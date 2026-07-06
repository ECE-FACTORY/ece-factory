import { describe, it, expect, afterAll } from 'vitest';
import pkg from 'pg';
const { Pool, Client } = pkg;
import { PostgresHashChainSink } from '../../factory-shared/audit-engine/postgres-sink.js';
import { RedactionEngine } from '../../factory-shared/redaction-engine/redaction-engine.js';
import {
  factoryVentureBlueprintComposer,
  factoryVentureBlueprintAuditor,
} from '../../mcp-server/live-venture-blueprint-composer.js';
import type { EngineOutput } from './venture-blueprint-composer.js';

// VI Wave — CAPSTONE: Venture Blueprint Composer, against REAL PostgreSQL. Proves the unified blueprint records to
// the hash-chain and verifies (verifyChain ok); the audit stores the SINGLE plan-only status + routesNothing:true +
// BOTH advisory markings distinctly (fact vs opinion, no bleed); and the audit trail is SECRET-FREE even when the
// ingested concept text carries a fake token (redaction on the inert data). The composer runs NO engine and routes
// NOTHING — it only unifies passed-in engine OUTPUTS and records the inert result.

const cfg = { host: process.env.PGHOST ?? '127.0.0.1', port: Number(process.env.PGPORT ?? 55432), database: process.env.PGDATABASE ?? 'ece_audit_test' };
const pool = new Pool({ ...cfg, user: 'ece_app' });
const sink = new PostgresHashChainSink(pool, new RedactionEngine());
afterAll(async () => { await pool.end(); });

const ORG = `orgVBC-${process.pid}`;
const cf = (ref: string, name: string) => ({ kind: 'capability' as const, ref, name, note: 'engine at src' });

// A realistic mix: structural (advisory:false) engine outputs + judgment (advisory:true) engine outputs, as DATA.
const outputs = (): EngineOutput[] => [
  { engine: 'build-buy-partner-acquire', advisory: false, groundedOn: [cf('engine:audit-engine', 'audit-engine')], sourcingVerdicts: [{ capability: 'billing', verdict: 'BUY' }, { capability: 'audit', verdict: 'REUSE' }] },
  { engine: 'platform-blueprint', advisory: false, groundedOn: [cf('engine:mcp-bridge', 'mcp-bridge')] },
  { engine: 'moat-engine', advisory: true, groundedOn: [cf('engine:sovereign-readiness', 'sovereign-readiness')] },
  { engine: 'venture-roadmap', advisory: true, groundedOn: [cf('engine:audit-engine', 'audit-engine')] },
];

describe('venture-blueprint-composer — unified blueprint audited to the hash-chain (verifyChain ok), secret-free', () => {
  it('records the unified blueprint; chain verifies; stores plan-only status + both advisory markings distinctly', async () => {
    const composer = factoryVentureBlueprintComposer();
    const auditor = factoryVentureBlueprintAuditor(sink, ORG);

    // ingest a concept carrying a FAKE token — it is inert DATA and must be scrubbed from the audit trail.
    const bp = composer.compose({ concept: 'a sovereign audit API platform token=ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345', outputs: outputs() });
    expect(bp.status).toBe('VENTURE-BLUEPRINT-AWAITING-HUMAN-APPROVAL');
    expect(bp.routesNothing).toBe(true);
    expect(bp.whatWeKnow.every((x) => x.advisory === false)).toBe(true);
    expect(bp.whatWeBelieve.every((x) => x.advisory === true)).toBe(true);
    expect(bp.proposals.every((p) => p.inert === true)).toBe(true);

    const r1 = await auditor.record(bp);
    const r2 = await auditor.record(composer.compose({ concept: 'a second venture concept', outputs: outputs() }));
    expect(r2.seq).toBe(r1.seq + 1);

    const v = await sink.verifyChain(ORG);
    expect(v.ok).toBe(true);

    const client = new Client({ ...cfg, user: 'ece_app' });
    await client.connect();
    try {
      await client.query(`SET app.current_org = '${ORG}'`);
      const raw = await client.query<{ query_range: unknown }>(`SELECT query_range FROM audit_read_log WHERE organization_id = $1`, [ORG]);
      const dump = JSON.stringify(raw.rows);
      expect(dump).not.toMatch(/ghp_[A-Za-z0-9]{20,}|PGPASSWORD|privateKey/);   // ingested token scrubbed
      expect(dump).toMatch(/blueprint\.composed/);
      expect(dump).toMatch(/VENTURE-BLUEPRINT-AWAITING-HUMAN-APPROVAL/);          // single plan-only status
      expect(dump).toMatch(/"routesNothing":true/);
      expect(dump).toMatch(/"advisory":false/);                                  // fact section recorded
      expect(dump).toMatch(/"advisory":true/);                                   // opinion section recorded — no bleed
      expect(dump).not.toMatch(/APPROVED|EXECUTED|DEPLOYED|PRODUCT_LIVE/);        // no forbidden status ever recorded
    } finally { await client.end(); }
  });
});
