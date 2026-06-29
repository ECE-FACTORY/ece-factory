import { describe, it, expect } from 'vitest';
import { ApprovalGate, type ActionDescriptor, type ApprovalAuditEvent } from './approval-gate.js';
import { PermissionEngine } from '../permission-engine/permission-engine.js';
import { createDefaultToolRegistry, type ToolDefinition } from '../tool-registry/tool-registry.js';

// Approval Gate Engine (Module 17). Pure-logic: per-action binding, single-use, deny-by-default, and
// the audit hook are all in-memory decision logic (no DB). The injected audit hook is tested by capture;
// the real Audit Engine adapter is wired at composition (the Audit Engine is DB-tested in its own suite).

function action(over: Partial<ActionDescriptor> = {}): ActionDescriptor {
  return { tool: 'update_client', risk: 'WRITE_LOW_RISK', reversible: 'yes', requestedBy: { user_id: 'op1' }, ...over };
}
const human = { user_id: 'rania', email: 'rania@ece.ae', role: 'admin' };

describe('Approval Gate — held until approved, single-use, per-action', () => {
  it('an approval-required action is HELD (not approved) until a human approves it', () => {
    const gate = new ApprovalGate();
    const q = gate.request(action());
    expect(q.state).toBe('held');
    expect(gate.isApproved(q.actionId)).toBe(false); // deny-by-default
    gate.resolve({ actionId: q.actionId, approver: human, decision: 'APPROVE', reason: 'reviewed change' });
    expect(gate.isApproved(q.actionId)).toBe(true);
  });

  it('a blanket/generalized approval does NOT resolve a specific action — approving A does not authorize B (core)', () => {
    const gate = new ApprovalGate();
    const a = gate.request(action()); // identical shape...
    const b = gate.request(action()); // ...distinct unique id
    expect(a.actionId).not.toBe(b.actionId);
    gate.resolve({ actionId: a.actionId, approver: human, decision: 'APPROVE', reason: 'approve A only' });
    expect(gate.isApproved(a.actionId)).toBe(true);
    expect(gate.isApproved(b.actionId)).toBe(false); // B is still held — approving A authorized nothing else
    expect(gate.get(b.actionId)!.state).toBe('held');
  });

  it('an approval is single-use — it cannot resolve the same action twice', () => {
    const gate = new ApprovalGate();
    const q = gate.request(action());
    const first = gate.resolve({ actionId: q.actionId, approver: human, decision: 'APPROVE', reason: 'ok' });
    expect(first.ok).toBe(true);
    const second = gate.resolve({ actionId: q.actionId, approver: human, decision: 'APPROVE', reason: 'again' });
    expect(second.ok).toBe(false);
    expect(second.reason).toMatch(/single-use/i);
  });
});

describe('Approval Gate — deny-by-default failure modes', () => {
  it('a mismatched / missing approval (unknown actionId) ⇒ not approved', () => {
    const gate = new ApprovalGate();
    const r = gate.resolve({ actionId: 'does-not-exist', approver: human, decision: 'APPROVE', reason: 'x' });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/does not match any specific/i);
  });
  it('an expired action ⇒ not approved', () => {
    let t = 1000;
    const gate = new ApprovalGate({ now: () => t });
    const q = gate.request(action({ expiresAtMs: 1500 }));
    t = 2000; // past the window
    const r = gate.resolve({ actionId: q.actionId, approver: human, decision: 'APPROVE', reason: 'late' });
    expect(r.ok).toBe(false);
    expect(r.state).toBe('expired');
    expect(gate.isApproved(q.actionId)).toBe(false);
  });
  it('"claude" as approver ⇒ refused', () => {
    const gate = new ApprovalGate();
    const q = gate.request(action());
    const r = gate.resolve({ actionId: q.actionId, approver: { user_id: 'claude' }, decision: 'APPROVE', reason: 'nope' });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/claude/i);
    expect(gate.isApproved(q.actionId)).toBe(false);
  });
  it('a REJECT decision leaves the action not approved', () => {
    const gate = new ApprovalGate();
    const q = gate.request(action());
    gate.resolve({ actionId: q.actionId, approver: human, decision: 'REJECT', reason: 'too risky' });
    expect(gate.isApproved(q.actionId)).toBe(false);
    expect(gate.get(q.actionId)!.state).toBe('rejected');
  });
});

describe('Approval Gate — auditability', () => {
  it('request and resolve emit audit events (who/what/when/why)', () => {
    const events: ApprovalAuditEvent[] = [];
    const gate = new ApprovalGate({ audit: { record: (e) => { events.push(e); } } });
    const q = gate.request(action({ tool: 'update_client' }));
    gate.resolve({ actionId: q.actionId, approver: human, decision: 'APPROVE', reason: 'change #88' });
    expect(events.map((e) => e.type)).toEqual(['requested', 'approved']);
    const approved = events[1]!;
    expect(approved.actionId).toBe(q.actionId);
    expect(approved.tool).toBe('update_client');
    expect(approved.approver).toBe('rania');
    expect(approved.reason).toBe('change #88');
    expect(approved.atIso).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe('Approval Gate — consumes Permission Engine STOP_FOR_APPROVAL', () => {
  it('a STOP_FOR_APPROVAL decision is held by the gate, then resolved by a human', async () => {
    const registry = createDefaultToolRegistry();
    const approvalTool: ToolDefinition = {
      name: 'update_client', purpose: 'edit a client', readOrWrite: 'write', classification: 'WRITE_LOW_RISK',
      permissionLevel: 'write', requiredRole: 'user', approvalRequired: true, serverSideRedaction: true,
      auditBehavior: 'audited', blastRadius: 1, reversible: 'yes', idempotent: true, environments: ['local'], owner: 'ECE', status: 'enabled',
    };
    registry.register(approvalTool);
    const perm = new PermissionEngine(registry);
    const decision = await perm.authorize({ human_actor: { user_id: 'op1', email: 'o@ece.ae', role: 'user' }, organization_id: 'org', tool: { name: 'update_client' }, environment: 'local' });
    expect(decision.decision).toBe('STOP_FOR_APPROVAL');

    // Map the STOP_FOR_APPROVAL into a held approval request.
    const gate = new ApprovalGate();
    const q = gate.request(action({ tool: 'update_client', requestedBy: { user_id: 'op1' } }));
    expect(gate.isApproved(q.actionId)).toBe(false); // held
    gate.resolve({ actionId: q.actionId, approver: human, decision: 'APPROVE', reason: 'approved by admin' });
    expect(gate.isApproved(q.actionId)).toBe(true); // now may proceed
  });
});
