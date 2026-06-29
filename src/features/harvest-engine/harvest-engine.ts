// Harvest Engine (Module 8) — orchestrates the full harvest loop over the five sourcing engines
// (License, Repo Intelligence, Scoring, Product Spine, Sovereign Readiness, White-Label), consumed via
// INJECTED PORTS, and assembles a structured Harvest Report.
//
// CORE GUARANTEE — the harvest ALWAYS ends in STOP-for-human-approval and NEVER self-approves. The
// report's `status` is a single literal type `'STOP-AWAITING-HUMAN-APPROVAL'`; there is no code path
// and no type variant by which the engine emits "approved"/"proceed". It produces a recommendation,
// never an authorization.
//
// DENY-BY-DEFAULT: any engine returning Rejected/Non-sovereign/Blocked/needs-review/escalation is
// surfaced as a blocking or review item — never buried under an otherwise-positive recommendation.
//
// STANDALONE-PACKAGEABLE: the five engines are injected; the only cross-engine references are `import type`.

import type { LicenseInput, ComplianceResult } from '../license-compliance/license-compliance.js';
import type { RepoIdentity, RepoEvaluationInput, RepoEvaluationRecord, Eligibility } from '../repo-intelligence/repo-intelligence.js';
import type { ScoringCandidate, ScoreResult, Verdict } from '../scoring-engine/scoring-engine.js';
import type { SpineCandidate, SpineAssessmentInput, SpineResult, CompositionProposal, SpofAnalysis } from '../product-spine/product-spine.js';
import type { SovereignDescriptor, SovereignReport } from '../sovereign-readiness/sovereign-readiness.js';
import type { BrandingElement, WhiteLabelReport } from '../white-label/white-label.js';

/** The five engines, injected as ports (no concrete cross-engine import). */
export interface HarvestEngines {
  classifyLicense(input: LicenseInput): ComplianceResult;
  evaluateRepo(input: RepoEvaluationInput): RepoEvaluationRecord;
  score(candidate: ScoringCandidate): ScoreResult;
  assessSpine(input: SpineAssessmentInput): SpineResult;
  assessSovereign(descriptor: SovereignDescriptor): SovereignReport;
  assessWhiteLabel(elements: BrandingElement[]): WhiteLabelReport;
}

export interface HarvestCandidateInput {
  id: string;
  identity: RepoIdentity;
  license: LicenseInput;
  provenanceVerified: boolean;
  /** Two INDEPENDENT scoring passes (§3.8) — disagreement > 15 ⇒ escalate. */
  scoringPassA: ScoringCandidate;
  scoringPassB: ScoringCandidate;
}

export interface HarvestInput {
  candidates: HarvestCandidateInput[];
  composition?: CompositionProposal;
  sovereignDescriptor?: SovereignDescriptor;
  brandingElements?: BrandingElement[];
  buildJustification?: string;
  /** The scout's proposed sourcing verdict for the product (flagged if BUILD over an acceptable FORK/EXTEND). */
  proposedVerdict?: Verdict;
}

export interface CandidateAssessment {
  id: string;
  license: ComplianceResult;
  eligibility: Eligibility;
  scorePassA: ScoreResult;
  scorePassB: ScoreResult;
  scoreUsed: number; // pessimistic: min of the two passes
  scoreDisagreement: number;
  escalated: boolean; // §3.8 disagreement > 15
  evidence: string[];
}

export interface HarvestRecommendation {
  verdict: Verdict | 'NONE';
  evidence: string[]; // no verdict without evidence
  reuseOverBuildFlag: boolean; // §3.9: BUILD while an acceptable FORK/EXTEND exists
}

export interface HarvestReport {
  /** ALWAYS this literal — the engine never self-approves. */
  status: 'STOP-AWAITING-HUMAN-APPROVAL';
  candidates: CandidateAssessment[];
  spine: SpineResult;
  sovereign: SovereignReport | null;
  whiteLabel: WhiteLabelReport | null;
  spof: SpofAnalysis;
  recommendation: HarvestRecommendation;
  blockingItems: string[];
  reviewItems: string[];
}

const SCORE_DISAGREEMENT_LIMIT = 15;

export class HarvestEngine {
  constructor(private readonly engines: HarvestEngines) {}

  harvest(input: HarvestInput): HarvestReport {
    const blockingItems: string[] = [];
    const reviewItems: string[] = [];

    // --- per candidate: license + eligibility + two-pass scoring (§3.8) ---
    const candidates: CandidateAssessment[] = input.candidates.map((c) => {
      const license = this.engines.classifyLicense(c.license);
      const record = this.engines.evaluateRepo({ identity: c.identity, license: c.license, provenanceVerified: c.provenanceVerified });
      const a = this.engines.score(c.scoringPassA);
      const b = this.engines.score(c.scoringPassB);
      const disagreement = Math.abs(a.total - b.total);
      const escalated = disagreement > SCORE_DISAGREEMENT_LIMIT;
      const scoreUsed = Math.min(a.total, b.total); // deny-by-default: use the pessimistic pass
      const evidence = [
        `license ${license.decision} (${license.detected})`,
        `eligibility ${record.eligibility}`,
        `score pass A=${a.total}, pass B=${b.total} (Δ=${disagreement})`,
      ];

      if (license.decision === 'REJECT') blockingItems.push(`${c.id}: license REJECT (${license.detected})`);
      else if (record.eligibility === 'not-eligible') blockingItems.push(`${c.id}: not-eligible`);
      if (record.eligibility === 'needs-review') reviewItems.push(`${c.id}: eligibility needs-review`);
      if (escalated) reviewItems.push(`${c.id}: §3.8 scoring passes disagree by ${disagreement} (> ${SCORE_DISAGREEMENT_LIMIT}) — escalate to human (do not average/pick one)`);

      return { id: c.id, license, eligibility: record.eligibility, scorePassA: a, scorePassB: b, scoreUsed, scoreDisagreement: disagreement, escalated, evidence };
    });

    // --- product spine over the scored set (pessimistic pass) ---
    const spineCandidates: SpineCandidate[] = input.candidates.map((c, i) => {
      const ca = candidates[i]!;
      return { id: c.id, score: ca.scorePassA.total <= ca.scorePassB.total ? ca.scorePassA : ca.scorePassB };
    });
    const spine = this.engines.assessSpine({ candidates: spineCandidates, composition: input.composition, buildJustification: input.buildJustification });
    if (spine.verdict === 'rejected') blockingItems.push(`spine: rejected — ${spine.reasons.join('; ')}`);
    else if (spine.verdict === 'downgraded') reviewItems.push(`spine: downgraded — ${spine.recommendation ?? 'find a stronger spine'}`);

    // --- sovereign readiness on the chosen spine (deny-by-default surfacing) ---
    const sovereign = input.sovereignDescriptor ? this.engines.assessSovereign(input.sovereignDescriptor) : null;
    if (sovereign) {
      if (sovereign.verdict === 'Rejected') blockingItems.push('sovereign: Rejected');
      else if (sovereign.verdict === 'Non-sovereign-only') blockingItems.push('sovereign: Non-sovereign-only');
      else if (sovereign.verdict === 'Acceptable-after-hardening') reviewItems.push('sovereign: Acceptable-after-hardening');
    }

    // --- white-label assessment ---
    const whiteLabel = input.brandingElements ? this.engines.assessWhiteLabel(input.brandingElements) : null;
    if (whiteLabel) {
      if (whiteLabel.verdict === 'Blocked-by-legal-obligation') blockingItems.push('white-label: Blocked-by-legal-obligation');
      else if (whiteLabel.verdict === 'Ready-after-stripping') reviewItems.push('white-label: Ready-after-stripping');
    }

    // --- recommendation (no verdict without evidence; §3.9 reuse-beats-rebuild flag) ---
    const acceptableSourced = candidates.some((c) => c.eligibility === 'eligible' && c.scoreUsed >= 70);
    let recVerdict: Verdict | 'NONE';
    if (input.proposedVerdict) recVerdict = input.proposedVerdict;
    else if (spine.spineType === 'justified-BUILD-spine') recVerdict = 'BUILD';
    else if (spine.verdict === 'accepted' || spine.verdict === 'downgraded') recVerdict = 'FORK';
    else recVerdict = 'NONE';

    const reuseOverBuildFlag = recVerdict === 'BUILD' && acceptableSourced;
    if (reuseOverBuildFlag) {
      reviewItems.push('§3.9: BUILD recommended while an acceptable FORK/EXTEND candidate exists (eligible, score ≥ 70) — reuse beats rebuild; requires human review');
    }
    const recommendation: HarvestRecommendation = {
      verdict: recVerdict,
      evidence: [
        `spine: ${spine.verdict} / ${spine.spineType ?? 'none'}`,
        `acceptable sourced candidate available: ${acceptableSourced}`,
        `derived ${input.proposedVerdict ? 'from the scout proposed verdict' : 'from the spine result'}`,
      ],
      reuseOverBuildFlag,
    };

    // status is ALWAYS STOP — the engine produces a recommendation, never an authorization.
    return {
      status: 'STOP-AWAITING-HUMAN-APPROVAL',
      candidates,
      spine,
      sovereign,
      whiteLabel,
      spof: spine.spof,
      recommendation,
      blockingItems,
      reviewItems,
    };
  }
}
