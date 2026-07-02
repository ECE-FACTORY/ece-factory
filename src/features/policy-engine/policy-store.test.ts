import { describe, it, expect } from 'vitest';
import { PolicyStore } from './policy-store.js';
import { DEFAULT_POLICY_SET } from './example-rules.js';
import type { PolicyActionFacts } from './policy-engine.js';

// Wave 6 Piece 3 — the PolicyStore is versioned + append-only. A proposed candidate is INERT until activated;
// activation records an append-only transition and requires a real human approver (never 'claude').

const publicRepo: PolicyActionFacts = { tool: 'create_github_repo', target: 'ECE/x', effect: 'create repo', tier: 'external', blastRadius: 1, reversibility: 'soft-only', payload: { private: false } };

describe('PolicyStore — versioned, append-only; a candidate is INERT until activated', () => {
  it('starts on v1; proposeVersion appends a candidate but does NOT activate it (evaluations keep using v1)', () => {
    const store = new PolicyStore(DEFAULT_POLICY_SET);
    expect(store.activeVersion()).toBe(1);
    expect(store.evaluate(publicRepo).policyBlocked).toBe(true); // v1 has the hard no-public-repo rule

    const v2 = store.proposeVersion([]); // an empty (maximally-permissive) candidate
    expect(v2).toBe(2);
    expect(store.activeVersion()).toBe(1);                    // NOT activated
    expect(store.evaluate(publicRepo).policyBlocked).toBe(true); // still evaluated under v1 — candidate is inert
  });

  it('activate switches the active version + records an append-only transition; evaluations reflect the new version', () => {
    const store = new PolicyStore(DEFAULT_POLICY_SET, () => 0);
    const v2 = store.proposeVersion([]);
    const t = store.activate(v2, 'human_boss');
    expect(store.activeVersion()).toBe(2);
    expect(store.evaluate(publicRepo).policyBlocked).toBe(false); // now under the empty v2
    expect(t).toMatchObject({ fromVersion: 1, toVersion: 2, approvedBy: 'human_boss' });
    // history is inspectable + append-only; v1 is still retrievable (never mutated/removed)
    const h = store.history();
    expect(h.versions).toEqual([1, 2]);
    expect(h.active).toBe(2);
    expect(h.transitions).toHaveLength(1);
    expect(store.version(1)!.rules.length).toBe(DEFAULT_POLICY_SET.rules.length);
  });

  it('activation requires a real human approver — "claude" is refused; an unknown version throws', () => {
    const store = new PolicyStore(DEFAULT_POLICY_SET);
    const v2 = store.proposeVersion([]);
    expect(() => store.activate(v2, 'claude')).toThrow(/real human/i);
    expect(() => store.activate(v2, '')).toThrow(/real human/i);
    expect(() => store.activate(999, 'human_boss')).toThrow(/no policy version/);
    expect(store.activeVersion()).toBe(1); // nothing activated on a refused/invalid attempt
  });
});
