import { describe, it, expect, afterAll } from 'vitest';
import pkg from 'pg';
const { Pool, Client } = pkg;
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PostgresHashChainSink } from '../audit-engine/postgres-sink.js';
import { RedactionEngine } from '../redaction-engine/redaction-engine.js';
import { factoryCapabilityGraph } from '../../mcp-server/live-capability-reuse-graph.js';
import { factoryMoatEngine, factoryMoatAssessmentAuditor } from '../../mcp-server/live-moat-engine.js';

// VI Wave — JUDGMENT engine 2: Moat, GROUNDED on the REAL Phase-1 Capability Reuse Graph, against REAL PostgreSQL.
// Proves: it consumes the real structural surface READ-ONLY and cites ONLY real backbone nodes (fabricates none);
// an unmatched concept yields an honest insufficient-basis assessment; weak moats are flagged with strengthenings;
// and recording the advisory assessment to the append-only hash-chain audit verifies (verifyChain ok), secret-free.

const cfg = { host: process.env.PGHOST ?? '127.0.0.1', port: Number(process.env.PGPORT ?? 55432), database: process.env.PGDATABASE ?? 'ece_audit_test' };
const pool = new Pool({ ...cfg, user: 'ece_app' });
const sink = new PostgresHashChainSink(pool, new RedactionEngine());
afterAll(async () => { await pool.end(); });

const ORG = `orgM-${process.pid}`;
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

describe('moat-engine — grounded on the REAL Phase-1 graph (cites real nodes only; advisory)', () => {
  it('a concept matching real ECE capabilities cites those real backbone nodes (fabricates none); advisory:true', () => {
    const graph = factoryCapabilityGraph(REPO_ROOT);
    const a = factoryMoatEngine(graph).assess({ description: 'a sovereign audit + compliance platform', terms: ['audit', 'sovereign', 'compliance'] });
    expect(a.advisory).toBe(true);
    expect(a.status).toBe('VENTURE-BLUEPRINT-AWAITING-HUMAN-APPROVAL');
    expect(a.groundedOn.length).toBeGreaterThan(0);
    const realIds = new Set(graph.graph.nodes.map((n) => n.id));
    for (const f of a.groundedOn) if (f.kind === 'capability') expect(realIds.has(f.ref)).toBe(true);
    for (const c of a.components) for (const f of c.groundedOn) expect(realIds.has(f.ref)).toBe(true);
    // the real Audit Engine grounds a data/compliance moat
    expect(a.components.find((c) => c.dimension === 'data')!.groundedOn.some((f) => f.ref === 'engine:audit-engine')).toBe(true);
    expect(a.confidence).not.toBe('insufficient-basis');
  });

  it('the weak-moat invariant holds on the real graph: every weak/none moat carries a strengthening, strong ones do not', () => {
    // the real ECE graph is rich, so a broad concept may ground every dimension strongly (weakMoats can be empty).
    // What must ALWAYS hold (requirement §3b): a weak/absent moat is flagged with a strengthening; a strong one is not.
    const a = factoryMoatEngine(factoryCapabilityGraph(REPO_ROOT)).assess({ description: 'a sovereign audit platform', terms: ['audit', 'sovereign'] });
    for (const c of a.components) {
      if (c.strength === 'none' || c.strength === 'weak') { expect(a.weakMoats).toContain(c.dimension); expect(typeof c.strengthening).toBe('string'); }
      else { expect(a.weakMoats).not.toContain(c.dimension); expect(c.strengthening).toBeUndefined(); }
    }
  });

  it('a concept the real graph cannot ground ⇒ honest insufficient-basis (no fabricated moat)', () => {
    const a = factoryMoatEngine(factoryCapabilityGraph(REPO_ROOT)).assess({ description: 'a quantum teleportation relay', terms: ['quantum', 'teleportation', 'relay'] });
    expect(a.groundedOn).toEqual([]);
    expect(a.confidence).toBe('insufficient-basis');
    expect(a.overall.strength).toBe('none');
  });

  it('consumes the graph read-only: unchanged after assessing', () => {
    const graph = factoryCapabilityGraph(REPO_ROOT);
    const before = graph.size.nodes;
    factoryMoatEngine(graph).assess({ description: 'audit', terms: ['audit'] });
    expect(graph.size.nodes).toBe(before);
  });
});

describe('moat-engine — audited to the hash-chain (verifyChain ok), secret-free', () => {
  it('recording assessments verifies on the chain and stores only allowlisted, secret-free metadata', async () => {
    const engine = factoryMoatEngine(factoryCapabilityGraph(REPO_ROOT));
    const auditor = factoryMoatAssessmentAuditor(sink, ORG);
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
      expect(dump).toMatch(/moat\.assessed/);
      expect(dump).toMatch(/"advisory":true/);
      expect(dump).toMatch(/insufficient-basis/); // the honest-uncertainty verdict is on the chain too
    } finally { await client.end(); }
  });
});
