import { describe, it, expect } from 'vitest';
import { LiveGitHubRepoAdapter, parseRepoTarget } from './live-github-adapter.js';
import type { ExternalTarget } from '../features/mcp-bridge/external-tools.js';

// Phase 9.4 — Live GitHub adapter (create_github_repo ONLY). NO real network: a mock `fetchImpl` is injected;
// the real-API path is exercised against the mock so no real repo is ever created in the suite.

const SECRET = 'ghp_TESTONLYsecretvalue000000000000000000'; // a fake token literal, used to prove it never leaks
function target(over: Partial<ExternalTarget> = {}): ExternalTarget {
  return { system: 'github', targetId: 'ECE-FACTORY/x', effect: 'create repo ECE-FACTORY/x private', reversible: 'soft-only', ...over };
}
type FetchCall = { url: string; init: RequestInit };
function mockFetch(resp: { ok: boolean; status: number; json?: unknown; text?: string }) {
  const calls: FetchCall[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return { ok: resp.ok, status: resp.status, json: async () => resp.json ?? {}, text: async () => resp.text ?? '' };
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe('Live GitHub adapter — credential safety: loud fail if the token is unset (NO silent fake fallback)', () => {
  it('an empty token throws loudly, naming the env var (not a value)', () => {
    expect(() => new LiveGitHubRepoAdapter({ token: '' })).toThrow(/ECE_GITHUB_TOKEN is not set/);
    expect(() => new LiveGitHubRepoAdapter({ token: '   ' })).toThrow(/no silent fake fallback/);
  });
});

describe('Live GitHub adapter — DRY-RUN validates the path but makes NO real API call', () => {
  it('dryRun ⇒ returns wouldCreate, apiCalled:false, and fetch is never called', async () => {
    const { impl, calls } = mockFetch({ ok: true, status: 201 });
    const a = new LiveGitHubRepoAdapter({ token: SECRET, fetchImpl: impl, dryRun: true });
    const out = await a.createGithubRepo(target());
    expect(out).toMatchObject({ dryRun: true, apiCalled: false, wouldCreate: { owner: 'ECE-FACTORY', name: 'x', private: true } });
    expect(calls).toHaveLength(0); // no real call
  });
});

describe('Live GitHub adapter — live path (mocked fetch): correct request, mapped response, token never leaks', () => {
  it('POSTs to the org repos endpoint with a Bearer header and a private body; maps the response', async () => {
    const { impl, calls } = mockFetch({ ok: true, status: 201, json: { full_name: 'ECE-FACTORY/x', id: 42, html_url: 'https://github.com/ECE-FACTORY/x', private: true } });
    const a = new LiveGitHubRepoAdapter({ token: SECRET, fetchImpl: impl });
    const out = await a.createGithubRepo(target());
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://api.github.com/orgs/ECE-FACTORY/repos');
    expect(calls[0].init.method).toBe('POST');
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${SECRET}`);
    expect(JSON.parse(String(calls[0].init.body))).toMatchObject({ name: 'x', private: true });
    expect(out).toMatchObject({ created: true, apiCalled: true, repo: 'ECE-FACTORY/x', id: 42 });
  });
  it('a no-org target ⇒ POSTs to /user/repos', async () => {
    const { impl, calls } = mockFetch({ ok: true, status: 201, json: { full_name: 'me/solo' } });
    const a = new LiveGitHubRepoAdapter({ token: SECRET, fetchImpl: impl });
    await a.createGithubRepo(target({ targetId: 'solo', effect: 'create repo solo' }));
    expect(calls[0].url).toBe('https://api.github.com/user/repos');
  });
  it('payload private:false is honored', async () => {
    const { impl, calls } = mockFetch({ ok: true, status: 201, json: {} });
    const a = new LiveGitHubRepoAdapter({ token: SECRET, fetchImpl: impl });
    await a.createGithubRepo(target(), { private: false });
    expect(JSON.parse(String(calls[0].init.body)).private).toBe(false);
  });
  it('the token NEVER appears in the returned record', async () => {
    const { impl } = mockFetch({ ok: true, status: 201, json: { full_name: 'ECE-FACTORY/x', id: 1 } });
    const a = new LiveGitHubRepoAdapter({ token: SECRET, fetchImpl: impl });
    const out = await a.createGithubRepo(target());
    expect(JSON.stringify(out)).not.toContain(SECRET);
    expect(JSON.stringify(out)).not.toContain('ghp_');
  });
  it('a non-OK response throws with the status — and NEVER the token', async () => {
    const { impl } = mockFetch({ ok: false, status: 422, text: '{"message":"name already exists on this account"}' });
    const a = new LiveGitHubRepoAdapter({ token: SECRET, fetchImpl: impl });
    await expect(a.createGithubRepo(target())).rejects.toThrow(/HTTP 422/);
    await a.createGithubRepo(target()).catch((e: Error) => {
      expect(e.message).not.toContain(SECRET);
      expect(e.message).not.toContain('ghp_');
    });
  });
});

describe('Live GitHub adapter — scope: exposes ONLY create_github_repo (cannot perform any other action)', () => {
  it('has no other external method to misuse', () => {
    const a = new LiveGitHubRepoAdapter({ token: SECRET, fetchImpl: mockFetch({ ok: true, status: 201 }).impl }) as unknown as Record<string, unknown>;
    for (const m of ['openPullRequest', 'createTicket', 'updateCrmRecord', 'sendEmail', 'deployPackage']) {
      expect(typeof a[m]).toBe('undefined'); // structurally cannot be routed to any other external action
    }
    expect(typeof a.createGithubRepo).toBe('function');
  });
});

describe('Live GitHub adapter — parseRepoTarget', () => {
  it('parses ORG/name and bare name; rejects empty/malformed', () => {
    expect(parseRepoTarget('ECE-FACTORY/x')).toEqual({ org: 'ECE-FACTORY', name: 'x' });
    expect(parseRepoTarget('solo')).toEqual({ name: 'solo' });
    expect(() => parseRepoTarget('')).toThrow(/required/);
    expect(() => parseRepoTarget('a/b/c')).toThrow(/malformed/);
  });
});
