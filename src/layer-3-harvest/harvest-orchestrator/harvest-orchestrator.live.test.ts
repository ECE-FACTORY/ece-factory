// LIVE end-to-end test for the Harvest Orchestrator — runs the FULL chain for "Legal & Contract
// Operations" against real GitHub (via the committed repo-scout) and writes the real Harvest Report to
// docs/HARVEST_REPORT_LEGAL_CONTRACT_OPS.md.
//
// It SKIPS CLEANLY when GITHUB_TOKEN is unset, so the default suite never touches the network and writes
// no report. The human runs it themselves with their own read-only public-scope token:
//
//     GITHUB_TOKEN=xxx npx vitest run src/layer-3-harvest/harvest-orchestrator/harvest-orchestrator.live.test.ts
//     cat docs/HARVEST_REPORT_LEGAL_CONTRACT_OPS.md
//
// The builder never supplies or handles the token. This file never hardcodes or prints one.

import { describe, it, expect } from 'vitest';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { HarvestOrchestrator } from './harvest-orchestrator.js';
import type { SignalsScoutPort } from './harvest-orchestrator.js';
import { RepoScout } from '../repo-scout/repo-scout.js';
import { RepoScoutSignals } from '../repo-scout-signals/repo-scout-signals.js';
import { normalizeGithubToken } from '../../factory-shared/github-token/github-token.js';

// Route through the shared guard: a blank / whitespace-only / malformed GITHUB_TOKEN is treated as ABSENT,
// so `GITHUB_TOKEN=` no longer triggers an unauthenticated live run — it SKIPS exactly like a missing token.
const TOKEN = normalizeGithubToken(process.env.GITHUB_TOKEN);
const HAS_TOKEN = !!TOKEN;
const REPORT_PATH = join(__dirname, '..', '..', '..', 'docs', 'HARVEST_REPORT_LEGAL_CONTRACT_OPS.md');

// One read-only lookup of the repo's default branch (the base ScoutedCandidate does not carry it). The token
// is used ONLY in the Authorization header here and is NEVER logged; on any miss we fall back to 'main'.
async function resolveDefaultBranch(owner: string, name: string, token: string): Promise<string> {
  try {
    const res = await fetch(`https://api.github.com/repos/${owner}/${name}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'ece-harvest-live' },
    });
    if (res.ok) {
      const j = (await res.json()) as { default_branch?: unknown };
      if (typeof j.default_branch === 'string' && j.default_branch) return j.default_branch;
    }
  } catch { /* read-only lookup failed — signals will degrade to deny-by-default on a wrong branch */ }
  return 'main';
}

// The read-only signals adapter: repo-scout-signals owns all of its network egress. The orchestrator hands us
// only owner/name; we resolve the branch and delegate. A throw here is caught by the orchestrator (⇒ null ⇒
// that candidate is graded deny-by-default, never fabricated).
function liveSignalsPort(token: string): SignalsScoutPort {
  return {
    gather: async ({ owner, name }) => {
      const branch = await resolveDefaultBranch(owner, name, token);
      return new RepoScoutSignals({ token }).gather({ owner, name, branch });
    },
  };
}

describe('Harvest Orchestrator — LIVE end-to-end (skips without GITHUB_TOKEN)', () => {
  it.skipIf(!HAS_TOKEN)('runs the full ENRICHED chain for Legal & Contract Operations and writes the Harvest Report', async () => {
    const scout = new RepoScout({ token: TOKEN }); // real GitHub reads live in repo-scout only
    const orch = new HarvestOrchestrator(scout, { maxPerSubDomain: 5, signalsPort: liveSignalsPort(TOKEN!) });

    const res = await orch.run('Legal & Contract Operations', 'sovereign');

    // The chain must complete against real GitHub and produce a STOP report.
    expect(res.status).toBe('OK');
    expect(res.report).not.toBeNull();
    expect(res.report!.status).toBe('STOP-AWAITING-HUMAN-APPROVAL');
    expect(res.report!.subDomains.length).toBe(5);
    expect(res.reportMarkdown && res.reportMarkdown.length).toBeGreaterThan(0);

    // The enriched chain ran: the report carries the confidence-gated signals column.
    expect(res.reportMarkdown!).toContain('Signals (confidence-gated)');

    // Enrichment can SHARPEN but never manufacture a FORK from signals — air-gap + white-label stay
    // deny-by-default, so no candidate may exceed 'risky' on signals alone (this is a structural guarantee,
    // not a claim about any specific live repo).
    for (const sd of res.report!.subDomains) {
      for (const c of sd.candidates) {
        if (c.enrichment.applied) expect(['reject', 'risky']).toContain(c.score.band);
      }
    }

    // The token must NEVER appear anywhere in the report (covers scout + signals enrichment evidence).
    expect(res.reportMarkdown!).not.toContain(TOKEN!);

    // Write the real artifact for the human gate.
    writeFileSync(REPORT_PATH, res.reportMarkdown!, 'utf8');
    // eslint-disable-next-line no-console
    console.log(`Harvest Report written to ${REPORT_PATH}`);
  }, 120_000);

  it.skipIf(HAS_TOKEN)('is skipped because GITHUB_TOKEN is not set (documented no-op — writes nothing)', () => {
    expect(HAS_TOKEN).toBe(false);
  });
});
