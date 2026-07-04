// Live GitHub Milestone Adapter (Factory capability — external-tier live wiring, GitHub Milestones ONLY) — the
// external action `create_milestone` → a real GitHub Milestone (POST /repos/{owner}/{repo}/milestones). It
// mirrors LiveGitHubIssueAdapter EXACTLY: same env-only token, same loud-fail-if-unset, same injectable fetch +
// dry-run, and the same narrowing — it implements ONLY `createMilestone`, so it is structurally incapable of
// performing any other external action.
//
// It plugs in BEHIND the unchanged gate: reached ONLY through MilestoneGateway (the sole owner of
// create_milestone) → bridge.createMilestone(capability, …) → the unchanged Phase 8.4 gauntlet. It adds NO guard
// logic. The token is read ONLY from the constructor (the composition root passes process.env.ECE_GITHUB_TOKEN)
// — never hardcoded, committed, logged, echoed, or placed in the returned record / error message.

import type { ExternalTarget, ExternalResult } from '../features/mcp-bridge/external-tools.js';

export interface GitHubMilestoneAdapterOptions {
  token: string;
  fetchImpl?: typeof fetch;
  dryRun?: boolean;
  apiBase?: string;
}

/** The narrow port this adapter satisfies — exactly the one external action it owns. */
export interface MilestoneCreator {
  createMilestone(target: ExternalTarget, payload?: Record<string, unknown>): Promise<ExternalResult>;
}

/** A milestone needs a FULL repo slug "owner/repo" (both parts) — a bare name cannot locate a repo. */
export function parseMilestoneRepo(targetId: string): { owner: string; repo: string } {
  const raw = (targetId ?? '').trim();
  if (!raw) throw new Error('create_milestone: a target repo "owner/repo" is required');
  const parts = raw.split('/').filter((s) => s.length > 0);
  if (parts.length !== 2) throw new Error(`create_milestone: malformed repo target "${raw}" — expected "owner/repo"`);
  return { owner: parts[0], repo: parts[1] };
}

export class LiveGitHubMilestoneAdapter implements MilestoneCreator {
  readonly #token: string; // private field — not enumerable, never serialized
  private readonly fetchImpl: typeof fetch;
  private readonly dryRun: boolean;
  private readonly apiBase: string;

  constructor(opts: GitHubMilestoneAdapterOptions) {
    if (!opts.token || !opts.token.trim()) {
      // LOUD fail — never a silent fake fallback. The message names the env var, NOT any value.
      throw new Error('ECE_GITHUB_TOKEN is not set: the live GitHub Milestone adapter requires a token in the environment. Refusing to start (no silent fake fallback). Set ECE_GITHUB_TOKEN or disable live wiring (unset ECE_GITHUB_LIVE).');
    }
    this.#token = opts.token;
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch;
    this.dryRun = opts.dryRun ?? false;
    this.apiBase = (opts.apiBase ?? 'https://api.github.com').replace(/\/$/, '');
  }

  async createMilestone(target: ExternalTarget, payload?: Record<string, unknown>): Promise<ExternalResult> {
    const { owner, repo } = parseMilestoneRepo(target.targetId);
    const title = String(payload?.title ?? target.effect ?? '').trim() || '(untitled milestone)';
    const description = typeof payload?.description === 'string' ? payload.description : undefined;
    const dueOn = typeof payload?.due_on === 'string' ? payload.due_on : undefined;
    const body: Record<string, unknown> = { title, ...(description ? { description } : {}), ...(dueOn ? { due_on: dueOn } : {}) };

    if (this.dryRun) {
      // gauntlet has already passed (this runs behind the gate); stop short of the real API.
      return { dryRun: true, apiCalled: false, wouldCreate: { owner, repo, title } };
    }

    const url = `${this.apiBase}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/milestones`;
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
      throw new Error(`create_milestone failed: GitHub responded HTTP ${res.status}${detail ? ` (${detail})` : ''}`);
    }
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    // inert record — NO token, NO headers echoed.
    return { created: true, apiCalled: true, repo: `${owner}/${repo}`, milestone: data.number, htmlUrl: data.html_url, title };
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
