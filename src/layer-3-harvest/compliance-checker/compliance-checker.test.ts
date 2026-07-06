import { describe, it, expect } from 'vitest';
import { runComplianceCheck, type ComplianceDescriptor, type CheckResult } from './compliance-checker.js';

// Compliance Checker (Module 26). Pure-logic: the verdict is a pure function of the descriptor, no DB.

function compliant(): ComplianceDescriptor {
  return {
    governance: { present: true, anyPlaceholder: false },
    claudeMdPresent: true,
    requiredArtifacts: [{ name: 'CLAUDE.md', present: true }, { name: 'audit-engine.feature.md', present: true }],
    build: { hasBuildCode: true, harvestApproved: true },
    featureRegistry: { exists: true, populated: true },
    tools: { used: ['search_clients'], registered: ['search_clients'] },
    redactionPolicyPresent: true,
    auditSchema: { present: true, appendOnly: true },
    writeTools: { present: false },
    controls: { audit: true, permission: true, redaction: true },
    humanAttribution: true,
    instructionBoundaryEnforced: true,
  };
}

const check = (r: { checks: CheckResult[] }, id: string): CheckResult => r.checks.find((c) => c.id === id)!;

describe('Compliance Checker — fully compliant', () => {
  it('a fully-compliant descriptor ⇒ Compliant', () => {
    const r = runComplianceCheck(compliant());
    expect(r.verdict).toBe('Compliant');
    expect(r.checks.every((c) => c.status === 'pass')).toBe(true);
  });
});

describe('Compliance Checker — per-invariant violations', () => {
  it('placeholder governance file ⇒ Fail', () => {
    const r = runComplianceCheck({ ...compliant(), governance: { present: true, anyPlaceholder: true } });
    expect(r.verdict).toBe('Fail');
    expect(check(r, 'governance').status).toBe('fail');
    expect(check(r, 'governance').reason).toMatch(/placeholder/i);
  });
  it('missing CLAUDE.md ⇒ Fail', () => {
    const r = runComplianceCheck({ ...compliant(), claudeMdPresent: false });
    expect(check(r, 'claude-md').status).toBe('fail');
    expect(r.verdict).toBe('Fail');
  });
  it('a missing required feature file ⇒ Fail (lists it)', () => {
    const r = runComplianceCheck({ ...compliant(), requiredArtifacts: [{ name: 'audit-engine.feature.md', present: false }] });
    expect(check(r, 'required-artifacts').status).toBe('fail');
    expect(check(r, 'required-artifacts').reason).toMatch(/audit-engine.feature.md/);
  });
  it('build code without an approved Harvest Report ⇒ Fail', () => {
    const r = runComplianceCheck({ ...compliant(), build: { hasBuildCode: true, harvestApproved: false } });
    expect(check(r, 'harvest-before-build').status).toBe('fail');
  });
  it('feature registry not populated ⇒ Fail', () => {
    const r = runComplianceCheck({ ...compliant(), featureRegistry: { exists: true, populated: false } });
    expect(check(r, 'feature-registry').status).toBe('fail');
  });
  it('an unregistered tool used ⇒ Fail (no hidden tools)', () => {
    const r = runComplianceCheck({ ...compliant(), tools: { used: ['ghost_tool'], registered: ['search_clients'] } });
    expect(check(r, 'tools-registered').status).toBe('fail');
    expect(check(r, 'tools-registered').reason).toMatch(/ghost_tool/);
  });
  it('missing redaction policy ⇒ Fail', () => {
    const r = runComplianceCheck({ ...compliant(), redactionPolicyPresent: false });
    expect(check(r, 'redaction-policy').status).toBe('fail');
  });
});

describe('Compliance Checker — security-critical ⇒ STOP', () => {
  it('audit schema missing ⇒ STOP', () => {
    const r = runComplianceCheck({ ...compliant(), auditSchema: { present: false, appendOnly: false } });
    expect(check(r, 'audit-schema').status).toBe('stop');
    expect(r.verdict).toBe('STOP');
  });
  it('write tools present but a control missing ⇒ STOP (write-disabled-without-controls)', () => {
    const r = runComplianceCheck({ ...compliant(), writeTools: { present: true }, controls: { audit: true, permission: true, redaction: false } });
    expect(check(r, 'write-controls').status).toBe('stop');
    expect(r.verdict).toBe('STOP');
  });
  it('write tools present WITH full controls ⇒ that check passes', () => {
    const r = runComplianceCheck({ ...compliant(), writeTools: { present: true }, controls: { audit: true, permission: true, redaction: true } });
    expect(check(r, 'write-controls').status).toBe('pass');
  });
  it('no human attribution ⇒ STOP', () => {
    const r = runComplianceCheck({ ...compliant(), humanAttribution: false });
    expect(check(r, 'human-attribution').status).toBe('stop');
  });
  it('dashboard-data-as-instruction path not closed ⇒ STOP', () => {
    const r = runComplianceCheck({ ...compliant(), instructionBoundaryEnforced: false });
    expect(check(r, 'instruction-boundary').status).toBe('stop');
  });
});

describe('Compliance Checker — deny-by-default on unverifiable', () => {
  it('an unverifiable security-critical invariant (audit schema undefined) ⇒ STOP, never pass', () => {
    const d = compliant();
    delete d.auditSchema;
    const r = runComplianceCheck(d);
    expect(check(r, 'audit-schema').status).toBe('stop');
    expect(r.verdict).not.toBe('Compliant');
  });
  it('an unverifiable non-critical invariant (redaction undefined) ⇒ Fail, never pass', () => {
    const d = compliant();
    delete d.redactionPolicyPresent;
    const r = runComplianceCheck(d);
    expect(check(r, 'redaction-policy').status).toBe('fail');
    expect(r.verdict).not.toBe('Compliant');
  });
  it('an empty descriptor ⇒ STOP (everything unverifiable), never Compliant', () => {
    const r = runComplianceCheck({});
    expect(r.verdict).toBe('STOP');
    expect(r.checks.some((c) => c.status === 'pass')).toBe(false);
  });
});
