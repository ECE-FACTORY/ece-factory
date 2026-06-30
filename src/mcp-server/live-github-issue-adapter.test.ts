import { describe, it, expect } from 'vitest';
import { LiveGitHubIssueAdapter, parseIssueRepo } from './live-github-issue-adapter.js';
import type { ExternalTarget } from '../features/mcp-bridge/external-tools.js';

// Phase 9.5 — Live GitHub Issue adapter (create_ticket ONLY). NO real network: a mock `fetchImpl` is injected.

const SECRET = 'ghp_TESTONLYsecretvalue000000000000000000'; // a fake token literal, used to prove it never leaks
function target(over: Partial<ExternalTarget> = {}): ExternalTarget {
  return { system: 'tickets', targetId: 'ECE-PLATFORMS/repoA', effect: 'create issue in ECE-PLATFORMS/repoA', reversible: 'soft-only', ...over };
}
function mockFetch(resp: { ok: boolean; status: number; json?: unknown; text?: string }) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return { ok: resp.ok, status: resp.status, json: async () => resp.json ?? {}, text: async () => resp.text ?? '' };
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe('Live GitHub Issue adapter — credential safety: loud fail if token unset (NO silent fake fallback)', () => {
  it('an empty/blank token throws loudly, naming the env var (not a value)', () => {
    expect(() => new LiveGitHubIssueAdapter({ token: '' })).toThrow(/ECE_GITHUB_TOKEN is not set/);
    expect(() => new LiveGitHubIssueAdapter({ token: '   ' })).toThrow(/no silent fake fallback/);
  });
});

describe('Live GitHub Issue adapter — DRY-RUN validates the path but makes NO real API call', () => {
  it('dryRun ⇒ returns wouldCreate, apiCalled:false, fetch never called', async () => {
    const { impl, calls } = mockFetch({ ok: true, status: 201 });
    const a = new LiveGitHubIssueAdapter({ token: SECRET, fetchImpl: impl, dryRun: true });
    const out = await a.createTicket(target(), { title: 'Bug: x' });
    expect(out).toMatchObject({ dryRun: true, apiCalled: false, wouldCreate: { owner: 'ECE-PLATFORMS', repo: 'repoA', title: 'Bug: x' } });
    expect(calls).toHaveLength(0);
  });
});

describe('Live GitHub Issue adapter — live path (mocked fetch): correct request, mapped response, token never leaks', () => {
  it('POSTs to /repos/{owner}/{repo}/issues with a Bearer header + title/body; maps the response', async () => {
    const { impl, calls } = mockFetch({ ok: true, status: 201, json: { number: 7, html_url: 'https://github.com/ECE-PLATFORMS/repoA/issues/7' } });
    const a = new LiveGitHubIssueAdapter({ token: SECRET, fetchImpl: impl });
    const out = await a.createTicket(target(), { title: 'Bug: x', body: 'steps' });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://api.github.com/repos/ECE-PLATFORMS/repoA/issues');
    expect(calls[0].init.method).toBe('POST');
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe(`Bearer ${SECRET}`);
    expect(JSON.parse(String(calls[0].init.body))).toMatchObject({ title: 'Bug: x', body: 'steps' });
    expect(out).toMatchObject({ created: true, apiCalled: true, repo: 'ECE-PLATFORMS/repoA', issue: 7 });
  });
  it('the token NEVER appears in the returned record', async () => {
    const { impl } = mockFetch({ ok: true, status: 201, json: { number: 1 } });
    const a = new LiveGitHubIssueAdapter({ token: SECRET, fetchImpl: impl });
    const out = await a.createTicket(target(), { title: 't' });
    expect(JSON.stringify(out)).not.toContain(SECRET);
    expect(JSON.stringify(out)).not.toContain('ghp_');
  });
  it('a non-OK response throws with the status — and NEVER the token', async () => {
    const { impl } = mockFetch({ ok: false, status: 410, text: '{"message":"Issues are disabled for this repo"}' });
    const a = new LiveGitHubIssueAdapter({ token: SECRET, fetchImpl: impl });
    await expect(a.createTicket(target(), { title: 't' })).rejects.toThrow(/HTTP 410/);
    await a.createTicket(target(), { title: 't' }).catch((e: Error) => {
      expect(e.message).not.toContain(SECRET);
      expect(e.message).not.toContain('ghp_');
    });
  });
});

describe('Live GitHub Issue adapter — scope: exposes ONLY create_ticket (cannot perform any other action)', () => {
  it('has no other external method to misuse', () => {
    const a = new LiveGitHubIssueAdapter({ token: SECRET, fetchImpl: mockFetch({ ok: true, status: 201 }).impl }) as unknown as Record<string, unknown>;
    for (const m of ['createGithubRepo', 'openPullRequest', 'updateCrmRecord', 'sendEmail', 'deployPackage']) {
      expect(typeof a[m]).toBe('undefined');
    }
    expect(typeof a.createTicket).toBe('function');
  });
});

describe('Live GitHub Issue adapter — parseIssueRepo requires owner/repo', () => {
  it('parses owner/repo; rejects bare name / empty / malformed', () => {
    expect(parseIssueRepo('ECE-PLATFORMS/repoA')).toEqual({ owner: 'ECE-PLATFORMS', repo: 'repoA' });
    expect(() => parseIssueRepo('justname')).toThrow(/owner\/repo/);
    expect(() => parseIssueRepo('')).toThrow(/required/);
    expect(() => parseIssueRepo('a/b/c')).toThrow(/malformed/);
  });
});
