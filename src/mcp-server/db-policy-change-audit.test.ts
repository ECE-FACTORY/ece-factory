import { describe, it, expect, afterAll } from 'vitest';
import pkg from 'pg';
const { Pool } = pkg;
import { PostgresPolicyChangeAudit, type PolicyChangeAuditEvent } from './policy-change-wiring.js';
import { PostgresHashChainSink } from '../features/audit-engine/postgres-sink.js';
import { RedactionEngine } from '../features/redaction-engine/redaction-engine.js';

// Wave 6 Piece 3 — policy version transitions are durably audited in the real append-only, hash-chained store,
// operator-attributed (never 'claude'). No mocks on the audit path.

const cfg = { host: process.env.PGHOST ?? '127.0.0.1', port: Number(process.env.PGPORT ?? 55432), database: process.env.PGDATABASE ?? 'ece_audit_test' };
const appPool = new Pool({ ...cfg, user: 'ece_app' });
afterAll(async () => { await appPool.end(); });
const kinds = (rows: { kind: string }[], k: string) => rows.filter((r) => r.kind === k).length;

describe('Policy-change audit → Postgres (append-only, hash-chained, operator-attributed)', () => {
  it('version-proposed + version-activated persist as chained entries; the chain verifies', async () => {
    const ORG = `orgPCH-${Date.now()}`;
    const sink = new PostgresHashChainSink(appPool, new RedactionEngine(['policyChangeEvent', 'candidateVersion', 'fromVersion', 'approvedBy', 'ruleCount']));
    const audit = new PostgresPolicyChangeAudit(sink, ORG, 'local');
    const evs: PolicyChangeAuditEvent[] = [
      { type: 'version-proposed', candidateVersion: 2, ruleCount: 0, atIso: '2026-07-02T00:00:00Z' },
      { type: 'version-activated', candidateVersion: 2, fromVersion: 1, approvedBy: 'human_boss', ruleCount: 0, atIso: '2026-07-02T00:01:00Z' },
    ];
    for (const e of evs) await audit.append(e);
    const entries = await sink.readEntries(ORG);
    expect(kinds(entries, 'read')).toBe(2);
    expect((await sink.verifyChain(ORG)).ok).toBe(true);
  });
});
