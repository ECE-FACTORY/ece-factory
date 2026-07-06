import { describe, it, expect } from 'vitest';
import { assessFeatureRegistry, type FeatureEntry, type FeatureFinding } from './feature-registry.js';

// Feature Registry Engine (Module 28). Pure-logic: the verdict is a pure function of the feature list.

function builtFeature(over: Partial<FeatureEntry> = {}): FeatureEntry {
  return { name: 'audit-engine', path: 'src/features/audit-engine', status: 'built', hasCode: true, hasFeatureFile: true, hasTests: true, permissions: ['ece_app'], ...over };
}
const kinds = (r: { findings: FeatureFinding[] }) => r.findings.map((f) => f.kind);

describe('Feature Registry — no feature exists only in code', () => {
  it('a fully-documented built feature (file + tests + permissions) ⇒ Compliant', () => {
    const r = assessFeatureRegistry([builtFeature()]);
    expect(r.verdict).toBe('Compliant');
    expect(r.findings).toHaveLength(0);
  });

  it('a code-only feature (no feature file) ⇒ flagged (undocumented)', () => {
    const r = assessFeatureRegistry([builtFeature({ hasFeatureFile: false })]);
    expect(r.verdict).toBe('Fail');
    expect(kinds(r)).toContain('undocumented-code');
  });

  it('a built feature with NO tests ⇒ flagged (dangerous omission)', () => {
    const r = assessFeatureRegistry([builtFeature({ hasTests: false })]);
    expect(r.verdict).toBe('Fail');
    expect(kinds(r)).toContain('no-tests');
  });

  it('a built feature with NO permissions ⇒ flagged (access-control gap)', () => {
    const r = assessFeatureRegistry([builtFeature({ permissions: [] })]);
    expect(r.verdict).toBe('Fail');
    expect(kinds(r)).toContain('no-permissions');
  });

  it('a built feature with NO code (overclaim) ⇒ flagged', () => {
    const r = assessFeatureRegistry([builtFeature({ hasCode: false })]);
    expect(r.verdict).toBe('Fail');
    expect(kinds(r)).toContain('overclaim');
  });

  it('a planned feature with no code ⇒ NOT flagged', () => {
    const r = assessFeatureRegistry([{ name: 'future', status: 'planned', hasCode: false, hasFeatureFile: true }]);
    expect(r.verdict).toBe('Compliant');
    expect(r.findings).toHaveLength(0);
  });
});

describe('Feature Registry — deny-by-default', () => {
  it('an unverifiable feature (unknown status/code/file) ⇒ non-compliant', () => {
    const r = assessFeatureRegistry([{ name: 'mystery', hasFeatureFile: true }]); // status + hasCode unknown
    expect(r.verdict).toBe('Fail');
    expect(kinds(r)).toContain('unknown-drift');
  });
});
