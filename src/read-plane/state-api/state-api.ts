// Factory State API (Design §4) — a local, read-only router. Each route calls an adapter and wraps the result in
// a FactoryStateEnvelope { data, meta:{apiVersion, head, generatedAt} }; the envelope pins the whole response to
// the HEAD commit. The API stamps NO provenance itself — it only composes what the adapters (the sole readers)
// already stamped. Law/Test runs are cached keyed by HEAD (ratified §8); a DIRTY tree bypasses the cache and is
// surfaced in the run's provenance. All injectable (gitRun, docsDir, vitestRunner) so tests never hit git/vitest.

import { gitState, type GitAdapterOpts } from '../adapters/git-adapter.js';
import { listReports, getReport } from '../adapters/report-adapter.js';
import { capabilityState } from '../adapters/capability-adapter.js';
import { storeState } from '../adapters/store-adapter.js';
import { testSuiteRun, lawTestRun, type VitestRunner } from '../adapters/test-adapter.js';
import type { EnvelopeMeta, FactoryStateEnvelope } from '../contracts/index.js';

export const API_VERSION = 'read-plane/1';

export interface StateApiDeps {
  now?: () => string;
  gitRun?: GitAdapterOpts['run'];
  docsDir?: string;
  vitestRunner?: VitestRunner;
}

export function createStateApi(deps: StateApiDeps = {}) {
  const now = deps.now ?? (() => new Date().toISOString());
  const cache = new Map<string, FactoryStateEnvelope<unknown>>(); // HEAD-keyed cache for laws/tests

  function handle(path: string): FactoryStateEnvelope<unknown> {
    const g = gitState({ now, run: deps.gitRun });
    // gitState always returns present values; narrow the Provenanced union to the concrete value.
    const head = g.head.status === 'present' ? g.head.value : '';
    const dirty = g.dirty.status === 'present' ? g.dirty.value : false;
    const meta: EnvelopeMeta = { apiVersion: API_VERSION, head, generatedAt: now() };
    const env = <T>(data: T): FactoryStateEnvelope<T> => ({ data, meta });

    // Cache only clean-tree law/test runs, keyed by HEAD; a dirty tree always re-runs (and surfaces dirty).
    const cachedRun = (route: string, compute: () => FactoryStateEnvelope<unknown>): FactoryStateEnvelope<unknown> => {
      if (dirty) return compute();
      const key = `${route}:${head}`;
      const hit = cache.get(key);
      if (hit) return hit;
      const val = compute();
      cache.set(key, val);
      return val;
    };

    if (path === '/healthz') return { data: { ok: true, head, apiVersion: API_VERSION }, meta };
    if (path === '/state/git') return env(g);
    if (path === '/state/reports') return env(listReports({ now, docsDir: deps.docsDir }));
    if (path.startsWith('/state/reports/')) return env(getReport(decodeURIComponent(path.slice('/state/reports/'.length)), { now, docsDir: deps.docsDir }));
    if (path === '/state/capabilities') return env(capabilityState(now));
    if (path === '/state/stores') return env(storeState(now));
    if (path === '/state/laws') return cachedRun('laws', () => env(lawTestRun({ head, dirty, now, runner: deps.vitestRunner })));
    if (path === '/state/tests') return cachedRun('tests', () => env(testSuiteRun({ head, dirty, now, runner: deps.vitestRunner })));
    throw new Error(`no route: ${path}`);
  }

  return { handle };
}
