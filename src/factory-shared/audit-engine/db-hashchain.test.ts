import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pkg from 'pg';
const { Pool, Client } = pkg;
import { PostgresHashChainSink } from './postgres-sink.js';
import { RedactionEngine } from '../redaction-engine/redaction-engine.js';

// T6 — hash-chain tamper-evidence. NO mocks: real PostgreSQL. Builds a real chain,
// then tampers a stored row OUT OF BAND (with the append-only trigger temporarily
// disabled, simulating an attacker with DB access) and proves verifyChain catches it
// at the correct sequence position.

const cfg = {
  host: process.env.PGHOST ?? '127.0.0.1',
  port: Number(process.env.PGPORT ?? 55432),
  database: process.env.PGDATABASE ?? 'ece_audit_test',
};
const ORG = 'orgT6';
const pool = new Pool({ ...cfg, user: 'ece_app' });
const sink = new PostgresHashChainSink(pool, new RedactionEngine());

const actor = { user_id: 'u6', email: 'u6@ece.ae', role: 'admin' };
const session = { session_id: 's6' };

beforeAll(async () => {
  // Build a real cross-table chain for ORG: intent(seq1) → result(seq2) → intent(seq3).
  const i1 = await sink.appendIntent({
    organization_id: ORG, human_actor: actor, session, tool: { name: 'search_clients' },
    authz: { decision: 'ALLOW' }, environment: 'local',
  });
  await sink.appendResult({ intent_id: i1.intent_id, organization_id: ORG }, { status: 'success', duration_ms: 5 });
  await sink.appendIntent({
    organization_id: ORG, human_actor: actor, session, tool: { name: 'search_clients' },
    authz: { decision: 'ALLOW' }, environment: 'local',
  });
});

afterAll(async () => {
  await pool.end();
});

describe('T6 — hash-chain tamper-evidence', () => {
  it('a correctly-built chain verifies', async () => {
    const v = await sink.verifyChain(ORG);
    expect(v.ok).toBe(true);
    expect(v.checked).toBe(3);
  });

  it('an out-of-band edit is DETECTED at the correct sequence position', async () => {
    // Tamper as superuser, with the append-only trigger temporarily disabled.
    const su = new Client({ ...cfg, user: 'postgres' });
    await su.connect();
    try {
      await su.query('ALTER TABLE audit_intent DISABLE TRIGGER audit_intent_no_mutate');
      const upd = await su.query(
        `UPDATE audit_intent SET tool = '{"name":"TAMPERED"}'::jsonb WHERE organization_id=$1 AND seq=1`,
        [ORG],
      );
      expect(upd.rowCount).toBe(1); // the tamper actually landed
      await su.query('ALTER TABLE audit_intent ENABLE TRIGGER audit_intent_no_mutate'); // restore immediately
    } finally {
      await su.end();
    }

    const v = await sink.verifyChain(ORG);
    expect(v.ok).toBe(false);
    expect(v.first_broken_seq).toBe(1); // the tampered entry is pinpointed
  });
});
