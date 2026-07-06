import { describe, it, expect } from 'vitest';
import { PolicyChangeService, InMemoryPolicyChangeAudit, POLICY_CHANGE_TOOL, type ApprovalReader } from './policy-change-wiring.js';
import { PolicyGatedSeat, InMemoryPolicyAudit } from './policy-console-wiring.js';
import { PolicyStore } from '../layer-1-law/policy-engine/policy-store.js';
import { DEFAULT_POLICY_SET } from '../layer-1-law/policy-engine/example-rules.js';
import type { PolicyActionFacts } from '../layer-1-law/policy-engine/policy-engine.js';
import { DecisionConsole, InMemoryConsoleAudit, type EnqueueMeta } from '../layer-2-command/decision-console/decision-console.js';
import { ApprovalGate, type ActionDescriptor, type Principal } from '../layer-1-law/approval-gate/approval-gate.js';

// Wave 6 Piece 3 — policy-change-as-gated-write reusing the EXISTING gate/Console approval (single operator).
// Proposed change is INERT until approved; after a real operator approval it is applied + audited; the AI
// cannot approve; a policy change cannot weaken the guard stack.

const OPERATOR: Principal = { user_id: 'human_boss', email: 'b@e', role: 'admin' };
const publicRepo: PolicyActionFacts = { tool: 'create_github_repo', target: 'ECE/x', effect: 'create repo', tier: 'external', blastRadius: 1, reversibility: 'soft-only', payload: { private: false } };
function setup() {
  const gate = new ApprovalGate();
  const console = new DecisionConsole(gate, new InMemoryConsoleAudit());
  const store = new PolicyStore(DEFAULT_POLICY_SET);
  const audit = new InMemoryPolicyChangeAudit();
  const service = new PolicyChangeService(store, console, gate, audit);
  return { gate, console, store, audit, service };
}

describe('Piece 3 — a proposed policy change is INERT until a real operator approves', () => {
  it('propose enqueues a gated pending item + candidate version, but does NOT take effect', () => {
    const { console, store, service } = setup();
    expect(store.evaluate(publicRepo).policyBlocked).toBe(true); // v1
    const { pendingActionId, candidateVersion } = service.propose([], 'claude-code'); // propose an empty policy
    expect(candidateVersion).toBe(2);
    expect(store.activeVersion()).toBe(1);                                   // active unchanged
    expect(store.evaluate(publicRepo).policyBlocked).toBe(true);            // evaluations still use v1
    expect(console.listPending().some((it) => it.actionId === pendingActionId && it.tool === POLICY_CHANGE_TOOL)).toBe(true); // appears in the SAME queue
    expect(service.apply(pendingActionId)).toEqual({ status: 'not-approved' }); // apply before approval ⇒ inert
    expect(store.activeVersion()).toBe(1);
  });
});

describe('Piece 3 — after a real operator APPROVE, the change is applied + the new version active', () => {
  it('approve (single operator) → apply activates the candidate; evaluations reflect it', () => {
    const { console, store, service } = setup();
    const { pendingActionId, candidateVersion } = service.propose([], 'claude-code');
    expect(console.approve(pendingActionId, OPERATOR, 'reviewed — relaxing policy').status).toBe('APPROVED'); // the existing single-operator flow mints the gate token
    const r = service.apply(pendingActionId);
    expect(r).toMatchObject({ status: 'applied', activeVersion: candidateVersion });
    expect(store.activeVersion()).toBe(2);
    expect(store.evaluate(publicRepo).policyBlocked).toBe(false); // now under the approved v2
  });
});

describe('Piece 3 — the AI/conduit cannot approve a policy change (same SoD as any action)', () => {
  it('claude and the proposing conduit are barred; without a real approval the change stays inert', () => {
    const { console, store, service } = setup();
    const { pendingActionId } = service.propose([], 'claude-code');
    expect(console.approve(pendingActionId, { user_id: 'claude' }, 'x').status).toBe('rejected');       // AI barred
    expect(console.approve(pendingActionId, { user_id: 'claude-code' }, 'x').status).toBe('rejected');  // proposing conduit barred (SoD)
    expect(service.apply(pendingActionId)).toEqual({ status: 'not-approved' });                          // never approved ⇒ inert
    expect(store.activeVersion()).toBe(1);
  });
  it('defense-in-depth: even a forged "approved by claude" gate state is refused at apply', () => {
    const { console, store, audit } = setup();
    const forgedGate: ApprovalReader = { get: () => ({ state: 'approved', resolution: { approver: { user_id: 'claude' } } }) };
    const svc = new PolicyChangeService(store, console, forgedGate, audit);
    const { pendingActionId } = svc.propose([], 'claude-code');
    expect(svc.apply(pendingActionId)).toEqual({ status: 'refused-approver' });
    expect(store.activeVersion()).toBe(1);
  });
});

describe('Piece 3 — a policy change CANNOT weaken the guard stack (only alters PolicySet)', () => {
  it('even an approved empty (maximally-permissive) policy leaves the gate floor intact', () => {
    const { gate, console, store, service } = setup();
    const seat = new PolicyGatedSeat(console, store, new InMemoryPolicyAudit()); // seat evaluates the ACTIVE version
    const meta: EnqueueMeta = { tier: 'APPROVAL_REQUIRED_WRITE (external)', blastRadius: 1, proposingCaller: 'claude' };
    const repoDesc = { tool: 'create_github_repo', target: 'ECE/x', after: { system: 'github', effect: 'create repo', environment: null, payload: { private: false } }, risk: 'WRITE_MEDIUM_RISK', reversible: 'soft-only', requestedBy: { user_id: 'admin1', email: 'a@e', role: 'admin' } } as ActionDescriptor;
    const repoId = console.enqueue(repoDesc, meta);
    expect(seat.approve(repoId, OPERATOR, 'x').status).toBe('rejected'); // v1 HARD-blocks the public repo
    expect(gate.isApproved(repoId)).toBe(false);

    // gated change to an EMPTY policy, approved by a real operator, then applied
    const { pendingActionId } = service.propose([], 'claude-code');
    console.approve(pendingActionId, OPERATOR, 'relax');
    expect(service.apply(pendingActionId)!.status).toBe('applied');

    // the public-repo item is no longer POLICY-blocked — but the GATE floor is untouched: it STILL required a
    // real human approval to mint. Policy only removed the advisory withhold; it did not commit anything itself.
    expect(seat.approve(repoId, OPERATOR, 'approving').status).toBe('APPROVED');
    expect(gate.isApproved(repoId)).toBe(true);
    // structural: the change path exposes NO guard toggle — it can only touch PolicySet.
    const s = service as unknown as Record<string, unknown>;
    for (const m of ['disableAudit', 'disableKill', 'disableRedaction', 'setForbidden', 'bypassGate', 'approve', 'mint']) {
      expect(typeof s[m]).toBe('undefined');
    }
  });
});

describe('Piece 3 — transitions audited (operator-attributed, never claude); non-policy actions unaffected', () => {
  it('version-proposed + version-activated recorded, approver attributed, never claude', () => {
    const { console, service, audit } = setup();
    const { pendingActionId } = service.propose([], 'claude-code');
    console.approve(pendingActionId, OPERATOR, 'ok');
    service.apply(pendingActionId);
    const types = audit.entries().map((e) => e.type);
    expect(types).toContain('version-proposed');
    expect(types).toContain('version-activated');
    expect(audit.entries().find((e) => e.type === 'version-activated')!.approvedBy).toBe('human_boss');
    expect(audit.entries().every((e) => (e.approvedBy ?? '').toLowerCase() !== 'claude')).toBe(true);
  });
  it('a non-policy actionId is not owned by the service (composite committer falls through to the external path)', () => {
    const { service } = setup();
    expect(service.isPolicyChange('some-external-action')).toBe(false);
    expect(service.apply('some-external-action')).toBeUndefined();
  });
});
