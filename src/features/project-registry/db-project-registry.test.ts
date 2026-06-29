import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pkg from 'pg';
const { Pool } = pkg;
import { ProjectRegistry, ProjectValidationError, gateView, type ProjectInput, type DomainLookup } from './project-registry.js';
import { PostgresProjectRegistryStore } from './postgres-project-store.js';
import { DomainRegistry, domainSummary, type DomainInput } from '../domain-registry/domain-registry.js';
import { PostgresDomainRegistryStore } from '../domain-registry/postgres-domain-store.js';

// Project Registry persistence — NO mocks: real PostgreSQL, with the real Domain Registry providing the lookup.

const cfg = {
  host: process.env.PGHOST ?? '127.0.0.1',
  port: Number(process.env.PGPORT ?? 55432),
  database: process.env.PGDATABASE ?? 'ece_audit_test',
};
const pool = new Pool({ ...cfg, user: 'ece_app' });
const projects = new PostgresProjectRegistryStore(pool);
const domains = new PostgresDomainRegistryStore(pool);
const projectReg = new ProjectRegistry();
const domainReg = new DomainRegistry();

const lookup: DomainLookup = async (name) => {
  const d = await domains.getLatest(name);
  return d ? domainSummary(d) : null;
};
function domainInput(name: string): DomainInput {
  return { name, businessObjective: 'obj', sovereignty: 'sovereign', airGap: 'required', arabicFirst: 'required', owner: 'ECE', riskLevel: 'high' };
}
function projectInput(name: string, domain: string): ProjectInput {
  return { project: name, repo: name, domain, purpose: 'p', owner: 'ECE', stack: 'TS', deployment: 'on-prem', harvestApprovalStatus: 'not-started' };
}

beforeAll(async () => {
  await domainReg.register(domains, domainInput('identity-trust'));
});
afterAll(async () => { await pool.end(); });

describe('Project Registry — persistence (real PostgreSQL)', () => {
  it('a project referencing a registered domain registers and is retrievable', async () => {
    const saved = await projectReg.register(projects, lookup, projectInput('ece-identity', 'identity-trust'));
    expect(saved.recordId).toBeTruthy();
    expect(saved.status).toBe('Phase 0 inspection');
    const got = await projects.getLatest('ece-identity');
    expect(got!.domain).toBe('identity-trust');
  });

  it('a project referencing an UNREGISTERED domain ⇒ rejected, not stored', async () => {
    await expect(projectReg.register(projects, lookup, projectInput('ghost-proj', 'no-such-domain'))).rejects.toThrow(ProjectValidationError);
    expect(await projects.getLatest('ghost-proj')).toBeNull();
  });

  it('the gate blocks "In build" without harvest approval, then allows it once approved (append-only trail)', async () => {
    const name = `gated-${Date.now()}`;
    await projectReg.register(projects, lookup, { ...projectInput(name, 'identity-trust'), status: 'Harvest pending' });

    // Blocked: no harvest approval yet.
    expect(gateView((await projects.getLatest(name))!).clearedToBuild).toBe(false);
    await expect(projectReg.transitionStatus(projects, name, 'In build')).rejects.toThrow(/harvest-before-build|approved Harvest Report/i);

    // Approve harvest, then build is allowed.
    await projectReg.setHarvestApproval(projects, name, 'approved');
    expect(gateView((await projects.getLatest(name))!).clearedToBuild).toBe(true);
    const built = await projectReg.transitionStatus(projects, name, 'In build');
    expect(built.status).toBe('In build');

    const history = await projects.history(name);
    expect(history.map((h) => h.status)).toEqual(['Harvest pending', 'Harvest approved', 'In build']); // full append-only trail
  });

  it('append-only: UPDATE on the registry is denied at the DB layer', async () => {
    await expect(pool.query(`UPDATE project_registration SET status='Live' WHERE project='ece-identity'`)).rejects.toThrow(/permission denied/i);
  });
});
