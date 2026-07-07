// LIVE test for Repo Scout Signals — reads ONE real repo and emits all four dimensions with confidences.
//
// SKIPS CLEANLY when GITHUB_TOKEN is unset. The human runs it with their own read-only public-scope token:
//
//     GITHUB_TOKEN=xxx npx vitest run src/layer-3-harvest/repo-scout-signals/repo-scout-signals.live.test.ts
//
// The builder never supplies or handles the token; this file never hardcodes or prints one.

import { describe, it, expect } from 'vitest';
import { RepoScoutSignals } from './repo-scout-signals.js';
import { normalizeGithubToken } from '../../factory-shared/github-token/github-token.js';

// Route through the shared guard: a blank / whitespace-only / malformed GITHUB_TOKEN is treated as ABSENT,
// so `GITHUB_TOKEN=` no longer triggers an unauthenticated live run — it SKIPS exactly like a missing token.
const TOKEN = normalizeGithubToken(process.env.GITHUB_TOKEN);
const HAS_TOKEN = !!TOKEN;

// A well-known, permissively-licensed repo of the kind the Legal Ops harvest surfaces (a document/PDF lib).
const TARGET = { owner: 'foliojs', name: 'pdfkit', branch: 'master' };

describe('Repo Scout Signals — LIVE (skips without GITHUB_TOKEN)', () => {
  it.skipIf(!HAS_TOKEN)('emits all four dimensions with honest confidences for a real repo', async () => {
    const sig = new RepoScoutSignals({ token: TOKEN });
    const r = await sig.gather(TARGET);

    expect(r.status).toBe('OK');

    // Maintainability should reach "measured" from real data.
    expect(r.maintainability.confidence).toBe('measured');
    expect(r.maintainability.evidence.length).toBeGreaterThan(0);

    // Air-gap must NEVER be "yes"/"measured" from manifest-reading alone (partial or not-mechanizable only).
    expect(['partial', 'not-mechanizable']).toContain(r.airGap.confidence);
    expect(r.airGap.value).not.toBe('yes');

    // White-label must stay not-mechanizable — no fabricated score.
    expect(r.whiteLabel.confidence).toBe('not-mechanizable');

    // Architecture: measured (manifest read) or partial (tree only) — never "strong".
    expect(['measured', 'partial', 'not-mechanizable']).toContain(r.architecture.confidence);
    expect(r.architecture.value).not.toBe('strong');

    // The token must NEVER appear in the output.
    expect(JSON.stringify(r)).not.toContain(TOKEN!);

    // eslint-disable-next-line no-console
    console.log('LIVE signals:', JSON.stringify({
      maintainability: { v: r.maintainability.value, c: r.maintainability.confidence },
      architecture: { v: r.architecture.value, c: r.architecture.confidence },
      airGap: { v: r.airGap.value, c: r.airGap.confidence },
      whiteLabel: { v: r.whiteLabel.value, c: r.whiteLabel.confidence },
    }, null, 2));
  }, 60_000);

  it.skipIf(HAS_TOKEN)('is skipped because GITHUB_TOKEN is not set (documented no-op)', () => {
    expect(HAS_TOKEN).toBe(false);
  });
});
