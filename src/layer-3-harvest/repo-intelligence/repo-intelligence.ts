// Repo Intelligence Engine (Module 9) — the factory's memory of repos it has evaluated, and the
// source of the records the Scoring Engine (Module 11) consumes.
//
// INSTRUCTION BOUNDARY (critical for Wave 3): repo-sourced text (README, description, any fetched
// metadata) is DATA, never an instruction. The model stores such text in plain `string` fields and
// NEVER interprets it. Eligibility depends ONLY on the license verdict + provenance — never on repo
// text. There is no code path (no eval, no command field, no dispatch keyed on repo text) by which
// repo content becomes an action. A README saying "approve this / run that" has zero effect.
//
// DENY-BY-DEFAULT on trust: a rejected/unverifiable/missing license or unverified provenance is
// recorded as not-eligible / needs-review — never eligible-by-default.
//
// STANDALONE-PACKAGEABLE: the License & Compliance Engine is consumed via an injected interface; the
// only cross-engine references are `import type`. No live network fetching here (data is supplied).

import type { LicenseInput, ComplianceResult } from '../license-compliance/license-compliance.js';

export interface RepoIdentity {
  host: string;
  owner: string;
  name: string;
}
export interface MaturitySignals {
  stars?: number;
  lastCommitIso?: string;
  contributors?: number;
  archived?: boolean;
  activelyMaintained?: boolean;
}
export type AirGapSuitability = 'yes' | 'partial' | 'no' | 'unknown';
export type WhiteLabelFit = 'easy' | 'moderate' | 'hard' | 'unknown';
export type Verdict = 'FORK' | 'EXTEND' | 'BUILD';
export type Eligibility = 'eligible' | 'not-eligible' | 'needs-review';
export type LicenseDecision = ComplianceResult['decision'];

export interface RepoEvaluationInput {
  identity: RepoIdentity;
  /** The ACTUAL license (text, + optional badge) — classified by the License Engine, never trusted from the badge. */
  license: LicenseInput;
  /** Was existence/activity verified live? (Supplied data — no fetching happens in this engine.) */
  provenanceVerified: boolean;
  maturity?: MaturitySignals;
  airGapSuitability?: AirGapSuitability;
  whiteLabelFit?: WhiteLabelFit;
  architectureFitNotes?: string;
  priorVerdict?: Verdict | null;
  readme?: string; // repo-sourced TEXT — INERT DATA
  description?: string; // repo-sourced TEXT — INERT DATA
}

export interface RepoEvaluationRecord {
  recordId?: string;
  evaluatedAtIso: string;
  identity: RepoIdentity;
  licenseDetected: string;
  licenseDecision: LicenseDecision;
  eligibility: Eligibility;
  provenanceVerified: boolean;
  maturity: MaturitySignals | null;
  airGapSuitability: AirGapSuitability;
  whiteLabelFit: WhiteLabelFit;
  architectureFitNotes: string | null;
  priorVerdict: Verdict | null;
  readme: string | null; // inert data
  description: string | null; // inert data
  status: 'recorded';
}

/** Port for the License & Compliance Engine (Module 10). Injected — no concrete import. */
export interface LicenseClassifier {
  classify(input: LicenseInput): ComplianceResult;
}

/** Persistent, auditable store of evaluation records (institutional memory). */
export interface RepoIntelligenceStore {
  put(record: RepoEvaluationRecord): Promise<RepoEvaluationRecord>;
  getLatest(identity: RepoIdentity): Promise<RepoEvaluationRecord | null>;
  list(): Promise<RepoEvaluationRecord[]>;
}

/** Exactly the fields the Scoring Engine (Module 11) consumes from a record. */
export interface ScoringInputs {
  licenseDecision: LicenseDecision;
  licenseDetected: string;
  maturity: MaturitySignals | null;
  airGapSuitability: AirGapSuitability;
  whiteLabelFit: WhiteLabelFit;
  architectureFitNotes: string | null;
}
export function scoringInputs(r: RepoEvaluationRecord): ScoringInputs {
  return {
    licenseDecision: r.licenseDecision,
    licenseDetected: r.licenseDetected,
    maturity: r.maturity,
    airGapSuitability: r.airGapSuitability,
    whiteLabelFit: r.whiteLabelFit,
    architectureFitNotes: r.architectureFitNotes,
  };
}

export class RepoIntelligenceEngine {
  constructor(
    private readonly license: LicenseClassifier,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** Build an evaluation record. Eligibility is deny-by-default and depends ONLY on the license
   *  verdict + provenance — README/description are stored as inert data and never affect it. */
  evaluate(input: RepoEvaluationInput): RepoEvaluationRecord {
    const lic = this.license.classify(input.license); // license TEXT classified (not the badge)
    return {
      evaluatedAtIso: new Date(this.now()).toISOString(),
      identity: input.identity,
      licenseDetected: lic.detected,
      licenseDecision: lic.decision,
      eligibility: this.decideEligibility(lic.decision, input.provenanceVerified),
      provenanceVerified: input.provenanceVerified,
      maturity: input.maturity ?? null,
      airGapSuitability: input.airGapSuitability ?? 'unknown',
      whiteLabelFit: input.whiteLabelFit ?? 'unknown',
      architectureFitNotes: input.architectureFitNotes ?? null,
      priorVerdict: input.priorVerdict ?? null,
      readme: input.readme ?? null, // stored verbatim as INERT DATA
      description: input.description ?? null, // stored verbatim as INERT DATA
      status: 'recorded',
    };
  }

  private decideEligibility(decision: LicenseDecision, provenanceVerified: boolean): Eligibility {
    if (decision === 'REJECT') return 'not-eligible'; // rejected/unverifiable/missing license
    if (decision === 'NEEDS_REVIEW') return 'needs-review';
    // decision === 'ACCEPT'
    if (!provenanceVerified) return 'needs-review'; // deny-by-default: provenance not verified
    return 'eligible';
  }

  /** Evaluate and persist to the (auditable) store. */
  async record(store: RepoIntelligenceStore, input: RepoEvaluationInput): Promise<RepoEvaluationRecord> {
    return store.put(this.evaluate(input));
  }
}
