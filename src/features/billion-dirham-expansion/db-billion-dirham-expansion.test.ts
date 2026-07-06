import { describe, it, expect, afterAll } from 'vitest';
import pkg from 'pg';
const { Pool, Client } = pkg;
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PostgresHashChainSink } from '../audit-engine/postgres-sink.js';
import { RedactionEngine } from '../redaction-engine/redaction-engine.js';
import { factoryCapabilityGraph } from '../../mcp-server/live-capability-reuse-graph.js';
import { factoryBillionDirhamExpansionEngine, factoryExpansionAuditor } from '../../mcp-server/live-billion-dirham-expansion.js';

// VI Wave — JUDGMENT engine 8: Billion-Dirham Expansion, GROUNDED on the REAL Phase-1 graph, against REAL
// PostgreSQL. Proves: it consumes the real structural surface READ-ONLY and cites ONLY real backbone nodes for each
// expansion stage (fabricates none); an unmatched concept ⇒ insufficient-basis; the SHARPEST boundary holds (NO
// fabricated market size / growth / revenue / billion-dirham number); and recording the advisory assessment to the
// hash-chain verifies (verifyChain ok), secret-free.

const cfg = { host: process.env.PGHOST ?? '127.0.0.1', port: Number(process.env.PGPORT ?? 55432), database: process.env.PGDATABASE ?? 'ece_audit_test' };
const pool = new Pool({ ...cfg, user: 'ece_app' });
const sink = new PostgresHashChainSink(pool, new RedactionEngine());
afterAll(async () => { await pool.end(); });

const ORG = `orgBD-${process.pid}`;
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

describe('billion-dirham-expansion — grounded on the REAL Phase-1 graph (cites real nodes only; advisory)', () => {
  it('a real concept supports expansion stages with real backbone nodes (fabricates none); advisory:true', () => {
    const graph = factoryCapabilityGraph(REPO_ROOT);
    const a = factoryBillionDirhamExpansionEngine(graph).assess({ description: 'a sovereign audit API platform', terms: ['audit', 'api', 'sovereign', 'package'] });
    expect(a.advisory).toBe(true);
    expect(a.status).toBe('VENTURE-BLUEPRINT-AWAITING-HUMAN-APPROVAL');
    expect(a.assertsNoFinancials).toBe(true);
    expect(a.supportedLevels.length).toBeGreaterThan(0);
    const realIds = new Set(graph.graph.nodes.map((n) => n.id));
    for (const f of a.groundedOn) if (f.kind === 'capability') expect(realIds.has(f.ref)).toBe(true);
    for (const s of a.stages) for (const f of s.supportedBy) expect(realIds.has(f.ref)).toBe(true);
    expect(a.stages.find((s) => s.level === 'tool')!.supportedBy.some((f) => f.ref === 'engine:audit-engine')).toBe(true);
    expect(a.confidence).not.toBe('insufficient-basis');
  });

  it('the SHARPEST boundary on the real graph: NO fabricated market/growth/revenue/billion-dirham figure', () => {
    const a = factoryBillionDirhamExpansionEngine(factoryCapabilityGraph(REPO_ROOT)).assess({ description: 'a sovereign audit platform', terms: ['audit', 'sovereign'] });
    expect(a.externalDataNeeded).toMatch(/market size|TAM|growth|never fabricated/i);
    const dump = JSON.stringify(a);
    expect(dump).not.toMatch(/\$\s?\d/);
    expect(dump).not.toMatch(/\bAED\s?\d/);
    expect(dump).not.toMatch(/\d+\s?%/);
    expect(dump).not.toMatch(/\d\s?billion|billion\s?\d/i);
    expect(dump).not.toMatch(/\d[\d,.]*\s?(dirham|dirhams)/i);
  });

  it('a concept the real graph cannot ground ⇒ no supported level (insufficient-basis)', () => {
    const a = factoryBillionDirhamExpansionEngine(factoryCapabilityGraph(REPO_ROOT)).assess({ description: 'a quantum teleportation relay', terms: ['quantum', 'teleportation', 'relay'] });
    expect(a.groundedOn).toEqual([]);
    expect(a.supportedLevels).toEqual([]);
    expect(a.confidence).toBe('insufficient-basis');
  });

  it('consumes the graph read-only: unchanged after assessing', () => {
    const graph = factoryCapabilityGraph(REPO_ROOT);
    const before = graph.size.nodes;
    factoryBillionDirhamExpansionEngine(graph).assess({ description: 'audit', terms: ['audit'] });
    expect(graph.size.nodes).toBe(before);
  });
});

describe('billion-dirham-expansion — audited to the hash-chain (verifyChain ok), secret-free', () => {
  it('recording assessments verifies on the chain and stores only allowlisted, secret-free metadata (no financials)', async () => {
    const engine = factoryBillionDirhamExpansionEngine(factoryCapabilityGraph(REPO_ROOT));
    const auditor = factoryExpansionAuditor(sink, ORG);
    const r1 = await auditor.record(engine.assess({ description: 'sovereign audit API platform', terms: ['audit', 'api', 'sovereign'] }), ['audit', 'api', 'sovereign']);
    const r2 = await auditor.record(engine.assess({ description: 'quantum relay', terms: ['quantum', 'relay'] }), ['quantum', 'relay']);
    expect(r2.seq).toBe(r1.seq + 1);

    const v = await sink.verifyChain(ORG);
    expect(v.ok).toBe(true);

    const client = new Client({ ...cfg, user: 'ece_app' });
    await client.connect();
    try {
      await client.query(`SET app.current_org = '${ORG}'`);
      const raw = await client.query<{ query_range: unknown }>(`SELECT query_range FROM audit_read_log WHERE organization_id = $1`, [ORG]);
      const dump = JSON.stringify(raw.rows);
      expect(dump).not.toMatch(/ghp_[A-Za-z0-9]{20,}|PGPASSWORD|privateKey/);
      expect(dump).not.toMatch(/\$\s?\d|\bAED\s?\d|\d\s?billion/); // no fabricated financial magnitude on the chain
      expect(dump).toMatch(/expansion\.assessed/);
      expect(dump).toMatch(/"advisory":true/);
      expect(dump).toMatch(/insufficient-basis/);
    } finally { await client.end(); }
  });
});
