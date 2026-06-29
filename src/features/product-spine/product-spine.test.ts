import { describe, it, expect } from 'vitest';
import { assessProductSpine, type SpineCandidate } from './product-spine.js';
import type { ScoreResult } from '../scoring-engine/scoring-engine.js';

// Product Spine Engine (Module 14). Pure-logic: the verdict is a pure function of scored candidates + composition.

function score(total: number, maturity: number, rejected = false): ScoreResult {
  return {
    subScores: [{ dimension: 'maturity', score: maturity, max: 20, evidence: 'm', flagged: false }],
    total,
    rejected,
    band: rejected ? 'reject' : total >= 85 ? 'strong' : total >= 70 ? 'acceptable' : total >= 55 ? 'risky' : 'reject',
    flags: [],
  };
}
const cand = (id: string, total: number, maturity: number, rejected = false): SpineCandidate => ({ id, score: score(total, maturity, rejected) });

describe('Product Spine — single & composed', () => {
  it('a strong, mature single candidate ⇒ single-spine accepted', () => {
    const r = assessProductSpine({ candidates: [cand('trillian', 92, 18), cand('other', 58, 16)] });
    expect(r.verdict).toBe('accepted');
    expect(r.spineType).toBe('single-spine');
    expect(r.spineRepoIds).toEqual(['trillian']);
  });

  it('a tightly-compatible 2–3 repo set ⇒ composed-spine accepted', () => {
    const r = assessProductSpine({
      candidates: [cand('a', 80, 17), cand('b', 75, 16)],
      composition: { repoIds: ['a', 'b'], compatibility: 'tight', integrationEffort: 'low' },
    });
    expect(r.verdict).toBe('accepted');
    expect(r.spineType).toBe('composed-spine');
    expect(r.spineRepoIds).toEqual(['a', 'b']);
  });
});

describe('Product Spine — §4 no clear spine ⇒ Rejected', () => {
  it('several equal-but-mediocre candidates ⇒ Rejected', () => {
    const r = assessProductSpine({ candidates: [cand('a', 55, 15), cand('b', 54, 15), cand('c', 53, 15)] });
    expect(r.verdict).toBe('rejected');
    expect(r.spineType).toBeNull();
    expect(r.reasons.join('\n')).toMatch(/no clear strongest/i);
  });
  it('no spine-eligible candidate (all immature) ⇒ Rejected', () => {
    const r = assessProductSpine({ candidates: [cand('a', 60, 8), cand('b', 58, 5)] });
    expect(r.verdict).toBe('rejected');
  });
  it('no sourced spine but a justified BUILD ⇒ justified-BUILD-spine accepted', () => {
    const r = assessProductSpine({ candidates: [cand('a', 60, 8)], buildJustification: 'no permissive mature repo for this capability' });
    expect(r.verdict).toBe('accepted');
    expect(r.spineType).toBe('justified-BUILD-spine');
  });
});

describe('Product Spine — §5 Anti-Frankenstein', () => {
  const base = [cand('a', 90, 18), cand('b', 60, 16), cand('c', 58, 15), cand('d', 55, 15)];

  it('a composition of > 3 repos ⇒ downgrade with "find a stronger spine"', () => {
    const r = assessProductSpine({ candidates: base, composition: { repoIds: ['a', 'b', 'c', 'd'], compatibility: 'tight', integrationEffort: 'low' } });
    expect(r.verdict).toBe('downgraded');
    expect(r.recommendation).toMatch(/stronger spine/i);
    expect(r.reasons.join('\n')).toMatch(/Anti-Frankenstein/i);
  });

  it('integration glue that dominates ⇒ downgrade', () => {
    const r = assessProductSpine({ candidates: base, composition: { repoIds: ['a', 'b'], compatibility: 'tight', integrationEffort: 'dominates' } });
    expect(r.verdict).toBe('downgraded');
    expect(r.reasons.join('\n')).toMatch(/glue dominates/i);
  });
});

describe('Product Spine — deny-by-default on compatibility', () => {
  it('unknown compatibility ⇒ NOT silently accepted (treated as incompatible until proven)', () => {
    const r = assessProductSpine({ candidates: [cand('a', 90, 18), cand('b', 60, 16)], composition: { repoIds: ['a', 'b'], compatibility: 'unknown', integrationEffort: 'low' } });
    expect(r.verdict).not.toBe('accepted');
    expect(r.reasons.join('\n')).toMatch(/INCOMPATIBLE until proven/i);
  });
});

describe('Product Spine — single-point-of-failure', () => {
  it('a lone spine candidate ⇒ SPOF identified as fatally dependent (no alternative)', () => {
    const r = assessProductSpine({ candidates: [cand('only-one', 90, 18)] });
    expect(r.spof.repoId).toBe('only-one');
    expect(r.spof.collapsesProduct).toBe(true);
    expect(r.spof.contingency).toMatch(/fatally dependent/i);
  });
  it('a spine with an alternative ⇒ SPOF named but not fatal', () => {
    const r = assessProductSpine({ candidates: [cand('primary', 92, 18), cand('backup', 80, 16)] });
    expect(r.spof.repoId).toBe('primary');
    expect(r.spof.collapsesProduct).toBe(false);
    expect(r.spof.contingency).toMatch(/alternative.*backup/i);
  });
});
