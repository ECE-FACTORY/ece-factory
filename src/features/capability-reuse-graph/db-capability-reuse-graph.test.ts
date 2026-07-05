import { describe, it, expect, afterAll } from 'vitest';
import pkg from 'pg';
const { Pool, Client } = pkg;
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PostgresHashChainSink } from '../audit-engine/postgres-sink.js';
import { RedactionEngine } from '../redaction-engine/redaction-engine.js';
import { deriveCapabilityFacts, factoryCapabilityGraph, factoryCapabilityGraphAuditor } from '../../mcp-server/live-capability-reuse-graph.js';
import { buildCapabilityGraph, kindCounts } from './capability-reuse-graph.js';

// Venture Intelligence Wave — Phase 1: the Capability Reuse Graph built from the REAL repo, against REAL
// PostgreSQL. Proves: the graph is RE-DERIVABLE from the actual codebase (deriving twice ⇒ identical facts) and
// indexes the factory's own capabilities with correct posture; searching finds them; and recording the index/
// query event to the append-only hash-chain audit verifies (verifyChain ok) and carries NO secret.

const cfg = { host: process.env.PGHOST ?? '127.0.0.1', port: Number(process.env.PGPORT ?? 55432), database: process.env.PGDATABASE ?? 'ece_audit_test' };
const pool = new Pool({ ...cfg, user: 'ece_app' });
const sink = new PostgresHashChainSink(pool, new RedactionEngine());
afterAll(async () => { await pool.end(); });

const ORG = `orgCG-${process.pid}`;
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

describe('capability-reuse-graph — RE-DERIVABLE from the real repo; indexes real factory capabilities', () => {
  it('deriving facts twice from the same repo yields identical structural facts (re-derivable)', () => {
    const a = deriveCapabilityFacts(REPO_ROOT);
    const b = deriveCapabilityFacts(REPO_ROOT);
    expect(JSON.stringify(buildCapabilityGraph(a))).toBe(JSON.stringify(buildCapabilityGraph(b)));
    expect(a.modules.length).toBeGreaterThan(20); // the factory has many feature modules
    expect(a.tables.length).toBeGreaterThan(5);   // migrations declare the core tables
  });

  it('the real graph carries known factory capabilities with correct kind + posture + lineage', () => {
    const graph = factoryCapabilityGraph(REPO_ROOT);
    // the Audit Engine exists — a FACT, with its lineage and audit/redaction/tests/packageable posture
    const audit = graph.search({ kind: 'engine', text: 'audit-engine' }).find((n) => n.id === 'engine:audit-engine');
    expect(audit).toBeTruthy();
    expect(audit!.source).toBe('src/features/audit-engine');
    expect(audit!.posture.hasTests).toBe(true);
    // the Run/Build Observer (#2) is indexed and its audit posture is derived from its real source
    const observer = graph.search({ text: 'build-observer' }).find((n) => n.name === 'build-observer');
    expect(observer).toBeTruthy();
    expect(observer!.posture.hasAudit).toBe(true); // it references the hash-chain audit
    // db-table nodes come from the real migrations (underscore-preserving id)
    expect(graph.search({ kind: 'db-table' }).some((n) => n.name === 'audit_intent')).toBe(true);
  });

  it('search answers "do we already have this?" over the real index (by kind / by posture)', () => {
    const graph = factoryCapabilityGraph(REPO_ROOT);
    expect(graph.search({ kind: 'engine' }).length).toBeGreaterThan(3);
    expect(graph.search({ kind: 'feature', posture: { packageable: true } }).length).toBeGreaterThan(0);
    expect(graph.search({ text: 'a-capability-that-does-not-exist-xyzzy' })).toEqual([]); // honest absence
  });
});

describe('capability-reuse-graph — audited to the hash-chain (verifyChain ok), secret-free', () => {
  it('recording an index event + a query event verifies on the chain and stores only allowlisted metadata', async () => {
    const graph = factoryCapabilityGraph(REPO_ROOT);
    const g = graph.graph;
    const auditor = factoryCapabilityGraphAuditor(sink, ORG);

    const r1 = await auditor.record({ type: 'graph.indexed', nodes: g.nodes.length, edges: g.edges.length, kinds: kindCounts(g) });
    const hits = graph.search({ kind: 'engine', text: 'audit' }).length;
    const r2 = await auditor.record({ type: 'graph.queried', query: { kind: 'engine', text: 'audit' }, hits });
    expect(r2.seq).toBe(r1.seq + 1);

    const v = await sink.verifyChain(ORG);
    expect(v.ok).toBe(true); // "what the graph indexed / was asked" is tamper-evident evidence

    const rows = await sink.readEntries(ORG);
    expect(rows.filter((x) => x.kind === 'read').length).toBeGreaterThanOrEqual(2);
    // no secret persisted (there is none in structural facts; the guarantee holds regardless) — raw RLS-scoped read
    const client = new Client({ ...cfg, user: 'ece_app' });
    await client.connect();
    try {
      await client.query(`SET app.current_org = '${ORG}'`);
      const raw = await client.query<{ query_range: unknown }>(`SELECT query_range FROM audit_read_log WHERE organization_id = $1`, [ORG]);
      const dump = JSON.stringify(raw.rows);
      expect(dump).not.toMatch(/ghp_[A-Za-z0-9]{20,}|PGPASSWORD|privateKey/);
      expect(dump).toMatch(/graph\.indexed/); // the index event landed on the chain
    } finally { await client.end(); }
  });
});
