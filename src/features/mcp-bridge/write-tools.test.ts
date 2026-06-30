import { describe, it, expect } from 'vitest';
import { McpBridge, EXPOSED_READ_TOOLS, EXPOSED_DRAFT_TOOLS, EXPOSED_WRITE_TOOLS, type BridgeCallContext, type AuditedSequencerPort, type WriteOutcome } from './mcp-bridge.js';
import { WRITE_TOOLS, registerWriteTools, type WriteStores, type WriteParams, type WriteRecord } from './write-tools.js';
import { registerFactoryReadTools, classifyRegisteredTool } from './factory-read-tools.js';
import { BridgeApprovalGate } from './tool-classes.js';
import { registerDraftTools } from './draft-tools.js';
import { createDefaultToolRegistry, InMemoryToolRegistry } from '../tool-registry/tool-registry.js';
import { PermissionEngine } from '../permission-engine/permission-engine.js';
import { RedactionEngine } from '../redaction-engine/redaction-engine.js';
import { InMemoryKillSwitch } from '../kill-switch/kill-switch.js';
import { ApprovalGate, type ActionDescriptor } from '../approval-gate/approval-gate.js';
import type { Authorizer, SequencerRequest, SequencerOutcome, ExecuteFn, CommittedIntent, RefusalRequest } from '../audit-engine/sequencer.js';

// Approval-gated internal write tools (Phase 8.3) — pure-logic. The guard DECISIONS are real (Permission +
// Kill Switch), the approval mechanism is the real ApprovalGate behind BridgeApprovalGate, and the stores
// are OBSERVABLE append-only fakes so we can prove the mutation lands (or doesn't). The real sequencer +
// Postgres sink + audit bracketing are exercised in db-write-tools.test.ts.

class FakeSequencer implements AuditedSequencerPort {
  intents: string[] = []; results: number[] = []; refusals: { tool: string }[] = [];
  private seq = 0;
  constructor(private readonly authorizer: Authorizer) {}
  async recordRefusal(req: RefusalRequest): Promise<void> { this.refusals.push({ tool: req.tool.name }); }
  async run<T>(req: SequencerRequest, execute: ExecuteFn<T>): Promise<SequencerOutcome<T>> {
    const decision = await this.authorizer.authorize({ human_actor: req.principal, organization_id: req.organization_id, tool: req.tool, environment: req.environment, connector: req.session.connector_id });
    if (decision.decision !== 'ALLOW') { this.refusals.push({ tool: req.tool.name }); return { status: 'refused', stage: 'authorize', reason: decision.reason ?? decision.decision }; }
    const seq = ++this.seq; this.intents.push(req.tool.name);
    const committed = { intent_id: `i${seq}`, organization_id: req.organization_id, seq } as unknown as CommittedIntent;
    try {
      const r = await execute(committed); this.results.push(seq);
      return { status: 'completed', value: r.value, intent: committed, result: { seq, entry_hash: `h${seq}` } };
    } catch (e) {
      return { status: 'execute-failed', intent: committed, result: { seq, entry_hash: `h${seq}` }, error: e };
    }
  }
}

// Append-only observable stores — push a snapshot, never overwrite.
class Stores implements WriteStores {
  reviewDecisions: WriteRecord[] = []; signoffs: WriteRecord[] = []; openItems: WriteRecord[] = [];
  approvalGates: WriteRecord[] = []; riskStatuses: WriteRecord[] = []; waveSignoffs: WriteRecord[] = [];
  private n = 0;
  private snap(arr: WriteRecord[], p: WriteParams): WriteRecord { const rec = { recordId: `r${++this.n}`, ...(p.payload ?? {}) }; arr.push(rec); return rec; }
  async recordReviewDecision(p: WriteParams) { return this.snap(this.reviewDecisions, p); }
  async recordHumanSignoff(p: WriteParams) { return this.snap(this.signoffs, p); }
  async createOpenItem(p: WriteParams) { return this.snap(this.openItems, p); }
  async recordApprovalGate(p: WriteParams) { return this.snap(this.approvalGates, p); }
  async updateRiskStatus(p: WriteParams) { return this.snap(this.riskStatuses, p); }
  async recordWaveSignoff(p: WriteParams) { return this.snap(this.waveSignoffs, p); }
}

const CALLER = 'claude';
function ctx(over: Partial<BridgeCallContext> = {}): BridgeCallContext {
  return { principal: { user_id: 'op', email: 'op@ece.ae', role: 'operator' }, organization_id: 'orgA', session: { session_id: 's1' }, environment: 'local', via: CALLER, ...over };
}
function descriptor(tool: string, target: string | undefined, payload: Record<string, unknown>): ActionDescriptor {
  return { tool, target, after: payload, risk: 'WRITE_LOW_RISK', reversible: 'soft-only', requestedBy: { user_id: 'op', email: 'op@ece.ae', role: 'operator' } };
}

function build(opts: { kill?: InMemoryKillSwitch; stores?: Stores; gate?: ApprovalGate; registry?: InMemoryToolRegistry } = {}) {
  const registry = opts.registry ?? createDefaultToolRegistry();
  registerFactoryReadTools(registry); registerDraftTools(registry); registerWriteTools(registry);
  const stores = opts.stores ?? new Stores();
  const gate = opts.gate ?? new ApprovalGate();
  const approvalGate = new BridgeApprovalGate(gate, CALLER); // caller cannot self-approve
  const authorizer = new PermissionEngine(registry, { killSwitch: opts.kill });
  const seq = new FakeSequencer(authorizer);
  const bridge = new McpBridge(registry, seq, { searchClients: async () => [] }, new RedactionEngine(['recordId', 'verdict', 'note', 'key', 'status', 'item', 'wave']), { writeStores: stores, approvalGate });
  return { bridge, seq, registry, stores, gate };
}

/** Request + human-APPROVE a specific action; returns its actionId. The approver is a real human (not the caller). */
function approve(gate: ApprovalGate, tool: string, target: string | undefined, payload: Record<string, unknown>): string {
  const q = gate.request(descriptor(tool, target, payload));
  gate.resolve({ actionId: q.actionId, approver: { user_id: 'human_boss', email: 'boss@ece.ae', role: 'admin' }, decision: 'APPROVE', reason: 'reviewed' });
  return q.actionId;
}

describe('Write tools — a valid single-use human approval commits once', () => {
  it('record_review_decision with a valid token ⇒ WRITE-COMMITTED, audited, mutation landed', async () => {
    const { bridge, seq, gate, stores } = build();
    const payload = { verdict: 'PASS', note: 'all green' };
    const actionId = approve(gate, 'record_review_decision', undefined, payload);
    const out = await bridge.writeWithTool('record_review_decision', ctx(), { approvalActionId: actionId, payload });
    expect(out.status).toBe('WRITE-COMMITTED');
    if (out.status === 'WRITE-COMMITTED') expect(out.approvalId).toBeTruthy();
    expect(stores.reviewDecisions).toHaveLength(1);     // mutation landed in the append-only store
    expect(seq.intents).toContain('record_review_decision');
    expect(seq.results).toHaveLength(1);                 // intent + result bracket the mutation
  });
});

describe('Write tools — no approval ⇒ STOP_FOR_APPROVAL, store unchanged (the core)', () => {
  it('a write with no token never runs', async () => {
    const { bridge, stores, seq } = build();
    const out = await bridge.writeWithTool('create_open_item', ctx(), { payload: { item: 'x' } });
    expect(out.status).toBe('STOP_FOR_APPROVAL');
    expect(stores.openItems).toHaveLength(0); // nothing written
    expect(seq.intents).toHaveLength(0);       // not even an audit intent — write withheld pre-flight
  });
});

describe('Write tools — single-use: a consumed token cannot be replayed (the core)', () => {
  it('replaying a consumed token ⇒ refused/withheld, no second mutation', async () => {
    const { bridge, gate, stores } = build();
    const payload = { key: 'RISK-1', status: 'mitigating' };
    const actionId = approve(gate, 'update_risk_status', 'RISK-1', payload);
    const first = await bridge.writeWithTool('update_risk_status', ctx(), { approvalActionId: actionId, target: 'RISK-1', payload });
    expect(first.status).toBe('WRITE-COMMITTED');
    const replay = await bridge.writeWithTool('update_risk_status', ctx(), { approvalActionId: actionId, target: 'RISK-1', payload });
    expect(replay.status).toBe('STOP_FOR_APPROVAL'); // token already consumed
    expect(stores.riskStatuses).toHaveLength(1);      // no second mutation
  });
});

describe('Write tools — per-action binding: a token for A cannot authorize B', () => {
  it('a token minted for action A ⇒ refused for a different action B, no mutation', async () => {
    const { bridge, gate, stores } = build();
    const actionId = approve(gate, 'update_risk_status', 'RISK-1', { key: 'RISK-1', status: 'mitigating' });
    // attempt a DIFFERENT action (different target + payload) with A's token
    const out = await bridge.writeWithTool('update_risk_status', ctx(), { approvalActionId: actionId, target: 'RISK-2', payload: { key: 'RISK-2', status: 'closed' } });
    expect(out.status).toBe('STOP_FOR_APPROVAL');
    expect(stores.riskStatuses).toHaveLength(0);
  });
});

describe('Write tools — self-approval rejected (caller cannot approve its own write)', () => {
  it('an approval granted by the calling agent is not honored', async () => {
    const gate = new ApprovalGate();
    const q = gate.request(descriptor('create_open_item', undefined, { item: 'x' }));
    // the gate engine refuses claude as approver; even a non-claude approver equal to the caller is rejected by the adapter
    const res = gate.resolve({ actionId: q.actionId, approver: { user_id: 'human_boss', email: 'boss@ece.ae', role: 'admin' }, decision: 'APPROVE', reason: 'ok' });
    expect(res.ok).toBe(true);
    // build a bridge whose CALLER is the same human as the approver → adapter rejects self-approval
    const stores2 = new Stores();
    const registry = createDefaultToolRegistry(); registerWriteTools(registry);
    const approvalGate = new BridgeApprovalGate(gate, 'human_boss');
    const seq = new FakeSequencer(new PermissionEngine(registry));
    const bridge2 = new McpBridge(registry, seq, { searchClients: async () => [] }, new RedactionEngine(['recordId', 'item']), { writeStores: stores2, approvalGate });
    const out = await bridge2.writeWithTool('create_open_item', ctx({ principal: { user_id: 'human_boss', email: 'boss@ece.ae', role: 'operator' } }), { approvalActionId: q.actionId, payload: { item: 'x' } });
    expect(out.status).toBe('STOP_FOR_APPROVAL'); // self-approval not honored
    expect(stores2.openItems).toHaveLength(0);
  });
  it('the Approval Gate engine refuses "claude" as approver outright', () => {
    const gate = new ApprovalGate();
    const q = gate.request(descriptor('create_open_item', undefined, { item: 'x' }));
    const res = gate.resolve({ actionId: q.actionId, approver: { user_id: 'claude', email: 'c@e', role: 'admin' }, decision: 'APPROVE', reason: 'self' });
    expect(res.ok).toBe(false);
  });
});

describe('Write tools — kill beats approval', () => {
  it('a kill-switched write ⇒ REFUSE even with a valid token, no mutation', async () => {
    const kill = new InMemoryKillSwitch();
    kill.activate({ type: 'tool', name: 'create_open_item' }, 'admin', 'freeze writes');
    const { bridge, gate, stores } = build({ kill });
    const actionId = approve(gate, 'create_open_item', undefined, { item: 'x' });
    const out = await bridge.writeWithTool('create_open_item', ctx(), { approvalActionId: actionId, payload: { item: 'x' } });
    expect(out.status).toBe('refused'); // kill beats a valid approval
    if (out.status === 'refused') expect(out.reason).toMatch(/kill/i);
    expect(stores.openItems).toHaveLength(0);
  });
});

describe('Write tools — append-only: history preserved across writes', () => {
  it('two approved risk-status transitions append two snapshots (no overwrite)', async () => {
    const { bridge, gate, stores } = build();
    const a1 = approve(gate, 'update_risk_status', 'RISK-1', { key: 'RISK-1', status: 'mitigating' });
    await bridge.writeWithTool('update_risk_status', ctx(), { approvalActionId: a1, target: 'RISK-1', payload: { key: 'RISK-1', status: 'mitigating' } });
    const a2 = approve(gate, 'update_risk_status', 'RISK-1', { key: 'RISK-1', status: 'closed' });
    await bridge.writeWithTool('update_risk_status', ctx(), { approvalActionId: a2, target: 'RISK-1', payload: { key: 'RISK-1', status: 'closed' } });
    expect(stores.riskStatuses).toHaveLength(2); // both snapshots preserved
    expect(stores.riskStatuses.map((r) => r.status)).toEqual(['mitigating', 'closed']);
  });
});

describe('Write tools — structural & unforgeable token', () => {
  it('WriteOutcome has no committed state reachable without a token (STOP/refused are the alternatives)', () => {
    // @ts-expect-error WRITE-COMMITTED requires committed+approvalId+auditSeq — it cannot be conjured bare
    const _bad: WriteOutcome = { status: 'WRITE-COMMITTED', tool: 'create_open_item' };
    void _bad;
  });
  // (the ConsumedApproval-unforgeable type-level proof lives in tool-classes.test.ts)
});

describe('Write tools — per-tool permissioning; unregistered; surface', () => {
  it('per-tool permissioning: an operator is REFUSED record_wave_signoff (admin-only)', async () => {
    const { bridge, gate } = build();
    const actionId = approve(gate, 'record_wave_signoff', undefined, { wave: 5 });
    const out = await bridge.writeWithTool('record_wave_signoff', ctx({ principal: { user_id: 'op', email: 'op@ece.ae', role: 'operator' } }), { approvalActionId: actionId, payload: { wave: 5 } });
    expect(out.status).toBe('refused'); // sign-offs are admin-only
  });
  it('an unregistered write tool ⇒ refused (fail-closed, before the approval pre-check)', async () => {
    const empty = new InMemoryToolRegistry();
    const seq = new FakeSequencer(new PermissionEngine(empty));
    const bridge = new McpBridge(empty, seq, { searchClients: async () => [] }, new RedactionEngine([]), { writeStores: new Stores(), approvalGate: new BridgeApprovalGate(new ApprovalGate()) });
    const out = await bridge.writeWithTool('create_open_item', ctx());
    expect(out.status).toBe('refused');
    if (out.status === 'refused') expect(out.stage).toBe('registry');
  });
  it('surface is READ_ONLY + DRAFT_ONLY + APPROVAL_REQUIRED_WRITE(internal) only — no external tool', () => {
    const { bridge, registry } = build();
    const tools = bridge.listTools();
    expect(tools).toHaveLength(EXPOSED_READ_TOOLS.length + EXPOSED_DRAFT_TOOLS.length + EXPOSED_WRITE_TOOLS.length); // 16 + 7 + 6 = 29 (no external registered here)
    for (const t of tools) {
      const cls = classifyRegisteredTool(registry.require(t.name));
      expect(['READ_ONLY', 'DRAFT_ONLY', 'APPROVAL_REQUIRED_WRITE']).toContain(cls); // never FORBIDDEN/external
    }
    const writeNames = tools.filter((t) => classifyRegisteredTool(registry.require(t.name)) === 'APPROVAL_REQUIRED_WRITE').map((t) => t.name).sort();
    expect(writeNames).toEqual([...EXPOSED_WRITE_TOOLS].sort());
    // every write tool is a single-record internal write (blastRadius 1), not an external action
    for (const n of WRITE_TOOLS) expect(registry.require(n).blastRadius).toBe(1);
  });
});
