// Feature Registry Engine (Module 28) — enforces "no feature exists only in code" at the FEATURE level
// (Layer 2 §8/§9), catching the subtler "built but incompletely accounted for" cases the project-level
// Doc Engine doesn't reach.
//
// CONSISTENCY RULES:
//  - code with no feature file ⇒ undocumented
//  - feature file marked built with no code ⇒ overclaim
//  - a BUILT feature with no tests ⇒ flagged (unverified code wearing a "done" label — dangerous omission)
//  - a BUILT feature with no permissions noted ⇒ flagged (an access-control gap hiding in plain sight)
//  - a PLANNED feature with no code ⇒ fine
//
// DENY-BY-DEFAULT: an unverifiable feature state ⇒ non-compliant, never "probably fine".
//
// STANDALONE-PACKAGEABLE: imports NOTHING from any other engine.

export type FeatureStatus = 'planned' | 'built';

export interface FeatureEntry {
  name: string;
  path?: string;
  status?: FeatureStatus; // undefined ⇒ unverifiable
  hasCode?: boolean; // undefined ⇒ unverifiable
  hasFeatureFile?: boolean; // undefined ⇒ unverifiable
  components?: string[];
  services?: string[];
  apis?: string[];
  dbTables?: string[];
  permissions?: string[];
  hasTests?: boolean;
  risks?: string[];
  openItems?: string[];
}

export type FeatureFindingKind = 'undocumented-code' | 'overclaim' | 'no-tests' | 'no-permissions' | 'unknown-drift';
export type FeatureVerdict = 'Compliant' | 'Fail';

export interface FeatureFinding {
  feature: string;
  kind: FeatureFindingKind;
  reason: string;
}
export interface FeatureComplianceReport {
  verdict: FeatureVerdict;
  findings: FeatureFinding[];
}

function checkFeature(f: FeatureEntry): FeatureFinding[] {
  const out: FeatureFinding[] = [];

  // Deny-by-default: the core presence facts must be known to reason at all.
  if (f.status === undefined || f.hasCode === undefined || f.hasFeatureFile === undefined) {
    out.push({ feature: f.name, kind: 'unknown-drift', reason: `${f.name}: status/code/feature-file presence unverifiable — deny-by-default (treated as drift)` });
    return out;
  }

  // No feature exists only in code: code with no feature file.
  if (f.hasCode && !f.hasFeatureFile) {
    out.push({ feature: f.name, kind: 'undocumented-code', reason: `${f.name}: code present with NO feature file (a feature exists only in code)` });
  }

  if (f.status === 'built') {
    // Overclaim: a feature file marked built with no code.
    if (!f.hasCode) {
      out.push({ feature: f.name, kind: 'overclaim', reason: `${f.name}: marked "built" but there is NO code (overclaim — a feature that doesn't exist)` });
    }
    // Dangerous omission: built code with no tests.
    if (f.hasTests !== true) {
      out.push({ feature: f.name, kind: 'no-tests', reason: `${f.name}: "built" but no tests — unverified code wearing a "done" label (dangerous omission)` });
    }
    // Dangerous omission: built code with no permissions noted.
    if (!f.permissions || f.permissions.length === 0) {
      out.push({ feature: f.name, kind: 'no-permissions', reason: `${f.name}: "built" but no permissions noted — an access-control gap hiding in plain sight (dangerous omission)` });
    }
  }

  // A 'planned' feature with no code is fine — no finding.
  return out;
}

export function assessFeatureRegistry(features: FeatureEntry[]): FeatureComplianceReport {
  const findings = (features ?? []).flatMap(checkFeature);
  return { verdict: findings.length > 0 ? 'Fail' : 'Compliant', findings };
}
