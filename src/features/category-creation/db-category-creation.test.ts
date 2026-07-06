import { describe, it, expect, afterAll } from 'vitest';
import pkg from 'pg';
const { Pool, Client } = pkg;
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PostgresHashChainSink } from '../audit-engine/postgres-sink.js';
import { RedactionEngine } from '../redaction-engine/redaction-engine.js';
import { factoryCapabilityGraph } from '../../mcp-server/live-capability-reuse-graph.js';
import { factoryCategoryCreationEngine, factoryCategoryThesisAuditor } from '../../mcp-server/live-category-creation.js';

// VI Wave — first JUDGMENT engine: Category Creation, GROUNDED on the REAL Phase-1 Capability Reuse Graph, against
// REAL PostgreSQL. Proves: it consumes the real structural surface READ-ONLY and cites ONLY real backbone nodes
// (fabricates none); an unmatched concept yields an honest insufficient-basis thesis; and recording the advisory
// thesis to the append-only hash-chain audit verifies (verifyChain ok) and carries no secret.

const cfg = { host: process.env.PGHOST ?? '127.0.0.1', port: Number(process.env.PGPORT ?? 55432), database: process.env.PGDATABASE ?? 'ece_audit_test' };
const pool = new Pool({ ...cfg, user: 'ece_app' });
const sink = new PostgresHashChainSink(pool, new RedactionEngine());
afterAll(async () => { await pool.end(); });

const ORG = `orgCC-${process.pid}`;
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

describe('category-creation — grounded on the REAL Phase-1 graph (cites real nodes only; advisory)', () => {
  it('a concept matching real ECE capabilities cites those real backbone nodes (fabricates none); advisory:true', () => {
    const graph = factoryCapabilityGraph(REPO_ROOT);
    const t = factoryCategoryCreationEngine(graph).propose({ description: 'a sovereign audit + redaction platform', terms: ['audit', 'redaction'] });
    expect(t.advisory).toBe(true);
    expect(t.status).toBe('VENTURE-BLUEPRINT-AWAITING-HUMAN-APPROVAL');
    expect(t.groundedOn.length).toBeGreaterThan(0);
    // EVERY cited ref must be a node that actually exists in the real graph — no fabrication
    const realIds = new Set(graph.graph.nodes.map((n) => n.id));
    for (const f of t.groundedOn) {
      if (f.kind === 'capability') expect(realIds.has(f.ref)).toBe(true);
    }
    expect(t.groundedOn.some((f) => f.ref === 'engine:audit-engine')).toBe(true);
    expect(t.confidence).not.toBe('insufficient-basis'); // real facts ground it
  });

  it('a concept the real graph cannot ground ⇒ honest insufficient-basis (no fabricated category)', () => {
    const graph = factoryCapabilityGraph(REPO_ROOT);
    const t = factoryCategoryCreationEngine(graph).propose({ description: 'a quantum teleportation relay', terms: ['quantum', 'teleportation', 'relay'] });
    expect(t.groundedOn).toEqual([]);
    expect(t.confidence).toBe('insufficient-basis');
    expect(t.opinion.proposedCategory).toMatch(/insufficient basis/i);
  });

  it('consumes the graph read-only: the graph is unchanged after proposing', () => {
    const graph = factoryCapabilityGraph(REPO_ROOT);
    const before = graph.size.nodes;
    factoryCategoryCreationEngine(graph).propose({ description: 'audit', terms: ['audit'] });
    expect(graph.size.nodes).toBe(before);
  });
});

describe('category-creation — audited to the hash-chain (verifyChain ok), secret-free', () => {
  it('recording theses verifies on the chain and stores only allowlisted, secret-free metadata', async () => {
    const engine = factoryCategoryCreationEngine(factoryCapabilityGraph(REPO_ROOT));
    const auditor = factoryCategoryThesisAuditor(sink, ORG);
    const grounded = engine.propose({ description: 'a sovereign audit platform', terms: ['audit'] });
    const insufficient = engine.propose({ description: 'quantum relay', terms: ['quantum', 'relay'] });
    const r1 = await auditor.record(grounded, ['audit']);
    const r2 = await auditor.record(insufficient, ['quantum', 'relay']);
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
      expect(dump).toMatch(/category\.proposed/);
      expect(dump).toMatch(/"advisory":true/);       // recorded as advisory judgment, never proof
      expect(dump).toMatch(/insufficient-basis/);    // the honest-uncertainty verdict is on the chain too
    } finally { await client.end(); }
  });
});
