// Policy Store (Wave 6, Piece 3) — the VERSIONED, APPEND-ONLY holder of the active policy. A policy change is
// a new version (append-only); activating a version is recorded as an append-only transition. The store holds
// ONLY PolicySet config (rules = pure add-only-constraint predicates) — it has NO reference to and NO way to
// touch audit / redaction / kill-switch / the approval requirement / sole-authority / FORBIDDEN. A policy
// change therefore CANNOT weaken the guard stack; it can only alter the (advisory + hard-withhold) policy layer.
//
// `evaluate` always uses the CURRENTLY ACTIVE version — so a proposed-but-unapproved version is INERT until it
// is activated (which happens only after a human approves the gated change; see policy-change-wiring.ts).

import { PolicyEngine, type PolicyActionFacts, type PolicyEvaluation, type PolicyRule, type PolicySet } from './policy-engine.js';

/** The narrow evaluate port the Console seat depends on. Both `PolicyEngine` and `PolicyStore` satisfy it. */
export interface PolicyEvaluator {
  evaluate(facts: PolicyActionFacts): PolicyEvaluation;
}

/** An append-only record of a version activation (old → new, who approved, when). */
export interface PolicyTransition {
  fromVersion: number;
  toVersion: number;
  approvedBy: string; // the REAL operator — never 'claude'
  atIso: string;
}

export class PolicyStore implements PolicyEvaluator {
  private readonly versions = new Map<number, PolicySet>(); // append-only: entries are never removed or mutated
  private readonly order: number[] = [];
  private readonly transitionLog: PolicyTransition[] = [];
  private activeVersionNum: number;
  private activeEngine: PolicyEngine;
  private nextVersion: number;

  constructor(initial: PolicySet, private readonly now: () => number = () => Date.now()) {
    this.versions.set(initial.version, initial);
    this.order.push(initial.version);
    this.activeVersionNum = initial.version;
    this.activeEngine = new PolicyEngine(initial);
    this.nextVersion = initial.version + 1;
  }

  /** The active policy set + its evaluation — always the CURRENTLY ACTIVE version. */
  active(): PolicySet { return this.versions.get(this.activeVersionNum)!; }
  activeVersion(): number { return this.activeVersionNum; }
  evaluate(facts: PolicyActionFacts): PolicyEvaluation { return this.activeEngine.evaluate(facts); }

  /**
   * Append a NEW candidate version from a full ruleset. It is stored (append-only) but NOT activated — the
   * active version is unchanged, so evaluations still use the old policy until `activate` is approved.
   */
  proposeVersion(rules: readonly PolicyRule[]): number {
    const version = this.nextVersion++;
    this.versions.set(version, { version, rules }); // append-only — a new version, never a mutation
    this.order.push(version);
    return version;
  }

  /**
   * Activate an existing candidate version and record an append-only transition. This ONLY moves the active
   * pointer over PolicySet config — it touches NO guard. Requires a real human approver (never 'claude').
   */
  activate(version: number, approvedBy: string): PolicyTransition {
    const set = this.versions.get(version);
    if (!set) throw new Error(`no policy version ${version}`);
    const who = approvedBy?.trim();
    if (!who || who.toLowerCase() === 'claude') throw new Error('policy activation requires a real human approver (never "claude")');
    const transition: PolicyTransition = { fromVersion: this.activeVersionNum, toVersion: version, approvedBy: who, atIso: new Date(this.now()).toISOString() };
    this.transitionLog.push(transition); // append-only
    this.activeVersionNum = version;
    this.activeEngine = new PolicyEngine(set); // evaluations now use the new active version
    return transition;
  }

  version(version: number): PolicySet | undefined { return this.versions.get(version); }
  /** Inspectable, append-only history. */
  history(): { versions: number[]; active: number; transitions: readonly PolicyTransition[] } {
    return { versions: this.order.slice(), active: this.activeVersionNum, transitions: this.transitionLog.slice() };
  }
}
