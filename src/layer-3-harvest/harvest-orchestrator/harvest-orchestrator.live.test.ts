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
import { RepoScout } from '../repo-scout/repo-scout.js';

const TOKEN = process.env.GITHUB_TOKEN?.trim();
const HAS_TOKEN = !!TOKEN;
const REPORT_PATH = join(__dirname, '..', '..', '..', 'docs', 'HARVEST_REPORT_LEGAL_CONTRACT_OPS.md');

describe('Harvest Orchestrator — LIVE end-to-end (skips without GITHUB_TOKEN)', () => {
  it.skipIf(!HAS_TOKEN)('runs the full chain for Legal & Contract Operations and writes the Harvest Report', async () => {
    const scout = new RepoScout({ token: TOKEN }); // real GitHub reads live in repo-scout only
    const orch = new HarvestOrchestrator(scout, { maxPerSubDomain: 5 });

    const res = await orch.run('Legal & Contract Operations');

    // The chain must complete against real GitHub and produce a STOP report.
    expect(res.status).toBe('OK');
    expect(res.report).not.toBeNull();
    expect(res.report!.status).toBe('STOP-AWAITING-HUMAN-APPROVAL');
    expect(res.report!.subDomains.length).toBe(5);
    expect(res.reportMarkdown && res.reportMarkdown.length).toBeGreaterThan(0);

    // The token must NEVER appear in the report.
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
