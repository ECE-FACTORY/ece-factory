import { describe, it, expect } from 'vitest';
import { DecisionConsoleServer, type ActionProposer, type ApprovedActionCommitter } from './decision-console-server.js';
import { StopEnqueuer, observingGatewayCall, type GatewayCall } from './decision-console-wiring.js';
import { DecisionConsole, InMemoryConsoleAudit } from '../layer-2-command/decision-console/decision-console.js';
import { RepoCreationGateway, TicketGateway, type ExternalActionRequest } from '../layer-5-action/external-gateways/external-gateways.js';
import { ApprovalGate, type Principal } from '../layer-1-law/approval-gate/approval-gate.js';
import { McpBridge, type BridgeCallContext, type AuditedSequencerPort } from '../layer-5-action/mcp-bridge/mcp-bridge.js';
import { registerExternalTools, registerForbiddenTools, type ExternalSystems, type ExternalTarget } from '../layer-5-action/mcp-bridge/external-tools.js';
import { registerWriteTools, type WriteStores } from '../layer-5-action/mcp-bridge/write-tools.js';
import { registerFactoryReadTools } from '../layer-5-action/mcp-bridge/factory-read-tools.js';
import { registerDraftTools } from '../layer-5-action/mcp-bridge/draft-tools.js';
import { BridgeApprovalGate } from '../layer-5-action/mcp-bridge/tool-classes.js';
import { createDefaultToolRegistry } from '../layer-5-action/tool-registry/tool-registry.js';
import { PermissionEngine } from '../layer-1-law/permission-engine/permission-engine.js';
import { RedactionEngine } from '../factory-shared/redaction-engine/redaction-engine.js';
import type { Authorizer, SequencerRequest, SequencerOutcome, ExecuteFn, CommittedIntent, RefusalRequest } from '../factory-shared/audit-engine/sequencer.js';

// Wave 6 Piece 1d — the PROPOSE surface (Design 2, strict). Composition-root/transport only: a loopback-only,
// secret-gated route that lets the AI conduit INITIATE an external action into the SAME Console queue where a
// real human must approve. The propose path has NO approvalActionId anywhere — propose and approve are separate.
// Real bridge + gateways + gate + Console; the external systems are injected FAKES (no real network). The
// proposer/committer are wired here EXACTLY as the composition root wires them (server.ts). Guard/gauntlet/
// gateway files are untouched — this exercises the observation-only + transport seams.

const CONDUIT = 'claude-code';                                        // the proposer identity (never an approver)
const OPERATOR: Principal = { user_id: 'rashed', email: 'r@e', role: 'operator' }; // a REAL human operator
const SECRET = 'test-propose-secret';                                 // stands in for ECE_PROPOSE_TOKEN
const REPO: ExternalTarget = { system: 'github', targetId: 'ECE-PLATFORMS/ece-console-test', effect: 'create private repo ECE-PLATFORMS/ece-console-test', reversible: 'soft-only' };
const REPO_B: ExternalTarget = { system: 'github', targetId: 'ECE-PLATFORMS/ece-console-test-b', effect: 'create private repo ECE-PLATFORMS/ece-console-test-b', reversible: 'soft-only' };

// The conduit IDENTITY is 'claude-code' (structurally barred as an approver via SoD), carrying an admin ROLE —
// the real server principal's role — so the permission engine permits DRIVING create_github_repo (admin-tier).
// Role gates the attempt; the human token minted at approval remains the sole authority to COMMIT.
function conduitCtx(): BridgeCallContext {
  return { principal: { user_id: CONDUIT, email: '', role: 'admin' }, organization_id: 'orgP', session: { session_id: 's' }, environment: 'local', via: CONDUIT };
}

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
  createMilestone(t: ExternalTarget) { return this.rec('create_milestone', t); }
  createLabel(t: ExternalTarget) { return this.rec('create_label', t); }
  createIssueBatch(t: ExternalTarget) { return this.rec('create_issue_batch', t); }
}
class FakeWriteStores implements WriteStores {
  createOpenItem() { return Promise.resolve({ ok: true }); }
  private nope = () => Promise.reject(new Error('n/a'));
  recordReviewDecision = this.nope; recordHumanSignoff = this.nope; recordApprovalGate = this.nope; updateRiskStatus = this.nope; recordWaveSignoff = this.nope;
}

// Build the real object graph + the propose/commit seams EXACTLY as server.ts wires them at the composition root.
function setup() {
  const registry = createDefaultToolRegistry();
  registerFactoryReadTools(registry); registerDraftTools(registry); registerWriteTools(registry); registerExternalTools(registry); registerForbiddenTools(registry);
  const gate = new ApprovalGate();
  const externals = new FakeExternals();
  const bridge = new McpBridge(registry, new FakeSequencer(new PermissionEngine(registry)), { searchClients: async () => [] }, new RedactionEngine(['ok', 'targetId']), { writeStores: new FakeWriteStores(), externalSystems: externals, approvalGate: new BridgeApprovalGate(gate, CONDUIT) });
  const console = new DecisionConsole(gate, new InMemoryConsoleAudit());
  const enqueuer = new StopEnqueuer(console);
  const gatewayByTool: Record<string, GatewayCall> = {
    create_github_repo: observingGatewayCall('create_github_repo', (r, c) => new RepoCreationGateway(bridge).createRepo(r, c), enqueuer),
    create_ticket: observingGatewayCall('create_ticket', (r, c) => new TicketGateway(bridge).createTicket(r, c), enqueuer),
  };
  const proposed = new Map<string, { tool: string; request: ExternalActionRequest }>();
  const listPending = console.listPending.bind(console);
  const proposer: ActionProposer = {
    async propose(input) {
      const call = gatewayByTool[input.tool];
      if (!call) return { status: 'refused', reason: `unknown or non-external tool "${input.tool}"` };
      const request: ExternalActionRequest = { target: input.target as ExternalTarget, payload: input.payload as Record<string, unknown> | undefined }; // NO approvalActionId
      const out = await call(request, conduitCtx());
      if (out.status !== 'STOP_FOR_APPROVAL') return { status: out.status, reason: 'reason' in out ? out.reason : undefined };
      const pendingActionId = listPending().find((it) => it.tool === input.tool && it.target === request.target?.targetId)?.actionId;
      if (pendingActionId) proposed.set(pendingActionId, { tool: input.tool, request });
      return { status: out.status, pendingActionId };
    },
  };
  const committer: ApprovedActionCommitter = {
    async commit(actionId) {
      const e = proposed.get(actionId);
      if (!e) return undefined;
      const call = gatewayByTool[e.tool];
      const out = await call({ ...e.request, approvalActionId: actionId }, conduitCtx());
      if (out.status === 'EXTERNAL-ACTION-COMMITTED') proposed.delete(actionId);
      return { status: out.status, committed: out.status === 'EXTERNAL-ACTION-COMMITTED' ? out.committed : undefined, reason: 'reason' in out ? out.reason : undefined };
    },
  };
  let n = 0;
  const server = new DecisionConsoleServer(console, { proposer, committer, proposeToken: SECRET, idgen: () => `sess_${++n}` });
  return { server, console, externals, proposer, proposed };
}

function propose(server: DecisionConsoleServer, target: ExternalTarget = REPO, token = SECRET) {
  return server.proposeRoute({ method: 'POST', path: '/api/propose', proposeToken: token, body: { tool: 'create_github_repo', target } });
}
function loginOperator(server: DecisionConsoleServer, operator: Principal = OPERATOR): string {
  return server.route({ method: 'POST', path: '/api/login', body: { operator } }).setSessionId!;
}

describe('Piece 1d — propose INITIATES: action reaches the gateway → STOPs → auto-enqueues → returns pendingActionId (no commit)', () => {
  it('a valid propose enqueues into the Console and returns the pending id; the external port is NOT reached', async () => {
    const { server, console, externals } = setup();
    const r = await propose(server);
    expect(r.status).toBe(200);
    const body = JSON.parse(r.body);
    expect(body.ok).toBe(true);
    expect(body.outcome.status).toBe('STOP_FOR_APPROVAL');
    expect(body.outcome.pendingActionId).toBeTruthy();
    // it landed in the SAME Console queue a human approves in
    const pending = console.listPending();
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ tool: 'create_github_repo', target: REPO.targetId });
    expect(pending[0].proposingCaller).toBe(CONDUIT);   // attributed to the conduit, never a human
    expect(externals.calls).toHaveLength(0);            // propose alone commits NOTHING
  });

  it('the propose surface can ONLY ever STOP — it never returns a committed outcome', async () => {
    const { server } = setup();
    const body = JSON.parse((await propose(server)).body);
    expect(body.outcome.status).not.toBe('EXTERNAL-ACTION-COMMITTED');
  });
});

describe('Piece 1d — the propose path has NO approvalActionId (structural): a propose cannot carry/reference an approval', () => {
  it('the ActionProposer exposes ONLY propose(), and its input has no approvalActionId field (compile-time)', async () => {
    const { proposer } = setup();
    expect(Object.keys(proposer)).toEqual(['propose']); // no approve/refuse/resolve/commit — cannot mint or commit
    // @ts-expect-error — approvalActionId is not part of the propose input under Design 2 (strict).
    const out = await proposer.propose({ tool: 'not_external', target: REPO, approvalActionId: 'x' });
    expect(out.status).toBe('refused'); // unknown tool refused; the excess approvalActionId is a type error above
  });

  it('even a raw body carrying approvalActionId cannot commit — proposeRoute ignores it and still STOPs', async () => {
    const { server, console, externals } = setup();
    // first, get a real minted approval for REPO
    const id = JSON.parse((await propose(server)).body).outcome.pendingActionId as string;
    expect(console.approve(id, OPERATOR, 'ok').status).toBe('APPROVED'); // token now exists for this action
    // attacker-style: try to smuggle the approval id through the PROPOSE body
    const r = await server.proposeRoute({ method: 'POST', path: '/api/propose', proposeToken: SECRET, body: { tool: 'create_github_repo', target: REPO, approvalActionId: id } });
    const body = JSON.parse(r.body);
    expect(body.outcome.status).toBe('STOP_FOR_APPROVAL'); // ignored — propose drives with NO token
    expect(externals.calls).toHaveLength(0);               // nothing committed via propose
  });
});

describe('Piece 1d — attribution: proposed actions are the claude-code conduit → it cannot self-approve; a real operator is required', () => {
  it('the conduit / AI / requester cannot approve; only a distinct real operator can', async () => {
    const { server, console } = setup();
    const id = JSON.parse((await propose(server)).body).outcome.pendingActionId as string;
    expect(console.approve(id, { user_id: CONDUIT }, 'x').status).toBe('rejected');  // proposing caller barred (SoD)
    expect(console.approve(id, { user_id: 'claude' }, 'x').status).toBe('rejected'); // the AI barred
    expect(console.approve(id, { user_id: '' }, 'x').status).toBe('rejected');       // anonymous barred
    expect(console.approve(id, OPERATOR, 'reviewed').status).toBe('APPROVED');       // a real, distinct human
  });
});

describe('Piece 1d — hardening: ECE_PROPOSE_TOKEN required; secret never leaked; surface off when unconfigured', () => {
  it('wrong / missing secret ⇒ 401; the secret is never echoed in a response body', async () => {
    const { server } = setup();
    const wrong = await propose(server, REPO, 'nope');
    expect(wrong.status).toBe(401);
    const missing = await server.proposeRoute({ method: 'POST', path: '/api/propose', body: { tool: 'create_github_repo', target: REPO } });
    expect(missing.status).toBe(401);
    expect(wrong.body).not.toContain(SECRET);
    expect(missing.body).not.toContain(SECRET);
  });

  it('no proposer/token configured ⇒ the propose route is locked (404)', async () => {
    const { console } = setup();
    const off = new DecisionConsoleServer(console); // no propose options
    const r = await off.proposeRoute({ method: 'POST', path: '/api/propose', proposeToken: SECRET, body: { tool: 'create_github_repo', target: REPO } });
    expect(r.status).toBe(404);
  });
});

describe('Piece 1d — loopback-only bind', () => {
  it('listen() binds to 127.0.0.1 (not reachable on a non-loopback interface)', async () => {
    const { server } = setup();
    const srv = server.listen(0);
    await new Promise<void>((resolve) => srv.once('listening', () => resolve()));
    const addr = srv.address();
    expect(typeof addr === 'object' && addr !== null ? addr.address : addr).toBe('127.0.0.1');
    await new Promise<void>((resolve) => srv.close(() => resolve()));
  });
});

describe('Piece 1d — after a REAL operator approves ⇒ commits through the UNCHANGED gauntlet (single-use, per-action bound)', () => {
  it('propose → operator approve (via /api/approve) → EXTERNAL-ACTION-COMMITTED once; a second approve cannot re-commit', async () => {
    const { server, externals } = setup();
    const id = JSON.parse((await propose(server)).body).outcome.pendingActionId as string;
    const sid = loginOperator(server);
    const a = await server.approveRoute({ method: 'POST', path: '/api/approve', sessionId: sid, body: { actionId: id, reason: 'looks good' } });
    expect(a.status).toBe(200);
    const ab = JSON.parse(a.body);
    expect(ab.outcome.status).toBe('APPROVED');
    expect(ab.outcome.approver).toBe('rashed');                 // attributed to the real operator, never claude
    expect(ab.commit.status).toBe('EXTERNAL-ACTION-COMMITTED'); // committed through the unchanged gauntlet
    expect(externals.calls).toEqual(['create_github_repo:ECE-PLATFORMS/ece-console-test']);
    // single-use: the action is resolved; approving again mints nothing and commits nothing
    const a2 = await server.approveRoute({ method: 'POST', path: '/api/approve', sessionId: sid, body: { actionId: id, reason: 'again' } });
    expect(a2.status).toBe(409);
    expect(externals.calls).toHaveLength(1);
  });

  it('per-action bound: approving repoA commits ONLY repoA; repoB stays pending & uncommitted', async () => {
    const { server, console, externals } = setup();
    const idA = JSON.parse((await propose(server, REPO)).body).outcome.pendingActionId as string;
    await propose(server, REPO_B);
    const sid = loginOperator(server);
    const a = await server.approveRoute({ method: 'POST', path: '/api/approve', sessionId: sid, body: { actionId: idA, reason: 'ok' } });
    expect(JSON.parse(a.body).commit.status).toBe('EXTERNAL-ACTION-COMMITTED');
    expect(externals.calls).toEqual(['create_github_repo:ECE-PLATFORMS/ece-console-test']); // only A
    expect(console.listPending().map((it) => it.target)).toEqual([REPO_B.targetId]);         // B still awaiting a human
  });

  it('REFUSE never commits: an operator refusal leaves the external port untouched', async () => {
    const { server, console, externals } = setup();
    const id = JSON.parse((await propose(server)).body).outcome.pendingActionId as string;
    const sid = loginOperator(server);
    const r = await server.route({ method: 'POST', path: '/api/refuse', sessionId: sid, body: { actionId: id, reason: 'not now' } });
    expect(JSON.parse(r.body).outcome.status).toBe('REFUSED');
    expect(externals.calls).toHaveLength(0);
    expect(console.listPending()).toHaveLength(0);
  });
});
