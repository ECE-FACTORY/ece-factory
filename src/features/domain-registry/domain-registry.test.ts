import { describe, it, expect } from 'vitest';
import { DomainRegistry, domainSummary, type DomainInput } from './domain-registry.js';

// Domain Registry (Module 4) — pure-logic validation + the consumable summary shape (no DB).

const registry = new DomainRegistry(() => 1000);

function validDomain(name = 'identity-trust'): DomainInput {
  return {
    name, businessObjective: 'Sovereign identity & trust platform for UAE entities',
    sovereignty: 'sovereign', airGap: 'required', arabicFirst: 'required',
    owner: 'ECE', riskLevel: 'high', subDomains: ['kyc', 'auth'], targetClients: ['banks', 'ministries'],
  };
}

describe('Domain Registry — validation (deny-by-default)', () => {
  it('a fully-specified domain validates', () => {
    expect(registry.validate(validDomain()).ok).toBe(true);
  });
  it('missing business objective ⇒ rejected', () => {
    const r = registry.validate({ ...validDomain(), businessObjective: '' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join('\n')).toMatch(/businessObjective/i);
  });
  it('missing/unknown sovereignty classification ⇒ rejected (unknown is not valid)', () => {
    const r = registry.validate({ ...validDomain(), sovereignty: undefined as unknown as 'sovereign' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join('\n')).toMatch(/sovereignty must be explicitly set/i);
  });
  it('missing air-gap classification ⇒ rejected', () => {
    const r = registry.validate({ ...validDomain(), airGap: undefined as unknown as 'required' });
    expect(r.ok).toBe(false);
  });
  it('missing Arabic-first classification ⇒ rejected', () => {
    const r = registry.validate({ ...validDomain(), arabicFirst: undefined as unknown as 'required' });
    expect(r.ok).toBe(false);
  });
  it('invalid risk level ⇒ rejected', () => {
    const r = registry.validate({ ...validDomain(), riskLevel: 'extreme' as unknown as 'high' });
    expect(r.ok).toBe(false);
  });
});

describe('Domain Registry — consumable summary', () => {
  it('domainSummary exposes what the Project Registry / Product Creation engines need', () => {
    const rec = {
      registeredAtIso: 'x', name: 'identity-trust', businessObjective: 'b', sovereignty: 'sovereign' as const,
      airGap: 'required' as const, arabicFirst: 'required' as const, owner: 'ECE', riskLevel: 'high' as const,
      status: 'registered' as const, subDomains: ['kyc'], targetClients: [], linkedHarvestRef: null, linkedProjectRefs: [],
    };
    expect(domainSummary(rec)).toEqual({ name: 'identity-trust', sovereignty: 'sovereign', airGap: 'required', arabicFirst: 'required', status: 'registered', subDomains: ['kyc'] });
  });
});
