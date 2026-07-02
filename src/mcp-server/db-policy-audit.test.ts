import { describe, it, expect, afterAll } from 'vitest';
import pkg from 'pg';
const { Pool } = pkg;
import { PostgresPolicyAudit, type PolicyAuditEvent } from './policy-console-wiring.js';
import { PostgresHashChainSink } from '../features/audit-engine/postgres-sink.js';
import { RedactionEngine } from '../features/redaction-engine/redaction-engine.js';

// Wave 6 Piece 2 — policy evaluations + override reasons are durably audited in the real append-only,
// hash-chained store, operator-attributed. No mocks on the audit path.

const cfg = { host: process.env.PGHOST ?? '127.0.0.1', port: Number(process.env.PGPORT ?? 55432), database: process.env.PGDATABASE ?? 'ece_audit_test' };
const appPool = new Pool({ ...cfg, user: 'ece_app' });
afterAll(async () => { await appPool.end(); });
const kinds = (rows: { kind: string }[], k: string) => rows.filter((r) => r.kind === k).length;

describe('Policy audit → Postgres (append-only, hash-chained, operator-attributed)', () => {
  it('evaluated / hard-withheld / soft-override are persisted as chained entries; the chain verifies', async () => {
    const ORG = `orgPOL-${Date.now()}`;
    const sink = new PostgresHashChainSink(appPool, new RedactionEngine(['policyEvent', 'actionId', 'tool', 'operator', 'recommendation', 'policyBlocked', 'reason']));
    const audit = new PostgresPolicyAudit(sink, ORG, 'local');
    const evs: PolicyAuditEvent[] = [
      { type: 'evaluated', actionId: 'a1', tool: 'create_github_repo', operator: 'human_boss', policyVersion: 1, recommendation: 'RECOMMEND-REFUSE', policyBlocked: true, hardViolations: ['safety.no-public-repo'], reason: 'x', atIso: '2026-07-02T00:00:00Z' },
      { type: 'policy-blocked-withheld', actionId: 'a1', tool: 'create_github_repo', operator: 'human_boss', policyVersion: 1, recommendation: 'RECOMMEND-REFUSE', policyBlocked: true, hardViolations: ['safety.no-public-repo'], reason: 'x', atIso: '2026-07-02T00:01:00Z' },
      { type: 'soft-override-approved', actionId: 'a2', tool: 'create_ticket', operator: 'human_boss', policyVersion: 1, recommendation: 'REQUIRES-DUAL-APPROVAL', policyBlocked: false, hardViolations: [], reason: 'small blast — approving', atIso: '2026-07-02T00:02:00Z' },
    ];
    for (const e of evs) await audit.append(e);
    const entries = await sink.readEntries(ORG);
    expect(kinds(entries, 'read')).toBe(3);
    expect((await sink.verifyChain(ORG)).ok).toBe(true);
  });
});
