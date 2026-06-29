import { describe, it, expect, afterAll } from 'vitest';
import pkg from 'pg';
const { Pool } = pkg;
import { PostgresHashChainSink } from './postgres-sink.js';
import { WriteAheadSequencer, AllowAllAuthorizer, type Authorizer, type AuthorizationDecision } from './sequencer.js';
import { AuditViewer } from './read-audit.js';

// Refusal-audit path. NO mocks: real PostgreSQL. Proves denied attempts are auditable,
// chained, per-org scoped, and structurally DISTINCT from orphans.

const cfg = {
  host: process.env.PGHOST ?? '127.0.0.1',
  port: Number(process.env.PGPORT ?? 55432),
  database: process.env.PGDATABASE ?? 'ece_audit_test',
};
const pool = new Pool({ ...cfg, user: 'ece_app' });
const sink = new PostgresHashChainSink(pool);

class DenyAuthorizer implements Authorizer {
  async authorize(): Promise<AuthorizationDecision> {
    return { decision: 'REFUSE', reason: 'denied for test' };
  }
}
const allowSeq = new WriteAheadSequencer(sink, new AllowAllAuthorizer());
const denySeq = new WriteAheadSequencer(sink, new DenyAuthorizer());
const denyViewer = new AuditViewer(sink, new DenyAuthorizer());

function actionReq(org: string) {
  return {
    principal: { user_id: `human_${org}`, email: `${org}@ece.ae`, role: 'admin' },
    organization_id: org, session: { session_id: `s_${org}` },
    tool: { name: 'search_clients' }, environment: 'local' as const, via: 'claude',
  };
}
function readReq(org: string) {
  return {
    principal: { user_id: `human_${org}`, email: `${org}@ece.ae`, role: 'auditor' },
    organization_id: org, session: { session_id: `s_${org}` }, environment: 'local' as const,
  };
}
const kinds = (rows: { kind: string }[], k: string) => rows.filter((r) => r.kind === k).length;

afterAll(async () => {
  await pool.end();
});

describe('Refusal-audit path', () => {
  it('a refused ACTION writes exactly one chained refusal record and NO intent', async () => {
    let executed = false;
    const out = await denySeq.run(actionReq('orgR1'), async () => {
      executed = true;
      return { value: 1, outcome: { status: 'success' as const } };
    });
    expect(out.status).toBe('refused');
    expect(executed).toBe(false);

    const rows = await sink.readEntries('orgR1');
    expect(kinds(rows, 'refusal')).toBe(1);
    expect(kinds(rows, 'intent')).toBe(0); // no intent ⇒ cannot be an orphan
    const v = await sink.verifyChain('orgR1');
    expect(v.ok).toBe(true); // the refusal entry is chained
  });

  it('a refused READ writes exactly one chained refusal record and no read entry', async () => {
    const out = await denyViewer.read(readReq('orgR2'));
    expect(out.status).toBe('refused');
    const rows = await sink.readEntries('orgR2');
    expect(kinds(rows, 'refusal')).toBe(1);
    expect(kinds(rows, 'read')).toBe(0); // refused read logged no read entry, only a refusal
  });

  it('refusals are chained alongside real entries and are per-org scoped', async () => {
    await allowSeq.run(actionReq('orgR3'), async () => ({ value: 1, outcome: { status: 'success' as const } }));
    await denySeq.run(actionReq('orgR3'), async () => ({ value: 1, outcome: { status: 'success' as const } }));
    const v = await sink.verifyChain('orgR3'); // intent + result + refusal all chained
    expect(v.ok).toBe(true);

    const rows = await sink.readEntries('orgR3');
    expect(rows.every((r) => r.organization_id === 'orgR3')).toBe(true);
    expect(kinds(rows, 'refusal')).toBe(1);

    // A different org never sees orgR3's refusal (RLS).
    const other = await sink.readEntries('orgR3_other');
    expect(other.length).toBe(0);
  });

  it('orphan detection distinguishes a true orphan from a refusal', async () => {
    // A refusal (denied) — must NOT be an orphan.
    await denySeq.run(actionReq('orgR4'), async () => ({ value: 1, outcome: { status: 'success' as const } }));
    // A true crash — intent committed, no result — MUST be an orphan.
    const crashed = await sink.appendIntent({
      organization_id: 'orgR4',
      human_actor: { user_id: 'human_orgR4', email: 'orgR4@ece.ae', role: 'admin' },
      session: { session_id: 'crash' }, tool: { name: 'search_clients' },
      authz: { decision: 'ALLOW' }, environment: 'local',
    });

    const orphans = await denySeq.reconcileOrphans('orgR4', { olderThanSeconds: 0 });
    const ids = orphans.map((o) => o.intent_id);
    expect(ids).toContain(crashed.intent_id); // the real crash is flagged
    expect(orphans.length).toBe(1); // ...and ONLY the crash — the refusal is not counted

    const rows = await sink.readEntries('orgR4');
    expect(kinds(rows, 'refusal')).toBe(1); // the refusal exists, just not as an orphan
  });
});
