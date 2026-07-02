import { describe, it, expect, afterAll } from 'vitest';
import pkg from 'pg';
const { Pool } = pkg;
import { PostgresConsoleAudit } from './decision-console-wiring.js';
import { PostgresHashChainSink } from '../features/audit-engine/postgres-sink.js';
import { RedactionEngine } from '../features/redaction-engine/redaction-engine.js';
import type { ConsoleAuditEvent } from '../features/decision-console/decision-console.js';

// Wave 6 Piece 1b — Console audit is durably recorded in the REAL append-only, hash-chained audit store
// (PostgreSQL), operator-attributed. No mocks on the audit path.

const cfg = { host: process.env.PGHOST ?? '127.0.0.1', port: Number(process.env.PGPORT ?? 55432), database: process.env.PGDATABASE ?? 'ece_audit_test' };
const appPool = new Pool({ ...cfg, user: 'ece_app' });
afterAll(async () => { await appPool.end(); });

const kinds = (rows: { kind: string }[], k: string) => rows.filter((r) => r.kind === k).length;

describe('Console audit → Postgres (append-only, hash-chained, operator-attributed)', () => {
  it('enqueue/approve/refuse are persisted as chained read-log entries; the chain verifies', async () => {
    const ORG = `orgDC-${Date.now()}`;
    const sink = new PostgresHashChainSink(appPool, new RedactionEngine(['consoleEvent', 'actionId', 'tool', 'operator', 'proposingCaller', 'reason', 'atIso', 'environment']));
    const audit = new PostgresConsoleAudit(sink, ORG, 'local');

    const events: ConsoleAuditEvent[] = [
      { type: 'enqueued', actionId: 'a1', tool: 'create_ticket', proposingCaller: 'claude', atIso: '2026-07-02T00:00:00Z' },
      { type: 'approved', actionId: 'a1', tool: 'create_ticket', operator: 'human_boss', reason: 'reviewed', atIso: '2026-07-02T00:01:00Z' },
      { type: 'refused', actionId: 'a2', tool: 'create_ticket', operator: 'human_boss', reason: 'not now', atIso: '2026-07-02T00:02:00Z' },
    ];
    for (const e of events) await audit.append(e); // durable, awaited

    const entries = await sink.readEntries(ORG);
    expect(kinds(entries, 'read')).toBe(3);        // three Console transitions, durably recorded
    const chain = await sink.verifyChain(ORG);
    expect(chain.ok).toBe(true);                   // append-only + hash-chained, intact
  });
});
