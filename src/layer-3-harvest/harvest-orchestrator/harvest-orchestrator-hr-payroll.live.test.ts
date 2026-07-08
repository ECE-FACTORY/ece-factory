// LIVE end-to-end test for the Harvest Orchestrator — runs the FULL enriched chain for "HR & Payroll"
// against real GitHub (via the committed repo-scout + repo-scout-signals) and writes the real Harvest Report
// to docs/HARVEST_REPORT_HR_PAYROLL.md.
//
// It SKIPS CLEANLY when GITHUB_TOKEN is unset, so the default suite never touches the network and writes no
// report. The human runs it themselves with their own read-only public-scope token:
//
//     GITHUB_TOKEN=xxx npx vitest run src/layer-3-harvest/harvest-orchestrator/harvest-orchestrator-hr-payroll.live.test.ts
//     cat docs/HARVEST_REPORT_HR_PAYROLL.md
//
// The builder never supplies or handles the token. This file never hardcodes or prints one. It is a
// domain-parameterized twin of harvest-orchestrator.live.test.ts (Legal & Contract Operations) — same live
// wiring, same read-only guarantees, only the target domain and the report path differ.

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
const REPORT_PATH = join(__dirname, '..', '..', '..', 'docs', 'HARVEST_REPORT_HR_PAYROLL.md');

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

describe('Harvest Orchestrator — LIVE end-to-end for HR & Payroll (skips without GITHUB_TOKEN)', () => {
  it.skipIf(!HAS_TOKEN)('runs the full ENRICHED chain for HR & Payroll and writes the Harvest Report', async () => {
    const scout = new RepoScout({ token: TOKEN }); // real GitHub reads live in repo-scout only
    const orch = new HarvestOrchestrator(scout, { maxPerSubDomain: 5, signalsPort: liveSignalsPort(TOKEN!) });

    const res = await orch.run('HR & Payroll');

    // SECURITY GATE BEFORE PERSISTENCE: scan the in-memory report for any credential material and THROW without
    // writing if found — a token-contaminated report must NEVER touch disk. This covers the live token itself
    // plus generic GitHub credential prefixes (fail-closed even if the token shape changes). Only a CLEAN report
    // is persisted; and it is persisted the moment the chain returns, BEFORE any band/structure assertion, so a
    // later assertion failure can never destroy the report this ~50s live run produced.
    if (res.reportMarkdown) {
      const haystack = res.reportMarkdown.toLowerCase();
      const leak = [TOKEN!, 'ghp_', 'ghs_', 'gho_', 'github_token'].find((p) => haystack.includes(p.toLowerCase()));
      if (leak) throw new Error('Refusing to persist Harvest Report: credential pattern detected in report — not written to disk.');
      writeFileSync(REPORT_PATH, res.reportMarkdown, 'utf8');
      // eslint-disable-next-line no-console
      console.log(`Harvest Report written to ${REPORT_PATH}`);
    }

    // The chain must complete against real GitHub and produce a STOP report over 5 sub-domains.
    expect(res.status).toBe('OK');
    expect(res.report).not.toBeNull();
    expect(res.report!.status).toBe('STOP-AWAITING-HUMAN-APPROVAL');
    expect(res.report!.subDomains.length).toBe(5);
    expect(res.reportMarkdown && res.reportMarkdown.length).toBeGreaterThan(0);
    expect(res.reportMarkdown!).toContain('# Harvest Report — HR & Payroll');

    // The enriched chain ran: the report carries the confidence-gated signals column.
    expect(res.reportMarkdown!).toContain('Signals (confidence-gated)');

    // STRUCTURAL GUARANTEE: every enriched candidate lands in one of the real, valid score bands the grader can
    // legitimately emit — the enriched chain never produces an out-of-range or fabricated band. 'acceptable' and
    // 'strong' are legitimate, better outcomes, NOT test failures; the auto-FORK gate is enforced downstream by
    // the orchestrator (score + measuredCount + air-gap), not by capping a candidate's band here.
    for (const sd of res.report!.subDomains) {
      for (const c of sd.candidates) {
        if (c.enrichment.applied) expect(['reject', 'risky', 'acceptable', 'strong']).toContain(c.score.band);
      }
    }
  }, 120_000);

  it.skipIf(HAS_TOKEN)('is skipped because GITHUB_TOKEN is not set (documented no-op — writes nothing)', () => {
    expect(HAS_TOKEN).toBe(false);
  });
});
