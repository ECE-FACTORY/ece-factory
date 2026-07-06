import { describe, it, expect } from 'vitest';
import { assessSovereignReadiness, SOVEREIGN_CHECKS, type SovereignDescriptor, type CheckResult } from './sovereign-readiness.js';

// Sovereign Readiness Engine (Module 12). Pure-logic: the verdict is a pure function of the descriptor.

function fullyLocal(): SovereignDescriptor {
  const d: SovereignDescriptor = {};
  for (const c of SOVEREIGN_CHECKS) {
    d[c.id] = { state: c.id === 'aiInferenceLocal' ? 'not-applicable' : 'local' };
  }
  return d;
}
const check = (r: { checks: CheckResult[] }, id: string): CheckResult => r.checks.find((c) => c.id === id)!;

describe('Sovereign Readiness — verdicts', () => {
  it('a fully-local, offline-capable candidate ⇒ Acceptable', () => {
    const r = assessSovereignReadiness(fullyLocal());
    expect(r.verdict).toBe('Acceptable');
    expect(r.checks.every((c) => c.status === 'pass')).toBe(true);
  });

  it('a removable-dependency / disable-able-telemetry gap ⇒ Acceptable-after-hardening (names the hardening)', () => {
    const d = fullyLocal();
    d.noVendorTelemetry = { state: 'removable-gap', note: 'disable the analytics endpoint ANALYTICS_URL' };
    const r = assessSovereignReadiness(d);
    expect(r.verdict).toBe('Acceptable-after-hardening');
    expect(check(r, 'noVendorTelemetry').status).toBe('after-hardening');
    expect(check(r, 'noVendorTelemetry').reason).toMatch(/disable the analytics endpoint/i);
  });

  it('a mandatory foreign-SaaS / phone-home that cannot be removed ⇒ Rejected', () => {
    const d = fullyLocal();
    d.noForeignSaaS = { state: 'mandatory-blocker', note: 'requires a foreign licensing control plane' };
    const r = assessSovereignReadiness(d);
    expect(r.verdict).toBe('Rejected');
    expect(check(r, 'noForeignSaaS').status).toBe('blocker');
  });

  it('a connected-only dependency ⇒ Non-sovereign-only', () => {
    const d = fullyLocal();
    d.identityLocal = { state: 'connected-only', note: 'auth needs an online IdP' };
    const r = assessSovereignReadiness(d);
    expect(r.verdict).toBe('Non-sovereign-only');
  });

  it('a blocker dominates a connected-only ⇒ Rejected', () => {
    const d = fullyLocal();
    d.identityLocal = { state: 'connected-only' };
    d.noForeignSaaS = { state: 'mandatory-blocker' };
    expect(assessSovereignReadiness(d).verdict).toBe('Rejected');
  });
});

describe('Sovereign Readiness — deny-by-default (unknown ≠ offline)', () => {
  it('an unknown/unverifiable check ⇒ NOT Acceptable (the central guarantee)', () => {
    const d = fullyLocal();
    delete d.databaseLocal; // unverifiable
    const r = assessSovereignReadiness(d);
    expect(check(r, 'databaseLocal').status).toBe('unknown');
    expect(r.verdict).not.toBe('Acceptable');
    expect(r.verdict).toBe('Acceptable-after-hardening'); // at best — must verify
  });

  it('an empty descriptor ⇒ all unknown ⇒ Acceptable-after-hardening, never Acceptable', () => {
    const r = assessSovereignReadiness({});
    expect(r.verdict).toBe('Acceptable-after-hardening');
    expect(r.checks.every((c) => c.status === 'unknown')).toBe(true);
  });
});

describe('Sovereign Readiness — reasons', () => {
  it('every check carries a non-empty per-check reason', () => {
    const r = assessSovereignReadiness(fullyLocal());
    expect(r.checks).toHaveLength(SOVEREIGN_CHECKS.length);
    for (const c of r.checks) expect(c.reason.trim().length).toBeGreaterThan(0);
  });
});
