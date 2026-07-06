import { describe, it, expect } from 'vitest';
import { assessDocCompliance, REQUIRED_DOCS, type DocComplianceInput, type DocState, type RequiredDoc } from './doc-engine.js';

// Source-of-Truth Doc Engine (Module 27). Pure-logic: the verdict is a pure function of the descriptor.

function complete(): DocComplianceInput {
  const docs: Partial<Record<RequiredDoc, DocState>> = {};
  for (const d of REQUIRED_DOCS) docs[d] = 'present';
  return {
    docs,
    features: [
      { name: 'audit-engine', hasCode: true, hasFeatureFile: true, featureFileStatus: 'complete' },
      { name: 'future-thing', hasCode: false, hasFeatureFile: true, featureFileStatus: 'planned' }, // planned, no code — fine
    ],
  };
}

describe('Source-of-Truth Doc Engine — completeness', () => {
  it('a complete, aligned doc set ⇒ Compliant', () => {
    const r = assessDocCompliance(complete());
    expect(r.verdict).toBe('Compliant');
    expect(r.docs.every((d) => d.status === 'pass')).toBe(true);
    expect(r.alignment).toHaveLength(0);
  });

  it('a missing required doc ⇒ Fail', () => {
    const input = complete();
    delete input.docs.ARCHITECTURE; // unverifiable / not provided
    input.docs.IMPLEMENTATION_PLAN = 'missing';
    const r = assessDocCompliance(input);
    expect(r.verdict).toBe('Fail');
    expect(r.docs.find((d) => d.doc === 'IMPLEMENTATION_PLAN')!.status).toBe('fail');
    expect(r.docs.find((d) => d.doc === 'ARCHITECTURE')!.reason).toMatch(/deny-by-default/i);
  });

  it('a placeholder/empty required doc ⇒ Fail (not "present")', () => {
    const input = complete();
    input.docs.TESTING = 'placeholder';
    const r = assessDocCompliance(input);
    expect(r.verdict).toBe('Fail');
    expect(r.docs.find((d) => d.doc === 'TESTING')!.reason).toMatch(/placeholder/i);
  });
});

describe('Source-of-Truth Doc Engine — bidirectional alignment', () => {
  it('code with NO feature file ⇒ flagged (undocumented code)', () => {
    const input = complete();
    input.features = [{ name: 'sneaky-feature', hasCode: true, hasFeatureFile: false }];
    const r = assessDocCompliance(input);
    expect(r.verdict).toBe('Fail');
    expect(r.alignment[0]!.kind).toBe('undocumented-code');
  });

  it('a feature file claiming complete with NO code ⇒ flagged (overclaiming docs)', () => {
    const input = complete();
    input.features = [{ name: 'vaporware', hasCode: false, hasFeatureFile: true, featureFileStatus: 'complete' }];
    const r = assessDocCompliance(input);
    expect(r.verdict).toBe('Fail');
    expect(r.alignment[0]!.kind).toBe('overclaiming-docs');
    expect(r.alignment[0]!.reason).toMatch(/doesn't exist|overclaiming/i);
  });

  it('a feature file marked planned with no code is fine (not flagged)', () => {
    const input = complete();
    input.features = [{ name: 'later', hasCode: false, hasFeatureFile: true, featureFileStatus: 'planned' }];
    expect(assessDocCompliance(input).alignment).toHaveLength(0);
  });
});

describe('Source-of-Truth Doc Engine — deny-by-default', () => {
  it('an unverifiable alignment state ⇒ non-compliant (not "probably aligned")', () => {
    const input = complete();
    input.features = [{ name: 'mystery', hasFeatureFile: true }]; // hasCode unknown
    const r = assessDocCompliance(input);
    expect(r.verdict).toBe('Fail');
    expect(r.alignment[0]!.kind).toBe('unknown-drift');
  });
});
