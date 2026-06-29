import { describe, it, expect, afterAll } from 'vitest';
import pkg from 'pg';
const { Pool } = pkg;
import { PostgresHashChainSink } from './postgres-sink.js';
import { AuditViewer } from './read-audit.js';
import { AllowAllAuthorizer, type Authorizer, type AuthorizationDecision } from './sequencer.js';
import { RedactionEngine } from '../redaction-engine/redaction-engine.js';

// T7 — audit-of-reads + permissioned viewer. NO mocks: real PostgreSQL.
// Proves: every read writes a chained audit_read_log entry; reads are per-org scoped;
// an unpermitted read is refused, reads nothing, and (Phase 3.4) logs nothing
// (refusal-audit is the locked Phase 3.5 path).

const cfg = {
  host: process.env.PGHOST ?? '127.0.0.1',
  port: Number(process.env.PGPORT ?? 55432),
  database: process.env.PGDATABASE ?? 'ece_audit_test',
};
const pool = new Pool({ ...cfg, user: 'ece_app' });
const sink = new PostgresHashChainSink(pool, new RedactionEngine());
const viewer = new AuditViewer(sink, new AllowAllAuthorizer());

class DenyAuthorizer implements Authorizer {
  async authorize(): Promise<AuthorizationDecision> {
    return { decision: 'REFUSE', reason: 'test deny' };
  }
}
const denyViewer = new AuditViewer(sink, new DenyAuthorizer());

function readReq(org: string) {
  return {
    principal: { user_id: `human_${org}`, email: `${org}@ece.ae`, role: 'auditor' },
    organization_id: org,
    session: { session_id: `sess_${org}` },
    environment: 'local' as const,
    query_range: { all: true },
  };
}

afterAll(async () => {
  await pool.end();
});

describe('T7 — audit-of-reads (the watchers are watched)', () => {
  it('a read writes a chained read-log entry, and that entry is visible to a later read', async () => {
    const out1 = await viewer.read(readReq('orgT7'));
    expect(out1.status).toBe('ok');
    if (out1.status !== 'ok') return;
    expect(out1.read_log.entry_hash).toMatch(/^[0-9a-f]{64}$/);

    // The read entry is part of the chain.
    const v = await sink.verifyChain('orgT7');
    expect(v.ok).toBe(true);

    // A subsequent read now sees the prior read recorded (a 'read' kind entry).
    const out2 = await viewer.read(readReq('orgT7'));
    expect(out2.status).toBe('ok');
    if (out2.status !== 'ok') return;
    expect(out2.rows.some((r) => r.kind === 'read')).toBe(true);
  });

  it('reads are per-org scoped: an orgA viewer never sees orgB rows, and vice versa', async () => {
    const a = await viewer.read(readReq('orgA'));
    const b = await viewer.read(readReq('orgB'));
    expect(a.status).toBe('ok');
    expect(b.status).toBe('ok');
    if (a.status !== 'ok' || b.status !== 'ok') return;

    expect(a.rows.length).toBeGreaterThan(0);
    expect(a.rows.every((r) => r.organization_id === 'orgA')).toBe(true);
    expect(a.rows.some((r) => r.organization_id === 'orgB')).toBe(false);

    expect(b.rows.every((r) => r.organization_id === 'orgB')).toBe(true);
    expect(b.rows.some((r) => r.organization_id === 'orgA')).toBe(false);
  });

  it('an unpermitted read is refused, returns nothing, and is recorded as a refusal (Phase 3.5)', async () => {
    const before = await sink.readEntries('orgT7deny');
    expect(before.length).toBe(0);

    const out = await denyViewer.read(readReq('orgT7deny'));
    expect(out.status).toBe('refused');
    if (out.status === 'refused') expect(out.stage).toBe('authorize');
    expect(out).not.toHaveProperty('rows');

    // Phase 3.5: the denied attempt IS now audited (one refusal entry) — but nothing was read.
    const after = await sink.readEntries('orgT7deny');
    expect(after.filter((r) => r.kind === 'refusal').length).toBe(1);
    expect(after.filter((r) => r.kind === 'read').length).toBe(0);
  });
});
