import { describe, it, expect, afterAll } from 'vitest';
import pkg from 'pg';
const { Pool, Client } = pkg;
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PostgresHashChainSink } from '../audit-engine/postgres-sink.js';
import { RedactionEngine } from '../redaction-engine/redaction-engine.js';
import { factoryCapabilityGraph } from '../../mcp-server/live-capability-reuse-graph.js';
import { factoryAcquisitionPartnerTargetEngine, factoryAcquisitionPartnerAuditor } from '../../mcp-server/live-acquisition-partner-target.js';

// VI Wave — JUDGMENT engine 5: Acquisition/Partner Target, GROUNDED on the REAL Phase-1 graph, against REAL
// PostgreSQL. Proves: it consumes the real structural surface READ-ONLY and cites ONLY real backbone nodes for ECE
// strengths (fabricates none); gaps are evidenced-absence; the EXTERNAL-COMPANY boundary holds (no unflagged
// company-as-fact; a candidate company is unverified-flagged); an unmatched concept ⇒ insufficient-basis; and
// recording the advisory assessment to the hash-chain verifies (verifyChain ok), secret-free.

const cfg = { host: process.env.PGHOST ?? '127.0.0.1', port: Number(process.env.PGPORT ?? 55432), database: process.env.PGDATABASE ?? 'ece_audit_test' };
const pool = new Pool({ ...cfg, user: 'ece_app' });
const sink = new PostgresHashChainSink(pool, new RedactionEngine());
afterAll(async () => { await pool.end(); });

const ORG = `orgA-${process.pid}`;
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

describe('acquisition-partner-target — grounded on the REAL Phase-1 graph (cites real nodes only; advisory)', () => {
  it('ECE strengths cite real nodes; a genuine gap (billing) is evidenced-absence with a target PROFILE; advisory:true', () => {
    const graph = factoryCapabilityGraph(REPO_ROOT);
    const a = factoryAcquisitionPartnerTargetEngine(graph).assess({ description: 'a sovereign audit platform that also needs billing', terms: ['audit', 'sovereign', 'billing'] });
    expect(a.advisory).toBe(true);
    expect(a.status).toBe('VENTURE-BLUEPRINT-AWAITING-HUMAN-APPROVAL');
    expect(a.eceStrengths.length).toBeGreaterThan(0);
    const realIds = new Set(graph.graph.nodes.map((n) => n.id));
    for (const f of a.eceStrengths) expect(realIds.has(f.ref)).toBe(true);
    for (const f of a.groundedOn) if (f.kind === 'capability') expect(realIds.has(f.ref)).toBe(true);
    // 'billing' is genuinely absent from the real graph ⇒ evidenced-absence gap
    const billing = a.gaps.find((g) => g.need === 'billing');
    expect(billing?.evidencedAbsence).toBe(true);
    expect(a.confidence).not.toBe('insufficient-basis');
  });

  it('external-company boundary on the real graph: names none by default; a candidate is unverified-flagged, never a fact', () => {
    const graph = factoryCapabilityGraph(REPO_ROOT);
    const none = factoryAcquisitionPartnerTargetEngine(graph).assess({ description: 'a sovereign audit platform', terms: ['audit', 'sovereign'] });
    expect(none.externalCompanyClaims).toEqual([]);
    expect(none.overall.namesNoCompanyAsFact).toBe(true);
    const withCandidate = factoryAcquisitionPartnerTargetEngine(graph).assess({ description: 'audit', terms: ['audit'], candidateCompanies: ['SomeVendorInc'] });
    expect(withCandidate.externalCompanyClaims[0].unverified).toBe(true);
    expect(JSON.stringify(withCandidate.eceStrengths)).not.toMatch(/SomeVendorInc/);
  });

  it('a concept the real graph has no capability for ⇒ insufficient-basis (no fabricated complement)', () => {
    const a = factoryAcquisitionPartnerTargetEngine(factoryCapabilityGraph(REPO_ROOT)).assess({ description: 'a quantum teleportation relay', terms: ['quantum', 'teleportation', 'relay'] });
    expect(a.eceStrengths).toEqual([]);
    expect(a.confidence).toBe('insufficient-basis');
  });

  it('consumes the graph read-only: unchanged after assessing', () => {
    const graph = factoryCapabilityGraph(REPO_ROOT);
    const before = graph.size.nodes;
    factoryAcquisitionPartnerTargetEngine(graph).assess({ description: 'audit', terms: ['audit'] });
    expect(graph.size.nodes).toBe(before);
  });
});

describe('acquisition-partner-target — audited to the hash-chain (verifyChain ok), secret-free', () => {
  it('recording assessments verifies on the chain and stores only allowlisted, secret-free metadata', async () => {
    const engine = factoryAcquisitionPartnerTargetEngine(factoryCapabilityGraph(REPO_ROOT));
    const auditor = factoryAcquisitionPartnerAuditor(sink, ORG);
    const r1 = await auditor.record(engine.assess({ description: 'sovereign audit platform + billing', terms: ['audit', 'sovereign', 'billing'], candidateCompanies: ['SomeVendorInc'] }), ['audit', 'sovereign', 'billing']);
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
      expect(dump).toMatch(/acqpartner\.assessed/);
      expect(dump).toMatch(/"advisory":true/);
      expect(dump).toMatch(/"unverified":true/);   // the company hypothesis is recorded WITH its unverified flag
      expect(dump).toMatch(/insufficient-basis/);
    } finally { await client.end(); }
  });
});
