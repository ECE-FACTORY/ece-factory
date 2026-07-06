import { describe, it, expect } from 'vitest';
import { PostgresConsoleAudit, StopEnqueuer, EnqueueingServerCore, descriptorForStop, type CallableCore } from './decision-console-wiring.js';
import { McpServerCore, type McpServerBridge, type McpCallResult } from './server-core.js';
import { DecisionConsole, InMemoryConsoleAudit, type ConsoleAuditEvent } from '../layer-2-command/decision-console/decision-console.js';
import { ApprovalGate, type Principal } from '../layer-1-law/approval-gate/approval-gate.js';
import { McpBridge, type BridgeCallContext, type AuditedSequencerPort } from '../layer-5-action/mcp-bridge/mcp-bridge.js';
import { registerExternalTools, registerForbiddenTools } from '../layer-5-action/mcp-bridge/external-tools.js';
import { registerWriteTools, type WriteStores } from '../layer-5-action/mcp-bridge/write-tools.js';
import { registerFactoryReadTools } from '../layer-5-action/mcp-bridge/factory-read-tools.js';
import { registerDraftTools } from '../layer-5-action/mcp-bridge/draft-tools.js';
import { BridgeApprovalGate } from '../layer-5-action/mcp-bridge/tool-classes.js';
import { createDefaultToolRegistry } from '../layer-5-action/tool-registry/tool-registry.js';
import { PermissionEngine } from '../layer-1-law/permission-engine/permission-engine.js';
import { RedactionEngine } from '../factory-shared/redaction-engine/redaction-engine.js';
import type { Authorizer, SequencerRequest, SequencerOutcome, ExecuteFn, CommittedIntent, RefusalRequest } from '../factory-shared/audit-engine/sequencer.js';
import type { ReadInput } from '../factory-shared/audit-engine/sink.js';

// Wave 6 Piece 1b — the connective wiring. Auto-enqueue is an OBSERVATION of STOP_FOR_APPROVAL (it never
// changes the outcome), the loop runs end-to-end through the UNCHANGED gauntlet, and Console audit routes to
// the real append-only sink.

const OPERATOR: Principal = { user_id: 'human_boss', email: 'b@e', role: 'admin' };
function ctx(): BridgeCallContext { return { principal: { user_id: 'admin1', email: 'a@e', role: 'admin' }, organization_id: 'orgW', session: { session_id: 's' }, environment: 'local', via: 'claude' }; }
type OkResult = { ok: true; tool: string; outcome: unknown; pendingActionId?: string };
function okr(r: { ok: boolean }): OkResult { expect(r.ok).toBe(true); return r as OkResult; }

// ── StopEnqueuer / descriptor ─────────────────────────────────────────────────────────────────────────────
describe('Piece 1b — the STOP observer builds the exact bound descriptor and is idempotent', () => {
  it('descriptorForStop mirrors the gate binding for an external action (target=id, after=system/effect/env/payload)', () => {
    const d = descriptorForStop('create_ticket', ctx(), { target: { system: 'tickets', targetId: 'ECE/x', effect: 'create issue', reversible: 'soft-only' }, payload: { title: 't' } });
    expect(d).toMatchObject({ tool: 'create_ticket', target: 'ECE/x', after: { system: 'tickets', effect: 'create issue', environment: null, payload: { title: 't' } }, reversible: 'soft-only' });
  });
  it('descriptorForStop mirrors the gate binding for an internal write (target=target, after=payload)', () => {
    const d = descriptorForStop('create_open_item', ctx(), { target: 'oi-1', payload: { item: 'x' } });
    expect(d).toMatchObject({ tool: 'create_open_item', target: 'oi-1', after: { item: 'x' } });
  });
  it('observe only fires on STOP, and is idempotent for the same still-held action', () => {
    const console = new DecisionConsole(new ApprovalGate(), new InMemoryConsoleAudit());
    const enq = new StopEnqueuer(console);
    expect(enq.observe('create_open_item', ctx(), { target: 'oi-1', payload: { item: 'x' } }, { status: 'ok' })).toBeUndefined(); // not a stop
    const id1 = enq.observe('create_open_item', ctx(), { target: 'oi-1', payload: { item: 'x' } }, { status: 'STOP_FOR_APPROVAL' });
    const id2 = enq.observe('create_open_item', ctx(), { target: 'oi-1', payload: { item: 'x' } }, { status: 'STOP_FOR_APPROVAL' });
    expect(id1).toBeTruthy();
    expect(id2).toBe(id1);               // idempotent — same held action not enqueued twice
    expect(console.listPending()).toHaveLength(1);
  });
});

// ── EnqueueingServerCore observation-only ─────────────────────────────────────────────────────────────────
class FakeCore implements CallableCore {
  constructor(private readonly outcome: unknown) {}
  async callTool(name: string): Promise<McpCallResult> { return { ok: true, tool: name, outcome: this.outcome }; }
  listTools() { return [] as ReturnType<McpServerCore['listTools']>; }
  isForbidden() { return false; }
}
describe('Piece 1b — auto-enqueue is OBSERVATION-ONLY: it never changes the inner outcome', () => {
  it('a STOP outcome is returned verbatim (plus an additive pendingActionId) and is enqueued', async () => {
    const console = new DecisionConsole(new ApprovalGate(), new InMemoryConsoleAudit());
    const stop = { status: 'STOP_FOR_APPROVAL', tool: 'create_open_item', reason: 'no token' };
    const core = new EnqueueingServerCore(new FakeCore(stop), new StopEnqueuer(console));
    const r = okr(await core.callTool('create_open_item', { target: 'oi-1', payload: { item: 'x' } }, ctx()));
    expect(r.outcome).toEqual(stop);        // outcome UNCHANGED by the observation
    expect(r.pendingActionId).toBeTruthy(); // additive only
    expect(console.listPending()).toHaveLength(1);
  });
  it('a non-STOP outcome is passed through untouched and nothing is enqueued', async () => {
    const console = new DecisionConsole(new ApprovalGate(), new InMemoryConsoleAudit());
    const core = new EnqueueingServerCore(new FakeCore({ status: 'WRITE-COMMITTED' }), new StopEnqueuer(console));
    const r = okr(await core.callTool('create_open_item', { target: 'oi-1' }, ctx()));
    expect(r.pendingActionId).toBeUndefined();
    expect(console.listPending()).toHaveLength(0);
  });
});

// ── end-to-end through the UNCHANGED gauntlet (real McpBridge, internal write) ────────────────────────────
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
class FakeWriteStores implements WriteStores {
  created: unknown[] = [];
  createOpenItem(p: unknown) { this.created.push(p); return Promise.resolve({ recordId: 'oi', ok: true }); }
  private nope = () => Promise.reject(new Error('n/a'));
  recordReviewDecision = this.nope; recordHumanSignoff = this.nope; recordApprovalGate = this.nope; updateRiskStatus = this.nope; recordWaveSignoff = this.nope;
}
function e2eSetup() {
  const registry = createDefaultToolRegistry();
  registerFactoryReadTools(registry); registerDraftTools(registry); registerWriteTools(registry); registerExternalTools(registry); registerForbiddenTools(registry);
  const gate = new ApprovalGate();
  const writeStores = new FakeWriteStores();
  const bridge = new McpBridge(registry, new FakeSequencer(new PermissionEngine(registry)), { searchClients: async () => [] }, new RedactionEngine(['ok', 'recordId']), { writeStores, approvalGate: new BridgeApprovalGate(gate, 'claude') });
  const console = new DecisionConsole(gate, new InMemoryConsoleAudit());
  const core = new EnqueueingServerCore(new McpServerCore(bridge as McpServerBridge, registry), new StopEnqueuer(console));
  return { console, core, writeStores };
}

describe('Piece 1b — end-to-end: stop → auto-enqueue → operator APPROVE → commits through the unchanged gauntlet', () => {
  it('the full human-in-the-loop, automatic; refuse never commits', async () => {
    const { console, core, writeStores } = e2eSetup();
    const args = { target: 'oi-1', payload: { item: 'x' } };
    // 1. the action stops — and AUTO-appears in the queue (no manual enqueue), external/store untouched
    const stop = okr(await core.callTool('create_open_item', args, ctx()));
    expect((stop.outcome as { status: string }).status).toBe('STOP_FOR_APPROVAL');
    expect(writeStores.created).toHaveLength(0);
    const id = stop.pendingActionId!;
    expect(console.listPending().find((it) => it.actionId === id)?.descriptor).toMatchObject({ tool: 'create_open_item', target: 'oi-1', after: { item: 'x' } });
    // 2. a real operator approves in the Console (mints the gate's own token)
    expect(console.approve(id, OPERATOR, 'ok').status).toBe('APPROVED');
    // 3. re-driven with that approval ⇒ commits through the full unchanged gauntlet
    const committed = okr(await core.callTool('create_open_item', { ...args, approvalActionId: id }, ctx()));
    expect((committed.outcome as { status: string }).status).toBe('WRITE-COMMITTED');
    expect(writeStores.created).toHaveLength(1);
  });
  it('REFUSE ⇒ the action never commits', async () => {
    const { console, core, writeStores } = e2eSetup();
    const args = { target: 'oi-2', payload: { item: 'y' } };
    const id = okr(await core.callTool('create_open_item', args, ctx())).pendingActionId!;
    expect(console.refuse(id, OPERATOR, 'no').status).toBe('REFUSED');
    const retry = okr(await core.callTool('create_open_item', { ...args, approvalActionId: id }, ctx()));
    expect((retry.outcome as { status: string }).status).toBe('STOP_FOR_APPROVAL'); // refused ⇒ never approved ⇒ never commits
    expect(writeStores.created).toHaveLength(0);
  });
});

// ── PostgresConsoleAudit routing (unit: fake sink) ────────────────────────────────────────────────────────
describe('Piece 1b — Console audit routes to the append-only sink, operator-attributed, never "claude"', () => {
  it('every event maps to appendRead; approve is operator-attributed; enqueue uses the service actor', async () => {
    const reads: ReadInput[] = [];
    const audit = new PostgresConsoleAudit({ appendRead: async (i: ReadInput) => { reads.push(i); return { seq: reads.length, entry_hash: 'h' }; } }, 'orgW', 'local');
    const events: ConsoleAuditEvent[] = [
      { type: 'enqueued', actionId: 'a1', tool: 'create_ticket', proposingCaller: 'claude', atIso: '2026-07-02T00:00:00Z' },
      { type: 'approved', actionId: 'a1', tool: 'create_ticket', operator: 'human_boss', reason: 'ok', atIso: '2026-07-02T00:01:00Z' },
    ];
    for (const e of events) await audit.append(e);
    expect(reads).toHaveLength(2);
    expect(reads[0].human_actor.user_id).toBe('decision-console'); // enqueue → service actor (not 'claude')
    expect((reads[0].query_range as { consoleEvent: string }).consoleEvent).toBe('enqueued');
    expect(reads[1].human_actor.user_id).toBe('human_boss');       // approve → the real operator
    expect(reads.every((r) => r.human_actor.user_id.toLowerCase() !== 'claude')).toBe(true);
  });
});
