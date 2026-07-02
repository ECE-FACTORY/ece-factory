import { describe, it, expect } from 'vitest';
import { StopEnqueuer, EnqueueingServerCore, observingGatewayCall, type GatewayCall } from './decision-console-wiring.js';
import { McpServerCore, type McpServerBridge } from './server-core.js';
import { DecisionConsole, InMemoryConsoleAudit } from '../features/decision-console/decision-console.js';
import { RepoCreationGateway, TicketGateway, CrmGateway, EmailGateway, DeployGateway, type ExternalActionRequest } from '../features/external-gateways/external-gateways.js';
import { ApprovalGate, type Principal } from '../features/approval-gate/approval-gate.js';
import { McpBridge, type BridgeCallContext, type AuditedSequencerPort } from '../features/mcp-bridge/mcp-bridge.js';
import { registerExternalTools, registerForbiddenTools, type ExternalSystems, type ExternalTarget } from '../features/mcp-bridge/external-tools.js';
import { registerWriteTools, type WriteStores } from '../features/mcp-bridge/write-tools.js';
import { registerFactoryReadTools } from '../features/mcp-bridge/factory-read-tools.js';
import { registerDraftTools } from '../features/mcp-bridge/draft-tools.js';
import { BridgeApprovalGate } from '../features/mcp-bridge/tool-classes.js';
import { createDefaultToolRegistry } from '../features/tool-registry/tool-registry.js';
import { PermissionEngine } from '../features/permission-engine/permission-engine.js';
import { RedactionEngine } from '../features/redaction-engine/redaction-engine.js';
import type { Authorizer, SequencerRequest, SequencerOutcome, ExecuteFn, CommittedIntent, RefusalRequest } from '../features/audit-engine/sequencer.js';

// Wave 6 Piece 1c — external-action STOPs (which surface at the gateways, not callTool) auto-enqueue into the
// SAME Console queue as internal writes, observation-only. Real bridge + gateways; the external systems are
// injected FAKES (no real network). The gateway/gauntlet files are NOT edited — the observer is a wrapper.

const CALLER = 'claude';
const OPERATOR: Principal = { user_id: 'human_boss', email: 'b@e', role: 'admin' };
function ctx(): BridgeCallContext { return { principal: { user_id: 'admin1', email: 'a@e', role: 'admin' }, organization_id: 'orgG', session: { session_id: 's' }, environment: 'local', via: CALLER }; }

class FakeSequencer implements AuditedSequencerPort {
  constructor(private readonly authorizer: Authorizer) {}
  private seq = 0;
  async recordRefusal(_r: RefusalRequest): Promise<void> {}
  async run<T>(req: SequencerRequest, execute: ExecuteFn<T>): Promise<SequencerOutcome<T>> {
    const d = await this.authorizer.authorize({ human_actor: req.principal, organization_id: req.organization_id, tool: req.tool, environment: req.environment, connector: req.session.connector_id });
    if (d.decision !== 'ALLOW') return { status: 'refused', stage: 'authorize', reason: d.reason ?? d.decision };
    const seq = ++this.seq; const c = { intent_id: `i${seq}`, organization_id: req.organization_id, seq } as unknown as CommittedIntent;
    try { const r = await execute(c); return { status: 'completed', value: r.value, intent: c, result: { seq, entry_hash: `h${seq}` } }; }
    catch (e) { return { status: 'execute-failed', intent: c, result: { seq, entry_hash: `h${seq}` }, error: e }; }
  }
}
class FakeExternals implements ExternalSystems {
  calls: string[] = [];
  private rec(tool: string, t: ExternalTarget) { this.calls.push(`${tool}:${t.targetId}`); return Promise.resolve({ ok: true, targetId: t.targetId }); }
  createGithubRepo(t: ExternalTarget) { return this.rec('create_github_repo', t); }
  openPullRequest(t: ExternalTarget) { return this.rec('open_pull_request', t); }
  createTicket(t: ExternalTarget) { return this.rec('create_ticket', t); }
  updateCrmRecord(t: ExternalTarget) { return this.rec('update_crm_record', t); }
  sendEmail(t: ExternalTarget) { return this.rec('send_email', t); }
  deployPackage(t: ExternalTarget) { return this.rec('deploy_package', t); }
}
class FakeWriteStores implements WriteStores {
  createOpenItem() { return Promise.resolve({ ok: true }); }
  private nope = () => Promise.reject(new Error('n/a'));
  recordReviewDecision = this.nope; recordHumanSignoff = this.nope; recordApprovalGate = this.nope; updateRiskStatus = this.nope; recordWaveSignoff = this.nope;
}

function setup() {
  const registry = createDefaultToolRegistry();
  registerFactoryReadTools(registry); registerDraftTools(registry); registerWriteTools(registry); registerExternalTools(registry); registerForbiddenTools(registry);
  const gate = new ApprovalGate();
  const externals = new FakeExternals();
  const bridge = new McpBridge(registry, new FakeSequencer(new PermissionEngine(registry)), { searchClients: async () => [] }, new RedactionEngine(['ok', 'targetId']), { writeStores: new FakeWriteStores(), externalSystems: externals, approvalGate: new BridgeApprovalGate(gate, CALLER) });
  const console = new DecisionConsole(gate, new InMemoryConsoleAudit());
  const enqueuer = new StopEnqueuer(console);
  const observed: Record<string, GatewayCall> = {
    create_github_repo: observingGatewayCall('create_github_repo', (r, c) => new RepoCreationGateway(bridge).createRepo(r, c), enqueuer),
    create_ticket: observingGatewayCall('create_ticket', (r, c) => new TicketGateway(bridge).createTicket(r, c), enqueuer),
    update_crm_record: observingGatewayCall('update_crm_record', (r, c) => new CrmGateway(bridge).updateRecord(r, c), enqueuer),
    send_email: observingGatewayCall('send_email', (r, c) => new EmailGateway(bridge).sendEmail(r, c), enqueuer),
    deploy_package: observingGatewayCall('deploy_package', (r, c) => new DeployGateway(bridge).deploy(r, c), enqueuer),
  };
  const innerCore = new EnqueueingServerCore(new McpServerCore(bridge as McpServerBridge, registry), enqueuer);
  return { console, externals, observed, core: innerCore };
}
const TARGETS: Record<string, ExternalTarget> = {
  create_github_repo: { system: 'github', targetId: 'ECE/repoA', effect: 'create repo ECE/repoA', reversible: 'soft-only' },
  create_ticket: { system: 'tickets', targetId: 'ECE/repoA', effect: 'create issue in ECE/repoA', reversible: 'soft-only' },
  update_crm_record: { system: 'crm', targetId: 'C-1', effect: 'update crm C-1', reversible: 'soft-only' },
  send_email: { system: 'email', targetId: 'a@x.com', effect: 'email a@x.com', reversible: 'no' },
  deploy_package: { system: 'deploy', targetId: 'pkg-1', effect: 'deploy pkg-1 dev', environment: 'dev', reversible: 'soft-only' },
};

describe('Piece 1c — each external gateway STOP auto-enqueues the exact external descriptor (idempotent)', () => {
  for (const tool of Object.keys(TARGETS)) {
    it(`${tool}: no-approval STOP ⇒ auto-enqueued with tool+target+effect; second identical stop not re-enqueued`, async () => {
      const { console, observed, externals } = setup();
      const req: ExternalActionRequest = { target: TARGETS[tool] };
      const out1 = await observed[tool](req, ctx());
      expect(out1.status).toBe('STOP_FOR_APPROVAL');   // outcome unchanged
      expect(externals.calls).toHaveLength(0);         // external port never reached on a stop
      await observed[tool](req, ctx());                // retry the same stopped action
      const pending = console.listPending().filter((it) => it.tool === tool);
      expect(pending).toHaveLength(1);                 // idempotent — one item
      expect(pending[0]).toMatchObject({ tool, target: TARGETS[tool].targetId, effect: TARGETS[tool].effect, tier: 'APPROVAL_REQUIRED_WRITE (external)' });
      expect(pending[0].descriptor.after).toMatchObject({ system: TARGETS[tool].system, effect: TARGETS[tool].effect });
    });
  }
});

describe('Piece 1c — observation does not change the gateway outcome', () => {
  it('the wrapped call returns the same outcome the bare gateway would (verbatim)', async () => {
    const { observed } = setup();
    const out = await observed.create_github_repo({ target: TARGETS.create_github_repo }, ctx());
    expect(out).toEqual({ status: 'STOP_FOR_APPROVAL', reason: expect.any(String) });
  });
});

describe('Piece 1c — end-to-end external: stop → auto-enqueue → operator APPROVE → commit through the unchanged gauntlet', () => {
  it('create_github_repo commits once after a real approval; single-use; per-action bound; refuse never commits', async () => {
    const { console, observed, externals } = setup();
    const target = TARGETS.create_github_repo;
    // stop → auto-enqueue
    const stop = await observed.create_github_repo({ target }, ctx());
    expect(stop.status).toBe('STOP_FOR_APPROVAL');
    const id = console.listPending().find((it) => it.tool === 'create_github_repo')!.actionId;
    // operator approve → commit through the unchanged gauntlet (fake external called once)
    expect(console.approve(id, OPERATOR, 'ok').status).toBe('APPROVED');
    const committed = await observed.create_github_repo({ target, approvalActionId: id }, ctx());
    expect(committed.status).toBe('EXTERNAL-ACTION-COMMITTED');
    expect(externals.calls).toEqual(['create_github_repo:ECE/repoA']);
    // single-use
    expect((await observed.create_github_repo({ target, approvalActionId: id }, ctx())).status).toBe('STOP_FOR_APPROVAL');
    expect(externals.calls).toHaveLength(1);
  });
  it('per-action binding: repoA approval cannot drive repoB; refuse ⇒ never commits', async () => {
    const { console, observed, externals } = setup();
    await observed.create_github_repo({ target: TARGETS.create_github_repo }, ctx());
    const idA = console.listPending().find((it) => it.tool === 'create_github_repo')!.actionId;
    console.approve(idA, OPERATOR, 'ok');
    const wrong = await observed.create_github_repo({ target: { ...TARGETS.create_github_repo, targetId: 'ECE/repoB', effect: 'create repo ECE/repoB' }, approvalActionId: idA }, ctx());
    expect(wrong.status).toBe('STOP_FOR_APPROVAL'); // bound to repoA
    expect(externals.calls).toHaveLength(0);

    // refuse path
    await observed.create_ticket({ target: TARGETS.create_ticket }, ctx());
    const idT = console.listPending().find((it) => it.tool === 'create_ticket')!.actionId;
    expect(console.refuse(idT, OPERATOR, 'no').status).toBe('REFUSED');
    expect((await observed.create_ticket({ target: TARGETS.create_ticket, approvalActionId: idT }, ctx())).status).toBe('STOP_FOR_APPROVAL');
  });
});

describe('Piece 1c — one Console queue shows BOTH internal and external pending items', () => {
  it('an internal write (callTool) and an external gateway stop appear in the same queue', async () => {
    const { console, observed, core } = setup();
    await core.callTool('create_open_item', { target: 'oi-1', payload: { item: 'x' } }, ctx()); // internal STOP → enqueue
    await observed.send_email({ target: TARGETS.send_email }, ctx());                            // external STOP → enqueue
    const tools = console.listPending().map((it) => it.tool).sort();
    expect(tools).toEqual(['create_open_item', 'send_email']); // unified queue
  });
});
