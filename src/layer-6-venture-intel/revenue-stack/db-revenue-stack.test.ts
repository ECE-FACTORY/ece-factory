import { describe, it, expect, afterAll } from 'vitest';
import pkg from 'pg';
const { Pool, Client } = pkg;
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PostgresHashChainSink } from '../../factory-shared/audit-engine/postgres-sink.js';
import { RedactionEngine } from '../../factory-shared/redaction-engine/redaction-engine.js';
import { factoryCapabilityGraph } from '../../mcp-server/live-capability-reuse-graph.js';
import { factoryRevenueStackEngine, factoryRevenueStackAuditor } from '../../mcp-server/live-revenue-stack.js';

// VI Wave — JUDGMENT engine 3: Revenue Stack, GROUNDED on the REAL Phase-1 graph, against REAL PostgreSQL. Proves:
// it consumes the real structural surface READ-ONLY and cites ONLY real backbone nodes (fabricates none); an
// unmatched concept yields honest insufficient-basis; it is recurring-revenue-first; concrete pricing is flagged as
// external (never fabricated); and recording the advisory assessment to the hash-chain verifies (verifyChain ok).

const cfg = { host: process.env.PGHOST ?? '127.0.0.1', port: Number(process.env.PGPORT ?? 55432), database: process.env.PGDATABASE ?? 'ece_audit_test' };
const pool = new Pool({ ...cfg, user: 'ece_app' });
const sink = new PostgresHashChainSink(pool, new RedactionEngine());
afterAll(async () => { await pool.end(); });

const ORG = `orgR-${process.pid}`;
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

describe('revenue-stack — grounded on the REAL Phase-1 graph (cites real nodes only; advisory; recurring-first)', () => {
  it('a real concept cites real backbone nodes (fabricates none); advisory:true; recurring-revenue-first', () => {
    const graph = factoryCapabilityGraph(REPO_ROOT);
    const a = factoryRevenueStackEngine(graph).assess({ description: 'a sovereign audit API platform', terms: ['audit', 'api', 'sovereign'] });
    expect(a.advisory).toBe(true);
    expect(a.status).toBe('VENTURE-BLUEPRINT-AWAITING-HUMAN-APPROVAL');
    expect(a.groundedOn.length).toBeGreaterThan(0);
    const realIds = new Set(graph.graph.nodes.map((n) => n.id));
    for (const f of a.groundedOn) if (f.kind === 'capability') expect(realIds.has(f.ref)).toBe(true);
    for (const l of a.layers) for (const f of l.groundedOn) expect(realIds.has(f.ref)).toBe(true);
    expect(a.overall.recurringFirst).toBe(true);
    expect(a.recurringLayers.length).toBeGreaterThan(0);
    expect(a.confidence).not.toBe('insufficient-basis');
  });

  it('honest external-data boundary on the real graph: pricing flagged external; no fabricated price/market number', () => {
    const a = factoryRevenueStackEngine(factoryCapabilityGraph(REPO_ROOT)).assess({ description: 'a sovereign audit platform', terms: ['audit', 'sovereign'] });
    expect(a.externalDataNeeded).toMatch(/external market data/i);
    for (const l of a.layers) expect(l.pricingNote).toMatch(/external market data/i);
    expect(JSON.stringify(a)).not.toMatch(/\$\s?\d|\bAED\s?\d|\d+\s?(million|billion)\s?(market|TAM|revenue)/i);
  });

  it('a concept the real graph cannot ground ⇒ honest insufficient-basis (no fabricated stack)', () => {
    const a = factoryRevenueStackEngine(factoryCapabilityGraph(REPO_ROOT)).assess({ description: 'a quantum teleportation relay', terms: ['quantum', 'teleportation', 'relay'] });
    expect(a.groundedOn).toEqual([]);
    expect(a.confidence).toBe('insufficient-basis');
    expect(a.overall.recurringFirst).toBe(false);
  });

  it('consumes the graph read-only: unchanged after assessing', () => {
    const graph = factoryCapabilityGraph(REPO_ROOT);
    const before = graph.size.nodes;
    factoryRevenueStackEngine(graph).assess({ description: 'audit', terms: ['audit'] });
    expect(graph.size.nodes).toBe(before);
  });
});

describe('revenue-stack — audited to the hash-chain (verifyChain ok), secret-free', () => {
  it('recording assessments verifies on the chain and stores only allowlisted, secret-free metadata', async () => {
    const engine = factoryRevenueStackEngine(factoryCapabilityGraph(REPO_ROOT));
    const auditor = factoryRevenueStackAuditor(sink, ORG);
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
      expect(dump).toMatch(/revenue\.assessed/);
      expect(dump).toMatch(/"advisory":true/);
      expect(dump).toMatch(/insufficient-basis/);
    } finally { await client.end(); }
  });
});
