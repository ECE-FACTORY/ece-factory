import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pkg from 'pg';
const { Pool, Client } = pkg;
import { RedactionEngine } from './redaction-engine.js';
import { PostgresHashChainSink } from '../audit-engine/postgres-sink.js';
import type { RedactionPolicy } from '../audit-engine/sink.js';

// Module 24 Redaction Engine — deny-by-default, allowlist-based. Pure-logic unit checks plus
// persistence proof against real PostgreSQL (no mocks). Proves an UNKNOWN field (not a known
// sensitive name) is stripped — i.e. redaction is allowlist-based, not blocklist-based.

// Structural seam assertion (validated by `npm run typecheck`): RedactionEngine satisfies the
// audit sink's RedactionPolicy port WITHOUT the engine importing anything from the audit engine.
const _seam: RedactionPolicy = new RedactionEngine([]);
void _seam;

describe('Redaction Engine — deny-by-default (pure logic)', () => {
  it('drops an UNKNOWN field that is not on the allowlist (not a known-sensitive name)', () => {
    const eng = new RedactionEngine(['query', 'nested', 'keep']);
    const out = eng.redactSummary({
      query: 'x',
      totally_unknown_field: 'should-be-dropped',
      whatever123: 'also-dropped',
      nested: { keep: 'kept', token: 'dropped' },
    });
    expect(out).toEqual({ query: 'x', nested: { keep: 'kept' } });
  });

  it('allowlisted fields survive; everything else is denied', () => {
    const eng = new RedactionEngine(['a', 'b']);
    expect(eng.redactSummary({ a: 1, b: 2, c: 3 })).toEqual({ a: 1, b: 2 });
  });

  it('undefined summary stays undefined', () => {
    expect(new RedactionEngine(['a']).redactSummary(undefined)).toBeUndefined();
  });
});

const cfg = {
  host: process.env.PGHOST ?? '127.0.0.1',
  port: Number(process.env.PGPORT ?? 55432),
  database: process.env.PGDATABASE ?? 'ece_audit_test',
};
const ORG = 'orgRE';
const pool = new Pool({ ...cfg, user: 'ece_app' });
// Only 'query' is allowlisted — everything else must be denied by default.
const sink = new PostgresHashChainSink(pool, new RedactionEngine(['query']));
let stored: Record<string, unknown> = {};

beforeAll(async () => {
  await sink.appendIntent({
    organization_id: ORG,
    human_actor: { user_id: 'humanRE', email: 're@ece.ae', role: 'admin' },
    session: { session_id: 'sRE' },
    tool: { name: 'search_clients' },
    authz: { decision: 'ALLOW' },
    environment: 'local',
    request_summary: {
      query: 'acme corp',
      totally_unknown_field: 'LEAK',
      password: 'p@ss',
      national_id: '784-1990',
    },
  });
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

describe('Redaction Engine — persisted via real PostgreSQL', () => {
  it('deny-by-default: an unknown field never persists', () => {
    expect(stored).not.toHaveProperty('totally_unknown_field');
  });
  it('sensitive fields never persist', () => {
    expect(stored).not.toHaveProperty('password');
    expect(stored).not.toHaveProperty('national_id');
  });
  it('allowlisted field survives intact', () => {
    expect(stored).toEqual({ query: 'acme corp' });
  });
  it('the redacted entry still verifies (redaction before hashing)', async () => {
    const v = await sink.verifyChain(ORG);
    expect(v.ok).toBe(true);
  });
});
