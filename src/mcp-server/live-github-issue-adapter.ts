// Live GitHub Issue Adapter (Phase 9.5, external-tier live wiring — GitHub Issues ONLY) — the SECOND external
// action wired to a REAL service: create_ticket → a real GitHub Issue (POST /repos/{owner}/{repo}/issues). It
// mirrors the Phase 9.4 LiveGitHubRepoAdapter EXACTLY: same env-only token, same loud-fail-if-unset, same
// injectable fetch + dry-run, and the same narrowing — it implements ONLY `createTicket`, so it is
// structurally incapable of performing any other external action.
//
// It plugs in BEHIND the unchanged gate: reached ONLY through TicketGateway (the Phase 9.3 sole owner of
// create_ticket) → bridge.createTicket(capability, …) → the unchanged Phase 8.4 gauntlet. It adds NO guard
// logic. The token is read ONLY from the constructor (the composition root passes process.env.ECE_GITHUB_TOKEN)
// — never hardcoded, committed, logged, echoed, or placed in the returned record / error message.

import type { ExternalTarget, ExternalResult } from '../layer-5-action/mcp-bridge/external-tools.js';

export interface GitHubIssueAdapterOptions {
  token: string;
  fetchImpl?: typeof fetch;
  dryRun?: boolean;
  apiBase?: string;
}

/** The narrow port this adapter satisfies — exactly the one external action it owns. */
export interface TicketCreator {
  createTicket(target: ExternalTarget, payload?: Record<string, unknown>): Promise<ExternalResult>;
}

/** An issue needs a FULL repo slug "owner/repo" (both parts) — a bare name cannot locate a repo. */
export function parseIssueRepo(targetId: string): { owner: string; repo: string } {
  const raw = (targetId ?? '').trim();
  if (!raw) throw new Error('create_ticket: a target repo "owner/repo" is required');
  const parts = raw.split('/').filter((s) => s.length > 0);
  if (parts.length !== 2) throw new Error(`create_ticket: malformed repo target "${raw}" — expected "owner/repo"`);
  return { owner: parts[0], repo: parts[1] };
}

export class LiveGitHubIssueAdapter implements TicketCreator {
  readonly #token: string; // private field — not enumerable, never serialized
  private readonly fetchImpl: typeof fetch;
  private readonly dryRun: boolean;
  private readonly apiBase: string;

  constructor(opts: GitHubIssueAdapterOptions) {
    if (!opts.token || !opts.token.trim()) {
      // LOUD fail — never a silent fake fallback. The message names the env var, NOT any value.
      throw new Error('ECE_GITHUB_TOKEN is not set: the live GitHub Issue adapter requires a token in the environment. Refusing to start (no silent fake fallback). Set ECE_GITHUB_TOKEN or disable live wiring (unset ECE_GITHUB_LIVE).');
    }
    this.#token = opts.token;
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch;
    this.dryRun = opts.dryRun ?? false;
    this.apiBase = (opts.apiBase ?? 'https://api.github.com').replace(/\/$/, '');
  }

  async createTicket(target: ExternalTarget, payload?: Record<string, unknown>): Promise<ExternalResult> {
    const { owner, repo } = parseIssueRepo(target.targetId);
    const title = String(payload?.title ?? target.effect ?? '').trim() || '(untitled issue)';
    const issueBody = typeof payload?.body === 'string' ? payload.body : undefined;
    const body: Record<string, unknown> = { title, ...(issueBody ? { body: issueBody } : {}) };

    if (this.dryRun) {
      // gauntlet has already passed (this runs behind the gate); stop short of the real API.
      return { dryRun: true, apiCalled: false, wouldCreate: { owner, repo, title } };
    }

    const url = `${this.apiBase}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues`;
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
      throw new Error(`create_ticket failed: GitHub responded HTTP ${res.status}${detail ? ` (${detail})` : ''}`);
    }
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    // inert record — NO token, NO headers echoed.
    return { created: true, apiCalled: true, repo: `${owner}/${repo}`, issue: data.number, htmlUrl: data.html_url, title };
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
