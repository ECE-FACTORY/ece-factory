import { describe, it, expect } from 'vitest';
import pkg from 'pg';
const { Client } = pkg;

// T8 — per-org RLS isolation. NO mocks: real PostgreSQL, real FORCE ROW LEVEL SECURITY.
// Seeded by the orchestration: orgA has 1 intent row, orgB has 1 intent row.

const cfg = {
  host: process.env.PGHOST ?? '127.0.0.1',
  port: Number(process.env.PGPORT ?? 55432),
  database: process.env.PGDATABASE ?? 'ece_audit_test',
};
const asApp = () => new Client({ ...cfg, user: 'ece_app' });

async function countAs(org: string | null): Promise<{ total: number; orgs: string[] }> {
  const c = asApp();
  await c.connect();
  try {
    if (org === null) {
      await c.query(`RESET app.current_org`);
    } else {
      await c.query(`SET app.current_org = '${org}'`);
    }
    const r = await c.query<{ organization_id: string }>(`SELECT organization_id FROM audit_intent`);
    return { total: r.rowCount ?? 0, orgs: [...new Set(r.rows.map((x) => x.organization_id))] };
  } finally {
    await c.end();
  }
}

describe('T8 — per-org RLS isolation', () => {
  it('orgA principal sees ONLY orgA rows, never orgB', async () => {
    const a = await countAs('orgA');
    expect(a.total).toBeGreaterThanOrEqual(1);
    expect(a.orgs).toEqual(['orgA']);
    expect(a.orgs).not.toContain('orgB');
  });

  it('orgB principal sees ONLY orgB rows, never orgA', async () => {
    const b = await countAs('orgB');
    expect(b.total).toBeGreaterThanOrEqual(1);
    expect(b.orgs).toEqual(['orgB']);
    expect(b.orgs).not.toContain('orgA');
  });

  it('with no org context set, the principal sees nothing (safe default)', async () => {
    const none = await countAs(null);
    expect(none.total).toBe(0);
  });
});
