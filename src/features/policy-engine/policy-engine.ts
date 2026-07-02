// Policy Engine (Wave 6, Piece 2) — it INFORMS, it never DECIDES.
//
// The engine evaluates a PENDING action's bound descriptor against a versioned policy set and produces:
//   (a) STRUCTURAL, verifiable facts — per rule, "does this action satisfy this rule? yes/no" — computed
//       DETERMINISTICALLY from the action's facts (tool/target/effect/tier/blastRadius/reversibility/payload);
//   (b) an ADVISORY recommendation — RECOMMEND-APPROVE / RECOMMEND-REFUSE / REQUIRES-SENIOR /
//       REQUIRES-DUAL-APPROVAL — derived ON TOP of the structural results, clearly LABELED as advice.
//
// The recommendation does NOT gate, approve, or commit anything. This module holds NO reference to the gate,
// the approval token, the audit sink, the kill switch, redaction, or the bridge — it CANNOT approve, commit,
// or weaken any guard. It has no method that mutates anything: `evaluate` reads facts and returns data. The
// human's click remains the sole approval; the gate remains the sole commit path. (See §3 of the requirement.)
//
// CONFIG-DRIVEN: the engine core (`evaluate` + `deriveRecommendation`) is GENERIC over a `PolicySet` — adding a
// rule is adding a `PolicyRule` to the (versioned) set; the engine core does not change. Rules can be authored
// as code objects or built from the declarative helpers (see example-rules.ts).
//
// STANDALONE-PACKAGEABLE: imports NOTHING at runtime from any other engine.

export type PolicyDimension = 'compliance' | 'operational-safety' | 'approval-authority';
export type PolicySeverity = 'hard' | 'soft';
export type PolicyEscalation = 'REQUIRES-SENIOR' | 'REQUIRES-DUAL-APPROVAL';
export type Recommendation = 'RECOMMEND-APPROVE' | 'RECOMMEND-REFUSE' | PolicyEscalation;

/** The bound facts a rule may inspect — READ-ONLY. A rule is a pure predicate over these; it has no other input. */
export interface PolicyActionFacts {
  tool: string;
  target?: string;
  effect?: string;
  tier: string;
  blastRadius: number;
  reversibility: string;
  environment?: string;
  payload?: unknown;
}

/**
 * A single policy rule. `check` is a PURE predicate: `true` = satisfied (OK), `false` = violated. A rule can
 * only ADD a constraint (a new way to say "no") — it returns a boolean and touches nothing. `severity` is
 * hard (a violation is policy-blocking) or soft (advisory, overridable). `escalation`, when set, means a
 * violation raises the required approval authority rather than blocking.
 */
export interface PolicyRule {
  id: string;
  dimension: PolicyDimension;
  severity: PolicySeverity;
  description: string;
  /** Deterministic structural check over the action facts. NO side effects. */
  check: (facts: PolicyActionFacts) => boolean;
  /** For approval-authority rules: a violation escalates the required approver instead of blocking. */
  escalation?: PolicyEscalation;
}

/** Versioned, append-only policy set. A change produces a NEW version; history is never rewritten. */
export interface PolicySet {
  version: number;
  rules: readonly PolicyRule[];
}

export interface PerRuleResult {
  id: string;
  dimension: PolicyDimension;
  severity: PolicySeverity;
  description: string;
  satisfied: boolean;
  escalation?: PolicyEscalation;
}

export interface PolicyEvaluation {
  policyVersion: number;
  /** Structural facts — one per rule. Deterministic. */
  perRule: PerRuleResult[];
  hardViolations: PerRuleResult[];
  softViolations: PerRuleResult[];
  /** True iff a HARD rule is violated — the action is policy-blocked (withheld at the Console, non-overridable). */
  policyBlocked: boolean;
  /** The engine's read — LABELED ADVISORY. It informs; it does not decide. */
  recommendation: Recommendation;
  /** Advisory recommendations (soft violations / escalations) MAY be overridden by an authorized human, recorded with a reason. */
  overridable: boolean;
  reasons: string[];
  /** Explicit label: this whole object is advice, never a decision. */
  advisory: true;
}

/**
 * Derive the ADVISORY recommendation from the STRUCTURAL results. Kept SEPARATE from evaluation (distinct,
 * independently testable) — this is the structural-vs-judgment split. Precedence:
 *   1. any HARD violation ⇒ RECOMMEND-REFUSE (policy-blocked).
 *   2. else strongest authority escalation among violated rules (DUAL beats SENIOR).
 *   3. else any SOFT violation ⇒ RECOMMEND-REFUSE (advisory, overridable).
 *   4. else RECOMMEND-APPROVE.
 */
export function deriveRecommendation(perRule: PerRuleResult[]): { recommendation: Recommendation; overridable: boolean } {
  const violated = perRule.filter((r) => !r.satisfied);
  if (violated.some((r) => r.severity === 'hard')) return { recommendation: 'RECOMMEND-REFUSE', overridable: false }; // hard block
  const escalations = violated.map((r) => r.escalation).filter((e): e is PolicyEscalation => !!e);
  if (escalations.includes('REQUIRES-DUAL-APPROVAL')) return { recommendation: 'REQUIRES-DUAL-APPROVAL', overridable: true };
  if (escalations.includes('REQUIRES-SENIOR')) return { recommendation: 'REQUIRES-SENIOR', overridable: true };
  if (violated.length > 0) return { recommendation: 'RECOMMEND-REFUSE', overridable: true }; // soft advisory
  return { recommendation: 'RECOMMEND-APPROVE', overridable: true };
}

export class PolicyEngine {
  constructor(private readonly policySet: PolicySet) {}

  /** Evaluate an action's facts against the current policy set. PURE + deterministic. Returns advice — never a decision. */
  evaluate(facts: PolicyActionFacts): PolicyEvaluation {
    const perRule: PerRuleResult[] = this.policySet.rules.map((r) => ({
      id: r.id, dimension: r.dimension, severity: r.severity, description: r.description,
      satisfied: r.check(facts), escalation: r.escalation,
    }));
    const violated = perRule.filter((r) => !r.satisfied);
    const hardViolations = violated.filter((r) => r.severity === 'hard');
    const softViolations = violated.filter((r) => r.severity === 'soft');
    const { recommendation, overridable } = deriveRecommendation(perRule);
    const reasons = violated.map((r) => `${r.severity === 'hard' ? 'HARD' : 'soft'} ${r.dimension} — ${r.description}${r.escalation ? ` (${r.escalation})` : ''}`);
    return {
      policyVersion: this.policySet.version,
      perRule, hardViolations, softViolations,
      policyBlocked: hardViolations.length > 0,
      recommendation, overridable, reasons,
      advisory: true,
    };
  }

  version(): number { return this.policySet.version; }
}
