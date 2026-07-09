// State API — every endpoint returns a valid FactoryStateEnvelope whose data validates against its contract and
// whose meta.head is the real HEAD. git + vitest are injected fakes (no real repo/subprocess). HEAD-keyed cache
// is exercised (a second /state/tests hit does not re-invoke the runner on a clean tree).
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStateApi } from './state-api.js';
import { GitStateSchema, CapabilityStateSchema, StoreStateSchema, EvidenceIndexSchema, LawTestRunSchema, TestSuiteRunSchema, Run, provenanced } from '../contracts/index.js';
import { z } from 'zod';

const tmps: string[] = [];
afterEach(() => { while (tmps.length) { try { rmSync(tmps.pop()!, { recursive: true, force: true }); } catch { /* best effort */ } } });

const US = '\x1f';
const gitRun = (cmd: string, dirty = false) => cmd.includes('rev-parse HEAD') ? 'HEADSHA'
  : cmd.includes('abbrev-ref') ? 'main'
  : cmd.includes('status --porcelain') ? (dirty ? ' M x' : '')
  : cmd.includes('log -5') ? `s${US}subj${US}auth${US}2026-01-01T00:00:00Z` : '';

function makeApi(opts: { dirty?: boolean; onRun?: () => void } = {}) {
  let runs = 0;
  const vitestRunner = () => { runs += 1; opts.onRun?.(); return JSON.stringify({ numTotalTests: 2, numPassedTests: 1, numFailedTests: 1, testResults: [{ name: 'x.test.ts', assertionResults: [{ title: 'Prohibition 4a', status: 'passed' }, { title: 'Prohibition 4b', status: 'failed' }] }] }); };
  const storeRoot = mkdtempSync(join(tmpdir(), 'ece-api-')); tmps.push(storeRoot); // isolated empty factory-state
  const api = createStateApi({ now: () => '2026-07-09T00:00:00.000Z', gitRun: (c) => gitRun(c, opts.dirty), vitestRunner, storeRoot });
  return { api, runCount: () => runs };
}

describe('State API — envelopes, provenance, cache', () => {
  it('every endpoint returns a valid envelope pinned to HEAD; data validates against its contract', () => {
    const { api } = makeApi();
    const meta = (p: string) => api.handle(p).meta;
    expect(meta('/state/git')).toMatchObject({ apiVersion: 'read-plane/1', head: 'HEADSHA' });

    expect(GitStateSchema.safeParse(api.handle('/state/git').data).success).toBe(true);
    expect(CapabilityStateSchema.safeParse(api.handle('/state/capabilities').data).success).toBe(true);
    expect(StoreStateSchema.safeParse(api.handle('/state/stores').data).success).toBe(true);
    expect(EvidenceIndexSchema.safeParse(api.handle('/state/evidence').data).success).toBe(true);
    // stores flip to present-and-empty on an isolated root (present-and-empty is truth, not a mocked record)
    const stores = api.handle('/state/stores').data as { approvals: { status: string; value: { count: number } } };
    expect(stores.approvals.status).toBe('present');
    expect(stores.approvals.value.count).toBe(0);
    expect(LawTestRunSchema.safeParse(api.handle('/state/laws').data).success).toBe(true);
    expect(TestSuiteRunSchema.safeParse(api.handle('/state/tests').data).success).toBe(true);
    expect(z.array(provenanced(Run)).safeParse(api.handle('/state/reports').data).success).toBe(true);

    const one = api.handle('/state/reports/Identity & Access');
    expect(provenanced(z.unknown()).safeParse(one.data).success).toBe(true); // present report or honest-absent

    expect(api.handle('/healthz').data).toMatchObject({ ok: true, head: 'HEADSHA' });
  });

  it('HEAD-keyed cache: a clean-tree /state/tests runs vitest ONCE, then serves cached', () => {
    const { api, runCount } = makeApi({ dirty: false });
    api.handle('/state/tests'); api.handle('/state/tests');
    expect(runCount()).toBe(1); // cached on the second hit (clean tree, same HEAD)
  });

  it('DIRTY tree bypasses the cache (re-runs) and surfaces dirty in provenance', () => {
    const { api, runCount } = makeApi({ dirty: true });
    const t1 = api.handle('/state/tests'); api.handle('/state/tests');
    expect(runCount()).toBe(2); // never cached while dirty
    const data = t1.data as { dirty: { status: string; value: boolean } };
    expect(data.dirty.value).toBe(true);
  });

  it('an unknown route throws (no silent empty response)', () => {
    const { api } = makeApi();
    expect(() => api.handle('/state/nope')).toThrow(/no route/);
  });
});
