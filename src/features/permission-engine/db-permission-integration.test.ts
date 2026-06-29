import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pkg from 'pg';
const { Pool, Client } = pkg;
import { WriteAheadSequencer, type SequencerRequest } from '../audit-engine/sequencer.js';
import { PostgresHashChainSink } from '../audit-engine/postgres-sink.js';
import { RedactionEngine } from '../redaction-engine/redaction-engine.js';
import { createDefaultToolRegistry, type ToolDefinition } from '../tool-registry/tool-registry.js';
import { PermissionEngine } from './permission-engine.js';

// Module 22 integration. NO mocks: real PostgreSQL. Wires the REAL Permission Engine into the
// sequencer and proves ALLOW proceeds + logs; REFUSE writes one refusal record (no intent, no
// orphan); STOP_FOR_APPROVAL does not execute (no orphan) — Phase 3.5 guarantees hold.

function tool(overrides: Partial<ToolDefinition>): ToolDefinition {
  return {
    name: 'x', purpose: 'p', readOrWrite: 'read', classification: 'READ_ONLY', permissionLevel: 'read',
    requiredRole: 'user', approvalRequired: false, serverSideRedaction: true, auditBehavior: 'audited',
    blastRadius: 0, reversible: 'yes', idempotent: true, environments: ['local'], owner: 'ECE', status: 'enabled',
    ...overrides,
  };
}

const cfg = {
  host: process.env.PGHOST ?? '127.0.0.1',
  port: Number(process.env.PGPORT ?? 55432),
  database: process.env.PGDATABASE ?? 'ece_audit_test',
};
const pool = new Pool({ ...cfg, user: 'ece_app' });
const sink = new PostgresHashChainSink(pool, new RedactionEngine());

const registry = createDefaultToolRegistry(); // search_clients READ_ONLY, requiredRole user
registry.register(tool({ name: 'admin_tool', requiredRole: 'admin' }));
registry.register(tool({ name: 'approval_tool', readOrWrite: 'write', classification: 'WRITE_LOW_RISK', blastRadius: 1, approvalRequired: true }));

const seq = new WriteAheadSequencer(sink, new PermissionEngine(registry));
let su: InstanceType<typeof Client>;

function reqFor(org: string, toolName: string, role: string): SequencerRequest {
  return {
    principal: { user_id: `human_${org}`, email: `${org}@ece.ae`, role },
    organization_id: org, session: { session_id: `s_${org}` },
    tool: { name: toolName }, environment: 'local', via: 'claude',
  };
}
const kinds = (rows: { kind: string }[], k: string) => rows.filter((r) => r.kind === k).length;

beforeAll(async () => { su = new Client({ ...cfg, user: 'postgres' }); await su.connect(); });
afterAll(async () => { await pool.end(); await su.end(); });

describe('Permission Engine — integration with the sequencer (real authorizer)', () => {
  it('ALLOW: an authorized read proceeds and logs an intent + result', async () => {
    let executed = false;
    const out = await seq.run(reqFor('orgP1', 'search_clients', 'user'), async () => {
      executed = true;
      return { value: 'ok', outcome: { status: 'success' as const } };
    });
    expect(out.status).toBe('completed');
    expect(executed).toBe(true);
    const rows = await sink.readEntries('orgP1');
    expect(kinds(rows, 'intent')).toBe(1);
    expect(kinds(rows, 'result')).toBe(1);
    expect((await sink.verifyChain('orgP1')).ok).toBe(true);
  });

  it('REFUSE: an insufficient-role action writes exactly one refusal record, no intent, no orphan', async () => {
    let executed = false;
    const out = await seq.run(reqFor('orgP2', 'admin_tool', 'user'), async () => {
      executed = true;
      return { value: 1, outcome: { status: 'success' as const } };
    });
    expect(out.status).toBe('refused');
    expect(executed).toBe(false);
    const rows = await sink.readEntries('orgP2');
    expect(kinds(rows, 'refusal')).toBe(1);
    expect(kinds(rows, 'intent')).toBe(0);
    expect((await seq.reconcileOrphans('orgP2', { olderThanSeconds: 0 })).length).toBe(0);
  });

  it('STOP_FOR_APPROVAL: does not execute, records a refusal (decision STOP_FOR_APPROVAL), leaves no orphan', async () => {
    let executed = false;
    const out = await seq.run(reqFor('orgP3', 'approval_tool', 'user'), async () => {
      executed = true;
      return { value: 1, outcome: { status: 'success' as const } };
    });
    expect(out.status).toBe('refused');
    expect(executed).toBe(false);

    const r = await su.query<{ decision: string }>(`SELECT decision FROM audit_refusal WHERE organization_id=$1`, ['orgP3']);
    expect(r.rowCount).toBe(1);
    expect(r.rows[0]!.decision).toBe('STOP_FOR_APPROVAL');

    const rows = await sink.readEntries('orgP3');
    expect(kinds(rows, 'intent')).toBe(0);
    expect((await seq.reconcileOrphans('orgP3', { olderThanSeconds: 0 })).length).toBe(0);
  });
});
