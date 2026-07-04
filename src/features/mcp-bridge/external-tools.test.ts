import { describe, it, expect } from 'vitest';
import { McpBridge, EXPOSED_TOOLS, EXPOSED_EXTERNAL_TOOLS, type BridgeCallContext, type AuditedSequencerPort } from './mcp-bridge.js';
import { EXTERNAL_TOOLS, FORBIDDEN_TOOLS, registerExternalTools, registerForbiddenTools, type ExternalSystems, type ExternalTarget, type ExternalParams } from './external-tools.js';
import { registerFactoryReadTools, classifyRegisteredTool } from './factory-read-tools.js';
import { registerDraftTools } from './draft-tools.js';
import { registerWriteTools } from './write-tools.js';
import { BridgeApprovalGate } from './tool-classes.js';
import { createDefaultToolRegistry, InMemoryToolRegistry } from '../tool-registry/tool-registry.js';
import { PermissionEngine } from '../permission-engine/permission-engine.js';
import { RedactionEngine } from '../redaction-engine/redaction-engine.js';
import { InMemoryKillSwitch } from '../kill-switch/kill-switch.js';
import { ApprovalGate, type ActionDescriptor } from '../approval-gate/approval-gate.js';
import type { Authorizer, SequencerRequest, SequencerOutcome, ExecuteFn, CommittedIntent, RefusalRequest } from '../audit-engine/sequencer.js';

// External-action tools (Phase 8.4) — pure-logic. NO real side effects: the external systems are FAKES that
// RECORD what would have happened. Guard decisions are real (Permission + Kill Switch); the approval is the
// real ApprovalGate behind BridgeApprovalGate. The real audit bracketing is in db-external-tools.test.ts.

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

// External systems FAKE — records calls; performs NO real action.
class FakeExternals implements ExternalSystems {
  calls: { tool: string; target: ExternalTarget }[] = [];
  private rec(tool: string, target: ExternalTarget) { this.calls.push({ tool, target }); return Promise.resolve({ ok: true, targetId: target.targetId }); }
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

const CALLER = 'claude';
function ctx(over: Partial<BridgeCallContext> = {}): BridgeCallContext {
  return { principal: { user_id: 'admin1', email: 'a@ece.ae', role: 'admin' }, organization_id: 'orgA', session: { session_id: 's1' }, environment: 'local', via: CALLER, ...over };
}
function target(over: Partial<ExternalTarget> = {}): ExternalTarget {
  return { system: 'github', targetId: 'ECE-FACTORY/x', effect: 'create repo ECE-FACTORY/x private', reversible: 'soft-only', ...over };
}
function descriptor(tool: string, t: ExternalTarget, payload?: Record<string, unknown>): ActionDescriptor {
  return { tool, target: t.targetId, after: { system: t.system, effect: t.effect, environment: t.environment ?? null, payload: payload ?? null }, risk: 'WRITE_MEDIUM_RISK', reversible: t.reversible, requestedBy: { user_id: 'admin1', email: 'a@ece.ae', role: 'admin' } };
}

function build(opts: { kill?: InMemoryKillSwitch; externals?: FakeExternals; gate?: ApprovalGate } = {}) {
  const registry = createDefaultToolRegistry();
  registerFactoryReadTools(registry); registerDraftTools(registry); registerWriteTools(registry);
  registerExternalTools(registry); registerForbiddenTools(registry);
  const externals = opts.externals ?? new FakeExternals();
  const gate = opts.gate ?? new ApprovalGate();
  const authorizer = new PermissionEngine(registry, { killSwitch: opts.kill });
  const seq = new FakeSequencer(authorizer);
  const bridge = new McpBridge(registry, seq, { searchClients: async () => [] }, new RedactionEngine(['ok', 'targetId']), { externalSystems: externals, approvalGate: new BridgeApprovalGate(gate, CALLER) });
  return { bridge, seq, registry, externals, gate };
}
function approve(gate: ApprovalGate, tool: string, t: ExternalTarget, payload?: Record<string, unknown>): string {
  const q = gate.request(descriptor(tool, t, payload));
  gate.resolve({ actionId: q.actionId, approver: { user_id: 'human_boss', email: 'b@e', role: 'admin' }, decision: 'APPROVE', reason: 'reviewed' });
  return q.actionId;
}

// Phase 8.8b generalized (9.3 / #9): the generic external path now REFUSES every external action — each is
// capability-encapsulated behind its owning module. These bridge-level gauntlet tests therefore drive each
// action through its capability-gated method (the UNCHANGED full 8.4 gauntlet runs behind it), exactly as the
// per-action gateways do. A non-external name (e.g. a FORBIDDEN tool) still routes through the generic path.
function callExternal(bridge: McpBridge, tool: string, c: BridgeCallContext, params: ExternalParams = {}) {
  switch (tool) {
    case 'create_github_repo': return bridge.createGithubRepo(bridge.grantCreateGithubRepoCapability(), c, params);
    case 'open_pull_request': return bridge.openPullRequest(bridge.grantPrOpenCapability(), c, params);
    case 'create_ticket': return bridge.createTicket(bridge.grantCreateTicketCapability(), c, params);
    case 'update_crm_record': return bridge.updateCrmRecord(bridge.grantUpdateCrmRecordCapability(), c, params);
    case 'send_email': return bridge.sendEmail(bridge.grantSendEmailCapability(), c, params);
    case 'deploy_package': return bridge.deployPackage(bridge.grantDeployPackageCapability(), c, params);
    case 'create_milestone': return bridge.createMilestone(bridge.grantCreateMilestoneCapability(), c, params);
    case 'create_label': return bridge.createLabel(bridge.grantCreateLabelCapability(), c, params);
    case 'create_issue_batch': return bridge.createIssueBatch(bridge.grantCreateIssueBatchCapability(), c, params);
    default: return bridge.externalActionWithTool(tool as never, c, params); // FORBIDDEN/unregistered → generic path (refused)
  }
}

describe('External tools — a specific-target human approval commits once with the exact target', () => {
  it('create_github_repo ⇒ EXTERNAL-ACTION-COMMITTED, port called once with the exact target, blast-radius audited', async () => {
    const { bridge, seq, gate, externals } = build();
    const t = target();
    const actionId = approve(gate, 'create_github_repo', t);
    const out = await callExternal(bridge, 'create_github_repo', ctx(), { approvalActionId: actionId, target: t });
    expect(out.status).toBe('EXTERNAL-ACTION-COMMITTED');
    expect(externals.calls).toHaveLength(1);
    expect(externals.calls[0]).toMatchObject({ tool: 'create_github_repo', target: { targetId: 'ECE-FACTORY/x' } });
    // blast-radius in the audit intent
    const intent = seq.intents.find((i) => i.tool === 'create_github_repo')!;
    expect(intent.summary).toMatchObject({ system: 'github', target_id: 'ECE-FACTORY/x', reversibility: 'soft-only' });
    expect(seq.results).toHaveLength(1); // intent (before) + result (after)
  });
});

describe('External tools — no/non-specific approval ⇒ STOP, external port NEVER called (the core)', () => {
  it('no approval ⇒ STOP_FOR_APPROVAL, zero external calls', async () => {
    const { bridge, externals } = build();
    const out = await callExternal(bridge, 'send_email', ctx(), { target: target({ system: 'email', targetId: 'a@x.com', effect: 'email a@x.com subject hi' }) });
    expect(out.status).toBe('STOP_FOR_APPROVAL');
    expect(externals.calls).toHaveLength(0); // the external world was never touched
  });
  it('a target-less / vague approval ⇒ refused, zero external calls', async () => {
    const { bridge, externals, gate } = build();
    // approve a proper action, but call with no target → hardening refuses before approval matters
    const actionId = approve(gate, 'send_email', target({ system: 'email', targetId: 'a@x.com', effect: 'email a@x.com' }));
    const out = await callExternal(bridge, 'send_email', ctx(), { approvalActionId: actionId });
    expect(out.status).toBe('refused');
    if (out.status === 'refused') expect(out.stage).toBe('hardening');
    expect(externals.calls).toHaveLength(0);
  });
});

describe('External tools — target mismatch (per-action binding on the external target)', () => {
  it('an approval for target X ⇒ refused for target Y, port not called', async () => {
    const { bridge, externals, gate } = build();
    const actionId = approve(gate, 'create_github_repo', target({ targetId: 'ECE-FACTORY/X' }));
    const out = await callExternal(bridge, 'create_github_repo', ctx(), { approvalActionId: actionId, target: target({ targetId: 'ECE-FACTORY/Y', effect: 'create repo ECE-FACTORY/Y private' }) });
    expect(out.status).toBe('STOP_FOR_APPROVAL'); // binding mismatch ⇒ not approved for THIS target
    expect(externals.calls).toHaveLength(0);
  });
});

describe('External tools — no bulk (one approval = one target)', () => {
  it('a multi-target request ⇒ refused, port not called', async () => {
    const { bridge, externals, gate } = build();
    const t = target();
    const actionId = approve(gate, 'create_github_repo', t);
    const out = await callExternal(bridge, 'create_github_repo', ctx(), { approvalActionId: actionId, targets: [t, target({ targetId: 'ECE-FACTORY/y' })] });
    expect(out.status).toBe('refused');
    if (out.status === 'refused') expect(out.stage).toBe('hardening');
    expect(externals.calls).toHaveLength(0);
  });
});

describe('External tools — FORBIDDEN tier (never callable)', () => {
  it('a FORBIDDEN tool ⇒ refused even with a would-be-valid token, port not called', async () => {
    const { bridge, externals, gate } = build();
    // mint an approval that would be "valid" for a forbidden action — it still cannot unlock it
    const t = target({ system: 'github', targetId: 'ECE-FACTORY/x', effect: 'force delete' });
    const actionId = approve(gate, 'force_delete_repo', t);
    const out = await callExternal(bridge, 'force_delete_repo' as never, ctx(), { approvalActionId: actionId, target: t });
    expect(out.status).toBe('refused');
    if (out.status === 'refused') expect(out.stage).toBe('forbidden');
    expect(externals.calls).toHaveLength(0);
  });
  it('every FORBIDDEN tool classifies as FORBIDDEN', () => {
    const { registry } = build();
    for (const n of FORBIDDEN_TOOLS) expect(classifyRegisteredTool(registry.require(n))).toBe('FORBIDDEN');
  });
});

describe('External tools — the kill switch and audit can never be targeted', () => {
  it('an external action targeting the audit log ⇒ refused, port not called', async () => {
    const { bridge, externals, gate } = build();
    const t = target({ system: 'audit', targetId: 'audit_intent', effect: 'tamper with audit' });
    const actionId = approve(gate, 'deploy_package', t);
    const out = await callExternal(bridge, 'deploy_package', ctx(), { approvalActionId: actionId, target: t });
    expect(out.status).toBe('refused');
    if (out.status === 'refused') expect(out.stage).toBe('forbidden');
    expect(externals.calls).toHaveLength(0);
  });
  it('an external action targeting the kill switch ⇒ refused', async () => {
    const { bridge, externals, gate } = build();
    const t = target({ system: 'deploy', targetId: 'kill-switch', effect: 'disable kill switch' });
    const actionId = approve(gate, 'deploy_package', t);
    const out = await callExternal(bridge, 'deploy_package', ctx(), { approvalActionId: actionId, target: t });
    expect(out.status).toBe('refused');
    expect(externals.calls).toHaveLength(0);
  });
});

describe('External tools — production gate', () => {
  it('a dev-scoped approval ⇒ refused for a production target, port not called', async () => {
    const { bridge, externals, gate } = build();
    // approve a DEV deploy
    const dev = target({ system: 'deploy', targetId: 'pkg-1', effect: 'deploy pkg-1 to dev', environment: 'dev' });
    const actionId = approve(gate, 'deploy_package', dev);
    // attempt a PRODUCTION deploy with the dev approval
    const prod = target({ system: 'deploy', targetId: 'pkg-1', effect: 'deploy pkg-1 to production', environment: 'production' });
    const out = await callExternal(bridge, 'deploy_package', ctx(), { approvalActionId: actionId, target: prod });
    expect(out.status).toBe('STOP_FOR_APPROVAL'); // dev approval cannot act on production (binding includes env)
    expect(externals.calls).toHaveLength(0);
  });
  it('a production-scoped approval ⇒ commits to a production target', async () => {
    const { bridge, externals, gate } = build();
    const prod = target({ system: 'deploy', targetId: 'pkg-1', effect: 'deploy pkg-1 to production', environment: 'production' });
    const actionId = approve(gate, 'deploy_package', prod);
    const out = await callExternal(bridge, 'deploy_package', ctx(), { approvalActionId: actionId, target: prod });
    expect(out.status).toBe('EXTERNAL-ACTION-COMMITTED');
    expect(externals.calls).toHaveLength(1);
  });
});

describe('External tools — kill beats approval', () => {
  it('a kill-switched external action ⇒ REFUSE even with a valid token, port not called', async () => {
    const kill = new InMemoryKillSwitch();
    kill.activate({ type: 'tool', name: 'create_github_repo' }, 'admin', 'freeze external');
    const { bridge, externals, gate } = build({ kill });
    const t = target();
    const actionId = approve(gate, 'create_github_repo', t);
    const out = await callExternal(bridge, 'create_github_repo', ctx(), { approvalActionId: actionId, target: t });
    expect(out.status).toBe('refused');
    if (out.status === 'refused') expect(out.reason).toMatch(/kill/i);
    expect(externals.calls).toHaveLength(0);
  });
});

describe('External tools — self-approval rejected', () => {
  it('an approval granted by the calling agent is not honored, port not called', async () => {
    const gate = new ApprovalGate();
    const t = target();
    const q = gate.request(descriptor('create_github_repo', t));
    gate.resolve({ actionId: q.actionId, approver: { user_id: 'human_boss', email: 'b@e', role: 'admin' }, decision: 'APPROVE', reason: 'ok' });
    const registry = createDefaultToolRegistry(); registerExternalTools(registry);
    const externals = new FakeExternals();
    const approvalGate = new BridgeApprovalGate(gate, 'human_boss'); // caller == approver ⇒ self-approval
    const seq = new FakeSequencer(new PermissionEngine(registry));
    const bridge = new McpBridge(registry, seq, { searchClients: async () => [] }, new RedactionEngine(['ok']), { externalSystems: externals, approvalGate });
    const out = await callExternal(bridge, 'create_github_repo', ctx({ principal: { user_id: 'human_boss', email: 'b@e', role: 'admin' } }), { approvalActionId: q.actionId, target: t });
    expect(out.status).toBe('STOP_FOR_APPROVAL');
    expect(externals.calls).toHaveLength(0);
  });
});

describe('External tools — four-tier surface, FORBIDDEN refused, per-tool permissioning, unregistered', () => {
  it('the exposed surface is the four tiers; FORBIDDEN tools are registered-and-refused, not exposed', () => {
    const { bridge, registry } = build();
    const tools = bridge.listTools();
    expect(tools).toHaveLength(EXPOSED_TOOLS.length); // 16 + 7 + 6 + 9 = 38 (FORBIDDEN not exposed)
    const classes = new Set(tools.map((t) => classifyRegisteredTool(registry.require(t.name))));
    expect([...classes].sort()).toEqual(['APPROVAL_REQUIRED_WRITE', 'DRAFT_ONLY', 'READ_ONLY']); // no FORBIDDEN exposed
    const externalNames = tools.filter((t) => EXPOSED_EXTERNAL_TOOLS.includes(t.name as never)).map((t) => t.name).sort();
    expect(externalNames).toEqual([...EXPOSED_EXTERNAL_TOOLS].sort());
    for (const n of EXTERNAL_TOOLS) expect(registry.require(n).blastRadius).toBe(1); // one external target, no bulk
  });
  it('per-tool permissioning: an operator is REFUSED deploy_package (admin-only)', async () => {
    const { bridge, gate } = build();
    const t = target({ system: 'deploy', targetId: 'pkg-1', effect: 'deploy pkg-1 to dev', environment: 'dev' });
    const actionId = approve(gate, 'deploy_package', t);
    const out = await callExternal(bridge, 'deploy_package', ctx({ principal: { user_id: 'op', email: 'o@e', role: 'operator' } }), { approvalActionId: actionId, target: t });
    expect(out.status).toBe('refused'); // deploy is admin-only
  });
  it('an unregistered external tool ⇒ refused (fail-closed)', async () => {
    const empty = new InMemoryToolRegistry();
    const seq = new FakeSequencer(new PermissionEngine(empty));
    const bridge = new McpBridge(empty, seq, { searchClients: async () => [] }, new RedactionEngine([]), { externalSystems: new FakeExternals(), approvalGate: new BridgeApprovalGate(new ApprovalGate()) });
    const out = await callExternal(bridge, 'create_ticket', ctx(), { target: target({ system: 'tickets', targetId: 'T-1', effect: 'create ticket T-1' }) });
    expect(out.status).toBe('refused');
    if (out.status === 'refused') expect(out.stage).toBe('registry');
  });
});
