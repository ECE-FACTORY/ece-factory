// Unit tests for Repo Scout — NO NETWORK, NO TOKEN. The fetch boundary is injected as a fake; the
// fail-closed paths run with no fetch call at all. A green run here proves logic, redaction, and
// fail-closed behaviour WITHOUT any real GitHub access (the live path lives in repo-scout.live.test.ts).

import { describe, it, expect } from 'vitest';
import {
  RepoScout, parseSearchItems, licenseAgreement, normalizeLicenseHint, deriveMaturity,
  LICENSE_FILE_VARIANTS,
} from './repo-scout.js';

// ── fixtures (inert, hand-written — no real repo data) ─────────────────────────────────────────────────
const MIT_TEXT = `MIT License\n\nCopyright (c) 2024 Example\n\nPermission is hereby granted, free of charge, to any person obtaining a copy of this software...`;
const BSL_TEXT = `Business Source License 1.1\n\nParameters\nLicensor: Example Inc.\nThe Business Source License is not an Open Source license...`;

const SEARCH_BODY = {
  items: [
    {
      full_name: 'acme/pdfkit', name: 'pdfkit', owner: { login: 'acme' },
      html_url: 'https://github.com/acme/pdfkit', description: 'A PDF generation library',
      stargazers_count: 4200, pushed_at: '2025-01-15T00:00:00Z', archived: false,
      default_branch: 'main', license: { spdx_id: 'MIT' },
    },
    {
      full_name: 'globex/reportgen', name: 'reportgen', owner: { login: 'globex' },
      html_url: 'https://github.com/globex/reportgen', description: 'Report + PDF engine',
      stargazers_count: 800, pushed_at: '2024-11-02T00:00:00Z', archived: false,
      default_branch: 'trunk', license: { spdx_id: 'Apache-2.0' }, // hint says Apache — raw file will say BSL
    },
    { /* unidentifiable — no owner/name — must be dropped, never guessed */ description: 'junk', license: null },
  ],
};

// A fake `fetch` that routes by URL and records calls (so we can assert the token is USED but never EMITTED).
interface FakeRoute { ok: boolean; status: number; json?: unknown; text?: string }
function makeFetch(route: (url: string) => FakeRoute) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    calls.push({ url: u, headers: (init?.headers as Record<string, string>) ?? {} });
    const r = route(u);
    return {
      ok: r.ok, status: r.status,
      json: async () => r.json,
      text: async () => r.text ?? '',
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

// Default routing: search → SEARCH_BODY; raw LICENSE → MIT for acme, BSL for globex; other variants 404.
function defaultRoute(url: string): FakeRoute {
  if (url.includes('/search/repositories')) return { ok: true, status: 200, json: SEARCH_BODY };
  if (url.endsWith('/acme/pdfkit/main/LICENSE')) return { ok: true, status: 200, text: MIT_TEXT };
  if (url.endsWith('/globex/reportgen/trunk/LICENSE')) return { ok: true, status: 200, text: BSL_TEXT };
  return { ok: false, status: 404 }; // any other variant path
}

const TOKEN = 'SUPER_SECRET_TOKEN_do_not_leak_123';

describe('Repo Scout — pure helpers (no network)', () => {
  it('parseSearchItems parses discovery records and DROPS the unidentifiable item (never guesses)', () => {
    const repos = parseSearchItems(SEARCH_BODY);
    expect(repos.length).toBe(2); // the junk item with no owner/name is dropped
    expect(repos[0]).toMatchObject({ owner: 'acme', name: 'pdfkit', stars: 4200, defaultBranch: 'main', licenseHintRaw: 'MIT' });
    expect(repos[1]).toMatchObject({ owner: 'globex', name: 'reportgen', defaultBranch: 'trunk', licenseHintRaw: 'Apache-2.0' });
  });

  it('parseSearchItems tolerates a malformed body without throwing', () => {
    expect(parseSearchItems(null)).toEqual([]);
    expect(parseSearchItems({})).toEqual([]);
    expect(parseSearchItems({ items: 'nope' })).toEqual([]);
  });

  it('normalizeLicenseHint maps NOASSERTION/blank to unknown and normalizes badges', () => {
    expect(normalizeLicenseHint('NOASSERTION')).toBe('unknown');
    expect(normalizeLicenseHint('')).toBe('unknown');
    expect(normalizeLicenseHint(null)).toBe('unknown');
    expect(normalizeLicenseHint('MIT')).toBe('MIT');
    expect(normalizeLicenseHint('Apache-2.0')).toBe('Apache-2.0');
  });

  it('licenseAgreement: hint agrees with raw text ⇒ no disagreement', () => {
    const a = licenseAgreement('MIT', MIT_TEXT);
    expect(a).toEqual({ hint: 'MIT', fromText: 'MIT', disagreement: false });
  });

  it('licenseAgreement: API hint disagrees with raw text ⇒ flag set, RAW FILE WINS (fromText)', () => {
    const a = licenseAgreement('Apache-2.0', BSL_TEXT);
    expect(a.hint).toBe('Apache-2.0');
    expect(a.fromText).toBe('BSL'); // the raw file is the truth
    expect(a.disagreement).toBe(true);
  });

  it('licenseAgreement: unreadable raw text ⇒ fromText unknown, no false disagreement', () => {
    expect(licenseAgreement('MIT', null)).toEqual({ hint: 'MIT', fromText: 'unknown', disagreement: false });
  });

  it('deriveMaturity turns facts into signals (archived ⇒ not maintained; recent push ⇒ maintained)', () => {
    const now = Date.parse('2025-02-01T00:00:00Z');
    expect(deriveMaturity({ owner: 'a', name: 'b', url: '', description: null, stars: 10, pushedAtIso: '2025-01-15T00:00:00Z', archived: false, defaultBranch: 'main', licenseHintRaw: '' }, now))
      .toMatchObject({ stars: 10, lastCommitIso: '2025-01-15T00:00:00Z', activelyMaintained: true });
    expect(deriveMaturity({ owner: 'a', name: 'b', url: '', description: null, stars: 10, pushedAtIso: '2019-01-01T00:00:00Z', archived: true, defaultBranch: 'main', licenseHintRaw: '' }, now))
      .toMatchObject({ archived: true, activelyMaintained: false });
  });

  it('exposes the LICENSE filename variants it will try', () => {
    expect(LICENSE_FILE_VARIANTS).toContain('LICENSE');
    expect(LICENSE_FILE_VARIANTS.length).toBeGreaterThan(1);
  });
});

describe('Repo Scout — scout() with an injected fake fetch (still no real network)', () => {
  it('emits inert RepoEvaluationInput facts shaped for the graders', async () => {
    const { fetchImpl } = makeFetch(defaultRoute);
    const scout = new RepoScout({ token: TOKEN, fetchImpl });
    const res = await scout.scout({ query: 'PDF generation library' });

    expect(res.status).toBe('OK');
    expect(res.candidates.length).toBe(2);

    const mit = res.candidates[0];
    expect(mit.evaluationInput.identity).toEqual({ host: 'github.com', owner: 'acme', name: 'pdfkit' });
    expect(mit.evaluationInput.license.text).toBe(MIT_TEXT);        // verbatim raw file = authoritative
    expect(mit.evaluationInput.license.declaredSpdx).toBe('MIT');    // API hint = non-authoritative
    expect(mit.evaluationInput.license.source).toBe('acme/pdfkit');
    expect(mit.evaluationInput.provenanceVerified).toBe(true);
    expect(mit.licenseVerified).toBe(true);
    expect(mit.licenseDisagreement).toBe(false);
    expect(mit.rawLicenseUrl).toContain('/acme/pdfkit/main/LICENSE');
  });

  it('records the API-vs-rawfile disagreement and lets the RAW FILE WIN (text is BSL, hint was Apache)', async () => {
    const { fetchImpl } = makeFetch(defaultRoute);
    const scout = new RepoScout({ token: TOKEN, fetchImpl });
    const res = await scout.scout({ query: 'reporting' });

    const bsl = res.candidates.find((c) => c.evaluationInput.identity.name === 'reportgen')!;
    expect(bsl.licenseHint).toBe('Apache-2.0');       // what the badge/API claimed
    expect(bsl.licenseFromRawText).toBe('BSL');        // what the file actually is
    expect(bsl.licenseDisagreement).toBe(true);
    expect(bsl.evaluationInput.license.text).toBe(BSL_TEXT);       // raw file emitted as the truth
    expect(bsl.evaluationInput.license.declaredSpdx).toBe('Apache-2.0'); // hint preserved but non-authoritative
    expect(bsl.notes.join(' ')).toMatch(/RAW FILE WINS/);
  });

  it('REDACTION: the token is used in the Authorization header but NEVER appears in the output', async () => {
    const { fetchImpl, calls } = makeFetch(defaultRoute);
    const scout = new RepoScout({ token: TOKEN, fetchImpl });
    const res = await scout.scout({ query: 'PDF generation library' });

    // the token WAS used to authenticate the search call...
    const searchCall = calls.find((c) => c.url.includes('/search/repositories'))!;
    expect(searchCall.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    // ...but it appears NOWHERE in the emitted result.
    expect(JSON.stringify(res)).not.toContain(TOKEN);
  });

  it('a repo whose LICENSE cannot be read is emitted UNVERIFIED (empty text ⇒ grader denies), never fabricated', async () => {
    // Route: search returns one repo, but EVERY license variant 404s.
    const oneRepo = { items: [{ full_name: 'x/y', name: 'y', owner: { login: 'x' }, default_branch: 'main', license: { spdx_id: 'MIT' }, stargazers_count: 5, pushed_at: '2025-01-01T00:00:00Z' }] };
    const { fetchImpl } = makeFetch((url) => url.includes('/search/repositories') ? { ok: true, status: 200, json: oneRepo } : { ok: false, status: 404 });
    const scout = new RepoScout({ token: TOKEN, fetchImpl });
    const res = await scout.scout({ query: 'anything' });

    expect(res.status).toBe('OK');
    const c = res.candidates[0];
    expect(c.licenseVerified).toBe(false);
    expect(c.evaluationInput.license.text).toBeUndefined();          // no fabricated license
    expect(c.evaluationInput.provenanceVerified).toBe(false);        // deny-by-default
    expect(c.rawLicenseUrl).toBeNull();
    expect(c.notes.join(' ')).toMatch(/UNVERIFIED/);
  });
});

describe('Repo Scout — FAIL CLOSED (no fabrication)', () => {
  it('no token ⇒ FAILED_CLOSED, empty candidates, and NO fetch is attempted', async () => {
    let called = false;
    const fetchImpl = (async () => { called = true; throw new Error('must not be called'); }) as unknown as typeof fetch;
    const scout = new RepoScout({ fetchImpl }); // no token
    const res = await scout.scout({ query: 'PDF generation library' });

    expect(res.status).toBe('FAILED_CLOSED');
    expect(res.candidates).toEqual([]);
    expect(res.reason).toMatch(/GITHUB_TOKEN/);
    expect(called).toBe(false); // fail-closed BEFORE any network egress
  });

  it('network error during discovery ⇒ FAILED_CLOSED, empty candidates, token-free reason', async () => {
    const fetchImpl = (async () => { throw new Error('ECONNREFUSED getaddrinfo'); }) as unknown as typeof fetch;
    const scout = new RepoScout({ token: TOKEN, fetchImpl });
    const res = await scout.scout({ query: 'PDF generation library' });

    expect(res.status).toBe('FAILED_CLOSED');
    expect(res.candidates).toEqual([]);
    expect(res.reason).toMatch(/discovery failed/);
    expect(res.reason).not.toContain(TOKEN); // never leak the token in an error
  });

  it('a non-200 search response ⇒ FAILED_CLOSED (no fabricated repos)', async () => {
    const fetchImpl = (async () => ({ ok: false, status: 403, json: async () => ({}), text: async () => '' } as unknown as Response)) as unknown as typeof fetch;
    const scout = new RepoScout({ token: TOKEN, fetchImpl });
    const res = await scout.scout({ query: 'PDF generation library' });

    expect(res.status).toBe('FAILED_CLOSED');
    expect(res.candidates).toEqual([]);
    expect(res.reason).toMatch(/discovery failed/);
  });
});
