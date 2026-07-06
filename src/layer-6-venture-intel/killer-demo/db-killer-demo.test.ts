import { describe, it, expect, afterAll } from 'vitest';
import pkg from 'pg';
const { Pool, Client } = pkg;
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PostgresHashChainSink } from '../../factory-shared/audit-engine/postgres-sink.js';
import { RedactionEngine } from '../../factory-shared/redaction-engine/redaction-engine.js';
import { factoryCapabilityGraph } from '../../mcp-server/live-capability-reuse-graph.js';
import { factoryKillerDemoEngine, factoryKillerDemoAuditor } from '../../mcp-server/live-killer-demo.js';

// VI Wave — JUDGMENT engine 6: Killer Demo, GROUNDED on the REAL Phase-1 graph, against REAL PostgreSQL. Proves:
// it consumes the real structural surface READ-ONLY and cites ONLY real backbone nodes for buildability (a demo can
// only showcase real ECE capabilities); an unmatched concept ⇒ no demo (insufficient-basis); it RECOMMENDS only
// (recommendsOnly:true); audience/market impact flagged external; and recording the advisory assessment to the
// hash-chain verifies (verifyChain ok), secret-free.

const cfg = { host: process.env.PGHOST ?? '127.0.0.1', port: Number(process.env.PGPORT ?? 55432), database: process.env.PGDATABASE ?? 'ece_audit_test' };
const pool = new Pool({ ...cfg, user: 'ece_app' });
const sink = new PostgresHashChainSink(pool, new RedactionEngine());
afterAll(async () => { await pool.end(); });

const ORG = `orgK-${process.pid}`;
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

describe('killer-demo — grounded on the REAL Phase-1 graph (cites real nodes only; advisory; recommends only)', () => {
  it('a real concept cites real backbone buildability nodes (fabricates none); advisory:true; recommendsOnly:true', () => {
    const graph = factoryCapabilityGraph(REPO_ROOT);
    const a = factoryKillerDemoEngine(graph).assess({ description: 'a sovereign audit platform', terms: ['audit', 'sovereign'] });
    expect(a.advisory).toBe(true);
    expect(a.status).toBe('VENTURE-BLUEPRINT-AWAITING-HUMAN-APPROVAL');
    expect(a.recommendsOnly).toBe(true);
    expect(a.buildability.length).toBeGreaterThan(0);
    const realIds = new Set(graph.graph.nodes.map((n) => n.id));
    for (const f of a.groundedOn) if (f.kind === 'capability') expect(realIds.has(f.ref)).toBe(true);
    for (const fmt of a.formats) for (const s of fmt.showcases) expect(realIds.has(s.ref)).toBe(true);
    expect(a.buildability.some((f) => f.ref === 'engine:audit-engine')).toBe(true);
    expect(a.confidence).not.toBe('insufficient-basis');
  });

  it('honest audience/market boundary on the real graph: impact flagged external; no fabricated reaction/market number', () => {
    const a = factoryKillerDemoEngine(factoryCapabilityGraph(REPO_ROOT)).assess({ description: 'a sovereign audit platform', terms: ['audit', 'sovereign'] });
    expect(a.externalDataNeeded).toMatch(/external/i);
    for (const f of a.formats) expect(f.impactNote).toMatch(/external/i);
    expect(JSON.stringify(a)).not.toMatch(/\$\s?\d|\bAED\s?\d|\d+\s?(million|billion)\s?(market|deals|customers)/i);
  });

  it('a concept the real graph cannot ground ⇒ no demo (insufficient-basis)', () => {
    const a = factoryKillerDemoEngine(factoryCapabilityGraph(REPO_ROOT)).assess({ description: 'a quantum teleportation relay', terms: ['quantum', 'teleportation', 'relay'] });
    expect(a.buildability).toEqual([]);
    expect(a.confidence).toBe('insufficient-basis');
  });

  it('consumes the graph read-only: unchanged after assessing', () => {
    const graph = factoryCapabilityGraph(REPO_ROOT);
    const before = graph.size.nodes;
    factoryKillerDemoEngine(graph).assess({ description: 'audit', terms: ['audit'] });
    expect(graph.size.nodes).toBe(before);
  });
});

describe('killer-demo — audited to the hash-chain (verifyChain ok), secret-free', () => {
  it('recording assessments verifies on the chain and stores only allowlisted, secret-free metadata', async () => {
    const engine = factoryKillerDemoEngine(factoryCapabilityGraph(REPO_ROOT));
    const auditor = factoryKillerDemoAuditor(sink, ORG);
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
      expect(dump).toMatch(/demo\.recommended/);
      expect(dump).toMatch(/"advisory":true/);
      expect(dump).toMatch(/"recommendsOnly":true/);
      expect(dump).toMatch(/insufficient-basis/);
    } finally { await client.end(); }
  });
});
