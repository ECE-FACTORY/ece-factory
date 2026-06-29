import { describe, it, expect } from 'vitest';
import { ProjectRegistry, gateView, ProjectValidationError, type ProjectInput, type ProjectRecord, type ProjectRegistryStore } from './project-registry.js';
import type { DomainSummary } from '../domain-registry/domain-registry.js';

// Project Registry (Module 5) — pure-logic: validation, the harvest-before-build gate, and the
// domain-registered check (with an injected lookup + in-memory store). No DB needed here.

const registry = new ProjectRegistry(() => 1000);

function validProject(name = 'ece-identity'): ProjectInput {
  return { project: name, repo: name, domain: 'identity-trust', purpose: 'sovereign identity', owner: 'ECE', stack: 'TypeScript', deployment: 'on-prem', harvestApprovalStatus: 'not-started' };
}
const registeredDomain: DomainSummary = { name: 'identity-trust', sovereignty: 'sovereign', airGap: 'required', arabicFirst: 'required', status: 'registered', subDomains: [] };

function memStore(): ProjectRegistryStore {
  let rec: ProjectRecord | null = null;
  return {
    put: async (r) => { rec = { ...r, recordId: 'mem' }; return rec; },
    getLatest: async () => rec,
    history: async () => (rec ? [rec] : []),
    list: async () => (rec ? [rec] : []),
  };
}

describe('Project Registry — validation (deny-by-default)', () => {
  it('a fully-specified project validates', () => {
    expect(registry.validate(validProject()).ok).toBe(true);
  });
  it('a missing required field ⇒ rejected', () => {
    expect(registry.validate({ ...validProject(), repo: '' }).ok).toBe(false);
  });
  it('an invalid status (outside §5.4) ⇒ rejected', () => {
    const r = registry.validate({ ...validProject(), status: 'Shipping' as unknown as 'In build' });
    expect(r.ok).toBe(false);
  });
});

describe('Project Registry — domain must be registered', () => {
  it('a reference to an UNREGISTERED domain ⇒ rejected (nothing stored)', async () => {
    const lookup = async () => null; // domain not registered
    await expect(registry.register(memStore(), lookup, validProject())).rejects.toThrow(ProjectValidationError);
  });
  it('a reference to a registered domain ⇒ registers', async () => {
    const lookup = async () => registeredDomain;
    const rec = await registry.register(memStore(), lookup, validProject());
    expect(rec.domain).toBe('identity-trust');
    expect(rec.status).toBe('Phase 0 inspection');
  });
});

describe('Project Registry — harvest-before-build gate (core)', () => {
  it('registering directly into "In build" without harvest approval ⇒ rejected', () => {
    const r = registry.validate({ ...validProject(), status: 'In build', harvestApprovalStatus: 'not-started' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join('\n')).toMatch(/harvest-before-build/i);
  });
  it('"In build" with harvest approved ⇒ allowed', () => {
    expect(registry.validate({ ...validProject(), status: 'In build', harvestApprovalStatus: 'approved' }).ok).toBe(true);
  });
  it('gateView reports clearedToBuild only when harvest is approved', () => {
    const base: ProjectRecord = {
      registeredAtIso: 'x', project: 'p', repo: 'r', domain: 'identity-trust', purpose: 'x', owner: 'ECE', stack: 'TS', deployment: 'on-prem',
      status: 'Harvest pending', maturity: null, openRisks: [], lastReviewDecision: null, nextGate: null, harvestApprovalStatus: 'pending',
    };
    expect(gateView(base).clearedToBuild).toBe(false);
    expect(gateView({ ...base, harvestApprovalStatus: 'approved' }).clearedToBuild).toBe(true);
  });
});
