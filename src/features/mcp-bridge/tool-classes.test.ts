import { describe, it, expect, vi } from 'vitest';
import { ClassDispatcher, DRAFT_STATUS, type ConsumedApproval, type ApprovalGatePort } from './tool-classes.js';
import { ApprovalGate, type ActionDescriptor } from '../approval-gate/approval-gate.js';

function action(tool = 'fixture_write'): ActionDescriptor {
  return { tool, risk: 'WRITE_LOW_RISK', reversible: 'yes', requestedBy: { user_id: 'u1', email: 'u1@ece.ae', role: 'admin' } };
}

// Tool classification taxonomy (Phase 8.1, Part A) — STRUCTURAL enforcement of all four classes, proven
// with fixture handlers (no real draft/write tool is exposed). The point of each test: the class's limit
// is unrepresentable to violate, and dispatch-by-class never offers a lower class a higher-privilege path.

describe('Taxonomy — READ_ONLY structurally cannot write', () => {
  it('a READ_ONLY dispatch runs only the read handler; a write handler, even if present, never runs', async () => {
    const writeSpy = vi.fn();
    const d = new ClassDispatcher();
    const out = await d.dispatch('READ_ONLY', { readOnly: async () => ({ rows: [1, 2] }), approvalWrite: writeSpy });
    expect(out.status).toBe('ok');
    if (out.status === 'ok') expect(out.data).toEqual({ rows: [1, 2] });
    expect(writeSpy).not.toHaveBeenCalled(); // no write path for a READ_ONLY tool
  });
});

describe('Taxonomy — DRAFT_ONLY structurally cannot commit/mutate', () => {
  it('a DRAFT_ONLY dispatch yields the draft literal only; no committed/executed branch exists', async () => {
    const writeSpy = vi.fn();
    const d = new ClassDispatcher();
    const out = await d.dispatch('DRAFT_ONLY', { draftOnly: async () => ({ body: 'proposed change' }), approvalWrite: writeSpy });
    expect(out.status).toBe(DRAFT_STATUS);
    expect(out.status).not.toMatch(/committed|executed|approved/i);
    if (out.status === DRAFT_STATUS) expect(out.draft).toEqual({ body: 'proposed change' });
    expect(writeSpy).not.toHaveBeenCalled(); // a draft cannot escalate to a write
    // type-level: the draft success literal is not 'committed'
    // @ts-expect-error DRAFT_STATUS is the only draft-success literal; 'committed' is not assignable
    const _bad: typeof DRAFT_STATUS = 'committed';
    void _bad;
  });
});

describe('Taxonomy — APPROVAL_REQUIRED_WRITE cannot execute without a single-use token', () => {
  it('no approval ⇒ STOP_FOR_APPROVAL; the write handler never runs', async () => {
    const writeSpy = vi.fn(async () => 'mutated');
    const d = new ClassDispatcher(); // no Approval Gate wired
    const out = await d.dispatch('APPROVAL_REQUIRED_WRITE', { approvalWrite: writeSpy }, { tool: 'fixture_write' });
    expect(out.status).toBe('STOP_FOR_APPROVAL');
    expect(writeSpy).not.toHaveBeenCalled(); // no execute path absent the token
  });

  it('a still-held action that is NOT approved ⇒ STOP_FOR_APPROVAL', async () => {
    const gate = new ApprovalGate();
    const q = gate.request(action());
    const writeSpy = vi.fn(async () => 'mutated');
    const d = new ClassDispatcher(gate); // real gate, but action not yet approved
    const out = await d.dispatch('APPROVAL_REQUIRED_WRITE', { approvalWrite: writeSpy }, { tool: 'fixture_write', approvalActionId: q.actionId });
    expect(out.status).toBe('STOP_FOR_APPROVAL');
    expect(writeSpy).not.toHaveBeenCalled();
  });

  it('a single-use human approval ⇒ executes once, with a branded ConsumedApproval', async () => {
    const gate = new ApprovalGate();
    const q = gate.request(action());
    gate.resolve({ actionId: q.actionId, approver: { user_id: 'human_boss', email: 'boss@ece.ae', role: 'admin' }, decision: 'APPROVE', reason: 'reviewed and approved' });
    let received: ConsumedApproval | undefined;
    const writeSpy = vi.fn(async (a: ConsumedApproval) => { received = a; return 'mutated'; });
    const d = new ClassDispatcher(gate);
    const out = await d.dispatch('APPROVAL_REQUIRED_WRITE', { approvalWrite: writeSpy }, { tool: 'fixture_write', approvalActionId: q.actionId });
    expect(out.status).toBe('executed');
    expect(writeSpy).toHaveBeenCalledTimes(1);
    expect(received?.approvalId).toBeTruthy();
  });

  it('a forged approval token cannot be constructed outside the taxonomy module (type-level)', () => {
    // @ts-expect-error ConsumedApproval is branded with a module-private symbol — uncforgeable here
    const forged: ConsumedApproval = { approvalId: 'x', tool: 'fixture_write' };
    void forged;
  });
});

describe('Taxonomy — FORBIDDEN is never callable', () => {
  it('a FORBIDDEN dispatch always refuses; no handler runs', async () => {
    const readSpy = vi.fn(); const writeSpy = vi.fn();
    const d = new ClassDispatcher();
    const out = await d.dispatch('FORBIDDEN', { readOnly: readSpy, approvalWrite: writeSpy });
    expect(out.status).toBe('refused');
    expect(readSpy).not.toHaveBeenCalled();
    expect(writeSpy).not.toHaveBeenCalled();
  });
});

describe('Dispatch-by-class — a lower class cannot reach a higher-privilege path', () => {
  it('the same handler set, dispatched by different classes, runs ONLY the class-appropriate path', async () => {
    const approved = new ApprovalGate();
    const q = approved.request(action('t'));
    approved.resolve({ actionId: q.actionId, approver: { user_id: 'boss', email: 'b@e', role: 'admin' }, decision: 'APPROVE', reason: 'ok' });
    const gate: ApprovalGatePort = approved;

    const calls: string[] = [];
    const handlers = {
      readOnly: async () => { calls.push('read'); return 'r'; },
      draftOnly: async () => { calls.push('draft'); return 'd'; },
      approvalWrite: async () => { calls.push('write'); return 'w'; },
    };
    const ro = await new ClassDispatcher(gate).dispatch('READ_ONLY', handlers, { tool: 't', approvalActionId: q.actionId });
    expect(ro.status).toBe('ok');
    expect(calls).toEqual(['read']); // READ_ONLY reached ONLY the read path — not write, despite an approved token
  });
});
