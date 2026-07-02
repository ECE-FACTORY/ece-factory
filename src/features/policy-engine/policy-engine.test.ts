import { describe, it, expect } from 'vitest';
import { PolicyEngine, deriveRecommendation, type PolicyActionFacts, type PolicyRule, type PerRuleResult } from './policy-engine.js';
import { DEFAULT_POLICY_SET, EXAMPLE_RULES, ruleWhen } from './example-rules.js';

// Wave 6 Piece 2 — the Policy Engine INFORMS, never DECIDES. Structural checks are deterministic facts;
// the recommendation is derived separately and labeled advisory. The engine cannot approve/commit/weaken guards.

function facts(over: Partial<PolicyActionFacts> = {}): PolicyActionFacts {
  return { tool: 'create_ticket', target: 'ECE/repoA', effect: 'create issue in ECE/repoA', tier: 'APPROVAL_REQUIRED_WRITE (external)', blastRadius: 1, reversibility: 'soft-only', ...over };
}
const engine = new PolicyEngine(DEFAULT_POLICY_SET);

describe('Policy Engine — structural checks are DETERMINISTIC facts', () => {
  it('the same facts always yield the same per-rule results (pure)', () => {
    const a = engine.evaluate(facts());
    const b = engine.evaluate(facts());
    expect(a.perRule).toEqual(b.perRule);
    expect(a.perRule.map((r) => r.id).sort()).toEqual(EXAMPLE_RULES.map((r) => r.id).sort()); // every rule evaluated
    expect(a.advisory).toBe(true); // the whole result is labeled advice
  });
  it('a clean create_ticket (blast 1, non-regulated) ⇒ all satisfied ⇒ RECOMMEND-APPROVE', () => {
    const e = engine.evaluate(facts());
    expect(e.perRule.every((r) => r.satisfied)).toBe(true);
    expect(e.recommendation).toBe('RECOMMEND-APPROVE');
    expect(e.policyBlocked).toBe(false);
  });
});

describe('Policy Engine — HARD violations block (non-overridable); SOFT are advisory (overridable)', () => {
  it('a public repo (hard safety) ⇒ policyBlocked, RECOMMEND-REFUSE, not overridable', () => {
    const e = engine.evaluate(facts({ tool: 'create_github_repo', payload: { private: false } }));
    expect(e.policyBlocked).toBe(true);
    expect(e.hardViolations.map((r) => r.id)).toContain('safety.no-public-repo');
    expect(e.recommendation).toBe('RECOMMEND-REFUSE');
    expect(e.overridable).toBe(false);
  });
  it('a CII target without accreditation (hard compliance) ⇒ blocked; WITH accreditation ⇒ satisfied', () => {
    const blocked = engine.evaluate(facts({ effect: 'update CII regulated record', payload: {} }));
    expect(blocked.policyBlocked).toBe(true);
    expect(blocked.hardViolations.map((r) => r.id)).toContain('compliance.cii-accreditation');
    const ok = engine.evaluate(facts({ effect: 'update CII regulated record', payload: { accreditation: true } }));
    expect(ok.perRule.find((r) => r.id === 'compliance.cii-accreditation')!.satisfied).toBe(true);
  });
  it('high blast radius (>1) ⇒ REQUIRES-DUAL-APPROVAL (soft escalation, overridable)', () => {
    const e = engine.evaluate(facts({ blastRadius: 2 }));
    expect(e.policyBlocked).toBe(false);
    expect(e.recommendation).toBe('REQUIRES-DUAL-APPROVAL');
    expect(e.overridable).toBe(true);
  });
  it('an elevated tool (create_github_repo, private) ⇒ REQUIRES-SENIOR (soft escalation)', () => {
    const e = engine.evaluate(facts({ tool: 'create_github_repo', payload: { private: true } }));
    expect(e.policyBlocked).toBe(false);
    expect(e.recommendation).toBe('REQUIRES-SENIOR');
  });
});

describe('Policy Engine — recommendation derivation is SEPARATE from structural evaluation', () => {
  it('deriveRecommendation is a pure function of the per-rule results (independently testable)', () => {
    const hard: PerRuleResult[] = [{ id: 'x', dimension: 'compliance', severity: 'hard', description: '', satisfied: false }];
    expect(deriveRecommendation(hard)).toEqual({ recommendation: 'RECOMMEND-REFUSE', overridable: false });
    const dual: PerRuleResult[] = [{ id: 'y', dimension: 'approval-authority', severity: 'soft', description: '', satisfied: false, escalation: 'REQUIRES-DUAL-APPROVAL' }];
    expect(deriveRecommendation(dual).recommendation).toBe('REQUIRES-DUAL-APPROVAL');
    const soft: PerRuleResult[] = [{ id: 'z', dimension: 'operational-safety', severity: 'soft', description: '', satisfied: false }];
    expect(deriveRecommendation(soft)).toEqual({ recommendation: 'RECOMMEND-REFUSE', overridable: true });
    const clean: PerRuleResult[] = [{ id: 'w', dimension: 'compliance', severity: 'hard', description: '', satisfied: true }];
    expect(deriveRecommendation(clean).recommendation).toBe('RECOMMEND-APPROVE');
  });
});

describe('Policy Engine — CONFIG-DRIVEN: a new rule is evaluated with NO engine-core change', () => {
  it('adding a rule to the policy set (new version) is evaluated by the same engine', () => {
    const custom: PolicyRule = ruleWhen('safety.no-send-email-to-external', 'operational-safety', 'soft', 'no email to external domains', (f) => f.tool === 'send_email');
    const extended = new PolicyEngine({ version: 2, rules: [...EXAMPLE_RULES, custom] });
    const e = extended.evaluate(facts({ tool: 'send_email', target: 'a@x.com', effect: 'email a@x.com' }));
    expect(e.policyVersion).toBe(2);
    expect(e.perRule.map((r) => r.id)).toContain('safety.no-send-email-to-external');
    expect(e.perRule.find((r) => r.id === 'safety.no-send-email-to-external')!.satisfied).toBe(false);
  });
});

describe('Policy Engine — INFORMS, never DECIDES: cannot approve/commit/weaken any guard (structural)', () => {
  it('the engine exposes NO approve/commit/mint method and holds no gate/guard reference', () => {
    const e = engine as unknown as Record<string, unknown>;
    for (const m of ['approve', 'commit', 'mint', 'resolve', 'consume', 'disableAudit', 'disableKill', 'setForbidden']) {
      expect(typeof e[m]).toBe('undefined');
    }
    // its only capability is evaluate() → data. Even a set whose rules ALL satisfy produces only advice.
    const permissive = new PolicyEngine({ version: 9, rules: [ruleWhen('always.ok', 'compliance', 'soft', 'ok', () => false)] });
    const out = permissive.evaluate(facts());
    expect(out.advisory).toBe(true);
    expect(out.recommendation).toBe('RECOMMEND-APPROVE'); // a recommendation — NOT an approval; nothing is committed
    expect(Object.keys(out).sort()).toEqual(['advisory', 'hardViolations', 'overridable', 'perRule', 'policyBlocked', 'policyVersion', 'reasons', 'recommendation', 'softViolations']);
  });
  it('a PolicyRule can only ADD a constraint (a boolean predicate) — it has no guard-toggling shape', () => {
    // the rule surface is {id,dimension,severity,description,check,escalation?} — no field can disable a guard.
    const r: PolicyRule = EXAMPLE_RULES[0];
    expect(Object.keys(r).sort().filter((k) => k !== 'escalation')).toEqual(['check', 'description', 'dimension', 'id', 'severity']);
    expect(typeof r.check(facts())).toBe('boolean'); // pure predicate, returns a fact
  });
});
