import { describe, it, expect } from 'vitest';
import {
  validateEvidencePack,
  assertValidEvidencePack,
  LOAD_BEARING_CLAIM_TYPES,
  type EvidencePack,
  type LoadBearingClaimType,
} from './evidence-pack.js';

// Evidence Pack Engine (Module 16) — machine-true-evidence. Pure-logic: validation is a pure
// function of the pack structure, so no DB.

const CMD_ID: Record<LoadBearingClaimType, string> = { test: 'test', lint: 'lint', typecheck: 'tc', build: 'build', license: 'lic' };

function validPack(): EvidencePack {
  return {
    stepIdentity: { workflow: 'ECE Factory build', step: 'Phase 4.4', mode: 'manual review', environment: 'local' },
    repositoryEvidence: { commits: ['abc123'], filesChanged: ['evidence-pack.ts'], sync: 'main...origin/main clean' },
    commands: [
      { id: 'test', command: 'npx vitest run', output: 'Test Files 1 passed\nTests 5 passed', exitCode: 0 },
      { id: 'lint', command: 'eslint .', output: 'lint exit: 0', exitCode: 0 },
      { id: 'tc', command: 'tsc --noEmit', output: 'typecheck exit: 0', exitCode: 0 },
      { id: 'build', command: 'tsc -b', output: 'build complete', exitCode: 0 },
      { id: 'lic', command: 'npm view pg license', output: 'MIT', exitCode: 0 },
    ],
    loadBearingClaims: [{ type: 'test', statement: 'tests passed', evidenceCommandId: 'test' }],
    proseClaims: [{ statement: 'the design follows the established pattern' }],
    policyGates: { mcp: false, ui: false, versionsPinned: true },
    failuresRisksOpenItems: [],
    proposedNextStep: { recommendation: 'proceed to Module 10', nextPrompt: 'ECE FACTORY — PHASE 4.5 ...' },
  };
}

describe('Evidence Pack Engine — machine-true-evidence', () => {
  it('REJECTS a bare "tests passed" claim with no command output (the central guarantee)', () => {
    const p = validPack();
    p.commands.find((c) => c.id === 'test')!.output = ''; // confident claim, nothing executable behind it
    const r = validateEvidencePack(p);
    expect(r.valid).toBe(false);
    expect(r.errors.join('\n')).toMatch(/NO verbatim output/i);
  });

  it('ACCEPTS the same claim when backed by verbatim runner output', () => {
    expect(validateEvidencePack(validPack()).valid).toBe(true);
  });

  it('REJECTS a pack missing a required section (empty policy gates)', () => {
    const p: EvidencePack = { ...validPack(), policyGates: {} };
    const r = validateEvidencePack(p);
    expect(r.valid).toBe(false);
    expect(r.errors.join('\n')).toMatch(/policyGates/i);
  });

  it('REJECTS a pack with no proposed next step', () => {
    const p: EvidencePack = { ...validPack(), proposedNextStep: { recommendation: '' } };
    expect(validateEvidencePack(p).valid).toBe(false);
  });

  it('REJECTS a claim that cites a non-existent command (unproven)', () => {
    const p = validPack();
    p.loadBearingClaims = [{ type: 'test', statement: 'tests passed', evidenceCommandId: 'ghost' }];
    const r = validateEvidencePack(p);
    expect(r.valid).toBe(false);
    expect(r.errors.join('\n')).toMatch(/UNPROVEN/i);
  });

  it('for EVERY load-bearing type: no output ⇒ REJECTED, verbatim output ⇒ ACCEPTED', () => {
    for (const type of LOAD_BEARING_CLAIM_TYPES) {
      const ok = validPack();
      ok.loadBearingClaims = [{ type, statement: `${type} ok`, evidenceCommandId: CMD_ID[type] }];
      expect(validateEvidencePack(ok).valid, `${type} with output should be valid`).toBe(true);

      const bad = validPack();
      bad.commands.find((c) => c.id === CMD_ID[type])!.output = '';
      bad.loadBearingClaims = [{ type, statement: `${type} ok`, evidenceCommandId: CMD_ID[type] }];
      expect(validateEvidencePack(bad).valid, `${type} without output should be invalid`).toBe(false);
    }
  });

  it('REJECTS evidence that does not correspond to the claim type (license claim backed by test output)', () => {
    const p = validPack();
    p.loadBearingClaims = [{ type: 'license', statement: 'license is MIT', evidenceCommandId: 'test' }]; // 'test' cmd has no license marker
    const r = validateEvidencePack(p);
    expect(r.valid).toBe(false);
    expect(r.errors.join('\n')).toMatch(/correspond/i);
  });

  it('REJECTS an invalid claim type', () => {
    const p = validPack();
    p.loadBearingClaims = [{ type: 'BOGUS' as LoadBearingClaimType, statement: 'x', evidenceCommandId: 'test' }];
    expect(validateEvidencePack(p).valid).toBe(false);
  });

  it('assertValidEvidencePack throws on invalid, passes on valid', () => {
    expect(() => assertValidEvidencePack(validPack())).not.toThrow();
    const bad = validPack();
    bad.commands.find((c) => c.id === 'test')!.output = '';
    expect(() => assertValidEvidencePack(bad)).toThrow(/machine-true-evidence/i);
  });
});
