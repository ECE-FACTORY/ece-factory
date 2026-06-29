import { describe, it, expect } from 'vitest';
import { RiskRegister, surfaceBlockingRisks, hasBlockingRisks, type RiskInput, type RiskRecord, type Severity, type RiskStatus } from './risk-register.js';

// Risk Register (Module 31) — pure-logic: validation + the open-risk surfacer (no DB).

const registry = new RiskRegister(() => 1000);

function validRisk(over: Partial<RiskInput> = {}): RiskInput {
  return { key: 'RISK-001', title: 'BSL dependency', type: 'license', owner: 'ECE', severity: 'high', status: 'open', ...over };
}
function rec(key: string, severity: Severity, status: RiskStatus): RiskRecord {
  return { registeredAtIso: 'x', key, title: null, type: 'security', owner: 'ECE', severity, mitigation: null, status, linkedProject: null, linkedRepo: null, linkedDecision: null, linkedEvidence: null };
}

describe('Risk Register — validation (deny-by-default)', () => {
  it('a fully-specified risk validates', () => {
    expect(registry.validate(validRisk()).ok).toBe(true);
  });
  it('missing key / owner ⇒ rejected', () => {
    expect(registry.validate(validRisk({ key: '' })).ok).toBe(false);
    expect(registry.validate(validRisk({ owner: '' })).ok).toBe(false);
  });
  it('an invalid type ⇒ rejected', () => {
    expect(registry.validate(validRisk({ type: 'made-up' as unknown as 'license' })).ok).toBe(false);
  });
  it('an invalid severity ⇒ rejected', () => {
    expect(registry.validate(validRisk({ severity: 'extreme' as unknown as Severity })).ok).toBe(false);
  });
});

describe('Risk Register — open-risk surfacer (core)', () => {
  it('unmitigated high/critical OPEN risks are surfaced as blocking; mitigated/closed are not', () => {
    const risks = [
      rec('R1', 'critical', 'open'), // blocking
      rec('R2', 'low', 'open'), // not (low)
      rec('R3', 'high', 'closed'), // not (closed)
      rec('R4', 'high', 'open'), // blocking
      rec('R5', 'critical', 'mitigating'), // not (being mitigated)
    ];
    const blocking = surfaceBlockingRisks(risks).map((r) => r.key);
    expect(blocking).toEqual(['R1', 'R4']);
    expect(hasBlockingRisks(risks)).toBe(true);
  });
  it('no blocking risks when all high/critical are mitigated/closed', () => {
    const risks = [rec('R1', 'critical', 'closed'), rec('R2', 'high', 'mitigating'), rec('R3', 'medium', 'open')];
    expect(surfaceBlockingRisks(risks)).toHaveLength(0);
    expect(hasBlockingRisks(risks)).toBe(false);
  });
});
