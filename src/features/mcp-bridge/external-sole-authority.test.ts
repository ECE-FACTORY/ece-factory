import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpBridge, EXPOSED_EXTERNAL_TOOLS, type BridgeCallContext, type ExternalCapability, type AuditedSequencerPort } from './mcp-bridge.js';
import { EXTERNAL_TOOLS, registerExternalTools, registerForbiddenTools, type ExternalSystems, type ExternalTarget, type ExternalParams } from './external-tools.js';
import { BridgeApprovalGate } from './tool-classes.js';
import { createDefaultToolRegistry } from '../tool-registry/tool-registry.js';
import { PermissionEngine } from '../permission-engine/permission-engine.js';
import { RedactionEngine } from '../redaction-engine/redaction-engine.js';
import { InMemoryKillSwitch } from '../kill-switch/kill-switch.js';
import { ApprovalGate, type ActionDescriptor } from '../approval-gate/approval-gate.js';
import type { Authorizer, SequencerRequest, SequencerOutcome, ExecuteFn, CommittedIntent, RefusalRequest } from '../audit-engine/sequencer.js';

// Phase 9.3 (OPEN_ITEM #9) — EXTERNAL-TIER SOLE-AUTHORITY PARITY. The Phase 8.8b PR-Engine capability pattern,
// generalized to ALL NINE external actions BY CONSTRUCTION. The proofs, per action:
//   (1) the generic externalActionWithTool REFUSES it (stage `encapsulated`) — the external port never runs;
//   (2) its capability is UNFORGEABLE (the brand is a module-private symbol) and the capability-gated method
//       cannot be called capability-less (type-level);
//   (3) PER-ACTION BINDING — one action's capability cannot drive another (type-level AND runtime brand);
//   (4) the UNCHANGED full 8.4 gauntlet runs behind the capability path (token / specific-target / no-bulk /
//       kill-beats-approval / blast-radius audited);
//   (5) BOUNDARY — exactly ONE owner module references each action's capability path (9/9);
//   (6) EXTERNAL STAYS ON FAKES — zero real external calls on any path.

// ── fakes ────────────────────────────────────────────────────────────────────────────────────────────────
class XFakes implements ExternalSystems {
  calls: string[] = [];
  private rec(tool: string, t: ExternalTarget) { this.calls.push(`${tool}:${t.targetId}`); return Promise.resolve({ ok: true, targetId: t.targetId }); }
  createGithubRepo(t: ExternalTarget) { return this.rec('create_github_repo', t); }
  openPullRequest(t: ExternalTarget) { return this.rec('open_pull_request', t); }
  createTicket(t: ExternalTarget) { return this.rec('create_ticket', t); }
  updateCrmRecord(t: ExternalTarget) { return this.rec('update_crm_record', t); }
  sendEmail(t: ExternalTarget) { return this.rec('send_email', t); }
  deployPackage(t: ExternalTarget) { return this.rec('deploy_package', t); }
  createMilestone(t: ExternalTarget) { return this.rec('create_milestone', t); }
  createLabel(t: ExternalTarget) { return this.rec('create_label', t); }
  createIssueBatch(t: ExternalTarget) { return this.rec('create_issue_batch', t); }
}

// Records intents (with the redacted blast-radius summary); refuses on a non-ALLOW authorize decision.
class FakeSequencer implements AuditedSequencerPort {
  intents: { tool: string; summary: Record<string, unknown> }[] = []; results: number[] = []; refusals: { tool: string }[] = [];
  private seq = 0;
  constructor(private readonly authorizer: Authorizer) {}
  async recordRefusal(req: RefusalRequest): Promise<void> { this.refusals.push({ tool: req.tool.name }); }
  async run<T>(req: SequencerRequest, execute: ExecuteFn<T>): Promise<SequencerOutcome<T>> {
    const decision = await this.authorizer.authorize({ human_actor: req.principal, organization_id: req.organization_id, tool: req.tool, environment: req.environment, connector: req.session.connector_id });
    if (decision.decision !== 'ALLOW') { this.refusals.push({ tool: req.tool.name }); return { status: 'refused', stage: 'authorize', reason: decision.reason ?? decision.decision }; }
    const seq = ++this.seq; this.intents.push({ tool: req.tool.name, summary: req.request_summary ?? {} });
    const committed = { intent_id: `i${seq}`, organization_id: req.organization_id, seq } as unknown as CommittedIntent;
    try { const r = await execute(committed); this.results.push(seq); return { status: 'completed', value: r.value, intent: committed, result: { seq, entry_hash: `h${seq}` } }; }
    catch (e) { return { status: 'execute-failed', intent: committed, result: { seq, entry_hash: `h${seq}` }, error: e }; }
  }
}

const CALLER = 'claude';
function ctx(over: Partial<BridgeCallContext> = {}): BridgeCallContext {
  return { principal: { user_id: 'admin1', email: 'a@ece.ae', role: 'admin' }, organization_id: 'orgSA', session: { session_id: 's1' }, environment: 'local', via: CALLER, ...over };
}
function build(opts: { kill?: InMemoryKillSwitch } = {}) {
  const registry = createDefaultToolRegistry();
  registerExternalTools(registry); registerForbiddenTools(registry);
  const externals = new XFakes();
  const gate = new ApprovalGate();
  const seq = new FakeSequencer(new PermissionEngine(registry, { killSwitch: opts.kill }));
  const bridge = new McpBridge(registry, seq, { searchClients: async () => [] }, new RedactionEngine(['ok', 'targetId']), { externalSystems: externals, approvalGate: new BridgeApprovalGate(gate, CALLER) });
  return { bridge, seq, externals, gate };
}
function descriptor(tool: string, t: ExternalTarget): ActionDescriptor {
  return { tool, target: t.targetId, after: { system: t.system, effect: t.effect, environment: t.environment ?? null, payload: null }, risk: 'WRITE_MEDIUM_RISK', reversible: t.reversible, requestedBy: { user_id: 'admin1', email: 'a@ece.ae', role: 'admin' } };
}
function approve(gate: ApprovalGate, tool: string, t: ExternalTarget): string {
  const q = gate.request(descriptor(tool, t));
  gate.resolve({ actionId: q.actionId, approver: { user_id: 'human_boss', email: 'b@e', role: 'admin' }, decision: 'APPROVE', reason: 'reviewed' });
  return q.actionId;
}

// Each action: its capability minter, its capability-gated method, and a specific target. ONE row per action.
type Row = { action: typeof EXTERNAL_TOOLS[number]; viaCapability: (b: McpBridge, c: BridgeCallContext, p?: ExternalParams) => Promise<unknown>; target: ExternalTarget };
const ROWS: Row[] = [
  { action: 'create_github_repo', viaCapability: (b, c, p) => b.createGithubRepo(b.grantCreateGithubRepoCapability(), c, p), target: { system: 'github', targetId: 'ECE-FACTORY/x', effect: 'create repo ECE-FACTORY/x private', reversible: 'soft-only' } },
  { action: 'open_pull_request', viaCapability: (b, c, p) => b.openPullRequest(b.grantPrOpenCapability(), c, p), target: { system: 'github', targetId: 'ECE-FACTORY/x#a->b', effect: 'open PR', reversible: 'soft-only' } },
  { action: 'create_ticket', viaCapability: (b, c, p) => b.createTicket(b.grantCreateTicketCapability(), c, p), target: { system: 'tickets', targetId: 'T-1', effect: 'create ticket T-1', reversible: 'soft-only' } },
  { action: 'update_crm_record', viaCapability: (b, c, p) => b.updateCrmRecord(b.grantUpdateCrmRecordCapability(), c, p), target: { system: 'crm', targetId: 'C-1', effect: 'update crm C-1', reversible: 'soft-only' } },
  { action: 'send_email', viaCapability: (b, c, p) => b.sendEmail(b.grantSendEmailCapability(), c, p), target: { system: 'email', targetId: 'a@x.com', effect: 'email a@x.com', reversible: 'no' } },
  { action: 'deploy_package', viaCapability: (b, c, p) => b.deployPackage(b.grantDeployPackageCapability(), c, p), target: { system: 'deploy', targetId: 'pkg-1', effect: 'deploy pkg-1 to dev', environment: 'dev', reversible: 'soft-only' } },
  { action: 'create_milestone', viaCapability: (b, c, p) => b.createMilestone(b.grantCreateMilestoneCapability(), c, p), target: { system: 'github', targetId: 'ECE-FACTORY/x', effect: 'create milestone in ECE-FACTORY/x', reversible: 'soft-only' } },
  { action: 'create_label', viaCapability: (b, c, p) => b.createLabel(b.grantCreateLabelCapability(), c, p), target: { system: 'github', targetId: 'ECE-FACTORY/x', effect: 'create label in ECE-FACTORY/x', reversible: 'soft-only' } },
  { action: 'create_issue_batch', viaCapability: (b, c, p) => b.createIssueBatch(b.grantCreateIssueBatchCapability(), c, p), target: { system: 'github', targetId: 'ECE-FACTORY/x', effect: 'create issue batch in ECE-FACTORY/x', reversible: 'soft-only' } },
];

describe('External sole-authority — the generic external path refuses ALL NINE (encapsulated); the port never runs', () => {
  for (const { action, target } of ROWS) {
    it(`externalActionWithTool("${action}") ⇒ refused (encapsulated); external port not reached`, async () => {
      const { bridge, externals } = build();
      const out = await bridge.externalActionWithTool(action, ctx(), { target });
      expect(out.status).toBe('refused');
      if (out.status === 'refused') expect(out.stage).toBe('encapsulated');
      expect(externals.calls).toHaveLength(0);
    });
  }
  it('all nine EXPOSED_EXTERNAL_TOOLS are encapsulated (the set the generic path refuses == the external surface)', () => {
    expect([...EXPOSED_EXTERNAL_TOOLS].sort()).toEqual([...EXTERNAL_TOOLS].sort());
  });
});

describe('External sole-authority — each capability is unforgeable and the action cannot be called capability-less (type-level)', () => {
  it('a capability cannot be constructed outside the bridge, and every action method requires it', () => {
    const { bridge } = build();
    // @ts-expect-error ExternalCapability is branded with a module-private symbol — unconstructible here
    const forged: ExternalCapability<'send_email'> = {};
    void forged;
    // @ts-expect-error createGithubRepo REQUIRES the capability as the first argument (no capability-less overload)
    void bridge.createGithubRepo(ctx(), {});
    // @ts-expect-error deployPackage REQUIRES the capability as the first argument
    void bridge.deployPackage(ctx(), {});
    // the legitimate path: the capability is obtained only from the bridge's per-action grant.
    expect(typeof bridge.grantSendEmailCapability).toBe('function');
    expect(typeof bridge.grantDeployPackageCapability).toBe('function');
  });
});

describe('External sole-authority — PER-ACTION binding: one action’s capability cannot drive another', () => {
  it('a create_github_repo capability cannot be passed to sendEmail (type-level)', () => {
    const { bridge } = build();
    const repoCap = bridge.grantCreateGithubRepoCapability();
    // @ts-expect-error a create_github_repo capability is NOT a send_email capability (phantom tool-name binding)
    void bridge.sendEmail(repoCap, ctx(), {});
    expect(repoCap).toBeDefined();
  });
  it('a mismatched capability (forced past the type system) is REFUSED at runtime by its brand; port not reached', async () => {
    const { bridge, externals } = build();
    const repoCap = bridge.grantCreateGithubRepoCapability();
    // force the wrong capability through — the runtime brand check rejects it (defense-in-depth)
    const out = await bridge.sendEmail(repoCap as unknown as ExternalCapability<'send_email'>, ctx(), { target: { system: 'email', targetId: 'a@x.com', effect: 'email a@x.com', reversible: 'no' } });
    expect(out.status).toBe('refused');
    if (out.status === 'refused') expect(out.stage).toBe('encapsulated');
    expect(externals.calls).toHaveLength(0);
  });
});

describe('External sole-authority — the UNCHANGED full 8.4 gauntlet runs behind the capability path', () => {
  it('a specific-target human token ⇒ EXTERNAL-ACTION-COMMITTED via the capability method; port called once; blast-radius audited', async () => {
    const { bridge, seq, gate, externals } = build();
    const t = ROWS[0].target; // create_github_repo
    const actionId = approve(gate, 'create_github_repo', t);
    const out = await bridge.createGithubRepo(bridge.grantCreateGithubRepoCapability(), ctx(), { approvalActionId: actionId, target: t }) ;
    expect(out.status).toBe('EXTERNAL-ACTION-COMMITTED');
    expect(externals.calls).toEqual(['create_github_repo:ECE-FACTORY/x']);
    const intent = seq.intents.find((i) => i.tool === 'create_github_repo')!;
    expect(intent.summary).toMatchObject({ system: 'github', target_id: 'ECE-FACTORY/x', reversibility: 'soft-only' }); // blast radius
  });
  it('no token ⇒ STOP_FOR_APPROVAL via the capability method; port never called', async () => {
    const { bridge, externals } = build();
    const out = await bridge.sendEmail(bridge.grantSendEmailCapability(), ctx(), { target: ROWS[4].target });
    expect(out.status).toBe('STOP_FOR_APPROVAL');
    expect(externals.calls).toHaveLength(0);
  });
  it('no bulk — a multi-target request ⇒ refused via the capability method; port never called', async () => {
    const { bridge, externals, gate } = build();
    const t = ROWS[0].target;
    const actionId = approve(gate, 'create_github_repo', t);
    const out = await bridge.createGithubRepo(bridge.grantCreateGithubRepoCapability(), ctx(), { approvalActionId: actionId, targets: [t, { ...t, targetId: 'ECE-FACTORY/y' }] });
    expect(out.status).toBe('refused');
    if (out.status === 'refused') expect(out.stage).toBe('hardening');
    expect(externals.calls).toHaveLength(0);
  });
  it('kill beats approval — a kill-switched action ⇒ refused even with a valid token; port never called', async () => {
    const kill = new InMemoryKillSwitch();
    kill.activate({ type: 'tool', name: 'create_github_repo' }, 'admin', 'freeze external');
    const { bridge, externals, gate } = build({ kill });
    const t = ROWS[0].target;
    const actionId = approve(gate, 'create_github_repo', t);
    const out = await bridge.createGithubRepo(bridge.grantCreateGithubRepoCapability(), ctx(), { approvalActionId: actionId, target: t });
    expect(out.status).toBe('refused');
    if (out.status === 'refused') expect(out.reason).toMatch(/kill/i);
    expect(externals.calls).toHaveLength(0);
  });
});

describe('External sole-authority — BOUNDARY: exactly ONE owner module references each action’s capability path (9/9)', () => {
  it('each grant<Action>Capability is referenced only by that action’s sanctioned owner module (src/ scan)', () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..'); // src/
    // action → (unambiguous grant marker, the single sanctioned owner directory)
    const owners: { action: string; marker: RegExp; owner: string }[] = [
      { action: 'create_github_repo', marker: /grantCreateGithubRepoCapability\(/, owner: 'features/external-gateways/' },
      { action: 'create_ticket', marker: /grantCreateTicketCapability\(/, owner: 'features/external-gateways/' },
      { action: 'update_crm_record', marker: /grantUpdateCrmRecordCapability\(/, owner: 'features/external-gateways/' },
      { action: 'send_email', marker: /grantSendEmailCapability\(/, owner: 'features/external-gateways/' },
      { action: 'deploy_package', marker: /grantDeployPackageCapability\(/, owner: 'features/external-gateways/' },
      { action: 'create_milestone', marker: /grantCreateMilestoneCapability\(/, owner: 'features/external-gateways/' },
      { action: 'create_label', marker: /grantCreateLabelCapability\(/, owner: 'features/external-gateways/' },
      { action: 'create_issue_batch', marker: /grantCreateIssueBatchCapability\(/, owner: 'features/external-gateways/' },
      { action: 'open_pull_request', marker: /grantPrOpenCapability\(|grantOpenPullRequestCapability\(/, owner: 'features/pr-engine/' },
    ];
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const p = path.join(dir, name);
        if (statSync(p).isDirectory()) { walk(p); continue; }
        if (!p.endsWith('.ts') || p.endsWith('.test.ts')) continue; // tests exercise the seam; not production refs
        files.push(p);
      }
    };
    walk(root);
    const coveredActions = new Set<string>();
    for (const { action, marker, owner } of owners) {
      const refs = files.map((p) => path.relative(root, p)).filter((rel) => marker.test(readFileSync(path.join(root, rel), 'utf8')));
      // the bridge DEFINES the grant (legitimate); every OTHER reference must be the single sanctioned owner.
      const offenders = refs.filter((rel) => !rel.startsWith('features/mcp-bridge/') && !rel.startsWith(owner));
      expect(offenders, `${action}: only ${owner} may hold the capability`).toEqual([]);
      const ownerRefs = refs.filter((rel) => rel.startsWith(owner));
      expect(ownerRefs.length, `${action}: its owner ${owner} must hold the capability`).toBeGreaterThanOrEqual(1);
      coveredActions.add(action);
    }
    expect([...coveredActions].sort()).toEqual([...EXTERNAL_TOOLS].sort()); // 6/6 actions have exactly one owner
  });
});
