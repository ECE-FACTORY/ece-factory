import { describe, it, expect, afterAll } from 'vitest';
import pkg from 'pg';
const { Pool, Client } = pkg;
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PostgresHashChainSink } from '../audit-engine/postgres-sink.js';
import { RedactionEngine } from '../redaction-engine/redaction-engine.js';
import { factoryCapabilityGraph } from '../../mcp-server/live-capability-reuse-graph.js';
import { factoryPlatformBlueprintRoadmapEngine, factoryPlatformBlueprintRoadmapAuditor } from '../../mcp-server/live-platform-blueprint-roadmap.js';

// VI Wave — MIXED engine: Platform Blueprint / Venture Roadmap, GROUNDED on the REAL Phase-1 graph, against REAL
// PostgreSQL. Proves BOTH bars end-to-end: the STRUCTURAL half is re-derivable from the real repo (deriving twice ⇒
// identical Platform Blueprint) and cites real nodes / deny-by-default gaps; the JUDGMENT half is advisory + honest;
// clean separation holds (distinct advisory markings); and recording BOTH halves to the hash-chain verifies.

const cfg = { host: process.env.PGHOST ?? '127.0.0.1', port: Number(process.env.PGPORT ?? 55432), database: process.env.PGDATABASE ?? 'ece_audit_test' };
const pool = new Pool({ ...cfg, user: 'ece_app' });
const sink = new PostgresHashChainSink(pool, new RedactionEngine());
afterAll(async () => { await pool.end(); });

const ORG = `orgPR-${process.pid}`;
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

describe('platform-blueprint-roadmap — BOTH halves on the REAL Phase-1 graph', () => {
  it('STRUCTURAL half re-derivable from the real repo (identical Platform Blueprint) + cites real nodes; advisory:false', () => {
    const a = factoryPlatformBlueprintRoadmapEngine(factoryCapabilityGraph(REPO_ROOT)).assess({ description: 'a sovereign audit API platform', components: ['audit', 'api', 'billing'] });
    const b = factoryPlatformBlueprintRoadmapEngine(factoryCapabilityGraph(REPO_ROOT)).assess({ description: 'a sovereign audit API platform', components: ['audit', 'api', 'billing'] });
    expect(JSON.stringify(a.platformBlueprint)).toBe(JSON.stringify(b.platformBlueprint)); // re-derivable fact
    expect(a.platformBlueprint.advisory).toBe(false);
    const graph = factoryCapabilityGraph(REPO_ROOT);
    const realIds = new Set(graph.graph.nodes.map((n) => n.id));
    for (const m of a.platformBlueprint.components) for (const f of m.mappedTo) expect(realIds.has(f.ref)).toBe(true);
    expect(a.platformBlueprint.components.find((m) => m.component === 'audit')!.status).toBe('existing');
    expect(a.platformBlueprint.components.find((m) => m.component === 'billing')!.status).toBe('unmapped'); // deny-by-default
    expect(a.platformBlueprint.feedsRepoBuilder).toBe(true);
  });

  it('JUDGMENT half is advisory + grounded + honest; clean separation holds', () => {
    const a = factoryPlatformBlueprintRoadmapEngine(factoryCapabilityGraph(REPO_ROOT)).assess({ description: 'a sovereign audit platform', components: ['audit', 'sovereign'] });
    expect(a.ventureRoadmap.advisory).toBe(true);
    expect(a.ventureRoadmap.confidence).not.toBe('insufficient-basis');
    expect(a.platformBlueprint.advisory).toBe(false);      // fact
    expect(a.ventureRoadmap.advisory).toBe(true);          // opinion — no bleed
    // an all-gap need ⇒ roadmap insufficient-basis, structural blueprint still valid
    const gaps = factoryPlatformBlueprintRoadmapEngine(factoryCapabilityGraph(REPO_ROOT)).assess({ description: 'x', components: ['billing', 'crm'] });
    expect(gaps.ventureRoadmap.confidence).toBe('insufficient-basis');
    expect(gaps.platformBlueprint.advisory).toBe(false);
  });

  it('consumes the graph read-only: unchanged after assessing', () => {
    const graph = factoryCapabilityGraph(REPO_ROOT);
    const before = graph.size.nodes;
    factoryPlatformBlueprintRoadmapEngine(graph).assess({ description: 'audit', components: ['audit'] });
    expect(graph.size.nodes).toBe(before);
  });
});

describe('platform-blueprint-roadmap — audited to the hash-chain (verifyChain ok), secret-free', () => {
  it('recording BOTH halves verifies on the chain and stores distinct advisory markings, secret-free', async () => {
    const engine = factoryPlatformBlueprintRoadmapEngine(factoryCapabilityGraph(REPO_ROOT));
    const auditor = factoryPlatformBlueprintRoadmapAuditor(sink, ORG);
    const r1 = await auditor.record(engine.assess({ description: 'sovereign audit API platform', components: ['audit', 'api', 'sovereign'] }), ['audit', 'api', 'sovereign']);
    const r2 = await auditor.record(engine.assess({ description: 'all gaps', components: ['billing', 'crm'] }), ['billing', 'crm']);
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
      expect(dump).toMatch(/platformroadmap\.assessed/);
      expect(dump).toMatch(/"advisory":false/); // structural half recorded as fact
      expect(dump).toMatch(/"advisory":true/);  // judgment half recorded as opinion
      expect(dump).toMatch(/insufficient-basis/);
    } finally { await client.end(); }
  });
});
