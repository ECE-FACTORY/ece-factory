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

import type { LicenseDecision, MaturitySignals, AirGapSuitability, WhiteLabelFit, ScoringInputs } from '../repo-intelligence/repo-intelligence.js';

export type ArchFitRating = 'strong' | 'good' | 'possible' | 'poor';
export type MaintainabilityRating = 'clean' | 'maintainable' | 'hard' | 'unsafe';
export type Verdict = 'FORK' | 'EXTEND' | 'BUILD';

export interface ScoringCandidate {
  license: { decision: LicenseDecision; detected: string };
  maturity?: MaturitySignals;
  airGap?: AirGapSuitability;
  whiteLabel?: WhiteLabelFit;
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
}

export type ScoreBand = 'strong' | 'acceptable' | 'risky' | 'reject';

export interface ScoreResult {
  subScores: SubScore[];
  total: number;
  rejected: boolean; // hard reject (license 0)
  band: ScoreBand;
  flags: string[];
}

/** Adapt a Repo Intelligence record's scoringInputs (+ supplied ratings) into a ScoringCandidate. */
export function candidateFromScoringInputs(
  s: ScoringInputs,
  extra: { archFit?: { rating: ArchFitRating; note?: string }; maintainability?: { rating: MaintainabilityRating; note?: string }; isSpine?: boolean; proposedVerdict?: Verdict } = {},
): ScoringCandidate {
  return {
    license: { decision: s.licenseDecision, detected: s.licenseDetected },
    maturity: s.maturity ?? undefined,
    airGap: s.airGapSuitability,
    whiteLabel: s.whiteLabelFit,
    // arch-fit rating must be supplied (a freeform note alone is not a score); merge the record's note if absent.
    archFit: extra.archFit ? { rating: extra.archFit.rating, note: extra.archFit.note ?? s.architectureFitNotes ?? undefined } : undefined,
    maintainability: extra.maintainability,
    isSpine: extra.isSpine,
    proposedVerdict: extra.proposedVerdict,
  };
}

function scoreLicense(c: ScoringCandidate): SubScore {
  const d = c.license?.decision;
  if (d === 'REJECT') return { dimension: 'license', score: 0, max: 20, evidence: `license REJECT (${c.license.detected}) — automatic rejection`, flagged: true };
  if (d === 'ACCEPT') return { dimension: 'license', score: 20, max: 20, evidence: `license ACCEPT (${c.license.detected})`, flagged: false };
  if (d === 'NEEDS_REVIEW') return { dimension: 'license', score: 10, max: 20, evidence: `license NEEDS_REVIEW (${c.license.detected}) — unresolved ambiguity`, flagged: true };
  return { dimension: 'license', score: 0, max: 20, evidence: 'license evidence missing', flagged: true };
}

function scoreMaturity(c: ScoringCandidate): SubScore {
  const m = c.maturity;
  if (!m) return { dimension: 'maturity', score: 0, max: 20, evidence: 'no maturity evidence (deny-by-default)', flagged: true };
  if (m.archived === true) return { dimension: 'maturity', score: 0, max: 20, evidence: 'archived', flagged: true };
  if (m.activelyMaintained !== true) {
    const score = m.activelyMaintained === false ? 5 : 8;
    return { dimension: 'maturity', score, max: 20, evidence: m.activelyMaintained === false ? 'not actively maintained' : 'active maintenance not positively confirmed (deny-by-default)', flagged: true };
  }
  // actively maintained
  if (m.stars === undefined) return { dimension: 'maturity', score: 12, max: 20, evidence: 'actively maintained; deployment/star scale unverified', flagged: true };
  if (m.stars >= 1000) return { dimension: 'maturity', score: 18, max: 20, evidence: `actively maintained; ${m.stars}★`, flagged: false };
  if (m.stars >= 100) return { dimension: 'maturity', score: 16, max: 20, evidence: `actively maintained; ${m.stars}★`, flagged: false };
  return { dimension: 'maturity', score: 13, max: 20, evidence: `actively maintained; only ${m.stars}★`, flagged: false };
}

function scoreAirGap(c: ScoringCandidate): SubScore {
  switch (c.airGap) {
    case 'yes': return { dimension: 'air-gap', score: 20, max: 20, evidence: 'fully offline / air-gap deployable', flagged: false };
    case 'partial': return { dimension: 'air-gap', score: 12, max: 20, evidence: 'partial air-gap (some removable deps)', flagged: false };
    case 'no': return { dimension: 'air-gap', score: 4, max: 20, evidence: 'not air-gap deployable', flagged: true };
    default: return { dimension: 'air-gap', score: 0, max: 20, evidence: 'air-gap suitability unknown (deny-by-default)', flagged: true };
  }
}

function scoreWhiteLabel(c: ScoringCandidate): SubScore {
  switch (c.whiteLabel) {
    case 'easy': return { dimension: 'white-label', score: 15, max: 15, evidence: 'easy rebrand, no hardcoded vendor identity', flagged: false };
    case 'moderate': return { dimension: 'white-label', score: 10, max: 15, evidence: 'moderate branding/telemetry cleanup', flagged: false };
    case 'hard': return { dimension: 'white-label', score: 5, max: 15, evidence: 'significant white-label friction', flagged: true };
    default: return { dimension: 'white-label', score: 0, max: 15, evidence: 'white-label fit unknown (deny-by-default)', flagged: true };
  }
}

function scoreArchFit(c: ScoringCandidate): SubScore {
  if (!c.archFit) return { dimension: 'arch-fit', score: 0, max: 15, evidence: 'no architecture-fit evidence (deny-by-default)', flagged: true };
  const note = c.archFit.note ? ` — ${c.archFit.note}` : '';
  switch (c.archFit.rating) {
    case 'strong': return { dimension: 'arch-fit', score: 15, max: 15, evidence: `strong fit${note}`, flagged: false };
    case 'good': return { dimension: 'arch-fit', score: 11, max: 15, evidence: `good fit, integration work${note}`, flagged: false };
    case 'possible': return { dimension: 'arch-fit', score: 6, max: 15, evidence: `possible but complex${note}`, flagged: true };
    case 'poor': return { dimension: 'arch-fit', score: 0, max: 15, evidence: `poor/incompatible${note}`, flagged: true };
  }
}

function scoreMaintainability(c: ScoringCandidate): SubScore {
  if (!c.maintainability) return { dimension: 'maintainability', score: 0, max: 10, evidence: 'no maintainability evidence (deny-by-default)', flagged: true };
  const note = c.maintainability.note ? ` — ${c.maintainability.note}` : '';
  switch (c.maintainability.rating) {
    case 'clean': return { dimension: 'maintainability', score: 10, max: 10, evidence: `clean, understandable, active${note}`, flagged: false };
    case 'maintainable': return { dimension: 'maintainability', score: 7, max: 10, evidence: `maintainable with cleanup${note}`, flagged: false };
    case 'hard': return { dimension: 'maintainability', score: 4, max: 10, evidence: `hard but usable${note}`, flagged: true };
    case 'unsafe': return { dimension: 'maintainability', score: 0, max: 10, evidence: `unsafe maintenance burden${note}`, flagged: true };
  }
}

export function scoreCandidate(c: ScoringCandidate): ScoreResult {
  const subScores = [scoreLicense(c), scoreMaturity(c), scoreAirGap(c), scoreWhiteLabel(c), scoreArchFit(c), scoreMaintainability(c)];
  const total = subScores.reduce((s, x) => s + x.score, 0);
  const license = subScores[0]!;
  const maturity = subScores[1]!;
  const airGap = subScores[2]!;
  const flags: string[] = [];

  // Hard gate — License 0 ⇒ automatic rejection (cannot be outweighed).
  const rejected = license.score === 0 && c.license?.decision === 'REJECT';

  // Hard gate — spine must score ≥15 maturity.
  if (c.isSpine && maturity.score < 15) flags.push(`spine candidate scores ${maturity.score}/20 on maturity (< 15) — a spine must be mature`);

  // Hard gate — air-gap below 10 ⇒ human-approval flag (sovereign requirement).
  if (airGap.score < 10) flags.push(`air-gap ${airGap.score}/20 (< 10) — human approval required (sovereign requirement)`);

  // §3.9 — a 70+ candidate steered to BUILD is flagged (don't rationalize unnecessary BUILD).
  if (!rejected && total >= 70 && c.proposedVerdict === 'BUILD') {
    flags.push(`§3.9: candidate scores ${total}/100 (70+) yet verdict is BUILD — requires a proven blocking issue + human review (reuse beats rebuild)`);
  }

  let band: ScoreBand;
  if (rejected) band = 'reject';
  else if (total >= 85) band = 'strong';
  else if (total >= 70) band = 'acceptable';
  else if (total >= 55) band = 'risky';
  else band = 'reject';

  return { subScores, total, rejected, band, flags };
}
