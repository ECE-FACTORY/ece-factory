import { describe, it, expect, afterAll } from 'vitest';
import pkg from 'pg';
const { Pool, Client } = pkg;
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PostgresHashChainSink } from '../audit-engine/postgres-sink.js';
import { RedactionEngine } from '../redaction-engine/redaction-engine.js';
import { factoryCapabilityGraph } from '../../mcp-server/live-capability-reuse-graph.js';
import { factoryInternalReuseEngine, factoryReuseDecisionAuditor } from '../../mcp-server/live-internal-reuse-engine.js';

// VI Wave Phase 2 — the Internal Reuse Engine against the REAL Phase-1 graph + REAL PostgreSQL. Proves: it
// consumes the real graph (built from the actual repo) read-only; a need matching an existing internal capability
// NEVER yields BUILD_CUSTOM (anti-rebuild on the real index); a genuinely-absent need ⇒ BUILD_CUSTOM (evidenced
// absence); decisions are re-derivable; and recording to the append-only hash-chain audit verifies.

const cfg = { host: process.env.PGHOST ?? '127.0.0.1', port: Number(process.env.PGPORT ?? 55432), database: process.env.PGDATABASE ?? 'ece_audit_test' };
const pool = new Pool({ ...cfg, user: 'ece_app' });
const sink = new PostgresHashChainSink(pool, new RedactionEngine());
afterAll(async () => { await pool.end(); });

const ORG = `orgIR-${process.pid}`;
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

describe('internal-reuse-engine — consumes the REAL Phase-1 graph; deny-by-default anti-rebuild', () => {
  it('a need matching an existing internal capability is NOT rebuilt (never BUILD_CUSTOM)', () => {
    const engine = factoryInternalReuseEngine(factoryCapabilityGraph(REPO_ROOT));
    const d = engine.classify({ description: 'a tamper-evident audit ledger', terms: ['audit', 'engine'], kind: 'engine' });
    expect(d.classification).not.toBe('BUILD_CUSTOM'); // the real Audit Engine exists — reuse/extend, never rebuild
    expect(['REUSE_INTERNAL', 'EXTEND_INTERNAL', 'FORK_INTERNAL', 'COPY_INTERNAL', 'NEEDS_REVIEW']).toContain(d.classification);
    expect(d.evidence.length).toBeGreaterThan(0);       // matched a real node
    expect(d.advisory).toBe(false);
  });

  it('a genuinely absent capability ⇒ BUILD_CUSTOM with evidenced absence (it DID search the real graph)', () => {
    const engine = factoryInternalReuseEngine(factoryCapabilityGraph(REPO_ROOT));
    const d = engine.classify({ description: 'a quantum teleportation relay', terms: ['quantum', 'teleportation', 'relay'] });
    expect(d.classification).toBe('BUILD_CUSTOM');
    expect(d.evidence).toEqual([]);
    expect(d.searched.candidatesConsidered).toBeGreaterThan(20); // it considered the whole real index
  });

  it('re-derivable on the real graph: same need ⇒ identical decision', () => {
    const engine = factoryInternalReuseEngine(factoryCapabilityGraph(REPO_ROOT));
    const n = { description: 'redaction', terms: ['redaction'] };
    expect(JSON.stringify(engine.classify(n))).toBe(JSON.stringify(engine.classify(n)));
  });

  it('consumes the graph, mutates nothing: the graph is unchanged after classification', () => {
    const graph = factoryCapabilityGraph(REPO_ROOT);
    const before = graph.size.nodes;
    factoryInternalReuseEngine(graph).classify({ description: 'audit', terms: ['audit'] });
    expect(graph.size.nodes).toBe(before); // Phase-1 graph untouched
  });
});

describe('internal-reuse-engine — audited to the hash-chain (verifyChain ok), secret-free', () => {
  it('recording classifications verifies on the chain and stores only allowlisted, secret-free metadata', async () => {
    const engine = factoryInternalReuseEngine(factoryCapabilityGraph(REPO_ROOT));
    const auditor = factoryReuseDecisionAuditor(sink, ORG);
    const r1 = await auditor.record(engine.classify({ description: 'audit ledger', terms: ['audit', 'ledger'], kind: 'engine' }));
    const r2 = await auditor.record(engine.classify({ description: 'quantum relay', terms: ['quantum', 'relay'] }));
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
      expect(dump).toMatch(/reuse\.classified/);
      expect(dump).toMatch(/BUILD_CUSTOM/); // the evidenced-absence decision is on the chain
    } finally { await client.end(); }
  });
});
