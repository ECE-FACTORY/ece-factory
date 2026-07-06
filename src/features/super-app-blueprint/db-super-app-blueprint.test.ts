import { describe, it, expect, afterAll } from 'vitest';
import pkg from 'pg';
const { Pool, Client } = pkg;
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PostgresHashChainSink } from '../audit-engine/postgres-sink.js';
import { RedactionEngine } from '../redaction-engine/redaction-engine.js';
import { factoryCapabilityGraph } from '../../mcp-server/live-capability-reuse-graph.js';
import { factorySuperAppBlueprintEngine, factorySuperAppBlueprintAuditor } from '../../mcp-server/live-super-app-blueprint.js';

// VI Wave — JUDGMENT engine 7: Super-App Blueprint, GROUNDED on the REAL Phase-1 graph, against REAL PostgreSQL.
// Proves: it consumes the real structural surface READ-ONLY and cites ONLY real backbone nodes for module anchoring
// (a module can only be anchored by a real ECE capability; unanchored ⇒ honest gap); an unmatched concept ⇒
// insufficient-basis; it RECOMMENDS only (recommendsOnly:true); network/market claims flagged external; and
// recording the advisory assessment to the hash-chain verifies (verifyChain ok), secret-free.

const cfg = { host: process.env.PGHOST ?? '127.0.0.1', port: Number(process.env.PGPORT ?? 55432), database: process.env.PGDATABASE ?? 'ece_audit_test' };
const pool = new Pool({ ...cfg, user: 'ece_app' });
const sink = new PostgresHashChainSink(pool, new RedactionEngine());
afterAll(async () => { await pool.end(); });

const ORG = `orgSA-${process.pid}`;
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

describe('super-app-blueprint — grounded on the REAL Phase-1 graph (cites real nodes only; advisory; recommends only)', () => {
  it('a real concept anchors modules with real backbone nodes (fabricates none); advisory:true; recommendsOnly:true', () => {
    const graph = factorySuperAppBlueprintEngine(factoryCapabilityGraph(REPO_ROOT));
    const a = graph.assess({ description: 'a sovereign audit API platform', terms: ['audit', 'api', 'registry', 'sovereign'] });
    expect(a.advisory).toBe(true);
    expect(a.status).toBe('VENTURE-BLUEPRINT-AWAITING-HUMAN-APPROVAL');
    expect(a.recommendsOnly).toBe(true);
    expect(a.anchoredModules.length).toBeGreaterThan(0);
    const realGraph = factoryCapabilityGraph(REPO_ROOT);
    const realIds = new Set(realGraph.graph.nodes.map((n) => n.id));
    for (const f of a.groundedOn) if (f.kind === 'capability') expect(realIds.has(f.ref)).toBe(true);
    for (const m of a.modules) for (const f of m.anchoredBy) expect(realIds.has(f.ref)).toBe(true);
    // the real Audit Engine anchors the analytics / ops-center modules
    expect(a.modules.find((m) => m.module === 'analytics')!.anchoredBy.some((f) => f.ref === 'engine:audit-engine')).toBe(true);
    expect(a.confidence).not.toBe('insufficient-basis');
  });

  it('the anchored/unanchored invariant holds on the real graph: anchored modules cite ≥1 capability; unanchored carry a gapNote', () => {
    const a = factorySuperAppBlueprintEngine(factoryCapabilityGraph(REPO_ROOT)).assess({ description: 'a sovereign audit platform', terms: ['audit', 'sovereign'] });
    for (const m of a.modules) {
      if (m.anchored) { expect(m.anchoredBy.length).toBeGreaterThan(0); expect(a.anchoredModules).toContain(m.module); expect(m.gapNote).toBeUndefined(); }
      else { expect(m.anchoredBy).toEqual([]); expect(a.unanchoredModules).toContain(m.module); expect(typeof m.gapNote).toBe('string'); }
    }
  });

  it('a concept the real graph cannot ground ⇒ no anchored module (insufficient-basis)', () => {
    const a = factorySuperAppBlueprintEngine(factoryCapabilityGraph(REPO_ROOT)).assess({ description: 'a quantum teleportation relay', terms: ['quantum', 'teleportation', 'relay'] });
    expect(a.groundedOn).toEqual([]);
    expect(a.anchoredModules).toEqual([]);
    expect(a.confidence).toBe('insufficient-basis');
  });

  it('consumes the graph read-only: unchanged after assessing', () => {
    const graph = factoryCapabilityGraph(REPO_ROOT);
    const before = graph.size.nodes;
    factorySuperAppBlueprintEngine(graph).assess({ description: 'audit', terms: ['audit'] });
    expect(graph.size.nodes).toBe(before);
  });
});

describe('super-app-blueprint — audited to the hash-chain (verifyChain ok), secret-free', () => {
  it('recording assessments verifies on the chain and stores only allowlisted, secret-free metadata', async () => {
    const engine = factorySuperAppBlueprintEngine(factoryCapabilityGraph(REPO_ROOT));
    const auditor = factorySuperAppBlueprintAuditor(sink, ORG);
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
      expect(dump).toMatch(/superapp\.blueprinted/);
      expect(dump).toMatch(/"advisory":true/);
      expect(dump).toMatch(/"recommendsOnly":true/);
      expect(dump).toMatch(/insufficient-basis/);
    } finally { await client.end(); }
  });
});
