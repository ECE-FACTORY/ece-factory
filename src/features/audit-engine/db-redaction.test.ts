import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pkg from 'pg';
const { Pool, Client } = pkg;
import { PostgresHashChainSink } from './postgres-sink.js';
import { RedactionEngine } from '../redaction-engine/redaction-engine.js';

// T9 — redaction-before-write, now flowing through the REAL deny-by-default Redaction Engine.
// NO mocks: real PostgreSQL. Writes an intent whose request_summary carries sensitive fields,
// then inspects the PERSISTED row and proves they never reached the store in the clear.
// Allowlist permits only the non-sensitive fields; sensitive keys are dropped by deny-by-default.

const cfg = {
  host: process.env.PGHOST ?? '127.0.0.1',
  port: Number(process.env.PGPORT ?? 55432),
  database: process.env.PGDATABASE ?? 'ece_audit_test',
};
const ORG = 'orgT9';
const pool = new Pool({ ...cfg, user: 'ece_app' });
// Allowlist only the non-sensitive fields this test expects to survive (incl. the nested branch).
const sink = new PostgresHashChainSink(pool, new RedactionEngine(['query', 'keep_top', 'nested', 'keep']));

let stored: Record<string, unknown> = {};

beforeAll(async () => {
  await sink.appendIntent({
    organization_id: ORG,
    human_actor: { user_id: 'u9', email: 'u9@ece.ae', role: 'admin' },
    session: { session_id: 's9' },
    tool: { name: 'search_clients' },
    authz: { decision: 'ALLOW' },
    environment: 'local',
    request_summary: {
      query: 'acme corp',
      password: 'p@ssw0rd',
      api_key: 'sk-secret-123',
      national_id: '784-1990-1234567-1',
      nested: { token: 'tok-xyz', keep: 'visible' },
      keep_top: 'ok',
    },
  });

  // Inspect the persisted row directly (superuser bypasses RLS).
  const su = new Client({ ...cfg, user: 'postgres' });
  await su.connect();
  try {
    const r = await su.query<{ request_summary: Record<string, unknown> }>(
      `SELECT request_summary FROM audit_intent WHERE organization_id=$1 AND seq=1`, [ORG],
    );
    stored = r.rows[0]!.request_summary;
  } finally {
    await su.end();
  }
});

afterAll(async () => {
  await pool.end();
});

describe('T9 — redaction-before-write', () => {
  it('sensitive top-level fields are NOT persisted', () => {
    expect(stored).not.toHaveProperty('password');
    expect(stored).not.toHaveProperty('api_key');
    expect(stored).not.toHaveProperty('national_id');
  });

  it('sensitive nested fields are NOT persisted, but non-sensitive ones survive', () => {
    expect(stored).toHaveProperty('query', 'acme corp');
    expect(stored).toHaveProperty('keep_top', 'ok');
    const nested = stored.nested as Record<string, unknown>;
    expect(nested).not.toHaveProperty('token');
    expect(nested).toHaveProperty('keep', 'visible');
  });

  it('the redacted entry still verifies (hash computed over redacted content)', async () => {
    const v = await sink.verifyChain(ORG);
    expect(v.ok).toBe(true);
  });
});
