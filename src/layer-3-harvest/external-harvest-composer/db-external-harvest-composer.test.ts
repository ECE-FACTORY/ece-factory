import { describe, it, expect, afterAll } from 'vitest';
import pkg from 'pg';
const { Pool, Client } = pkg;
import { PostgresHashChainSink } from '../../factory-shared/audit-engine/postgres-sink.js';
import { RedactionEngine } from '../../factory-shared/redaction-engine/redaction-engine.js';
import { factoryExternalHarvestComposer, factoryHarvestDecisionAuditor, REAL_SOURCING_ENGINES } from '../../mcp-server/live-external-harvest-composer.js';
import type { ExternalCandidate } from './external-harvest-composer.js';

// VI Wave Phase 3 — the External Harvest Composer driving the REAL Wave-3 sourcing engines (License / Scoring /
// Sovereign / White-Label), against REAL PostgreSQL. Proves: it COMPOSES the existing engines end-to-end (not
// reimplemented); a permissive, high-scoring, sovereign-ready candidate is ADOPTED (FORK/EXTEND_EXTERNAL); a
// non-permissive (AGPL) candidate is REJECTED (deny-by-default) through the real license engine; decisions are
// re-derivable; and recording to the append-only hash-chain audit verifies.

const cfg = { host: process.env.PGHOST ?? '127.0.0.1', port: Number(process.env.PGPORT ?? 55432), database: process.env.PGDATABASE ?? 'ece_audit_test' };
const pool = new Pool({ ...cfg, user: 'ece_app' });
const sink = new PostgresHashChainSink(pool, new RedactionEngine());
afterAll(async () => { await pool.end(); });

const ORG = `orgEH-${process.pid}`;

/** A permissive, mature, sovereign-ready external candidate (real engine inputs). */
function strongCandidate(over: Partial<ExternalCandidate> = {}): ExternalCandidate {
  return {
    name: 'acme-oss', description: 'a permissive, mature external library', internalAbsence: 'BUILD_CUSTOM',
    // real license TEXT (authoritative) — the license engine's deny-by-default treats a bare SPDX badge as NEEDS_REVIEW
    license: { text: 'MIT License\n\nPermission is hereby granted, free of charge, to any person obtaining a copy of this software.', declaredSpdx: 'MIT' },
    scoring: {
      license: { decision: 'ACCEPT', detected: 'MIT' },
      maturity: { stars: 9000, activelyMaintained: true, contributors: 80, lastCommitIso: '2026-06-01T00:00:00Z' },
      airGap: 'yes', whiteLabel: 'easy',
      archFit: { rating: 'strong' }, maintainability: { rating: 'clean' },
      proposedVerdict: 'FORK',
    },
    sovereign: {}, whiteLabel: [], ...over,
  };
}

describe('external-harvest-composer — composes the REAL sourcing engines end-to-end', () => {
  it('a permissive + high-score + sovereign-ready candidate is ADOPTED (FORK_EXTERNAL or EXTEND_EXTERNAL)', () => {
    const d = factoryExternalHarvestComposer().compose(strongCandidate());
    expect(['FORK_EXTERNAL', 'EXTEND_EXTERNAL']).toContain(d.classification); // adopted via the real engines
    expect(d.evidence.license).toBe('ACCEPT');     // real license engine
    expect(d.evidence.scoreTotal).toBeGreaterThanOrEqual(70); // real scoring engine
    expect(d.advisory).toBe(false);
  });

  it('a NON-PERMISSIVE (AGPL) candidate is REJECTED via the real license engine (deny-by-default, never FORK)', () => {
    const d = factoryExternalHarvestComposer().compose(strongCandidate({ license: { text: 'GNU AFFERO GENERAL PUBLIC LICENSE Version 3' }, scoring: { license: { decision: 'REJECT', detected: 'AGPL' }, proposedVerdict: 'FORK' } }));
    expect(d.classification).toBe('REJECT');
    expect(['FORK_EXTERNAL', 'EXTEND_EXTERNAL']).not.toContain(d.classification);
  });

  it('re-derivable: same candidate + same real engines ⇒ identical decision', () => {
    const c = strongCandidate();
    expect(JSON.stringify(factoryExternalHarvestComposer().compose(c))).toBe(JSON.stringify(factoryExternalHarvestComposer().compose(c)));
  });

  it('the composer only READS the engines (they are pure functions; no mutation door on the port)', () => {
    const port = REAL_SOURCING_ENGINES as unknown as Record<string, unknown>;
    for (const m of ['mutate', 'write', 'execute', 'approve']) expect(typeof port[m]).toBe('undefined');
  });
});

describe('external-harvest-composer — audited to the hash-chain (verifyChain ok), secret-free', () => {
  it('recording decisions verifies on the chain and stores only allowlisted, secret-free metadata', async () => {
    const composer = factoryExternalHarvestComposer();
    const auditor = factoryHarvestDecisionAuditor(sink, ORG);
    const r1 = await auditor.record(composer.compose(strongCandidate()));
    const r2 = await auditor.record(composer.compose(strongCandidate({ license: { text: 'GNU AFFERO GENERAL PUBLIC LICENSE Version 3' }, scoring: { license: { decision: 'REJECT', detected: 'AGPL' }, proposedVerdict: 'FORK' } })));
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
      expect(dump).toMatch(/harvest\.composed/);
      expect(dump).toMatch(/REJECT/); // the deny-by-default decision is on the chain
    } finally { await client.end(); }
  });
});
