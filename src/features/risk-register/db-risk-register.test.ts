import { describe, it, expect, afterAll } from 'vitest';
import pkg from 'pg';
const { Pool } = pkg;
import { RiskRegister, RiskValidationError, surfaceBlockingRisks, type RiskInput } from './risk-register.js';
import { PostgresRiskRegisterStore } from './postgres-risk-store.js';

// Risk Register persistence — NO mocks: real PostgreSQL. Register/retrieve, append-only history,
// the surfacer over a real list, UPDATE denied.

const cfg = {
  host: process.env.PGHOST ?? '127.0.0.1',
  port: Number(process.env.PGPORT ?? 55432),
  database: process.env.PGDATABASE ?? 'ece_audit_test',
};
const pool = new Pool({ ...cfg, user: 'ece_app' });
const store = new PostgresRiskRegisterStore(pool);
const registry = new RiskRegister();

function risk(key: string, over: Partial<RiskInput> = {}): RiskInput {
  return { key, title: 't', type: 'license', owner: 'ECE', severity: 'high', status: 'open', ...over };
}

afterAll(async () => { await pool.end(); });

describe('Risk Register — persistence (real PostgreSQL)', () => {
  it('a valid risk registers and is retrievable', async () => {
    const key = `RISK-${Date.now()}-A`;
    const saved = await registry.register(store, risk(key));
    expect(saved.recordId).toBeTruthy();
    const got = await store.getLatest(key);
    expect(got!.type).toBe('license');
    expect(got!.severity).toBe('high');
  });

  it('a risk missing a required field ⇒ rejected, not stored', async () => {
    const key = `RISK-${Date.now()}-B`;
    await expect(registry.register(store, risk(key, { owner: '' }))).rejects.toThrow(RiskValidationError);
    expect(await store.getLatest(key)).toBeNull();
  });

  it('status transitions are append-only — history preserved', async () => {
    const key = `RISK-${Date.now()}-C`;
    await registry.register(store, risk(key, { severity: 'critical' }));
    await registry.transitionStatus(store, key, 'mitigating', 'patching the dependency');
    await registry.transitionStatus(store, key, 'closed');
    expect((await store.getLatest(key))!.status).toBe('closed');
    expect((await store.history(key)).map((h) => h.status)).toEqual(['open', 'mitigating', 'closed']);
  });

  it('an unmitigated critical OPEN risk is surfaced as blocking from the live list', async () => {
    const t = Date.now();
    await registry.register(store, risk(`RISK-${t}-crit`, { severity: 'critical', status: 'open' }));
    await registry.register(store, risk(`RISK-${t}-low`, { severity: 'low', status: 'open' }));
    const blocking = surfaceBlockingRisks(await store.list());
    expect(blocking.some((r) => r.key === `RISK-${t}-crit`)).toBe(true);
    expect(blocking.some((r) => r.key === `RISK-${t}-low`)).toBe(false);
  });

  it('append-only: UPDATE on the register is denied at the DB layer', async () => {
    await expect(pool.query(`UPDATE risk_register SET status='closed' WHERE severity='critical'`)).rejects.toThrow(/permission denied/i);
  });
});
