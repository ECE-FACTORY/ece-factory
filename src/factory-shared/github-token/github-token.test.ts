// Unit tests for the shared GitHub-token boundary guard — NO NETWORK, NO REAL TOKEN.
// Proves: missing / "" / "   " / malformed ⇒ treated as ABSENT ⇒ fail-closed with NO fetch attempted and
// the token never in output; a normal-looking token is accepted by the guard (shape only — no live call).

import { describe, it, expect } from 'vitest';
import { normalizeGithubToken, hasValidGithubToken } from './github-token.js';
import { RepoScout } from '../../layer-3-harvest/repo-scout/repo-scout.js';
import { RepoScoutSignals } from '../../layer-3-harvest/repo-scout-signals/repo-scout-signals.js';

// A normal-looking (fake) token: non-trivial length, no whitespace. Accepted by shape — never sent anywhere here.
const VALID = 'ghp_ABCDEFGHIJKLMNOPqrstuvwxyz0123456789';

describe('normalizeGithubToken / hasValidGithubToken — the shape guard', () => {
  it('treats missing / undefined / null as ABSENT', () => {
    expect(normalizeGithubToken(undefined)).toBeUndefined();
    expect(normalizeGithubToken(null)).toBeUndefined();
    expect(hasValidGithubToken(undefined)).toBe(false);
  });
  it('treats "" and whitespace-only as ABSENT', () => {
    expect(normalizeGithubToken('')).toBeUndefined();
    expect(normalizeGithubToken('   ')).toBeUndefined();
    expect(normalizeGithubToken('\t\n ')).toBeUndefined();
    expect(hasValidGithubToken('   ')).toBe(false);
  });
  it('treats a token with internal whitespace as ABSENT (not a real token)', () => {
    expect(normalizeGithubToken('abc def ghi jkl')).toBeUndefined();
    expect(normalizeGithubToken('ghp_valid part')).toBeUndefined();
  });
  it('treats a trivially-short token as ABSENT', () => {
    expect(normalizeGithubToken('x')).toBeUndefined();
    expect(normalizeGithubToken('short')).toBeUndefined(); // < 10 chars
  });
  it('accepts a normal-looking token and trims surrounding whitespace', () => {
    expect(normalizeGithubToken(VALID)).toBe(VALID);
    expect(normalizeGithubToken(`  ${VALID}  `)).toBe(VALID);
    expect(hasValidGithubToken(VALID)).toBe(true);
  });
});

// A fetch spy that FAILS the test if it is ever called — proves fail-closed happens BEFORE any egress.
function throwingFetch() {
  const state = { called: false };
  const fetchImpl = (async () => { state.called = true; throw new Error('network must not be reached on a bad token'); }) as unknown as typeof fetch;
  return { fetchImpl, state };
}

describe('RepoScout — a blank/whitespace/malformed token fails closed with NO fetch', () => {
  for (const [label, token] of [['empty', ''], ['whitespace', '   '], ['too-short', 'x'], ['internal-space', 'abc def ghi']] as const) {
    it(`token "${label}" ⇒ FAILED_CLOSED, no fetch, no fabricated repos`, async () => {
      const { fetchImpl, state } = throwingFetch();
      const scout = new RepoScout({ token, fetchImpl });
      const res = await scout.scout({ query: 'anything' });
      expect(res.status).toBe('FAILED_CLOSED');
      expect(res.candidates).toEqual([]);
      expect(res.reason).toMatch(/GITHUB_TOKEN/);
      expect(state.called).toBe(false); // fail-closed BEFORE egress
    });
  }
});

describe('RepoScoutSignals — a blank/whitespace/malformed token fails closed with NO fetch', () => {
  for (const [label, token] of [['empty', ''], ['whitespace', '   '], ['too-short', 'x']] as const) {
    it(`token "${label}" ⇒ FAILED_CLOSED, every dimension not-mechanizable, no fetch`, async () => {
      const { fetchImpl, state } = throwingFetch();
      const sig = new RepoScoutSignals({ token, fetchImpl });
      const res = await sig.gather({ owner: 'o', name: 'n', branch: 'main' });
      expect(res.status).toBe('FAILED_CLOSED');
      expect(res.maintainability.confidence).toBe('not-mechanizable');
      expect(state.called).toBe(false);
    });
  }
});

describe('a normal-looking token is accepted (guard passes) — a fetch IS attempted, token stays redacted', () => {
  it('RepoScout: valid token ⇒ the guard lets it through and the fetch boundary is reached', async () => {
    const calls: { auth?: string }[] = [];
    const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
      calls.push({ auth: (init?.headers as Record<string, string> | undefined)?.Authorization });
      return { ok: true, status: 200, json: async () => ({ items: [] }), text: async () => '' } as unknown as Response;
    }) as unknown as typeof fetch;

    const scout = new RepoScout({ token: VALID, fetchImpl });
    const res = await scout.scout({ query: 'anything' });

    expect(res.status).toBe('OK');                 // NOT the no-token fail-closed path
    expect(calls.length).toBeGreaterThan(0);        // the guard accepted the token; egress was attempted
    expect(calls[0].auth).toBe(`Bearer ${VALID}`);  // token used only in the header
    expect(JSON.stringify(res)).not.toContain(VALID); // and never emitted in the output
  });
});
