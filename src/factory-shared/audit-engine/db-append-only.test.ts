import { describe, it, expect } from 'vitest';
import pkg from 'pg';
const { Client } = pkg;

// T5 — append-only enforced at the DB layer (privilege + trigger). NO mocks: runs
// against a real PostgreSQL prepared by the phase orchestration (migration + seed).
// Connection comes from PG* env vars set by the runner.

const cfg = {
  host: process.env.PGHOST ?? '127.0.0.1',
  port: Number(process.env.PGPORT ?? 55432),
  database: process.env.PGDATABASE ?? 'ece_audit_test',
};
const asApp = () => new Client({ ...cfg, user: 'ece_app' });
const asSuper = () => new Client({ ...cfg, user: 'postgres' });

describe('T5 — append-only enforced at the DB layer', () => {
  it('app role is DENIED update/delete/truncate (privilege layer)', async () => {
    const c = asApp();
    await c.connect();
    try {
      await c.query(`SET app.current_org = 'orgA'`);
      await expect(c.query(`UPDATE audit_intent SET status='intent' WHERE seq=1`)).rejects.toThrow(/permission denied/i);
      await expect(c.query(`DELETE FROM audit_intent WHERE seq=1`)).rejects.toThrow(/permission denied/i);
      await expect(c.query(`TRUNCATE audit_intent`)).rejects.toThrow(/permission denied/i);
    } finally {
      await c.end();
    }
  });

  it('guard trigger blocks update/delete/truncate even for a privileged role (defense-in-depth)', async () => {
    const c = asSuper(); // superuser HAS the privilege, but the trigger still fires
    await c.connect();
    try {
      await expect(c.query(`UPDATE audit_intent SET status='intent' WHERE seq=1`)).rejects.toThrow(/append-only/i);
      await expect(c.query(`DELETE FROM audit_intent WHERE seq=1`)).rejects.toThrow(/append-only/i);
      // TRUNCATE on audit_read_log (no inbound FK) proves the BEFORE TRUNCATE trigger fires.
      // (TRUNCATE on audit_intent is ALSO blocked — by the audit_result FK — additional defense.)
      await expect(c.query(`TRUNCATE audit_read_log`)).rejects.toThrow(/append-only/i);
      await expect(c.query(`TRUNCATE audit_intent`)).rejects.toThrow(/append-only|cannot truncate a table referenced/i);
    } finally {
      await c.end();
    }
  });

  it('insert still works for the app role (append is allowed)', async () => {
    const c = asApp();
    await c.connect();
    try {
      await c.query(`SET app.current_org = 'orgA'`);
      const r = await c.query(
        `INSERT INTO audit_intent (seq, organization_id, human_actor, session, tool, authz, environment, status)
         VALUES (99,'orgA','{"user_id":"u9","email":"u9@ece.ae","role":"admin"}','{"session_id":"s9"}','{"name":"search_clients"}','{"decision":"ALLOW"}','local','intent')
         RETURNING intent_id`,
      );
      expect(r.rowCount).toBe(1);
    } finally {
      await c.end();
    }
  });
});
