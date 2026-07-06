// Evidence Pack Engine (Module 16) — formalizes the Step Evidence Pack as a typed, machine-checkable
// artifact, and enforces §16.2 MACHINE-TRUE-EVIDENCE: a load-bearing claim (tests/lint/typecheck/
// build/license) is INVALID unless backed by VERBATIM command output — not prose. A confident-sounding
// claim with nothing executable behind it is exactly what this engine rejects.
//
// STANDALONE-PACKAGEABLE: imports NOTHING from any other engine.

/** The load-bearing claim types that MUST be backed by verbatim command output. */
export const LOAD_BEARING_CLAIM_TYPES = ['test', 'lint', 'typecheck', 'build', 'license'] as const;
export type LoadBearingClaimType = (typeof LOAD_BEARING_CLAIM_TYPES)[number];

/** A command and its VERBATIM output (the machine-true evidence). */
export interface EvidenceCommand {
  id: string;
  command: string;
  output: string; // verbatim — must be non-empty to back a load-bearing claim
  exitCode?: number;
}

/** A claim whose truth gates a phase transition — MUST cite a command's verbatim output. */
export interface LoadBearingClaim {
  type: LoadBearingClaimType;
  statement: string; // e.g. "tests passed"
  evidenceCommandId: string; // points at an EvidenceCommand
}

/** Narrative context — NOT checked for command output. */
export interface ProseClaim {
  statement: string;
}

export interface StepIdentity {
  workflow: string;
  step: string;
  mode: string;
  environment: string;
  promptRef?: string;
}

export interface EvidencePack {
  stepIdentity: StepIdentity;
  repositoryEvidence: { filesChanged?: string[]; commits?: string[]; sync?: string };
  commands: EvidenceCommand[];
  loadBearingClaims: LoadBearingClaim[];
  proseClaims?: ProseClaim[];
  policyGates: Record<string, string | boolean>;
  failuresRisksOpenItems: string[];
  proposedNextStep: { recommendation: string; nextPrompt?: string };
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/** The explicit required-section set. A pack missing any of these is invalid. */
export const REQUIRED_SECTIONS = [
  'stepIdentity', 'repositoryEvidence', 'commands', 'loadBearingClaims',
  'policyGates', 'failuresRisksOpenItems', 'proposedNextStep',
] as const;

/**
 * Heuristic correspondence markers per claim type. The backing command (command + output) must
 * carry at least one marker of the claimed type. This catches GROSS category mismatches (e.g. a
 * "license" claim backed by test-runner output). It is a structural signal, NOT proof of authenticity
 * or that it is the exact run — that remains the human reviewer's independent re-derivation (L0 §22).
 */
const TYPE_MARKERS: Record<LoadBearingClaimType, RegExp> = {
  test: /vitest|jest|mocha|\btests?\b|\bpassed\b|\bfailed\b|✓/i,
  lint: /\beslint\b|\blint\b/i,
  typecheck: /\btsc\b|typecheck|type-check|noemit/i,
  build: /\bbuild\b|\btsc\b|compile|webpack|vite build|rollup/i,
  license: /licen[cs]e|spdx|npm view/i,
};

export function validateEvidencePack(pack: EvidencePack): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // --- required-section completeness ---
  const si = pack?.stepIdentity;
  if (!si || !si.workflow || !si.step || !si.mode || !si.environment) {
    errors.push('section "stepIdentity" missing or incomplete (workflow/step/mode/environment required)');
  }
  if (!pack?.repositoryEvidence) errors.push('section "repositoryEvidence" missing');
  if (!pack?.policyGates || Object.keys(pack.policyGates).length === 0) errors.push('section "policyGates" missing or empty');
  if (!pack?.proposedNextStep?.recommendation) errors.push('section "proposedNextStep" missing (recommendation required)');
  if (!Array.isArray(pack?.failuresRisksOpenItems)) errors.push('section "failuresRisksOpenItems" missing (array required, may be empty)');
  if (!Array.isArray(pack?.commands)) errors.push('section "commands" missing (array required)');
  if (!Array.isArray(pack?.loadBearingClaims)) errors.push('section "loadBearingClaims" missing (array required, may be empty)');

  // --- machine-true-evidence on every load-bearing claim ---
  const commands = Array.isArray(pack?.commands) ? pack.commands : [];
  const byId = new Map(commands.map((c) => [c.id, c]));
  const claims = Array.isArray(pack?.loadBearingClaims) ? pack.loadBearingClaims : [];
  for (const claim of claims) {
    const tag = `load-bearing ${claim?.type ?? '?'} claim ("${claim?.statement ?? ''}")`;
    if (!claim?.type || !(LOAD_BEARING_CLAIM_TYPES as readonly string[]).includes(claim.type)) {
      errors.push(`${tag}: invalid or missing claim type`);
      continue;
    }
    const cmd = byId.get(claim.evidenceCommandId);
    if (!cmd) {
      errors.push(`${tag}: no command backs it (evidenceCommandId "${claim.evidenceCommandId}" not found) — UNPROVEN claim`);
      continue;
    }
    if (!cmd.output || cmd.output.trim() === '') {
      errors.push(`${tag}: backing command "${cmd.command}" has NO verbatim output — UNPROVEN claim (§16.2)`);
      continue;
    }
    if (!TYPE_MARKERS[claim.type].test(`${cmd.command}\n${cmd.output}`)) {
      errors.push(`${tag}: evidence does not correspond to a ${claim.type} command (marker mismatch) — wrong evidence cited`);
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

/** Throwing form — for use as a phase-transition gate. */
export function assertValidEvidencePack(pack: EvidencePack): void {
  const r = validateEvidencePack(pack);
  if (!r.valid) {
    throw new Error(`invalid evidence pack (machine-true-evidence not satisfied):\n- ${r.errors.join('\n- ')}`);
  }
}
