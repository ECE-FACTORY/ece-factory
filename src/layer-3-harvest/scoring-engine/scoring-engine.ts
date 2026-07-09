// Repository Scoring Engine (Module 11) — scores a candidate per Layer 1.1 §3, with hard gates that
// override the total, and DENY-BY-DEFAULT (pessimistic) scoring.
//
// CORE GUARANTEE — score pessimistic, never optimistic: a sub-score whose evidence is missing or
// unverifiable scores LOW (and is flagged), never gets the benefit of the doubt. A scorer that
// defaults generous is a scorer gamed by omitting evidence. Missing evidence = low score, full stop.
//
// HARD GATES (override the total): License REJECT ⇒ License 0 ⇒ automatic rejection; a spine candidate
// must score ≥15 Maturity; Air-gap < 10 ⇒ human-approval flag; §3.9 — a 70+ candidate steered to BUILD
// is flagged (don't rationalize an unnecessary BUILD over a good harvest candidate).
//
// STANDALONE-PACKAGEABLE: the only cross-engine references are `import type` (Repo Intelligence + License
// decision types) — zero runtime coupling.

import type { LicenseDecision, MaturitySignals, AirGapSuitability, WhiteLabelFit, MultiTenancy, BillingHooks, CloudNative, ScoringInputs } from '../repo-intelligence/repo-intelligence.js';

export type ArchFitRating = 'strong' | 'good' | 'possible' | 'poor';
export type MaintainabilityRating = 'clean' | 'maintainable' | 'hard' | 'unsafe';
export type Verdict = 'FORK' | 'EXTEND' | 'BUILD';

/**
 * The product lens for a harvest run. Chosen upfront, threaded as a REQUIRED parameter (never defaulted), and
 * stamped into every report. `sovereign` = today's behaviour (air-gap is a hard FORK gate). `subscription`
 * ignores air-gap entirely and rewards multi-tenancy, billing hooks, and cloud-native architecture.
 */
export type ProductMode = 'sovereign' | 'subscription';

export interface ScoringCandidate {
  license: { decision: LicenseDecision; detected: string };
  maturity?: MaturitySignals;
  airGap?: AirGapSuitability;          // sovereign-only
  whiteLabel?: WhiteLabelFit;          // sovereign-only
  multiTenancy?: MultiTenancy;         // subscription-only
  billingHooks?: BillingHooks;         // subscription-only
  cloudNative?: CloudNative;           // subscription-only
  archFit?: { rating: ArchFitRating; note?: string };
  maintainability?: { rating: MaintainabilityRating; note?: string };
  isSpine?: boolean;
  proposedVerdict?: Verdict;
}

export interface SubScore {
  dimension: string;
  score: number;
  max: number;
  evidence: string; // §3.8 — a sub-score with no evidence is not a real score
  flagged: boolean;
  /**
   * Was this dimension actually OBSERVED (even if the observation is bad), or is it a deny-by-default /
   * absent / "unknown" branch? MEASURED dims count toward the normalized score's denominator; UNMEASURED
   * dims are EXCLUDED entirely (never scored 0). Distinct from `flagged`: a measured-but-bad dimension is
   * `flagged: true, measured: true` — a real negative finding, not an absence of evidence.
   */
  measured: boolean;
}

export type ScoreBand = 'strong' | 'acceptable' | 'risky' | 'reject';

export interface ScoreResult {
  subScores: SubScore[];
  /**
   * NORMALIZED score (0–100): the weighted average over MEASURED dimensions only —
   * Σ(points of measured dims) / Σ(max of measured dims) × 100. An unmeasured dimension is excluded from
   * both numerator and denominator (never 0). When all six dimensions are measured, this equals the old sum.
   */
  total: number;
  rejected: boolean; // hard reject (license 0)
  band: ScoreBand;
  flags: string[];
  /** How many of the six dimensions were actually measured (confidence carried forward for the verdict floor). */
  measuredCount: number;
  /** Fraction of the total possible weight (100) that was actually measured — the score's coverage/confidence. */
  measuredWeightFraction: number;
}

/** Adapt a Repo Intelligence record's scoringInputs (+ supplied ratings) into a ScoringCandidate. */
export function candidateFromScoringInputs(
  s: ScoringInputs,
  extra: {
    archFit?: { rating: ArchFitRating; note?: string };
    maintainability?: { rating: MaintainabilityRating; note?: string };
    // Subscription dims the enrichment MAY fold from scout signals (override the record's deny-by-default).
    cloudNative?: CloudNative;
    billingHooks?: BillingHooks;
    isSpine?: boolean;
    proposedVerdict?: Verdict;
  } = {},
): ScoringCandidate {
  return {
    license: { decision: s.licenseDecision, detected: s.licenseDetected },
    maturity: s.maturity ?? undefined,
    airGap: s.airGapSuitability,
    whiteLabel: s.whiteLabelFit,
    // subscription dims — ignored by scoreCandidate under 'sovereign'. Enrichment overrides win over the record.
    multiTenancy: s.multiTenancy,   // multi-tenancy is human-assessed only — never folded from the scout
    billingHooks: extra.billingHooks ?? s.billingHooks,
    cloudNative: extra.cloudNative ?? s.cloudNative,
    // arch-fit rating must be supplied (a freeform note alone is not a score); merge the record's note if absent.
    archFit: extra.archFit ? { rating: extra.archFit.rating, note: extra.archFit.note ?? s.architectureFitNotes ?? undefined } : undefined,
    maintainability: extra.maintainability,
    isSpine: extra.isSpine,
    proposedVerdict: extra.proposedVerdict,
  };
}

function scoreLicense(c: ScoringCandidate): SubScore {
  const d = c.license?.decision;
  // A license classification (ACCEPT/REJECT/NEEDS_REVIEW) is a real observation of the LICENSE text ⇒ measured.
  // Only a total absence of license evidence is unmeasured.
  if (d === 'REJECT') return { dimension: 'license', score: 0, max: 20, evidence: `license REJECT (${c.license.detected}) — automatic rejection`, flagged: true, measured: true };
  if (d === 'ACCEPT') return { dimension: 'license', score: 20, max: 20, evidence: `license ACCEPT (${c.license.detected})`, flagged: false, measured: true };
  if (d === 'NEEDS_REVIEW') return { dimension: 'license', score: 10, max: 20, evidence: `license NEEDS_REVIEW (${c.license.detected}) — unresolved ambiguity`, flagged: true, measured: true };
  return { dimension: 'license', score: 0, max: 20, evidence: 'license evidence missing', flagged: true, measured: false };
}

function scoreMaturity(c: ScoringCandidate): SubScore {
  const m = c.maturity;
  // Unmeasured: no maturity object at all. Measured-but-bad: archived, or actively-maintained === false (a real
  // negative finding). Unmeasured: activelyMaintained === undefined ("not positively confirmed", deny-by-default —
  // an ABSENCE of a maintenance finding, not a finding). A confirmed-maintained repo is measured even if stars are
  // unknown (maintenance, the core of maturity, WAS observed).
  if (!m) return { dimension: 'maturity', score: 0, max: 20, evidence: 'no maturity evidence (deny-by-default)', flagged: true, measured: false };
  if (m.archived === true) return { dimension: 'maturity', score: 0, max: 20, evidence: 'archived', flagged: true, measured: true };
  if (m.activelyMaintained !== true) {
    const score = m.activelyMaintained === false ? 5 : 8;
    return { dimension: 'maturity', score, max: 20, evidence: m.activelyMaintained === false ? 'not actively maintained' : 'active maintenance not positively confirmed (deny-by-default)', flagged: true, measured: m.activelyMaintained === false };
  }
  // actively maintained (confirmed) — measured even when the star scale is unverified.
  if (m.stars === undefined) return { dimension: 'maturity', score: 12, max: 20, evidence: 'actively maintained; deployment/star scale unverified', flagged: true, measured: true };
  if (m.stars >= 1000) return { dimension: 'maturity', score: 18, max: 20, evidence: `actively maintained; ${m.stars}★`, flagged: false, measured: true };
  if (m.stars >= 100) return { dimension: 'maturity', score: 16, max: 20, evidence: `actively maintained; ${m.stars}★`, flagged: false, measured: true };
  return { dimension: 'maturity', score: 13, max: 20, evidence: `actively maintained; only ${m.stars}★`, flagged: false, measured: true };
}

/**
 * The air-gap dimension's fixed Layer-1.1 scale, as a standalone mapping. yes/partial/no are real observations
 * (incl. the bounded 'partial') ⇒ measured; only 'unknown'/absent is deny-by-default unmeasured. Exported so a
 * HUMAN-measured air-gap rating can be folded into an existing score through the SAME scale the engine uses
 * (no duplicate scoring math elsewhere) — see `foldAirGapMeasurement`.
 */
export function airGapSubScore(value: AirGapSuitability | undefined): SubScore {
  switch (value) {
    case 'yes': return { dimension: 'air-gap', score: 20, max: 20, evidence: 'fully offline / air-gap deployable', flagged: false, measured: true };
    case 'partial': return { dimension: 'air-gap', score: 12, max: 20, evidence: 'partial air-gap (some removable deps)', flagged: false, measured: true };
    case 'no': return { dimension: 'air-gap', score: 4, max: 20, evidence: 'not air-gap deployable', flagged: true, measured: true };
    default: return { dimension: 'air-gap', score: 0, max: 20, evidence: 'air-gap suitability unknown (deny-by-default)', flagged: true, measured: false };
  }
}

function scoreAirGap(c: ScoringCandidate): SubScore {
  return airGapSubScore(c.airGap);
}

function scoreWhiteLabel(c: ScoringCandidate): SubScore {
  // easy/moderate/hard are real observations ⇒ measured. Only 'unknown'/absent is not.
  switch (c.whiteLabel) {
    case 'easy': return { dimension: 'white-label', score: 15, max: 15, evidence: 'easy rebrand, no hardcoded vendor identity', flagged: false, measured: true };
    case 'moderate': return { dimension: 'white-label', score: 10, max: 15, evidence: 'moderate branding/telemetry cleanup', flagged: false, measured: true };
    case 'hard': return { dimension: 'white-label', score: 5, max: 15, evidence: 'significant white-label friction', flagged: true, measured: true };
    default: return { dimension: 'white-label', score: 0, max: 15, evidence: 'white-label fit unknown (deny-by-default)', flagged: true, measured: false };
  }
}

function scoreArchFit(c: ScoringCandidate): SubScore {
  // A supplied rating (incl. a bounded/partial 'possible') is a real observation ⇒ measured. No rating ⇒ not.
  if (!c.archFit) return { dimension: 'arch-fit', score: 0, max: 15, evidence: 'no architecture-fit evidence (deny-by-default)', flagged: true, measured: false };
  const note = c.archFit.note ? ` — ${c.archFit.note}` : '';
  switch (c.archFit.rating) {
    case 'strong': return { dimension: 'arch-fit', score: 15, max: 15, evidence: `strong fit${note}`, flagged: false, measured: true };
    case 'good': return { dimension: 'arch-fit', score: 11, max: 15, evidence: `good fit, integration work${note}`, flagged: false, measured: true };
    case 'possible': return { dimension: 'arch-fit', score: 6, max: 15, evidence: `possible but complex${note}`, flagged: true, measured: true };
    case 'poor': return { dimension: 'arch-fit', score: 0, max: 15, evidence: `poor/incompatible${note}`, flagged: true, measured: true };
  }
}

function scoreMaintainability(c: ScoringCandidate): SubScore {
  // A supplied rating is a real observation ⇒ measured. No rating ⇒ not.
  if (!c.maintainability) return { dimension: 'maintainability', score: 0, max: 10, evidence: 'no maintainability evidence (deny-by-default)', flagged: true, measured: false };
  const note = c.maintainability.note ? ` — ${c.maintainability.note}` : '';
  switch (c.maintainability.rating) {
    case 'clean': return { dimension: 'maintainability', score: 10, max: 10, evidence: `clean, understandable, active${note}`, flagged: false, measured: true };
    case 'maintainable': return { dimension: 'maintainability', score: 7, max: 10, evidence: `maintainable with cleanup${note}`, flagged: false, measured: true };
    case 'hard': return { dimension: 'maintainability', score: 4, max: 10, evidence: `hard but usable${note}`, flagged: true, measured: true };
    case 'unsafe': return { dimension: 'maintainability', score: 0, max: 10, evidence: `unsafe maintenance burden${note}`, flagged: true, measured: true };
  }
}

// ── Subscription-mode sub-scores (product-mode switch). Same pessimistic, evidence-or-unmeasured discipline. ──
/** Multi-tenancy — the subscription analog of air-gap: HUMAN-assessed, deny-by-default when unknown. Max 15. */
export function multiTenancySubScore(value: MultiTenancy | undefined): SubScore {
  switch (value) {
    case 'full': return { dimension: 'multi-tenancy', score: 15, max: 15, evidence: 'tenant isolation by design (schema/row-level/tenant-scoped)', flagged: false, measured: true };
    case 'partial': return { dimension: 'multi-tenancy', score: 9, max: 15, evidence: 'single-tenant with a multi-tenant bolt-on', flagged: true, measured: true };
    case 'none': return { dimension: 'multi-tenancy', score: 3, max: 15, evidence: 'explicitly single-tenant', flagged: true, measured: true };
    default: return { dimension: 'multi-tenancy', score: 0, max: 15, evidence: 'multi-tenancy unknown (deny-by-default)', flagged: true, measured: false };
  }
}
/** Billing / subscription hooks — machine-detectable to 'integratable' (billing SDK dep); 'native' is human-confirmed. Max 10. */
export function billingHooksSubScore(value: BillingHooks | undefined): SubScore {
  switch (value) {
    case 'native': return { dimension: 'billing-hooks', score: 10, max: 10, evidence: 'native subscription/billing lifecycle', flagged: false, measured: true };
    case 'integratable': return { dimension: 'billing-hooks', score: 6, max: 10, evidence: 'billing SDK present — integratable (a dep proves a hook, not subscription-grade)', flagged: false, measured: true };
    case 'none': return { dimension: 'billing-hooks', score: 2, max: 10, evidence: 'no billing integration found', flagged: true, measured: true };
    default: return { dimension: 'billing-hooks', score: 0, max: 10, evidence: 'billing hooks unknown (deny-by-default)', flagged: true, measured: false };
  }
}
/** Cloud-native / scalable — machine-measurable from Dockerfile/k8s/helm/cloud-SDK evidence. Max 10. */
export function cloudNativeSubScore(value: CloudNative | undefined): SubScore {
  switch (value) {
    case 'strong': return { dimension: 'cloud-native', score: 10, max: 10, evidence: 'container/orchestration-native, horizontally scalable', flagged: false, measured: true };
    case 'partial': return { dimension: 'cloud-native', score: 6, max: 10, evidence: 'some cloud-native evidence (Dockerfile / cloud SDK)', flagged: false, measured: true };
    case 'poor': return { dimension: 'cloud-native', score: 2, max: 10, evidence: 'not designed for cloud / scale', flagged: true, measured: true };
    default: return { dimension: 'cloud-native', score: 0, max: 10, evidence: 'cloud-native fit unknown (deny-by-default)', flagged: true, measured: false };
  }
}

/**
 * NORMALIZE over MEASURED dimensions only. An UNMEASURED dimension ("couldn't measure") is EXCLUDED from both
 * numerator and denominator — it is NEVER scored 0 (which would be arithmetically identical to "measured as
 * terrible"). Property: when all six dimensions are measured, the denominator is 100 and this equals the old
 * plain sum. Pure — the single source of the normalized aggregate, reused by `scoreCandidate` AND by
 * `foldAirGapMeasurement`, so folding a human air-gap measurement can never drift from the engine's own math.
 */
export function normalizeMeasured(subScores: readonly SubScore[]): { total: number; measuredCount: number; measuredWeightFraction: number } {
  const measured = subScores.filter((s) => s.measured);
  const measuredWeight = measured.reduce((w, s) => w + s.max, 0);
  const measuredPoints = measured.reduce((p, s) => p + s.score, 0);
  const total = measuredWeight > 0 ? Math.round((measuredPoints / measuredWeight) * 1000) / 10 : 0; // normalized %, 1 dp
  return { total, measuredCount: measured.length, measuredWeightFraction: measuredWeight / 100 }; // 100 = full weight
}

/** Band = pure normalized-score classification (a hard reject overrides). The confidence FLOOR that blocks
 *  FORK/EXTEND when too few dims are measured lives at the verdict layer (decideSourcing), not here. */
export function bandFor(total: number, rejected: boolean): ScoreBand {
  if (rejected) return 'reject';
  if (total >= 85) return 'strong';
  if (total >= 70) return 'acceptable';
  if (total >= 55) return 'risky';
  return 'reject';
}

export function scoreCandidate(c: ScoringCandidate, mode: ProductMode): ScoreResult {
  // PROFILE = which dimensions exist for this lens. Universal-4 in both modes; sovereign adds air-gap +
  // white-label, subscription adds multi-tenancy + billing-hooks + cloud-native (air-gap NOT scored at all).
  // The sovereign array is byte-identical to the pre-switch order — sovereign behaviour is unchanged.
  const subScores = mode === 'sovereign'
    ? [scoreLicense(c), scoreMaturity(c), scoreAirGap(c), scoreWhiteLabel(c), scoreArchFit(c), scoreMaintainability(c)]
    : [scoreLicense(c), scoreMaturity(c), scoreArchFit(c), scoreMaintainability(c), multiTenancySubScore(c.multiTenancy), billingHooksSubScore(c.billingHooks), cloudNativeSubScore(c.cloudNative)];

  const { total, measuredCount, measuredWeightFraction } = normalizeMeasured(subScores);

  const license = subScores.find((s) => s.dimension === 'license')!;   // present in both profiles
  const maturity = subScores.find((s) => s.dimension === 'maturity')!;  // present in both profiles
  const flags: string[] = [];

  // Hard gate — License 0 ⇒ automatic rejection (cannot be outweighed). UNCHANGED.
  const rejected = license.score === 0 && c.license?.decision === 'REJECT';

  // Hard gate — spine must score ≥15 maturity.
  if (c.isSpine && maturity.score < 15) flags.push(`spine candidate scores ${maturity.score}/20 on maturity (< 15) — a spine must be mature`);

  // Mode-critical HUMAN-gate hint — sovereign: air-gap < 10; subscription: multi-tenancy < 9. Mirrors the old
  // air-gap<10 flag; the actual FORK gate lives at the verdict layer (decideSourcing). Sovereign string is verbatim.
  if (mode === 'sovereign') {
    const airGap = subScores.find((s) => s.dimension === 'air-gap')!;
    if (airGap.score < 10) flags.push(`air-gap ${airGap.score}/20 (< 10) — human approval required (sovereign requirement)`);
  } else {
    const tenancy = subScores.find((s) => s.dimension === 'multi-tenancy')!;
    if (tenancy.score < 9) flags.push(`multi-tenancy ${tenancy.score}/15 (< 9) — human approval required (subscription requirement)`);
  }

  // §3.9 — a 70+ candidate steered to BUILD is flagged, BUT ONLY when the normalized score is backed by real
  // confidence: ≥3 measured dimensions (the promotion floor). §3.9 protects REUSE (FORK *or* EXTEND); an EXTEND
  // does not require air-gap, so the reuse floor here is measuredCount ≥ 3 (not air-gap-specific). A high
  // normalized score drawn from too few dimensions (e.g. license + maturity only) cannot substantiate the
  // "reuse beats rebuild" objection to a BUILD.
  const confidentForReuse = measuredCount >= 3;
  if (!rejected && total >= 70 && confidentForReuse && c.proposedVerdict === 'BUILD') {
    flags.push(`§3.9: candidate scores ${total}/100 (70+, ${measuredCount}/${subScores.length} dims measured) yet verdict is BUILD — requires a proven blocking issue + human review (reuse beats rebuild)`);
  }

  const band = bandFor(total, rejected);

  return { subScores, total, rejected, band, flags, measuredCount, measuredWeightFraction };
}

/**
 * Fold a HUMAN-MEASURED air-gap rating into an EXISTING score WITHOUT re-grading any other dimension. Returns a
 * NEW ScoreResult (mutates nothing): the air-gap sub-score is replaced with the measured one (via the engine's
 * own `airGapSubScore` scale), EVERY OTHER sub-score is carried BYTE-FOR-BYTE, and total/band/measuredCount/
 * coverage are recomputed over the now-larger measured set with the SAME `normalizeMeasured`. The air-gap<10
 * sovereign flag is recomputed from the measured value; all other flags are preserved. This is the seam's
 * honest mechanism for the one dimension the machine never measures: a bad air-gap (e.g. 'no' ⇒ 4/20) can drag
 * the normalized score below the FORK floor, which is exactly what must happen. `value` excludes 'unknown' — a
 * *measurement* is always yes/partial/no; recording "unknown" is not a measurement.
 */
export function foldAirGapMeasurement(score: ScoreResult, value: Exclude<AirGapSuitability, 'unknown'>): ScoreResult {
  const measuredAirGap = airGapSubScore(value);
  const subScores = score.subScores.map((s) => (s.dimension === 'air-gap' ? { ...measuredAirGap } : { ...s }));
  const { total, measuredCount, measuredWeightFraction } = normalizeMeasured(subScores);
  const band = bandFor(total, score.rejected);
  const flags = score.flags.filter((f) => !f.startsWith('air-gap ')); // drop the stale unmeasured air-gap flag
  if (measuredAirGap.score < 10) flags.push(`air-gap ${measuredAirGap.score}/20 (< 10) — human approval required (sovereign requirement)`);
  return { subScores, total, rejected: score.rejected, band, flags, measuredCount, measuredWeightFraction };
}

/**
 * SUBSCRIPTION analog of `foldAirGapMeasurement`. Fold a HUMAN-MEASURED multi-tenancy rating into an existing
 * SUBSCRIPTION score WITHOUT re-grading any other dimension — the one subscription dimension the scout leaves
 * deny-by-default (`not-mechanizable`). Only the `multi-tenancy` sub-score is replaced; the multi-tenancy<9 flag
 * is recomputed; everything else is byte-for-byte. `value` excludes 'unknown' (a measurement is full/partial/none).
 */
export function foldMultiTenancyMeasurement(score: ScoreResult, value: Exclude<MultiTenancy, 'unknown'>): ScoreResult {
  const measured = multiTenancySubScore(value);
  const subScores = score.subScores.map((s) => (s.dimension === 'multi-tenancy' ? { ...measured } : { ...s }));
  const { total, measuredCount, measuredWeightFraction } = normalizeMeasured(subScores);
  const band = bandFor(total, score.rejected);
  const flags = score.flags.filter((f) => !f.startsWith('multi-tenancy '));
  if (measured.score < 9) flags.push(`multi-tenancy ${measured.score}/15 (< 9) — human approval required (subscription requirement)`);
  return { subScores, total, rejected: score.rejected, band, flags, measuredCount, measuredWeightFraction };
}
