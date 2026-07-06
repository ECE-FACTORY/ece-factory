// Compliance Checker (Module 26) — verifies the governance invariants over a structured repo/step
// descriptor and emits Compliant / Warning / Fail / STOP with per-check reasons.
//
// CORE GUARANTEE — DENY-BY-DEFAULT: an invariant that cannot be POSITIVELY verified is non-compliant
// (Fail, or STOP for security-critical ones), never a silent pass. Unknown/unverifiable ≠ "probably fine".
// Missing evidence of compliance IS non-compliance.
//
// STANDALONE-PACKAGEABLE: imports NOTHING from any other engine.

export type CheckStatus = 'pass' | 'warn' | 'fail' | 'stop';
export type ComplianceVerdict = 'Compliant' | 'Warning' | 'Fail' | 'STOP';

export interface CheckResult {
  id: string;
  status: CheckStatus;
  reason: string;
}
export interface ComplianceReport {
  verdict: ComplianceVerdict;
  checks: CheckResult[];
}

/** Structured, compliance-relevant facts about a repo/step. Any undefined field is UNVERIFIABLE. */
export interface ComplianceDescriptor {
  governance?: { present: boolean; anyPlaceholder: boolean };
  claudeMdPresent?: boolean;
  requiredArtifacts?: { name: string; present: boolean }[];
  build?: { hasBuildCode: boolean; harvestApproved: boolean };
  featureRegistry?: { exists: boolean; populated: boolean };
  tools?: { used: string[]; registered: string[] };
  redactionPolicyPresent?: boolean;
  auditSchema?: { present: boolean; appendOnly: boolean };
  writeTools?: { present: boolean };
  controls?: { audit: boolean; permission: boolean; redaction: boolean };
  humanAttribution?: boolean; // no Claude-only actor
  instructionBoundaryEnforced?: boolean; // no dashboard-data-as-instruction path
}

const pass = (id: string, reason = 'ok'): CheckResult => ({ id, status: 'pass', reason });
const fail = (id: string, reason: string): CheckResult => ({ id, status: 'fail', reason });
const stop = (id: string, reason: string): CheckResult => ({ id, status: 'stop', reason });

export function runComplianceCheck(d: ComplianceDescriptor): ComplianceReport {
  const checks: CheckResult[] = [];

  // 1 — governance files present, full-text, no placeholders
  if (!d.governance) checks.push(fail('governance', 'governance state unverifiable — deny-by-default'));
  else if (!d.governance.present) checks.push(fail('governance', 'governance files missing'));
  else if (d.governance.anyPlaceholder) checks.push(fail('governance', 'a governance file is a placeholder / empty'));
  else checks.push(pass('governance'));

  // 2 — CLAUDE.md present
  checks.push(d.claudeMdPresent === true ? pass('claude-md') : fail('claude-md', 'CLAUDE.md missing or unverified'));

  // 3 — required docs + feature files exist
  if (!d.requiredArtifacts) checks.push(fail('required-artifacts', 'required artifacts unverified'));
  else {
    const missing = d.requiredArtifacts.filter((a) => !a.present).map((a) => a.name);
    checks.push(missing.length === 0 ? pass('required-artifacts') : fail('required-artifacts', `missing required artifact(s): ${missing.join(', ')}`));
  }

  // 4 — Harvest-Report-before-build
  if (!d.build) checks.push(fail('harvest-before-build', 'build/harvest state unverifiable'));
  else if (d.build.hasBuildCode && !d.build.harvestApproved) checks.push(fail('harvest-before-build', 'build code present without an approved Harvest Report'));
  else checks.push(pass('harvest-before-build'));

  // 5 — Feature Registry exists and is populated
  if (!d.featureRegistry) checks.push(fail('feature-registry', 'feature registry state unverifiable'));
  else if (!d.featureRegistry.exists || !d.featureRegistry.populated) checks.push(fail('feature-registry', 'feature registry missing or not populated'));
  else checks.push(pass('feature-registry'));

  // 6 — tools used are registered (no hidden tools)
  if (!d.tools) checks.push(fail('tools-registered', 'tool registration unverified'));
  else {
    const reg = new Set(d.tools.registered);
    const hidden = d.tools.used.filter((t) => !reg.has(t));
    checks.push(hidden.length === 0 ? pass('tools-registered') : fail('tools-registered', `unregistered tool(s) used: ${hidden.join(', ')} (no hidden tools)`));
  }

  // 7 — sensitive-field / redaction policy present
  checks.push(d.redactionPolicyPresent === true ? pass('redaction-policy') : fail('redaction-policy', 'redaction / sensitive-field policy missing'));

  // 8 — audit schema present (append-only) — security-critical ⇒ STOP on failure/unknown
  if (!d.auditSchema) checks.push(stop('audit-schema', 'audit schema unverifiable (security-critical)'));
  else if (!d.auditSchema.present) checks.push(stop('audit-schema', 'audit schema missing'));
  else if (!d.auditSchema.appendOnly) checks.push(stop('audit-schema', 'audit schema is not append-only'));
  else checks.push(pass('audit-schema'));

  // 9 — write tools disabled if controls missing — security-critical ⇒ STOP
  if (!d.writeTools) checks.push(fail('write-controls', 'write-tool presence unverified'));
  else if (!d.writeTools.present) checks.push(pass('write-controls', 'no write tools'));
  else if (!d.controls) checks.push(stop('write-controls', 'write tools present but controls unverifiable'));
  else if (!(d.controls.audit && d.controls.permission && d.controls.redaction)) checks.push(stop('write-controls', 'write tools present without full controls (audit + permission + redaction)'));
  else checks.push(pass('write-controls', 'write tools present with full controls'));

  // 10 — no Claude-only actor (human attribution) — security-critical ⇒ STOP
  checks.push(d.humanAttribution === true ? pass('human-attribution') : stop('human-attribution', 'human attribution missing (no Claude-only actor allowed)'));

  // 11 — no dashboard-data-as-instruction path — security-critical ⇒ STOP
  checks.push(d.instructionBoundaryEnforced === true ? pass('instruction-boundary') : stop('instruction-boundary', 'dashboard/fetched-data-as-instruction path not provably closed'));

  // Overall verdict: STOP dominates, then Fail, then Warning, else Compliant.
  let verdict: ComplianceVerdict = 'Compliant';
  if (checks.some((c) => c.status === 'stop')) verdict = 'STOP';
  else if (checks.some((c) => c.status === 'fail')) verdict = 'Fail';
  else if (checks.some((c) => c.status === 'warn')) verdict = 'Warning';

  return { verdict, checks };
}
