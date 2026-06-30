import { describe, it, expect, afterAll } from 'vitest';
import pkg from 'pg';
const { Pool } = pkg;
import { buildServer, handleRpc, type ServerEnv } from './server.js';
import { makeDbProbe, CORE_TABLES, type TierStatusReport } from './tier-status.js';

// Tier-Status — real PostgreSQL. The read-only probe reports reachability + core-table (migration) count +
// role names honestly; the real server wiring reports read/internal-write LIVE and draft/external FAKE; the
// health check performs NO writes.

const cfg = { host: process.env.PGHOST ?? '127.0.0.1', port: Number(process.env.PGPORT ?? 55432), database: process.env.PGDATABASE ?? 'ece_audit_test' };
const raw = new Pool({ ...cfg, user: 'postgres' }); // for before/after side-effect checks
afterAll(async () => { await raw.end(); });

function serverEnv(): ServerEnv {
  return {
    pgHost: cfg.host, pgPort: cfg.port, pgDatabase: cfg.database, pgUser: 'ece_app', pgWriteUser: 'ece_writer',
    principal: { user_id: 'op_real', email: 'op@ece.ae', role: 'operator' },
    organizationId: 'orgHEALTH', environment: 'local', repoRoot: process.cwd(),
  };
}
const countRows = async (table: string) => (await raw.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n as number;

describe('Tier-Status — the read-only DB probe reports reachability + migration/table count honestly', () => {
  it('makeDbProbe ⇒ reachable true and all core tables present (no writes)', async () => {
    const probePool = new Pool({ ...cfg, user: 'ece_app' });
    try {
      const before = await countRows('audit_intent');
      const probe = makeDbProbe(probePool);
      const r = await probe();
      expect(r.reachable).toBe(true);
      expect(r.coreTablesPresent).toBe(CORE_TABLES.length); // all 12 migration-created core tables exist
      expect(await countRows('audit_intent')).toBe(before); // the probe wrote nothing
    } finally { await probePool.end(); }
  });
});

describe('Tier-Status — the real server wiring reports LIVE reads/writes, FAKE draft/external (real PostgreSQL)', () => {
  it('buildServer().tierStatus() ⇒ read_only live, internal_write live, draft fake, external fake, db reachable, roles named', async () => {
    const { pool, writePool, tierStatus } = buildServer(serverEnv());
    try {
      const report = await tierStatus();
      expect(report.tiers.read_only).toBe('live');
      expect(report.tiers.internal_write).toBe('live');
      expect(report.tiers.draft_only).toBe('fake');
      expect(report.tiers.external).toBe('fake');
      expect(report.tiers.forbidden).toBe('registered-and-refused');
      expect(report.database.reachable).toBe(true);
      expect(report.database.coreTablesPresent).toBe(CORE_TABLES.length);
      expect(report.dbRoles).toEqual({ read: 'ece_app', write: 'ece_writer' });
      expect(report.toolCounts).toMatchObject({ read_only: 16, draft_only: 7, internal_write: 6, external: 6, forbidden: 6 });
      // NO secrets
      expect(JSON.stringify(report)).not.toMatch(/postgres:\/\/|password|secret|PGPASSWORD/i);
    } finally { await pool.end(); await writePool.end(); }
  });

  it('the `health` JSON-RPC method returns the tier-status report and writes nothing', async () => {
    const auditBefore = await countRows('audit_intent');
    const clientsBefore = await countRows('clients');
    const { core, ctx, pool, writePool, tierStatus } = buildServer(serverEnv());
    try {
      const resp = await handleRpc(core, ctx, { jsonrpc: '2.0', id: 1, method: 'health' }, tierStatus) as { result: TierStatusReport };
      expect(resp.result.tiers.external).toBe('fake');
      expect(resp.result.tiers.read_only).toBe('live');
      // observational — no audit intent, no system-of-record write produced by the health call
      expect(await countRows('audit_intent')).toBe(auditBefore);
      expect(await countRows('clients')).toBe(clientsBefore);
    } finally { await pool.end(); await writePool.end(); }
  });
});
