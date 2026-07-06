import { describe, it, expect } from 'vitest';
import { PolicyGatedSeat, InMemoryPolicyAudit, factsFromPendingItem, type PolicyPendingItem } from './policy-console-wiring.js';
import { DecisionConsoleServer, type OperatorSeat } from './decision-console-server.js';
import { PolicyEngine } from '../layer-1-law/policy-engine/policy-engine.js';
import { DEFAULT_POLICY_SET } from '../layer-1-law/policy-engine/example-rules.js';
import { DecisionConsole, InMemoryConsoleAudit, type EnqueueMeta, type PendingItem, type ConsoleDecisionOutcome } from '../layer-2-command/decision-console/decision-console.js';
import { ApprovalGate, type ActionDescriptor, type Principal } from '../layer-1-law/approval-gate/approval-gate.js';

const OPERATOR: Principal = { user_id: 'human_boss', email: 'b@e', role: 'admin' };
const engine = new PolicyEngine(DEFAULT_POLICY_SET);

// a recording inner seat that returns one configurable pending item
class RecordingSeat implements OperatorSeat {
  approvedIds: string[] = []; refusedIds: string[] = [];
  constructor(private readonly item: PendingItem) {}
  listPending(): PendingItem[] { return [this.item]; }
  approve(id: string): ConsoleDecisionOutcome { this.approvedIds.push(id); return { status: 'APPROVED', actionId: id, approvalId: 'apr', approver: 'inner' }; }
  refuse(id: string): ConsoleDecisionOutcome { this.refusedIds.push(id); return { status: 'REFUSED', actionId: id, approver: 'inner' }; }
}
function item(over: Partial<PendingItem> = {}, after: unknown = { system: 'tickets', effect: 'create issue', environment: null, payload: {} }): PendingItem {
  return { actionId: 'a1', tool: 'create_ticket', target: 'ECE/repoA', effect: 'create issue in ECE/repoA', descriptor: { tool: 'create_ticket', target: 'ECE/repoA', after, risk: 'WRITE_MEDIUM_RISK', reversible: 'soft-only', requestedBy: { user_id: 'admin1', email: 'a@e', role: 'admin' } } as ActionDescriptor, tier: 'APPROVAL_REQUIRED_WRITE (external)', blastRadius: 1, reversibility: 'soft-only', proposingCaller: 'claude', requestedAtIso: '2026-07-02T00:00:00.000Z', ...over };
}

describe('Piece 2 wiring — factsFromPendingItem maps the bound descriptor', () => {
  it('external (enveloped after) ⇒ payload/env extracted; internal (raw after) ⇒ payload is after', () => {
    expect(factsFromPendingItem(item({}, { system: 'github', effect: 'e', environment: 'production', payload: { private: false } }))).toMatchObject({ tool: 'create_ticket', environment: 'production', payload: { private: false } });
    expect(factsFromPendingItem(item({ tool: 'create_open_item' }, { note: 'x' })).payload).toEqual({ note: 'x' });
  });
});

describe('Piece 2 wiring — the queue carries the advisory policy read (Console surfacing)', () => {
  it('listPending attaches a labeled advisory evaluation per item', () => {
    const seat = new PolicyGatedSeat(new RecordingSeat(item()), engine, new InMemoryPolicyAudit());
    const items = seat.listPending() as PolicyPendingItem[];
    expect(items[0].policy.advisory).toBe(true);
    expect(items[0].policy.recommendation).toBe('RECOMMEND-APPROVE');
    expect(items[0].policy.perRule.length).toBeGreaterThan(0); // structural facts present
  });
  it('the Console /api/pending includes the policy read; the operator page renders it (labeled advisory)', () => {
    const seat = new PolicyGatedSeat(new RecordingSeat(item()), engine, new InMemoryPolicyAudit());
    const srv = new DecisionConsoleServer(seat, { idgen: () => 's1' });
    const sid = srv.route({ method: 'POST', path: '/api/login', body: { operator: { user_id: 'op_jane' } } }).setSessionId!;
    const pending = JSON.parse(srv.route({ method: 'GET', path: '/api/pending', sessionId: sid }).body);
    expect(pending.items[0].policy.recommendation).toBe('RECOMMEND-APPROVE');
    const page = srv.route({ method: 'GET', path: '/' }).body;
    expect(page).toMatch(/ADVISORY — informs, does not decide/);      // labeled advisory
    expect(page).toMatch(/structural checks/);                        // facts distinguished from advice
    expect(page).toMatch(/HARD-BLOCKED — not approvable/);            // hard is visibly distinguished
  });
});

describe('Piece 2 wiring — HARD violation is WITHHELD at the Console (non-overridable), the gate is NEVER reached', () => {
  it('a public-repo (hard) approve ⇒ rejected; the inner seat is NOT called', () => {
    const inner = new RecordingSeat(item({ tool: 'create_github_repo' }, { system: 'github', effect: 'create repo', environment: null, payload: { private: false } }));
    const audit = new InMemoryPolicyAudit();
    const seat = new PolicyGatedSeat(inner, engine, audit);
    const out = seat.approve('a1', OPERATOR, 'I really want to');
    expect(out.status).toBe('rejected');
    if (out.status === 'rejected') expect(out.reason).toMatch(/policy-blocked \(HARD/);
    expect(inner.approvedIds).toHaveLength(0);                         // the gate/seat was NEVER reached — no mint
    expect(audit.entries().map((e) => e.type)).toEqual(['evaluated', 'policy-blocked-withheld']);
  });
});

describe('Piece 2 wiring — SOFT violation is OVERRIDABLE with a recorded reason (approval proceeds)', () => {
  it('a high-blast (soft/dual) approve proceeds through the unchanged seat; the override reason is audited', () => {
    const inner = new RecordingSeat(item({ blastRadius: 2 }));
    const audit = new InMemoryPolicyAudit();
    const seat = new PolicyGatedSeat(inner, engine, audit);
    const out = seat.approve('a1', OPERATOR, 'small blast in practice — approving');
    expect(out.status).toBe('APPROVED');
    expect(inner.approvedIds).toEqual(['a1']);                        // proceeds through the unchanged seat/gate
    const soft = audit.entries().find((e) => e.type === 'soft-override-approved')!;
    expect(soft.reason).toBe('small blast in practice — approving');  // override recorded
    expect(soft.recommendation).toBe('REQUIRES-DUAL-APPROVAL');
    expect(audit.entries().every((e) => (e.operator ?? '').toLowerCase() !== 'claude')).toBe(true);
  });
});

describe('Piece 2 wiring — the engine cannot approve: the recommendation does NOT mint (real gate untouched)', () => {
  function realInner() {
    const gate = new ApprovalGate();
    const console = new DecisionConsole(gate, new InMemoryConsoleAudit());
    const meta: EnqueueMeta = { tier: 'APPROVAL_REQUIRED_WRITE (external)', blastRadius: 1, proposingCaller: 'claude' };
    const enqueue = (after: unknown) => console.enqueue({ tool: 'create_github_repo', target: 'ECE/repoA', after, risk: 'WRITE_MEDIUM_RISK', reversible: 'soft-only', requestedBy: { user_id: 'admin1', email: 'a@e', role: 'admin' } } as ActionDescriptor, meta);
    return { gate, console, enqueue };
  }
  it('a HARD-blocked item is never minted (gate stays held); a clean item still mints via the unchanged gate', () => {
    const { gate, console, enqueue } = realInner();
    const seat = new PolicyGatedSeat(console, engine, new InMemoryPolicyAudit());
    const blockedId = enqueue({ system: 'github', effect: 'create repo', environment: null, payload: { private: false } }); // hard
    expect(seat.approve(blockedId, OPERATOR, 'x').status).toBe('rejected');
    expect(gate.isApproved(blockedId)).toBe(false);                   // policy withheld ⇒ gate never minted

    const cleanId = enqueue({ system: 'github', effect: 'create repo', environment: null, payload: { private: true } }); // private ok (senior escalation, overridable)
    expect(seat.approve(cleanId, OPERATOR, 'reviewed').status).toBe('APPROVED');
    expect(gate.isApproved(cleanId)).toBe(true);                      // the unchanged gate still mints on a real approval
  });
});
