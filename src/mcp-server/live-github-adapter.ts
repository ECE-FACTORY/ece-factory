// Live GitHub Repo Adapter (Phase 9.4, external-tier live wiring — GitHub ONLY) — the FIRST external action
// wired to a REAL service: create_github_repo → the real GitHub REST API. It implements the SAME
// `ExternalSystems` port the bridge already calls, so it plugs in BEHIND the unchanged Phase 8.4 gauntlet +
// the Phase 9.3 sole-authority capability — it adds NO guard logic and is reachable ONLY through
// `RepoCreationGateway → bridge.createGithubRepo(capability, …)`.
//
// CREDENTIAL SAFETY (structural):
//   • the token is read ONLY from the constructor (the composition root passes `process.env.ECE_GITHUB_TOKEN`)
//     — it is NEVER hardcoded, NEVER written to a committed file, NEVER logged/echoed, and NEVER placed in the
//     returned record or any error message;
//   • an UNSET/blank token throws LOUDLY at construction — it must NOT silently fall back to a fake.
//
// SAFE BY DEFAULT: `dryRun` validates the request and asserts the path WITHOUT calling the real API (no repo is
// created). `fetchImpl` is injectable so the suite mocks the network boundary — no real call in any test.
//
// SCOPE: this adapter handles ONLY create_github_repo — it has NO other external method, so it cannot be
// misused to perform any other action. The other five external actions stay on fakes this phase (the
// composition root routes them to the fake, never here).

import type { ExternalTarget, ExternalResult } from '../features/mcp-bridge/external-tools.js';

/** The narrow port this adapter satisfies — exactly the one external action it owns. */
export interface RepoCreator {
  createGithubRepo(target: ExternalTarget, payload?: Record<string, unknown>): Promise<ExternalResult>;
}

export interface GitHubAdapterOptions {
  /** The GitHub token — supplied from the environment by the composition root. Required (blank ⇒ throw). */
  token: string;
  /** Injectable fetch (defaults to the global). The suite injects a mock so no real network call happens. */
  fetchImpl?: typeof fetch;
  /** When true, validate + report what WOULD happen but make NO real API call (no repo created). */
  dryRun?: boolean;
  /** API base (default the public GitHub API). Injectable for tests. */
  apiBase?: string;
}

export function parseRepoTarget(targetId: string): { org?: string; name: string } {
  const raw = (targetId ?? '').trim();
  if (!raw) throw new Error('create_github_repo: a target repo id is required (e.g. "ORG/name")');
  const parts = raw.split('/').filter((s) => s.length > 0);
  if (parts.length === 1) return { name: parts[0] };
  if (parts.length === 2) return { org: parts[0], name: parts[1] };
  throw new Error(`create_github_repo: malformed repo target "${raw}" — expected "ORG/name" or "name"`);
}

export class LiveGitHubRepoAdapter implements RepoCreator {
  readonly #token: string; // private field — not enumerable, never serialized
  private readonly fetchImpl: typeof fetch;
  private readonly dryRun: boolean;
  private readonly apiBase: string;

  constructor(opts: GitHubAdapterOptions) {
    if (!opts.token || !opts.token.trim()) {
      // LOUD fail — never a silent fake fallback. The message names the env var, NOT any value.
      throw new Error('ECE_GITHUB_TOKEN is not set: the live GitHub adapter requires a token in the environment. Refusing to start (no silent fake fallback). Set ECE_GITHUB_TOKEN or disable live wiring (unset ECE_GITHUB_LIVE).');
    }
    this.#token = opts.token;
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch;
    this.dryRun = opts.dryRun ?? false;
    this.apiBase = (opts.apiBase ?? 'https://api.github.com').replace(/\/$/, '');
  }

  async createGithubRepo(target: ExternalTarget, payload?: Record<string, unknown>): Promise<ExternalResult> {
    const { org, name } = parseRepoTarget(target.targetId);
    const isPrivate = payload?.private === undefined ? true : Boolean(payload.private); // default PRIVATE
    const description = typeof payload?.description === 'string' ? payload.description : undefined;
    const body: Record<string, unknown> = { name, private: isPrivate, ...(description ? { description } : {}) };

    if (this.dryRun) {
      // gauntlet has already passed (this runs behind the gate); stop short of the real API.
      return { dryRun: true, apiCalled: false, wouldCreate: { owner: org ?? '(authenticated user)', name, private: isPrivate } };
    }

    const url = org ? `${this.apiBase}/orgs/${encodeURIComponent(org)}/repos` : `${this.apiBase}/user/repos`;
    const res = await this.fetchImpl(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.#token}`, // the ONLY place the token is used; never logged
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
        'User-Agent': 'ece-factory-mcp',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const detail = await safeStatusText(res);
      // error names status + GitHub's message only — never the token.
      throw new Error(`create_github_repo failed: GitHub responded HTTP ${res.status}${detail ? ` (${detail})` : ''}`);
    }
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    // inert record — NO token, NO headers echoed.
    return { created: true, apiCalled: true, repo: data.full_name ?? (org ? `${org}/${name}` : name), id: data.id, htmlUrl: data.html_url, private: data.private ?? isPrivate };
  }
}

/** Read at most a short, token-free snippet of a GitHub error body for diagnostics. */
async function safeStatusText(res: { text: () => Promise<string> }): Promise<string> {
  try {
    const t = await res.text();
    const m = /"message"\s*:\s*"([^"]{0,120})"/.exec(t);
    return m ? m[1] : '';
  } catch {
    return '';
  }
}
