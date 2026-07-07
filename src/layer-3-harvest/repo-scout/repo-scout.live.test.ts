// LIVE test for Repo Scout — makes ONE real GitHub query and verifies ONE real LICENSE file end-to-end.
//
// It SKIPS CLEANLY when GITHUB_TOKEN is unset, so the default suite (and CI without a token) never touches
// the network. The human runs it themselves with their own read-only public-scope token:
//
//     GITHUB_TOKEN=xxx npx vitest run src/layer-3-harvest/repo-scout/repo-scout.live.test.ts
//
// This file NEVER hardcodes a token and NEVER prints one. The builder does not supply the token.

import { describe, it, expect } from 'vitest';
import { RepoScout } from './repo-scout.js';
import { normalizeGithubToken } from '../../factory-shared/github-token/github-token.js';

// Route through the shared guard: a blank / whitespace-only / malformed GITHUB_TOKEN is treated as ABSENT,
// so `GITHUB_TOKEN=` no longer triggers an unauthenticated live run — it SKIPS exactly like a missing token.
const TOKEN = normalizeGithubToken(process.env.GITHUB_TOKEN);
const HAS_TOKEN = !!TOKEN;

describe('Repo Scout — LIVE (skips without GITHUB_TOKEN)', () => {
  it.skipIf(!HAS_TOKEN)('sources real repos for "PDF generation library" and verifies a real LICENSE file', async () => {
    const scout = new RepoScout({ token: TOKEN }); // real global fetch, real GitHub
    const res = await scout.scout({ query: 'PDF generation library', maxResults: 5 });

    expect(res.status).toBe('OK');
    expect(res.candidates.length).toBeGreaterThan(0);

    // At least one candidate must have a REAL, verified LICENSE file read from raw.githubusercontent.com.
    const verified = res.candidates.find((c) => c.licenseVerified);
    expect(verified, 'expected at least one candidate with a verified LICENSE file').toBeTruthy();
    expect(verified!.evaluationInput.license.text && verified!.evaluationInput.license.text.length).toBeGreaterThan(0);
    expect(verified!.rawLicenseUrl).toContain('raw.githubusercontent.com');
    expect(verified!.evaluationInput.identity.host).toBe('github.com');

    // The token must NEVER appear anywhere in the emitted result.
    expect(JSON.stringify(res)).not.toContain(TOKEN);
  }, 30_000);

  it.skipIf(HAS_TOKEN)('is skipped because GITHUB_TOKEN is not set (documented no-op)', () => {
    // This assertion only runs when there is NO token — it documents that the live test is intentionally
    // inert by default. With a token, the real test above runs instead and this one skips.
    expect(HAS_TOKEN).toBe(false);
  });
});
