import { describe, it, expect, afterAll } from 'vitest';
import pkg from 'pg';
const { Pool } = pkg;
import { DomainRegistry, DomainValidationError, type DomainInput } from './domain-registry.js';
import { PostgresDomainRegistryStore } from './postgres-domain-store.js';

// Domain Registry persistence — NO mocks: real PostgreSQL. Register/retrieve, append-only history, UPDATE denied.

const cfg = {
  host: process.env.PGHOST ?? '127.0.0.1',
  port: Number(process.env.PGPORT ?? 55432),
  database: process.env.PGDATABASE ?? 'ece_audit_test',
};
const pool = new Pool({ ...cfg, user: 'ece_app' });
const store = new PostgresDomainRegistryStore(pool);
const registry = new DomainRegistry();

function validDomain(name: string): DomainInput {
  return { name, businessObjective: 'obj', sovereignty: 'sovereign', airGap: 'required', arabicFirst: 'required', owner: 'ECE', riskLevel: 'high', subDomains: ['a'] };
}

afterAll(async () => { await pool.end(); });

describe('Domain Registry — persistence (real PostgreSQL)', () => {
  it('a valid domain registers and is retrievable', async () => {
    const saved = await registry.register(store, validDomain('identity-trust'));
    expect(saved.recordId).toBeTruthy();
    expect(saved.status).toBe('registered');
    const got = await store.getLatest('identity-trust');
    expect(got!.businessObjective).toBe('obj');
    expect(got!.sovereignty).toBe('sovereign');
    expect(got!.subDomains).toEqual(['a']);
  });

  it('a domain missing a required field ⇒ rejected, not stored', async () => {
    const bad = { ...validDomain('money-rails'), businessObjective: '' };
    await expect(registry.register(store, bad)).rejects.toThrow(DomainValidationError);
    expect(await store.getLatest('money-rails')).toBeNull(); // nothing persisted
  });

  it('status transitions are recorded append-only — history preserved, not overwritten', async () => {
    const name = `security-ops-${Date.now()}`; // unique per run ⇒ history isolation even on a shared DB
    await registry.register(store, validDomain(name));
    await registry.transitionStatus(store, name, 'harvesting');
    await registry.transitionStatus(store, name, 'in-build');

    const latest = await store.getLatest(name);
    expect(latest!.status).toBe('in-build');

    const history = await store.history(name);
    expect(history.map((h) => h.status)).toEqual(['registered', 'harvesting', 'in-build']); // full trail preserved
  });

  it('append-only: an attempt to mutate registered history is denied at the DB layer', async () => {
    await expect(pool.query(`UPDATE domain_registration SET status='deprecated' WHERE name='identity-trust'`)).rejects.toThrow(/permission denied/i);
  });
});
