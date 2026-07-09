// @vitest-environment jsdom
// COMMAND CENTER — Rule 0 at the page level:
//   0c.5 — every rendered operational value traces to a real API field (walk the DOM, check
//          each [data-operational] against the actual envelopes from createStateApi).
//   0c.6 — kill the API ⇒ every operational slot flips to "unavailable", none shows a value.
//   0c.7 — Discrepancy Detector stub: clean envelopes ⇒ no banner (asserted); a drifted
//          envelope HEAD ⇒ red banner.
// Envelopes come from the REAL createStateApi (real store/capability/report reads; git + vitest
// via injected canned runners so the read-plane suite never recursively spawns). Not mocked.

import { describe, it, expect, afterEach } from 'vitest';
import { createElement } from 'react';
import { render, cleanup, waitFor } from '@testing-library/react';
import { createStateApi } from '../read-plane/state-api/state-api.js';
import { StateClientProvider } from './client/data/state-context.js';
import { CommandCenter } from './client/pages/command-center/CommandCenter.js';
import { detectDiscrepancies } from './client/pages/command-center/discrepancy.js';
import type { EnvelopeClient } from './client/data/use-envelope.js';

const US = '\x1f';
const HEAD = 'HEADSHA';
const gitRun = (cmd: string) =>
  cmd.includes('rev-parse HEAD') ? HEAD
    : cmd.includes('abbrev-ref') ? 'main'
      : cmd.includes('status --porcelain') ? ''
        : cmd.includes('log -5') ? `${HEAD}${US}console step 2${US}bitez${US}2026-07-09T00:00:00Z` : '';
const vitestRunner = () => JSON.stringify({
  numTotalTests: 2, numPassedTests: 1, numFailedTests: 1,
  testResults: [{ name: 'x.test.ts', assertionResults: [{ title: 'Prohibition 4a', status: 'passed' }, { title: 'Prohibition 4b', status: 'failed' }] }],
});

/** A client backed by the real read plane (repo factory-state as store root). */
function realClient(): EnvelopeClient {
  const api = createStateApi({ now: () => '2026-07-09T00:00:00.000Z', gitRun, vitestRunner, storeRoot: process.cwd() });
  return async (path: string) => api.handle(path);
}
const ROUTES = ['/state/git', '/state/tests', '/state/laws', '/state/capabilities', '/state/stores', '/state/reports', '/state/evidence'];
const REAL_SOURCES = new Set(['git', 'test-run', 'source-constant', 'store-file', 'report-file', 'derived']);

function renderCC(client: EnvelopeClient) {
  return render(createElement(StateClientProvider, { client }, createElement(CommandCenter)));
}

afterEach(() => cleanup());

describe('Command Center — Rule 0 at the page', () => {
  it('0c.5 — every rendered operational value traces to a real API field', async () => {
    const client = realClient();
    const { container } = renderCC(client);
    await waitFor(() => expect(container.querySelector('[data-operational][data-value="HEADSHA"]')).toBeTruthy());

    const combined = (await Promise.all(ROUTES.map((r) => client(r)))).map((e) => JSON.stringify(e)).join('\n');
    const nodes = Array.from(container.querySelectorAll('[data-operational]'));
    expect(nodes.length).toBeGreaterThan(6);

    for (const n of nodes) {
      const source = n.getAttribute('data-prov-source');
      expect(source, `node ${n.getAttribute('data-field')} has a provenance source`).toBeTruthy();
      expect(REAL_SOURCES.has(source ?? ''), `source '${source}' is a real read source`).toBe(true);
      const value = n.getAttribute('data-value');
      // Directly-read scalars must appear VERBATIM in an envelope. Derived values (source
      // 'derived') trace via their named route locator, not verbatim, so are exempt here.
      if (value !== null && source !== 'derived') {
        expect(combined.includes(value), `value "${value}" (${n.getAttribute('data-field')}) traces to an envelope`).toBe(true);
      }
    }
    // A concrete real trace: HEAD is git-sourced and present in the git envelope.
    const head = container.querySelector('[data-field="git.head"]')!;
    expect(head.getAttribute('data-prov-source')).toBe('git');
    expect(combined.includes('HEADSHA')).toBe(true);
    // Clean state ⇒ no discrepancy banner (asserted, not assumed).
    expect(container.querySelector('.banner--discrepancy')).toBeNull();
  });

  it('0c.6 — kill the API ⇒ every operational slot is "unavailable", none shows a value', async () => {
    const killClient: EnvelopeClient = async () => {
      throw new Error('ECONNREFUSED: state API down');
    };
    const { container } = renderCC(killClient);
    await waitFor(() => {
      const nodes = Array.from(container.querySelectorAll('[data-operational]'));
      expect(nodes.length).toBeGreaterThan(6);
      for (const n of nodes) {
        expect(n.hasAttribute('data-unavailable'), `${n.getAttribute('data-field')} is unavailable`).toBe(true);
        expect(n.getAttribute('data-value')).toBeNull(); // no value shown cached-as-current
        expect(n.textContent).toContain('unavailable');
      }
    });
  });

  it('0c.7 — detector: clean ⇒ [], drift ⇒ flagged (pure)', () => {
    expect(detectDiscrepancies({ gitHead: 'abc123', recentTopSha: 'abc123', envelopeHeads: [{ route: '/state/tests', head: 'abc123' }] })).toEqual([]);
    const drift = detectDiscrepancies({ gitHead: 'abc123', recentTopSha: 'abc123', envelopeHeads: [{ route: '/state/tests', head: 'zzz999' }] });
    expect(drift).toHaveLength(1);
    expect(drift[0].kind).toBe('envelope-head-drift');
    const notLatest = detectDiscrepancies({ gitHead: 'abc123', recentTopSha: 'xyz000', envelopeHeads: [] });
    expect(notLatest[0].kind).toBe('head-not-latest');
  });

  it('0c.7 — a drifted envelope HEAD renders the red discrepancy banner', async () => {
    const base = realClient();
    const driftClient: EnvelopeClient = async (path) => {
      const env = await base(path);
      return path === '/state/tests' ? { ...env, meta: { ...env.meta, head: 'DRIFTEDHEAD' } } : env;
    };
    const { container } = renderCC(driftClient);
    await waitFor(() => expect(container.querySelector('.banner--discrepancy')).toBeTruthy());
    expect(container.querySelector('.banner--discrepancy')!.textContent).toContain('DRIFTED'.slice(0, 7));
  });
});
