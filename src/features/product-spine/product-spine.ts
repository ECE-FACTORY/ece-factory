// Product Spine Engine (Module 14) — determines a product's spine from scored candidates +
// compatibility signals, enforcing the §4 spine doctrine and §5 Anti-Frankenstein rule.
//
// §4: a stack without a clear, strong foundation is REJECTED — a product is built on a spine, not
//     assembled from equal fragments. The spine must be the strongest, ≥15 maturity (the Scoring gate).
// §5 ANTI-FRANKENSTEIN: if integration glue dominates, or a composition needs > 3 repos, the verdict
//     is DOWNGRADED with "find a stronger spine". Composition is only justified when the pieces are
//     tightly compatible.
// DENY-BY-DEFAULT: no clear spine, or unknown/loose compatibility, is treated as NOT workable —
//     unknown compatibility is incompatible until proven, never "probably fine".
//
// STANDALONE-PACKAGEABLE: the only cross-engine reference is `import type` (the Scoring result).

import type { ScoreResult } from '../scoring-engine/scoring-engine.js';

/** Margin (points) by which the strongest candidate must lead to count as a CLEAR spine. */
export const CLEAR_SPINE_MARGIN = 10;

export interface SpineCandidate {
  id: string;
  score: ScoreResult;
}

export interface CompositionProposal {
  repoIds: string[];
  compatibility: 'tight' | 'loose' | 'unknown';
  integrationEffort: 'low' | 'moderate' | 'high' | 'dominates';
}

export interface SpineAssessmentInput {
  candidates: SpineCandidate[];
  composition?: CompositionProposal;
  buildJustification?: string;
}

export type SpineType = 'single-spine' | 'composed-spine' | 'justified-BUILD-spine';
export type SpineVerdict = 'accepted' | 'downgraded' | 'rejected';

export interface SpofAnalysis {
  repoId: string | null;
  collapsesProduct: boolean; // true ⇒ no alternative; the product is fatally dependent
  contingency: string;
}

export interface SpineResult {
  verdict: SpineVerdict;
  spineType: SpineType | null;
  spineRepoIds: string[];
  reasons: string[];
  recommendation?: string;
  spof: SpofAnalysis;
}

function maturityOf(c: SpineCandidate): number {
  return c.score.subScores.find((s) => s.dimension === 'maturity')?.score ?? 0;
}
function isEligible(c: SpineCandidate): boolean {
  return !c.score.rejected && maturityOf(c) >= 15; // §4: license-clean + mature enough to build on
}

function analyseSpof(spine: SpineCandidate, sorted: SpineCandidate[]): SpofAnalysis {
  const alt = sorted.find((c) => c.id !== spine.id);
  return {
    repoId: spine.id,
    collapsesProduct: !alt,
    contingency: alt ? `an alternative spine-eligible candidate exists: ${alt.id}` : `no alternative — the product is fatally dependent on a single upstream (${spine.id})`,
  };
}

const NO_SPOF: SpofAnalysis = { repoId: null, collapsesProduct: false, contingency: 'no sourced spine' };

export function assessProductSpine(input: SpineAssessmentInput): SpineResult {
  const candidates = input.candidates ?? [];
  const eligibles = candidates.filter(isEligible);
  const sorted = [...eligibles].sort((a, b) => b.score.total - a.score.total);
  const strongest = sorted[0];
  const second = sorted[1];
  const clearMargin = !second || (strongest!.score.total - second.score.total) >= CLEAR_SPINE_MARGIN;

  // §4 — no foundation at all.
  if (!strongest) {
    if (input.buildJustification?.trim()) {
      return { verdict: 'accepted', spineType: 'justified-BUILD-spine', spineRepoIds: [], reasons: ['no acceptable sourced spine exists; BUILD justified', input.buildJustification], spof: { repoId: null, collapsesProduct: false, contingency: 'BUILD spine — ECE owns it; no upstream dependency' } };
    }
    return { verdict: 'rejected', spineType: null, spineRepoIds: [], reasons: ['§4: no candidate is spine-eligible (license-clean + ≥15 maturity) — a product needs a strong foundation, not equal fragments'], recommendation: 'find a stronger spine, or justify a BUILD', spof: NO_SPOF };
  }

  // A composition is proposed → evaluate it under §5.
  if (input.composition) {
    const c = input.composition;
    const n = c.repoIds.length;
    const reasons: string[] = [];

    if (c.compatibility !== 'tight') {
      reasons.push(`§5: composition compatibility is "${c.compatibility}" — unknown/loose compatibility is treated as INCOMPATIBLE until proven (deny-by-default)`);
    } else if (n > 3) {
      reasons.push(`§5 Anti-Frankenstein: composition uses ${n} repos (> 3) — too many parts held together by glue; find a stronger spine`);
    } else if (c.integrationEffort === 'dominates' || c.integrationEffort === 'high') {
      reasons.push(`§5 Anti-Frankenstein: integration glue ${c.integrationEffort === 'dominates' ? 'dominates the product' : 'is high'} — gluing costs exceed the value delivered; find a stronger spine`);
    } else {
      // Valid composed spine: 2–3 tightly-compatible repos, integration low/moderate.
      const compSpine = sorted.find((x) => c.repoIds.includes(x.id)) ?? strongest;
      return { verdict: 'accepted', spineType: 'composed-spine', spineRepoIds: c.repoIds, reasons: [`§5: ${n} tightly-compatible repos, integration ${c.integrationEffort} — composition justified`], spof: analyseSpof(compSpine, sorted) };
    }

    // Composition downgraded → fall back to a CLEAR single spine if one exists, else reject.
    const recommendation = 'find a stronger spine (avoid a Frankenstein composition)';
    if (clearMargin) {
      return { verdict: 'downgraded', spineType: 'single-spine', spineRepoIds: [strongest.id], reasons, recommendation, spof: analyseSpof(strongest, sorted) };
    }
    return { verdict: 'rejected', spineType: null, spineRepoIds: [], reasons: [...reasons, '§4: and no clear single fallback spine'], recommendation, spof: NO_SPOF };
  }

  // No composition → single-spine path. §4 requires a CLEAR strongest, not equal fragments.
  if (!clearMargin) {
    return { verdict: 'rejected', spineType: null, spineRepoIds: [], reasons: [`§4: no clear strongest candidate (top two within ${CLEAR_SPINE_MARGIN} pts) — equal fragments, no spine`], recommendation: 'find a stronger spine, compose a tight 2–3 set, or justify a BUILD', spof: NO_SPOF };
  }
  return { verdict: 'accepted', spineType: 'single-spine', spineRepoIds: [strongest.id], reasons: [`single strong spine: ${strongest.id} (score ${strongest.score.total}/100, maturity ${maturityOf(strongest)}/20)`], spof: analyseSpof(strongest, sorted) };
}
