// Dual-Claude Review Engine (Module 15) — formalizes the PASS / FAIL / REVISE / STOP decision
// this loop has produced by hand on every phase, and makes machine-true evidence STRUCTURALLY
// enforceable: a review CANNOT return PASS if the submitted evidence pack is invalid, or if the
// independent re-derivation (§22) was not declared. The reviewer literally cannot approve unproven work.
//
// Deny-by-default: anything not positively meeting all PASS criteria is NOT PASS (downgraded to
// FAIL or REVISE). STANDALONE-PACKAGEABLE: the Evidence Pack Engine is consumed through an injected
// interface; the only cross-engine references are `import type` (zero runtime coupling).

import type { EvidencePack, ValidationResult } from '../evidence-pack/evidence-pack.js';

export type ReviewDecisionType = 'PASS' | 'FAIL' | 'REVISE' | 'STOP';

/** §22 — which load-bearing facts the reviewer INDEPENDENTLY re-derived (not trusted from the builder). */
export interface ReDerivationChecklist {
  loadBearingClaimsReverified: boolean; // re-ran/re-derived the test/lint/typecheck/build/license facts
  stopConditionsChecked: boolean; // §6 STOP conditions checked against the diff, not the builder's checkboxes
  notes?: string;
}

/** Port for the Evidence Pack Engine (Module 16). Injected — no concrete import of that engine. */
export interface EvidenceValidator {
  validate(pack: EvidencePack): ValidationResult;
}

export interface ReviewRequest {
  proposed: ReviewDecisionType;
  reason: string;
  evidencePack: EvidencePack;
  reDerivation?: ReDerivationChecklist;
  /** Required for PASS (the next prompt, L0 §18) and for REVISE. */
  nextPrompt?: string;
}

export interface ReviewDecision {
  decision: ReviewDecisionType;
  reason: string;
  evidenceValid: boolean;
  evidenceErrors: string[];
  reDerivation: ReDerivationChecklist | null;
  reDerivationComplete: boolean;
  nextPrompt?: string;
  enforcementNotes: string[];
  wellFormed: boolean;
}

export class DualClaudeReviewEngine {
  constructor(private readonly evidence: EvidenceValidator) {}

  review(req: ReviewRequest): ReviewDecision {
    const v = this.evidence.validate(req.evidencePack);
    const rd = req.reDerivation ?? null;
    const reDerivationComplete = !!rd?.loadBearingClaimsReverified && !!rd?.stopConditionsChecked;
    const notes: string[] = [];

    const result = (decision: ReviewDecisionType, wellFormed: boolean): ReviewDecision => ({
      decision,
      reason: req.reason ?? '',
      evidenceValid: v.valid,
      evidenceErrors: v.errors,
      reDerivation: rd,
      reDerivationComplete,
      nextPrompt: req.nextPrompt,
      enforcementNotes: notes,
      wellFormed,
    });

    const proposed = req.proposed;

    // Deny-by-default: an unrecognized proposal can never be PASS.
    if (proposed !== 'PASS' && proposed !== 'FAIL' && proposed !== 'REVISE' && proposed !== 'STOP') {
      notes.push('unrecognized proposed decision — deny-by-default to REVISE (never PASS)');
      return result('REVISE', false);
    }

    if (proposed === 'PASS') {
      // Gate 1 — machine-true evidence: PASS is IMPOSSIBLE on an invalid evidence pack.
      if (!v.valid) {
        notes.push('PASS impossible: evidence pack is INVALID (machine-true-evidence not satisfied) — downgraded to FAIL');
        for (const e of v.errors) notes.push(`  · ${e}`);
        return result('FAIL', true);
      }
      // Gate 2 — §22 independent re-derivation must be declared, or the PASS is malformed.
      if (!reDerivationComplete) {
        notes.push('PASS malformed: independent re-derivation (§22) not declared (loadBearingClaimsReverified + stopConditionsChecked) — downgraded to REVISE');
        return result('REVISE', false);
      }
      // Gate 3 — a PASS must carry a next prompt (L0 §18) and a reason.
      if (!req.nextPrompt?.trim()) {
        notes.push('PASS invalid without a next prompt (Layer 0 §18) — downgraded to REVISE');
        return result('REVISE', false);
      }
      if (!req.reason?.trim()) {
        notes.push('PASS requires a reason — downgraded to REVISE');
        return result('REVISE', false);
      }
      return result('PASS', true);
    }

    // FAIL / REVISE / STOP are not approvals; enforce their required fields but keep the decision.
    let wellFormed = true;
    if (!req.reason?.trim()) {
      notes.push(`${proposed} requires a reason`);
      wellFormed = false;
    }
    if (proposed === 'REVISE' && !req.nextPrompt?.trim()) {
      notes.push('REVISE requires a next prompt/step');
      wellFormed = false;
    }
    return result(proposed, wellFormed);
  }
}
