import { describe, it, expect, afterAll } from 'vitest';
import pkg from 'pg';
const { Pool, Client } = pkg;
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PostgresHashChainSink } from '../audit-engine/postgres-sink.js';
import { RedactionEngine } from '../redaction-engine/redaction-engine.js';
import { factoryCapabilityGraph } from '../../mcp-server/live-capability-reuse-graph.js';
import { factoryFirst10CustomersEngine, factoryFirst10Auditor } from '../../mcp-server/live-first-10-customers.js';

// VI Wave — JUDGMENT engine 4: First 10 Customers, GROUNDED on the REAL Phase-1 graph, against REAL PostgreSQL.
// Proves: it consumes the real structural surface READ-ONLY and cites ONLY real backbone nodes (fabricates none);
// an unmatched concept yields honest insufficient-basis; the external-customer boundary holds (no invented named
// customer / demand fact); and recording the advisory assessment to the hash-chain verifies (verifyChain ok).

const cfg = { host: process.env.PGHOST ?? '127.0.0.1', port: Number(process.env.PGPORT ?? 55432), database: process.env.PGDATABASE ?? 'ece_audit_test' };
const pool = new Pool({ ...cfg, user: 'ece_app' });
const sink = new PostgresHashChainSink(pool, new RedactionEngine());
afterAll(async () => { await pool.end(); });

const ORG = `orgF-${process.pid}`;
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

describe('first-10-customers — grounded on the REAL Phase-1 graph (cites real nodes only; advisory)', () => {
  it('a real concept cites real backbone credibility nodes (fabricates none); advisory:true', () => {
    const graph = factoryCapabilityGraph(REPO_ROOT);
    const a = factoryFirst10CustomersEngine(graph).assess({ description: 'a sovereign audit platform for government', terms: ['audit', 'sovereign'] });
    expect(a.advisory).toBe(true);
    expect(a.status).toBe('VENTURE-BLUEPRINT-AWAITING-HUMAN-APPROVAL');
    expect(a.credibility.length).toBeGreaterThan(0);
    const realIds = new Set(graph.graph.nodes.map((n) => n.id));
    for (const f of a.groundedOn) if (f.kind === 'capability') expect(realIds.has(f.ref)).toBe(true);
    for (const asp of a.aspects) for (const f of asp.groundedOn) expect(realIds.has(f.ref)).toBe(true);
    expect(a.entryWedge.groundedOn.every((f) => realIds.has(f.ref))).toBe(true);
    expect(a.confidence).not.toBe('insufficient-basis');
  });

  it('honest external-customer boundary on the real graph: no invented named customer / demand number', () => {
    const a = factoryFirst10CustomersEngine(factoryCapabilityGraph(REPO_ROOT)).assess({ description: 'a sovereign audit platform', terms: ['audit', 'sovereign'] });
    expect(a.externalDataNeeded).toMatch(/external customer\/market data/i);
    for (const asp of a.aspects.filter((x) => x.basis === 'external-data-needed')) { expect(asp.groundedOn).toEqual([]); expect(asp.externalNote).toBeTruthy(); }
    const dump = JSON.stringify(a);
    expect(dump).not.toMatch(/\$\s?\d|\bAED\s?\d|\d+\s?(million|billion)\s?(customers|market|users|demand)/i);
    expect(dump).not.toMatch(/\b(Acme|Contoso|Initech|Globex)\b/);
  });

  it('a concept the real graph cannot ground ⇒ honest insufficient-basis (no fabricated GTM)', () => {
    const a = factoryFirst10CustomersEngine(factoryCapabilityGraph(REPO_ROOT)).assess({ description: 'a quantum teleportation relay', terms: ['quantum', 'teleportation', 'relay'] });
    expect(a.groundedOn).toEqual([]);
    expect(a.credibility).toEqual([]);
    expect(a.confidence).toBe('insufficient-basis');
  });

  it('consumes the graph read-only: unchanged after assessing', () => {
    const graph = factoryCapabilityGraph(REPO_ROOT);
    const before = graph.size.nodes;
    factoryFirst10CustomersEngine(graph).assess({ description: 'audit', terms: ['audit'] });
    expect(graph.size.nodes).toBe(before);
  });
});

describe('first-10-customers — audited to the hash-chain (verifyChain ok), secret-free', () => {
  it('recording assessments verifies on the chain and stores only allowlisted, secret-free metadata', async () => {
    const engine = factoryFirst10CustomersEngine(factoryCapabilityGraph(REPO_ROOT));
    const auditor = factoryFirst10Auditor(sink, ORG);
    const r1 = await auditor.record(engine.assess({ description: 'sovereign audit platform', terms: ['audit', 'sovereign'] }), ['audit', 'sovereign']);
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
      expect(dump).toMatch(/first10\.assessed/);
      expect(dump).toMatch(/"advisory":true/);
      expect(dump).toMatch(/insufficient-basis/);
    } finally { await client.end(); }
  });
});
