import { describe, it, expect } from 'vitest';
import { DecisionConsole, InMemoryConsoleAudit, type EnqueueMeta } from './decision-console.js';
import { ApprovalGate, type ActionDescriptor, type Principal } from '../approval-gate/approval-gate.js';

// Wave 6 Piece 1 — the Decision Console seam over the REAL Approval Gate engine. Proves: enqueue reflects the
// exact bound descriptor; APPROVE mints the gate's own approval (attributed to the operator); REFUSE records;
// operator identity is real (no anonymous / 'claude' / proposing-caller / requester self-approval); single-use;
// every transition audited append-only.

function descriptor(over: Partial<ActionDescriptor> = {}): ActionDescriptor {
  return {
    tool: 'create_ticket', target: 'ECE-PLATFORMS/repoA',
    after: { system: 'tickets', effect: 'create issue in ECE-PLATFORMS/repoA', environment: null, payload: { title: 't' } },
    risk: 'WRITE_MEDIUM_RISK', reversible: 'soft-only', requestedBy: { user_id: 'admin1', email: 'a@e', role: 'admin' }, ...over,
  };
}
const META: EnqueueMeta = { tier: 'APPROVAL_REQUIRED_WRITE (external)', blastRadius: 1, proposingCaller: 'claude' };
const OPERATOR: Principal = { user_id: 'human_boss', email: 'b@e', role: 'admin' };
function setup() {
  const gate = new ApprovalGate();
  const audit = new InMemoryConsoleAudit();
  const console = new DecisionConsole(gate, audit);
  return { gate, audit, console };
}

describe('Decision Console — enqueue reflects the exact bound descriptor', () => {
  it('a pending item shows tool, target, effect, tier, blast radius, reversibility, proposing caller, timestamp', () => {
    const { console } = setup();
    const id = console.enqueue(descriptor(), META);
    const items = console.listPending();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      actionId: id, tool: 'create_ticket', target: 'ECE-PLATFORMS/repoA',
      effect: 'create issue in ECE-PLATFORMS/repoA', tier: 'APPROVAL_REQUIRED_WRITE (external)',
      blastRadius: 1, reversibility: 'soft-only', proposingCaller: 'claude',
    });
    expect(items[0].descriptor).toEqual(descriptor()); // the EXACT bound descriptor the approval will bind to
    expect(items[0].requestedAtIso).toMatch(/^\d{4}-\d\d-\d\dT/);
  });
});

describe('Decision Console — APPROVE mints the gate’s own single-use approval, attributed to the operator', () => {
  it('approve ⇒ APPROVED with a real gate approvalId; the gate records the operator as approver', () => {
    const { gate, console } = setup();
    const id = console.enqueue(descriptor(), META);
    const out = console.approve(id, OPERATOR, 'reviewed — looks good');
    expect(out.status).toBe('APPROVED');
    if (out.status === 'APPROVED') { expect(out.approvalId).toMatch(/^apr_/); expect(out.approver).toBe('human_boss'); }
    expect(gate.isApproved(id)).toBe(true); // the SAME gate state the bridge checks
    expect(gate.get(id)!.resolution!.approver.user_id).toBe('human_boss'); // human-attributed, not 'claude'
    expect(console.listPending()).toHaveLength(0); // resolved — no longer pending
  });
  it('a resolved item cannot be approved again — single-use', () => {
    const { console } = setup();
    const id = console.enqueue(descriptor(), META);
    expect(console.approve(id, OPERATOR, 'ok').status).toBe('APPROVED');
    expect(console.approve(id, OPERATOR, 'again').status).toBe('rejected'); // gate: already approved
  });
});

describe('Decision Console — REFUSE records refusal; the action is never approved', () => {
  it('refuse ⇒ REFUSED, gate state rejected, never approved', () => {
    const { gate, console } = setup();
    const id = console.enqueue(descriptor(), META);
    const out = console.refuse(id, OPERATOR, 'not now');
    expect(out.status).toBe('REFUSED');
    expect(gate.isApproved(id)).toBe(false);
    expect(gate.get(id)!.state).toBe('rejected');
  });
});

describe('Decision Console — operator identity is REAL: no anonymous / AI / self approval', () => {
  it('absent identity ⇒ rejected; the gate is NOT resolved', () => {
    const { gate, console } = setup();
    const id = console.enqueue(descriptor(), META);
    expect(console.approve(id, { user_id: '' }, 'r').status).toBe('rejected');
    expect(console.approve(id, { user_id: '   ' }, 'r').status).toBe('rejected');
    expect(gate.get(id)!.state).toBe('held'); // still awaiting a real human
  });
  it('the AI ("claude", any case) cannot approve', () => {
    const { gate, console } = setup();
    const id = console.enqueue(descriptor(), META);
    expect(console.approve(id, { user_id: 'claude' }, 'r').status).toBe('rejected');
    expect(console.approve(id, { user_id: 'CLAUDE' }, 'r').status).toBe('rejected');
    expect(gate.get(id)!.state).toBe('held');
  });
  it('the proposing caller cannot approve its own action (separation of duties)', () => {
    const { gate, console } = setup();
    const id = console.enqueue(descriptor(), { ...META, proposingCaller: 'autopilot-1' });
    const out = console.approve(id, { user_id: 'autopilot-1' }, 'r');
    expect(out.status).toBe('rejected');
    if (out.status === 'rejected') expect(out.reason).toMatch(/proposing caller/i);
    expect(gate.get(id)!.state).toBe('held');
  });
  it('the requester cannot approve its own action', () => {
    const { console } = setup();
    const id = console.enqueue(descriptor(), META); // requestedBy admin1
    const out = console.approve(id, { user_id: 'admin1' }, 'r');
    expect(out.status).toBe('rejected');
    if (out.status === 'rejected') expect(out.reason).toMatch(/requester/i);
  });
  it('a decision reason is required', () => {
    const { console } = setup();
    const id = console.enqueue(descriptor(), META);
    expect(console.approve(id, OPERATOR, '').status).toBe('rejected');
  });
});

describe('Decision Console — every transition audited, append-only, operator-attributed', () => {
  it('enqueue / rejected-attempt / approve all recorded; earlier entries never mutated', () => {
    const { audit, console } = setup();
    const id = console.enqueue(descriptor(), META);
    const afterEnqueue = audit.entries();
    expect(afterEnqueue).toHaveLength(1);
    expect(afterEnqueue[0]).toMatchObject({ type: 'enqueued', actionId: id, tool: 'create_ticket', proposingCaller: 'claude' });

    console.approve(id, { user_id: 'claude' }, 'r'); // rejected attempt — audited
    console.approve(id, OPERATOR, 'ok');             // real approval — audited, operator-attributed
    const all = audit.entries();
    expect(all.map((e) => e.type)).toEqual(['enqueued', 'resolve-rejected', 'approved']);
    expect(all[2]).toMatchObject({ type: 'approved', operator: 'human_boss', actionId: id });
    // append-only: the first entry is byte-for-byte the same object it was after enqueue
    expect(all[0]).toEqual(afterEnqueue[0]);
  });
});
