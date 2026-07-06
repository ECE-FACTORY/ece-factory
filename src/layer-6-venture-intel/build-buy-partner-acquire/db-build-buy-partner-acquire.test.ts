import { describe, it, expect, afterAll } from 'vitest';
import pkg from 'pg';
const { Pool, Client } = pkg;
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PostgresHashChainSink } from '../../factory-shared/audit-engine/postgres-sink.js';
import { RedactionEngine } from '../../factory-shared/redaction-engine/redaction-engine.js';
import { factoryCapabilityGraph } from '../../mcp-server/live-capability-reuse-graph.js';
import { factoryInternalReuseEngine } from '../../mcp-server/live-internal-reuse-engine.js';
import { factoryExternalHarvestComposer } from '../../mcp-server/live-external-harvest-composer.js';
import { factoryBuildBuyPartnerAcquireEngine, factoryUnifiedSourcingAuditor, resolveCapabilitySourcing } from '../../mcp-server/live-build-buy-partner-acquire.js';
import type { ExternalCandidate } from '../../layer-3-harvest/external-harvest-composer/external-harvest-composer.js';

// VI Wave Phase 4 — the FULL structural backbone end-to-end (Phase-2 internal reuse → Phase-3 external harvest →
// Phase-4 unify) with the REAL engines, against REAL PostgreSQL. Proves: a need matching a real internal
// capability ⇒ REUSE (never BUILD — anti-rebuild through the whole chain); a genuinely-absent need + a permissive
// strong external candidate ⇒ BUY; exactly one verdict; and recording to the hash-chain audit verifies.

const cfg = { host: process.env.PGHOST ?? '127.0.0.1', port: Number(process.env.PGPORT ?? 55432), database: process.env.PGDATABASE ?? 'ece_audit_test' };
const pool = new Pool({ ...cfg, user: 'ece_app' });
const sink = new PostgresHashChainSink(pool, new RedactionEngine());
afterAll(async () => { await pool.end(); });

const ORG = `orgBB-${process.pid}`;
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** A permissive, mature, sovereign-ready external candidate (real engine inputs) for absent capabilities. */
function strongExternal(): ExternalCandidate {
  return {
    name: 'acme-oss', description: 'a permissive external library', internalAbsence: 'BUILD_CUSTOM',
    license: { text: 'MIT License\n\nPermission is hereby granted, free of charge, to any person obtaining a copy of this software.' },
    scoring: { license: { decision: 'ACCEPT', detected: 'MIT' }, maturity: { stars: 9000, activelyMaintained: true }, airGap: 'yes', whiteLabel: 'easy', archFit: { rating: 'strong' }, maintainability: { rating: 'clean' }, proposedVerdict: 'FORK' },
    sovereign: {}, whiteLabel: [],
  };
}
function build() {
  const reuse = factoryInternalReuseEngine(factoryCapabilityGraph(REPO_ROOT));
  const harvest = factoryExternalHarvestComposer();
  const engine = factoryBuildBuyPartnerAcquireEngine();
  return { reuse, harvest, engine };
}

describe('build-buy-partner-acquire — FULL backbone (Phase 2→3→4) with the REAL engines', () => {
  it('a need matching a real internal capability ⇒ REUSE (never BUILD — anti-rebuild end-to-end)', () => {
    const { reuse, harvest, engine } = build();
    const d = resolveCapabilitySourcing(reuse, harvest, engine, { description: 'a tamper-evident audit ledger', terms: ['audit', 'engine'], kind: 'engine' }, () => strongExternal());
    expect(d.verdict).toBe('REUSE');
    expect(d.verdict).not.toBe('BUILD');
    expect(d.external).toBeNull();          // internal won — Phase 3 not consulted
    expect(d.advisory).toBe(false);
  });

  it('a genuinely-absent need + a permissive strong external candidate ⇒ BUY', () => {
    const { reuse, harvest, engine } = build();
    const d = resolveCapabilitySourcing(reuse, harvest, engine, { description: 'a quantum teleportation relay', terms: ['quantum', 'teleportation', 'relay'] }, () => strongExternal());
    expect(d.internal.classification).toBe('BUILD_CUSTOM'); // Phase 2 found genuine absence
    expect(d.verdict).toBe('BUY');                          // Phase 3 adoptable ⇒ Phase 4 BUY
    expect(d.external).toMatchObject({ classification: expect.stringMatching(/FORK_EXTERNAL|EXTEND_EXTERNAL/), license: 'ACCEPT' });
  });

  it('produces exactly ONE verdict from the 7-space; re-derivable', () => {
    const { reuse, harvest, engine } = build();
    const need = { description: 'redaction of secrets', terms: ['redaction'] };
    const d1 = resolveCapabilitySourcing(reuse, harvest, engine, need, () => strongExternal());
    const d2 = resolveCapabilitySourcing(reuse, harvest, engine, need, () => strongExternal());
    expect(['BUILD', 'BUY', 'PARTNER', 'ACQUIRE', 'REUSE', 'REJECT', 'NEEDS_REVIEW']).toContain(d1.verdict);
    expect(JSON.stringify(d1)).toBe(JSON.stringify(d2));
  });
});

describe('build-buy-partner-acquire — audited to the hash-chain (verifyChain ok), secret-free', () => {
  it('recording unified verdicts verifies on the chain and stores only allowlisted, secret-free metadata', async () => {
    const { reuse, harvest, engine } = build();
    const auditor = factoryUnifiedSourcingAuditor(sink, ORG);
    const reuseD = resolveCapabilitySourcing(reuse, harvest, engine, { description: 'audit ledger', terms: ['audit'], kind: 'engine' }, () => strongExternal());
    const buyD = resolveCapabilitySourcing(reuse, harvest, engine, { description: 'quantum relay', terms: ['quantum', 'relay'] }, () => strongExternal());
    const r1 = await auditor.record(reuseD);
    const r2 = await auditor.record(buyD);
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
      expect(dump).toMatch(/sourcing\.decided/);
      expect(dump).toMatch(/REUSE|BUY/);
    } finally { await client.end(); }
  });
});
