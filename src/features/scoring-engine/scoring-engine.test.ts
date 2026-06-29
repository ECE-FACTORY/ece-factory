import { describe, it, expect } from 'vitest';
import { scoreCandidate, type ScoringCandidate, type SubScore } from './scoring-engine.js';

// Repository Scoring Engine (Module 11). Pure-logic: scoring is a pure function of the candidate.

function clean(): ScoringCandidate {
  return {
    license: { decision: 'ACCEPT', detected: 'Apache-2.0' },
    maturity: { activelyMaintained: true, stars: 3735 },
    airGap: 'yes',
    whiteLabel: 'easy',
    archFit: { rating: 'strong', note: 'clean fit' },
    maintainability: { rating: 'clean' },
  };
}
const sub = (r: { subScores: SubScore[] }, dim: string): SubScore => r.subScores.find((s) => s.dimension === dim)!;

describe('Scoring Engine — clean candidate', () => {
  it('a clean, mature, permissively-licensed repo scores high, with evidence on every sub-score', () => {
    const r = scoreCandidate(clean());
    expect(r.total).toBe(98);
    expect(r.band).toBe('strong');
    expect(r.rejected).toBe(false);
    expect(r.subScores).toHaveLength(6);
    for (const s of r.subScores) expect(s.evidence.trim().length).toBeGreaterThan(0); // §3.8
  });
});

describe('Scoring Engine — hard gates', () => {
  it('a BSL/rejected-license repo ⇒ License 0 ⇒ auto-reject regardless of other scores', () => {
    const r = scoreCandidate({ ...clean(), license: { decision: 'REJECT', detected: 'BSL' } });
    expect(sub(r, 'license').score).toBe(0);
    expect(r.rejected).toBe(true);
    expect(r.band).toBe('reject'); // other high scores cannot outweigh it
  });

  it('a spine candidate below 15 maturity ⇒ flagged', () => {
    const r = scoreCandidate({ ...clean(), maturity: { activelyMaintained: false }, isSpine: true });
    expect(sub(r, 'maturity').score).toBeLessThan(15);
    expect(r.flags.join('\n')).toMatch(/spine.*maturity/i);
  });

  it('air-gap below 10 ⇒ human-approval flag', () => {
    const r = scoreCandidate({ ...clean(), airGap: 'no' });
    expect(sub(r, 'air-gap').score).toBeLessThan(10);
    expect(r.flags.join('\n')).toMatch(/air-gap.*human approval/i);
  });
});

describe('Scoring Engine — §3.9 70+ override', () => {
  it('a 70+ candidate steered to BUILD-from-scratch ⇒ flagged, not silently rejected', () => {
    const r = scoreCandidate({ ...clean(), proposedVerdict: 'BUILD' }); // scores 98
    expect(r.total).toBeGreaterThanOrEqual(70);
    expect(r.rejected).toBe(false);
    expect(r.flags.join('\n')).toMatch(/§3\.9/);
  });
  it('a 70+ candidate with a FORK verdict is NOT §3.9-flagged', () => {
    const r = scoreCandidate({ ...clean(), proposedVerdict: 'FORK' });
    expect(r.flags.join('\n')).not.toMatch(/§3\.9/);
  });
});

describe('Scoring Engine — deny-by-default (pessimistic on missing evidence)', () => {
  it('a sub-score with NO evidence scores low and is flagged, never optimistic', () => {
    const noMaint = { ...clean() };
    delete noMaint.maintainability;
    const r = scoreCandidate(noMaint);
    expect(sub(r, 'maintainability').score).toBe(0); // not given the benefit of the doubt
    expect(sub(r, 'maintainability').flagged).toBe(true);
  });
  it('unknown air-gap / white-label ⇒ 0 + flagged (not "probably fine")', () => {
    const r = scoreCandidate({ ...clean(), airGap: 'unknown', whiteLabel: 'unknown' });
    expect(sub(r, 'air-gap').score).toBe(0);
    expect(sub(r, 'air-gap').flagged).toBe(true);
    expect(sub(r, 'white-label').score).toBe(0);
    expect(sub(r, 'white-label').flagged).toBe(true);
  });
  it('unconfirmed maintenance is capped + flagged, not treated as maintained', () => {
    const r = scoreCandidate({ ...clean(), maturity: { stars: 5000 } }); // stars high but activelyMaintained unknown
    expect(sub(r, 'maturity').score).toBeLessThanOrEqual(8);
    expect(sub(r, 'maturity').flagged).toBe(true);
  });
  it('missing maturity entirely ⇒ 0 + flagged', () => {
    const noMat = { ...clean() };
    delete noMat.maturity;
    const r = scoreCandidate(noMat);
    expect(sub(r, 'maturity').score).toBe(0);
    expect(sub(r, 'maturity').flagged).toBe(true);
  });
});
