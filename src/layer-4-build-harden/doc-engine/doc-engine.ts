// Source-of-Truth Doc Engine (Module 27) — verifies the required per-project docs (Layer 2 §5) are
// present (not placeholder) AND that code and docs are aligned in BOTH directions.
//
// BIDIRECTIONAL ALIGNMENT (the core): code-without-a-feature-file is undocumented code; a feature file
// that claims complete/built with NO corresponding code is overclaiming — docs asserting a feature that
// doesn't exist, which is arguably worse than a missing doc (it misleads). Both are flagged.
//
// DENY-BY-DEFAULT: an unverifiable doc state or alignment state is treated as DRIFT (non-compliant),
// never "probably fine"/"probably aligned". A placeholder doc is NOT "present".
//
// STANDALONE-PACKAGEABLE: imports NOTHING from any other engine.

export const REQUIRED_DOCS = [
  'PROJECT_SOURCE_OF_TRUTH', 'PROJECT_MAP', 'ARCHITECTURE', 'IMPLEMENTATION_PLAN', 'FEATURE_REGISTRY',
  'DECISION_LOG', 'REPO_AUDIT', 'OPEN_ITEMS', 'SECURITY_NOTES', 'DEPLOYMENT', 'TESTING', 'UPSTREAM_TRACKING',
] as const;
export type RequiredDoc = (typeof REQUIRED_DOCS)[number];

/** A doc is 'present' only if it exists AND is full-text (not a placeholder). undefined ⇒ unverifiable. */
export type DocState = 'present' | 'placeholder' | 'missing';

export interface FeatureDescriptor {
  name: string;
  hasCode?: boolean; // undefined ⇒ unverifiable
  hasFeatureFile?: boolean; // undefined ⇒ unverifiable
  featureFileStatus?: 'planned' | 'complete';
}

export interface DocComplianceInput {
  docs: Partial<Record<RequiredDoc, DocState>>;
  features: FeatureDescriptor[];
}

export type DocCheckStatus = 'pass' | 'fail';
export type AlignmentKind = 'undocumented-code' | 'overclaiming-docs' | 'unknown-drift';
export type DocVerdict = 'Compliant' | 'Fail';

export interface DocCheckResult {
  doc: RequiredDoc;
  status: DocCheckStatus;
  reason: string;
}
export interface AlignmentFinding {
  feature: string;
  kind: AlignmentKind;
  reason: string;
}
export interface DocComplianceReport {
  verdict: DocVerdict;
  docs: DocCheckResult[];
  alignment: AlignmentFinding[];
}

function checkDoc(doc: RequiredDoc, state: DocState | undefined): DocCheckResult {
  if (state === 'present') return { doc, status: 'pass', reason: `${doc}: present (full-text)` };
  if (state === 'placeholder') return { doc, status: 'fail', reason: `${doc}: placeholder/empty — not "present" (no-placeholders discipline)` };
  if (state === 'missing') return { doc, status: 'fail', reason: `${doc}: missing` };
  return { doc, status: 'fail', reason: `${doc}: state unverifiable — deny-by-default (treated as drift)` };
}

function checkAlignment(f: FeatureDescriptor): AlignmentFinding | null {
  // Deny-by-default: an unverifiable side of the alignment is drift, not "probably aligned".
  if (f.hasCode === undefined || f.hasFeatureFile === undefined) {
    return { feature: f.name, kind: 'unknown-drift', reason: `${f.name}: code/doc presence unverifiable — deny-by-default drift` };
  }
  // Direction 1 — undocumented code.
  if (f.hasCode && !f.hasFeatureFile) {
    return { feature: f.name, kind: 'undocumented-code', reason: `${f.name}: code present with NO feature file (undocumented code)` };
  }
  // Direction 2 — overclaiming docs (a feature file claims complete/built but there is no code).
  if (f.hasFeatureFile && f.featureFileStatus === 'complete' && !f.hasCode) {
    return { feature: f.name, kind: 'overclaiming-docs', reason: `${f.name}: feature file claims complete/built but there is NO code (overclaiming docs — a feature that doesn't exist)` };
  }
  // A feature file marked 'planned' with no code is fine; code + feature file is fine.
  return null;
}

export function assessDocCompliance(input: DocComplianceInput): DocComplianceReport {
  const docs = REQUIRED_DOCS.map((d) => checkDoc(d, input.docs?.[d]));
  const alignment = (input.features ?? []).map(checkAlignment).filter((x): x is AlignmentFinding => x !== null);

  const verdict: DocVerdict = docs.some((d) => d.status === 'fail') || alignment.length > 0 ? 'Fail' : 'Compliant';
  return { verdict, docs, alignment };
}
