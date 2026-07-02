import { describe, it, expect } from 'vitest';
import { DecisionConsole, InMemoryConsoleAudit, type EnqueueMeta } from './decision-console.js';
import { ApprovalGate, type ActionDescriptor, type Principal } from '../approval-gate/approval-gate.js';
import { McpBridge, type BridgeCallContext, type AuditedSequencerPort } from '../mcp-bridge/mcp-bridge.js';
import { registerExternalTools, registerForbiddenTools, type ExternalSystems, type ExternalTarget } from '../mcp-bridge/external-tools.js';
import { BridgeApprovalGate } from '../mcp-bridge/tool-classes.js';
import { createDefaultToolRegistry } from '../tool-registry/tool-registry.js';
import { PermissionEngine } from '../permission-engine/permission-engine.js';
import { RedactionEngine } from '../redaction-engine/redaction-engine.js';
import type { Authorizer, SequencerRequest, SequencerOutcome, ExecuteFn, CommittedIntent, RefusalRequest } from '../audit-engine/sequencer.js';

// Wave 6 Piece 1 — THE no-bypass proof. The Console-minted approval is EXACTLY the token the UNCHANGED Phase
// 8.4 gauntlet consumes: after a real operator APPROVEs a pending item in the Console, the SAME real McpBridge
// external action commits through its full guard stack; without it, it STOPs and the external port is never
// reached. The gate/bridge are untouched — the Console is only the human SOURCE of the approval.

const CALLER = 'claude';
class FakeSequencer implements AuditedSequencerPort {
  constructor(private readonly authorizer: Authorizer) {}
  private seq = 0;
  async recordRefusal(_r: RefusalRequest): Promise<void> {}
  async run<T>(req: SequencerRequest, execute: ExecuteFn<T>): Promise<SequencerOutcome<T>> {
    const d = await this.authorizer.authorize({ human_actor: req.principal, organization_id: req.organization_id, tool: req.tool, environment: req.environment, connector: req.session.connector_id });
    if (d.decision !== 'ALLOW') return { status: 'refused', stage: 'authorize', reason: d.reason ?? d.decision };
    const seq = ++this.seq; const committed = { intent_id: `i${seq}`, organization_id: req.organization_id, seq } as unknown as CommittedIntent;
    try { const r = await execute(committed); return { status: 'completed', value: r.value, intent: committed, result: { seq, entry_hash: `h${seq}` } }; }
    catch (e) { return { status: 'execute-failed', intent: committed, result: { seq, entry_hash: `h${seq}` }, error: e }; }
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
function ctx(): BridgeCallContext { return { principal: { user_id: 'admin1', email: 'a@ece.ae', role: 'admin' }, organization_id: 'orgDC', session: { session_id: 's' }, environment: 'local', via: CALLER }; }
const OPERATOR: Principal = { user_id: 'human_boss', email: 'b@e', role: 'admin' };
const META: EnqueueMeta = { tier: 'APPROVAL_REQUIRED_WRITE (external)', blastRadius: 1, proposingCaller: CALLER };

function ticketTarget(repo: string, title: string): ExternalTarget {
  return { system: 'tickets', targetId: repo, effect: `create issue in ${repo}: ${title}`, reversible: 'soft-only' };
}
// the descriptor whose `after` matches the bridge's binding for this external target+payload (per-action).
function ticketDescriptor(repo: string, title: string): ActionDescriptor {
  const t = ticketTarget(repo, title);
  return { tool: 'create_ticket', target: t.targetId, after: { system: t.system, effect: t.effect, environment: null, payload: { title } }, risk: 'WRITE_MEDIUM_RISK', reversible: 'soft-only', requestedBy: { user_id: 'admin1', email: 'a@e', role: 'admin' } };
}
function setup() {
  const registry = createDefaultToolRegistry(); registerExternalTools(registry); registerForbiddenTools(registry);
  const gate = new ApprovalGate();
  const externals = new FakeExternals();
  const bridge = new McpBridge(registry, new FakeSequencer(new PermissionEngine(registry)), { searchClients: async () => [] }, new RedactionEngine(['ok', 'targetId']), { externalSystems: externals, approvalGate: new BridgeApprovalGate(gate, CALLER) });
  const console = new DecisionConsole(gate, new InMemoryConsoleAudit());
  const cap = bridge.grantCreateTicketCapability();
  const drive = (repo: string, title: string, approvalActionId?: string) => bridge.createTicket(cap, ctx(), { approvalActionId, target: ticketTarget(repo, title), payload: { title } });
  return { bridge, gate, externals, console, drive };
}

describe('Decision Console × the gate — the Console-minted approval commits through the UNCHANGED gauntlet', () => {
  it('no approval ⇒ STOP, external port never reached; after a real operator APPROVE ⇒ COMMITS once', async () => {
    const { console, externals, drive } = setup();
    // 1. the action STOPs (no approval yet) — the external world is untouched
    expect((await drive('ECE-PLATFORMS/repoA', 'Bug')).status).toBe('STOP_FOR_APPROVAL');
    expect(externals.calls).toHaveLength(0);
    // 2. it becomes a pending item; the operator approves it in the Console
    const id = console.enqueue(ticketDescriptor('ECE-PLATFORMS/repoA', 'Bug'), META);
    expect(console.approve(id, OPERATOR, 'reviewed').status).toBe('APPROVED');
    // 3. re-driven WITH that approval ⇒ commits through the full unchanged gauntlet, port called once
    const out = await drive('ECE-PLATFORMS/repoA', 'Bug', id);
    expect(out.status).toBe('EXTERNAL-ACTION-COMMITTED');
    expect(externals.calls).toEqual(['create_ticket:ECE-PLATFORMS/repoA']);
  });

  it('the minted token is single-use — a second commit with the same approval ⇒ STOP', async () => {
    const { console, externals, drive } = setup();
    const id = console.enqueue(ticketDescriptor('ECE-PLATFORMS/repoA', 'Bug'), META);
    console.approve(id, OPERATOR, 'ok');
    expect((await drive('ECE-PLATFORMS/repoA', 'Bug', id)).status).toBe('EXTERNAL-ACTION-COMMITTED');
    expect((await drive('ECE-PLATFORMS/repoA', 'Bug', id)).status).toBe('STOP_FOR_APPROVAL'); // consumed once
    expect(externals.calls).toHaveLength(1);
  });

  it('per-action binding: an approval for repo A cannot drive an action on repo B', async () => {
    const { console, externals, drive } = setup();
    const idA = console.enqueue(ticketDescriptor('ECE-PLATFORMS/repoA', 'Bug'), META);
    console.approve(idA, OPERATOR, 'ok');
    const out = await drive('ECE-PLATFORMS/repoB', 'Bug', idA); // A's approval, B's target
    expect(out.status).toBe('STOP_FOR_APPROVAL');
    expect(externals.calls).toHaveLength(0);
  });

  it('REFUSE ⇒ the action never commits; the external port is never reached', async () => {
    const { console, externals, drive } = setup();
    const id = console.enqueue(ticketDescriptor('ECE-PLATFORMS/repoA', 'Bug'), META);
    expect(console.refuse(id, OPERATOR, 'no').status).toBe('REFUSED');
    expect((await drive('ECE-PLATFORMS/repoA', 'Bug', id)).status).toBe('STOP_FOR_APPROVAL');
    expect(externals.calls).toHaveLength(0);
  });

  it('no bypass: the AI cannot approve, so a claude-attempted item never commits', async () => {
    const { console, externals, drive } = setup();
    const id = console.enqueue(ticketDescriptor('ECE-PLATFORMS/repoA', 'Bug'), META);
    expect(console.approve(id, { user_id: 'claude' }, 'r').status).toBe('rejected'); // seat bars the AI
    expect((await drive('ECE-PLATFORMS/repoA', 'Bug', id)).status).toBe('STOP_FOR_APPROVAL'); // still held ⇒ never commits
    expect(externals.calls).toHaveLength(0);
  });

  it('sole-authority intact: the generic external path still refuses create_ticket even after Console approval', async () => {
    const { bridge, console } = setup();
    const id = console.enqueue(ticketDescriptor('ECE-PLATFORMS/repoA', 'Bug'), META);
    console.approve(id, OPERATOR, 'ok');
    const out = await bridge.externalActionWithTool('create_ticket', ctx(), { approvalActionId: id, target: ticketTarget('ECE-PLATFORMS/repoA', 'Bug'), payload: { title: 'Bug' } });
    expect(out.status).toBe('refused'); // encapsulated — the Console did not change the gate
    if (out.status === 'refused') expect(out.stage).toBe('encapsulated');
  });
});
