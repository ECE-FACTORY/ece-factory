// Live GitHub Issue-Batch Adapter (Factory capability — external-tier live wiring, GATED BULK) — the external
// action `create_issue_batch` → a REAL, bounded, fully-enumerated batch of GitHub Issues in ONE repo (per-item
// POST /repos/{owner}/{repo}/issues). It mirrors LiveGitHubIssueAdapter's safety EXACTLY: same env-only token,
// same loud-fail-if-unset, same injectable fetch + dry-run, and the same narrowing — it implements ONLY
// `createIssueBatch`, so it is structurally incapable of performing any other external action.
//
// GATED-BULK CONTRACT (honors "no bulk without enumeration"):
//   • ONE target repo; the multiplicity lives ENTIRELY in payload.issues, a FULLY-ENUMERATED list.
//   • That list is part of the per-action approval binding (canonical payload) upstream — so an approval for
//     batch A cannot execute batch B, and any post-approval mutation of the list invalidates the approval.
//   • Hard cap MAX_ISSUE_BATCH enforced here as DEFENSE-IN-DEPTH (the gateway fails fast first).
//   • Reached ONLY through IssueBatchGateway → bridge.createIssueBatch(capability, …) → the unchanged 8.4
//     gauntlet. It adds NO guard logic. Each created issue is returned so the caller records each to the audit.
//   • Partial failure is reported CLEARLY (created + failed items), never swallowed.
//
// The token is read ONLY from the constructor (composition root passes process.env.ECE_GITHUB_TOKEN) — never
// hardcoded, committed, logged, echoed, or placed in the returned record / error message.

import type { ExternalTarget, ExternalResult } from '../layer-5-action/mcp-bridge/external-tools.js';
import { MAX_ISSUE_BATCH } from '../layer-5-action/mcp-bridge/external-tools.js';

export interface GitHubIssueBatchAdapterOptions {
  token: string;
  fetchImpl?: typeof fetch;
  dryRun?: boolean;
  apiBase?: string;
}

/** The narrow port this adapter satisfies — exactly the one external action it owns. */
export interface IssueBatchCreator {
  createIssueBatch(target: ExternalTarget, payload?: Record<string, unknown>): Promise<ExternalResult>;
}

/** A batch needs a FULL repo slug "owner/repo" (both parts) — a bare name cannot locate a repo. */
export function parseBatchRepo(targetId: string): { owner: string; repo: string } {
  const raw = (targetId ?? '').trim();
  if (!raw) throw new Error('create_issue_batch: a target repo "owner/repo" is required');
  const parts = raw.split('/').filter((s) => s.length > 0);
  if (parts.length !== 2) throw new Error(`create_issue_batch: malformed repo target "${raw}" — expected "owner/repo"`);
  return { owner: parts[0], repo: parts[1] };
}

interface BatchIssue { title: string; body?: string }

/** Normalize + validate the enumerated issue list; enforce the hard cap as defense-in-depth. */
export function normalizeIssueBatch(payload?: Record<string, unknown>): BatchIssue[] {
  const raw = (payload as { issues?: unknown } | undefined)?.issues;
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error('create_issue_batch: payload.issues must be a FULLY-ENUMERATED, non-empty list');
  }
  if (raw.length > MAX_ISSUE_BATCH) {
    throw new Error(`create_issue_batch: batch of ${raw.length} exceeds the hard cap of ${MAX_ISSUE_BATCH} — split it into smaller, separately-approved batches`);
  }
  return raw.map((item, i) => {
    const rec = (item ?? {}) as Record<string, unknown>;
    const title = String(rec.title ?? '').trim();
    if (!title) throw new Error(`create_issue_batch: issue #${i + 1} is missing a title`);
    const body = typeof rec.body === 'string' ? rec.body : undefined;
    return { title, ...(body ? { body } : {}) };
  });
}

export class LiveGitHubIssueBatchAdapter implements IssueBatchCreator {
  readonly #token: string; // private field — not enumerable, never serialized
  private readonly fetchImpl: typeof fetch;
  private readonly dryRun: boolean;
  private readonly apiBase: string;

  constructor(opts: GitHubIssueBatchAdapterOptions) {
    if (!opts.token || !opts.token.trim()) {
      // LOUD fail — never a silent fake fallback. The message names the env var, NOT any value.
      throw new Error('ECE_GITHUB_TOKEN is not set: the live GitHub Issue-Batch adapter requires a token in the environment. Refusing to start (no silent fake fallback). Set ECE_GITHUB_TOKEN or disable live wiring (unset ECE_GITHUB_LIVE).');
    }
    this.#token = opts.token;
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch;
    this.dryRun = opts.dryRun ?? false;
    this.apiBase = (opts.apiBase ?? 'https://api.github.com').replace(/\/$/, '');
  }

  async createIssueBatch(target: ExternalTarget, payload?: Record<string, unknown>): Promise<ExternalResult> {
    const { owner, repo } = parseBatchRepo(target.targetId);
    const issues = normalizeIssueBatch(payload); // enforces non-empty + hard cap before ANY network call

    if (this.dryRun) {
      // gauntlet has already passed (this runs behind the gate); stop short of the real API.
      return { dryRun: true, apiCalled: false, wouldCreate: { owner, repo, count: issues.length, titles: issues.map((x) => x.title) } };
    }

    const url = `${this.apiBase}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues`;
    const created: Array<{ index: number; title: string; issue: unknown; htmlUrl: unknown }> = [];
    const failed: Array<{ index: number; title: string; error: string }> = [];

    // Per-item POST, IN ORDER. A single item's failure is captured and reported — never silently dropped, and
    // it does not undo the ones already created (GitHub has no batch endpoint; each issue is its own action).
    for (let i = 0; i < issues.length; i++) {
      const item = issues[i];
      try {
        const res = await this.fetchImpl(url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.#token}`, // the ONLY place the token is used; never logged
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
            'Content-Type': 'application/json',
            'User-Agent': 'ece-factory-mcp',
          },
          body: JSON.stringify({ title: item.title, ...(item.body ? { body: item.body } : {}) }),
        });
        if (!res.ok) {
          const detail = await safeStatusText(res);
          failed.push({ index: i, title: item.title, error: `HTTP ${res.status}${detail ? ` (${detail})` : ''}` });
          continue;
        }
        const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        created.push({ index: i, title: item.title, issue: data.number, htmlUrl: data.html_url });
      } catch (e) {
        failed.push({ index: i, title: item.title, error: e instanceof Error ? e.message : String(e) });
      }
    }

    // inert record — NO token, NO headers echoed. Reports the full outcome including any partial failures.
    return {
      apiCalled: created.length > 0,
      repo: `${owner}/${repo}`,
      requested: issues.length,
      created,
      createdCount: created.length,
      failed,
      failedCount: failed.length,
      partial: failed.length > 0 && created.length > 0,
    };
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
