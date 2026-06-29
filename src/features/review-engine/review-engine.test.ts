import { describe, it, expect } from 'vitest';
import { DualClaudeReviewEngine, type ReviewRequest, type ReviewDecisionType } from './review-engine.js';
import { validateEvidencePack, type EvidencePack } from '../evidence-pack/evidence-pack.js';

// Dual-Claude Review Engine (Module 15). Pure-logic: the decision is a pure function of (evidence
// pack validity, re-derivation declaration, proposed decision, required fields), no DB.
// The REAL Evidence Pack Engine validator is injected through the EvidenceValidator port.

const engine = new DualClaudeReviewEngine({ validate: validateEvidencePack });

function validPack(): EvidencePack {
  return {
    stepIdentity: { workflow: 'ECE Factory build', step: 'Phase X', mode: 'manual review', environment: 'local' },
    repositoryEvidence: { commits: ['abc123'], sync: 'clean' },
    commands: [{ id: 'test', command: 'npx vitest run', output: 'Test Files 1 passed\nTests 5 passed', exitCode: 0 }],
    loadBearingClaims: [{ type: 'test', statement: 'tests passed', evidenceCommandId: 'test' }],
    policyGates: { mcp: false, ui: false },
    failuresRisksOpenItems: [],
    proposedNextStep: { recommendation: 'proceed' },
  };
}

function req(over: Partial<ReviewRequest>): ReviewRequest {
  return {
    proposed: 'PASS',
    reason: 'meets the bar',
    evidencePack: validPack(),
    reDerivation: { loadBearingClaimsReverified: true, stopConditionsChecked: true },
    nextPrompt: 'ECE FACTORY — PHASE 5.1 ...',
    ...over,
  };
}

describe('Dual-Claude Review Engine — PASS requires machine-true evidence', () => {
  it('an unproven load-bearing claim makes PASS IMPOSSIBLE (engine returns FAIL)', () => {
    const pack = validPack();
    pack.commands.find((c) => c.id === 'test')!.output = ''; // "tests passed" with nothing behind it
    const d = engine.review(req({ proposed: 'PASS', evidencePack: pack }));
    expect(d.decision).toBe('FAIL');
    expect(d.evidenceValid).toBe(false);
    expect(d.enforcementNotes.join('\n')).toMatch(/PASS impossible/i);
  });

  it('a valid, fully-evidenced pack with re-derivation declared ⇒ PASS', () => {
    const d = engine.review(req({}));
    expect(d.decision).toBe('PASS');
    expect(d.wellFormed).toBe(true);
    expect(d.evidenceValid).toBe(true);
    expect(d.reDerivationComplete).toBe(true);
    expect(d.nextPrompt).toBeTruthy();
  });

  it('a pack missing the re-derivation declaration ⇒ cannot PASS (REVISE)', () => {
    const d = engine.review(req({ reDerivation: { loadBearingClaimsReverified: false, stopConditionsChecked: true } }));
    expect(d.decision).toBe('REVISE');
    expect(d.enforcementNotes.join('\n')).toMatch(/re-derivation/i);
  });

  it('a PASS without a next prompt ⇒ REVISE (deny-by-default; L0 §18)', () => {
    const d = engine.review(req({ nextPrompt: '' }));
    expect(d.decision).toBe('REVISE');
  });
});

describe('Dual-Claude Review Engine — FAIL / REVISE / STOP', () => {
  it('FAIL carries a reason and the evidence it relied on', () => {
    const d = engine.review(req({ proposed: 'FAIL', reason: 'tests broke' }));
    expect(d.decision).toBe('FAIL');
    expect(d.wellFormed).toBe(true);
    expect(d.reason).toBe('tests broke');
    expect(typeof d.evidenceValid).toBe('boolean');
  });
  it('REVISE requires a next prompt', () => {
    expect(engine.review(req({ proposed: 'REVISE', nextPrompt: 'do X' })).wellFormed).toBe(true);
    expect(engine.review(req({ proposed: 'REVISE', nextPrompt: '' })).wellFormed).toBe(false);
  });
  it('STOP carries a reason (the approval item)', () => {
    const d = engine.review(req({ proposed: 'STOP', reason: 'human approval required: production write' }));
    expect(d.decision).toBe('STOP');
    expect(d.wellFormed).toBe(true);
  });
});

describe('Dual-Claude Review Engine — deny-by-default', () => {
  it('an unrecognized proposed decision ⇒ REVISE, never PASS', () => {
    const d = engine.review(req({ proposed: 'MAYBE' as ReviewDecisionType }));
    expect(d.decision).toBe('REVISE');
    expect(d.decision).not.toBe('PASS');
  });
  it('an incomplete review never defaults to PASS', () => {
    // valid evidence + re-derivation, but no reason → not PASS
    const d = engine.review(req({ reason: '' }));
    expect(d.decision).not.toBe('PASS');
  });
});
