// Repo Scout (Module — Layer 3 sourcing front-end) — the READ-ONLY component that turns a query into
// candidate GitHub repos and VERIFIES each license by reading the ACTUAL raw LICENSE file. It SOURCES;
// it does not grade, build, approve, mint, or take any external write action.
//
// TWO STAGES (independent):
//   (a) DISCOVERY  — GitHub search API returns candidate repos + a license HINT (spdx_id). The hint is
//                    NON-AUTHORITATIVE (the same badge-vs-text lesson the License Engine enforces).
//   (b) VERIFICATION — the scout independently fetches the raw LICENSE file (raw.githubusercontent.com,
//                    trying LICENSE + variants) and reads real content. On disagreement between the API
//                    hint and what the raw text actually is, THE RAW FILE WINS and a flag is recorded.
//
// NETWORK ISOLATION: every network egress lives HERE (this module's `fetchImpl`). The scout emits INERT
// DATA — repo facts + verbatim license text as `LicenseInput.text` — to the existing graders. No other
// module fetches. The scout consumes NO grader logic beyond the pure `detectFromText`/`labelFromBadge`
// helpers it reuses to compute the disagreement flag (it does NOT reimplement classification/scoring).
//
// TOKEN SAFETY (structural): the GitHub token is read ONLY from the constructor (composition root passes
// `process.env.GITHUB_TOKEN`), stored in a private `#token` field, used ONLY in the Authorization header,
// and NEVER logged, audited, emitted, placed in a fixture, or included in any returned record or error.
// No token OR unreachable network ⇒ FAIL CLOSED with a clear status. The scout NEVER fabricates a repo.
//
// READ-ONLY / STANDALONE: it holds no gate/approval/bridge/write reference and imports nothing from the
// action layer. Cross-engine references are `import type` (plus the two pure license helpers, reused).

import type { RepoIdentity, RepoEvaluationInput, MaturitySignals } from '../repo-intelligence/repo-intelligence.js';
import type { LicenseInput } from '../license-compliance/license-compliance.js';
import { detectFromText, labelFromBadge } from '../license-compliance/license-compliance.js';

// ── Public shapes ────────────────────────────────────────────────────────────────────────────────────

export interface RepoScoutOptions {
  /** Read-only public-scope GitHub token. Supplied by the composition root from `process.env.GITHUB_TOKEN`.
   *  Absent/blank ⇒ the scout fails CLOSED (never a silent fake). Stored privately; never emitted. */
  token?: string;
  /** Injectable fetch (defaults to the global). Tests inject a fake so no real network call happens. */
  fetchImpl?: typeof fetch;
  /** Overridable hosts (tests point these at a fake via `fetchImpl`; defaults are the real GitHub hosts). */
  apiBase?: string;
  rawBase?: string;
  /** Clock, injectable for deterministic maturity derivation. */
  now?: () => number;
}

export interface ScoutQuery {
  query: string;
  /** Hard cap on candidates returned (defence against unbounded fan-out). Default 10, clamped to [1,50]. */
  maxResults?: number;
}

export type ScoutStatus = 'OK' | 'FAILED_CLOSED';

/** One sourced candidate: the inert facts shaped for the graders PLUS the scout's verification metadata. */
export interface ScoutedCandidate {
  /** Inert facts shaped EXACTLY for `RepoIntelligenceEngine.evaluate` (repo-intelligence.ts:36,109). */
  evaluationInput: RepoEvaluationInput;
  /** The repo's GitHub URL (inert data). */
  repoUrl: string;
  /** The raw URL the LICENSE text was read from, or null if no license file was found. */
  rawLicenseUrl: string | null;
  /** Did the scout actually read a non-empty LICENSE file? (Feeds provenance.) */
  licenseVerified: boolean;
  /** Normalized API license HINT (non-authoritative). 'unknown' if none/NOASSERTION. */
  licenseHint: string;
  /** What the RAW license text actually is, via the reused `detectFromText`. 'unknown' if unreadable. */
  licenseFromRawText: string;
  /** True when the API hint disagrees with the raw file. The raw file wins downstream (it is the `text`). */
  licenseDisagreement: boolean;
  /** Inert, token-free diagnostics. */
  notes: string[];
}

export interface ScoutResult {
  status: ScoutStatus;
  query: string;
  candidates: ScoutedCandidate[];
  /** Set only when status is FAILED_CLOSED — the reason egress could not be performed. */
  reason?: string;
}

/** Intermediate, pre-verification discovery shape (pure-parsed from the search API). */
export interface DiscoveredRepo {
  owner: string;
  name: string;
  url: string;
  description: string | null;
  stars: number | undefined;
  pushedAtIso: string | undefined;
  archived: boolean | undefined;
  defaultBranch: string;
  /** Raw API license hint string (e.g. 'MIT', 'NOASSERTION', or ''). Non-authoritative. */
  licenseHintRaw: string;
}

// ── Pure helpers (unit-testable with NO network) ───────────────────────────────────────────────────────

/** LICENSE filename variants tried, in order. The first non-empty 200 wins. */
export const LICENSE_FILE_VARIANTS = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'COPYING', 'LICENSE-MIT', 'LICENSE-APACHE'] as const;

/** Normalize an API license hint to an SPDX-ish id via the reused badge helper. NOASSERTION/blank ⇒ 'unknown'. */
export function normalizeLicenseHint(apiSpdxId: string | null | undefined): string {
  const s = (apiSpdxId ?? '').trim();
  if (s === '' || /^noassertion$/i.test(s)) return 'unknown';
  const id = labelFromBadge(s);
  return id === 'noclaim' ? 'unknown' : id;
}

/**
 * Compare the API hint against the raw LICENSE text. THE RAW FILE IS TRUTH: `fromText` is what the actual
 * text is (via the reused `detectFromText`). `disagreement` is true when both are known and differ.
 */
export function licenseAgreement(apiSpdxId: string | null | undefined, rawText: string | null): {
  hint: string; fromText: string; disagreement: boolean;
} {
  const hint = normalizeLicenseHint(apiSpdxId);
  const fromText = rawText && rawText.trim() ? detectFromText(rawText) : 'unknown';
  const disagreement = hint !== 'unknown' && fromText !== 'unknown' && hint !== fromText;
  return { hint, fromText, disagreement };
}

/** Pure parse of a GitHub `/search/repositories` JSON body into discovery records. Tolerant of missing fields. */
export function parseSearchItems(body: unknown): DiscoveredRepo[] {
  const items = (body as { items?: unknown[] } | null)?.items;
  if (!Array.isArray(items)) return [];
  const out: DiscoveredRepo[] = [];
  for (const raw of items) {
    const it = raw as Record<string, unknown>;
    const fullName = typeof it.full_name === 'string' ? it.full_name : '';
    const ownerLogin = (it.owner as { login?: unknown } | undefined)?.login;
    const owner = typeof ownerLogin === 'string' && ownerLogin ? ownerLogin : fullName.split('/')[0] ?? '';
    const name = typeof it.name === 'string' && it.name ? it.name : fullName.split('/')[1] ?? '';
    if (!owner || !name) continue; // deny-by-default: a repo we cannot identify is dropped, never guessed
    const lic = it.license as { spdx_id?: unknown } | null | undefined;
    out.push({
      owner,
      name,
      url: typeof it.html_url === 'string' ? it.html_url : `https://github.com/${owner}/${name}`,
      description: typeof it.description === 'string' ? it.description : null,
      stars: typeof it.stargazers_count === 'number' ? it.stargazers_count : undefined,
      pushedAtIso: typeof it.pushed_at === 'string' ? it.pushed_at : undefined,
      archived: typeof it.archived === 'boolean' ? it.archived : undefined,
      defaultBranch: typeof it.default_branch === 'string' && it.default_branch ? it.default_branch : 'main',
      licenseHintRaw: typeof lic?.spdx_id === 'string' ? lic.spdx_id : '',
    });
  }
  return out;
}

/** Build the raw.githubusercontent.com URL for a license file variant. */
export function rawLicenseUrl(rawBase: string, owner: string, name: string, branch: string, file: string): string {
  return `${rawBase.replace(/\/$/, '')}/${owner}/${name}/${branch}/${file}`;
}

/** Derive maturity SIGNALS (facts + one transparent recency flag) from a discovery record. */
export function deriveMaturity(repo: DiscoveredRepo, nowMs: number): MaturitySignals {
  const ACTIVE_WINDOW_MS = 456 * 24 * 60 * 60 * 1000; // ~15 months
  let activelyMaintained: boolean | undefined;
  if (repo.archived === true) activelyMaintained = false;
  else if (repo.pushedAtIso) {
    const t = Date.parse(repo.pushedAtIso);
    if (!Number.isNaN(t)) activelyMaintained = nowMs - t < ACTIVE_WINDOW_MS;
  }
  return { stars: repo.stars, lastCommitIso: repo.pushedAtIso, archived: repo.archived, activelyMaintained };
}

// ── The scout ──────────────────────────────────────────────────────────────────────────────────────────

const DEFAULT_MAX = 10;
const MAX_CAP = 50;

export class RepoScout {
  readonly #token: string | undefined; // private field — never enumerable, never serialized, never logged
  private readonly fetchImpl: typeof fetch | undefined;
  private readonly apiBase: string;
  private readonly rawBase: string;
  private readonly now: () => number;

  constructor(opts: RepoScoutOptions = {}) {
    const t = opts.token?.trim();
    this.#token = t ? t : undefined;
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch;
    this.apiBase = (opts.apiBase ?? 'https://api.github.com').replace(/\/$/, '');
    this.rawBase = (opts.rawBase ?? 'https://raw.githubusercontent.com').replace(/\/$/, '');
    this.now = opts.now ?? (() => Date.now());
  }

  /** Scrub the token from any diagnostic string — defence in depth (the token should never reach here anyway). */
  private redact(s: string): string {
    return this.#token ? s.split(this.#token).join('[REDACTED]') : s;
  }

  /**
   * Source candidates for a query: discover → independently verify each license → emit inert facts.
   * FAILS CLOSED (empty candidate set + reason) when there is no token, no fetch, or the network is
   * unreachable. It NEVER fabricates a repo or a license.
   */
  async scout(q: ScoutQuery): Promise<ScoutResult> {
    if (!this.#token) {
      return { status: 'FAILED_CLOSED', query: q.query, candidates: [], reason: 'no GITHUB_TOKEN — scout refuses to source without a read-only token (fail-closed; no fake fallback)' };
    }
    if (!this.fetchImpl) {
      return { status: 'FAILED_CLOSED', query: q.query, candidates: [], reason: 'no fetch implementation available — cannot reach GitHub (fail-closed)' };
    }
    const max = Math.min(Math.max(1, q.maxResults ?? DEFAULT_MAX), MAX_CAP);

    let discovered: DiscoveredRepo[];
    try {
      discovered = await this.discover(q.query, max);
    } catch (e) {
      return { status: 'FAILED_CLOSED', query: q.query, candidates: [], reason: this.redact(`discovery failed: ${errName(e)} — network unreachable or API error (fail-closed, no fabricated repos)`) };
    }

    const candidates: ScoutedCandidate[] = [];
    for (const repo of discovered) {
      candidates.push(await this.verifyOne(repo));
    }
    return { status: 'OK', query: q.query, candidates };
  }

  // ── stage (a): discovery ─────────────────────────────────────────────────────────────────────────────
  private async discover(query: string, max: number): Promise<DiscoveredRepo[]> {
    const url = `${this.apiBase}/search/repositories?q=${encodeURIComponent(query)}&sort=stars&order=desc&per_page=${max}`;
    const res = await this.fetchImpl!(url, {
      headers: {
        Authorization: `Bearer ${this.#token}`, // the ONLY place the token is used; never echoed
        Accept: 'application/vnd.github+json',
        'User-Agent': 'ece-repo-scout',
      },
    });
    if (!res.ok) throw new Error(`GitHub search HTTP ${res.status}`); // status only — never the token/body
    const body = (await res.json()) as unknown;
    return parseSearchItems(body).slice(0, max);
  }

  // ── stage (b): independent license verification (raw file wins) ────────────────────────────────────────
  private async verifyOne(repo: DiscoveredRepo): Promise<ScoutedCandidate> {
    const notes: string[] = [];
    let rawText: string | null = null;
    let usedUrl: string | null = null;
    try {
      const found = await this.fetchLicenseText(repo);
      if (found) { rawText = found.text; usedUrl = found.url; }
    } catch (e) {
      notes.push(this.redact(`license fetch error: ${errName(e)}`));
    }

    const licenseVerified = !!rawText && rawText.trim().length > 0;
    if (!licenseVerified) notes.push('LICENSE file not found/unreadable — license UNVERIFIED (grader will deny-by-default)');

    const agreement = licenseAgreement(repo.licenseHintRaw, rawText);
    if (agreement.disagreement) {
      notes.push(`API license hint "${agreement.hint}" disagrees with raw LICENSE text "${agreement.fromText}" — RAW FILE WINS (emitted as text)`);
    }

    const identity: RepoIdentity = { host: 'github.com', owner: repo.owner, name: repo.name };
    // The raw file text is the AUTHORITATIVE input; the API hint is the non-authoritative declaredSpdx.
    const license: LicenseInput = {
      text: rawText ?? undefined,          // truth (verbatim, inert data) — empty ⇒ grader REJECTs (license-compliance.ts:96)
      declaredSpdx: repo.licenseHintRaw || undefined, // HINT only — the text wins on conflict
      source: `${repo.owner}/${repo.name}`,
    };
    const evaluationInput: RepoEvaluationInput = {
      identity,
      license,
      provenanceVerified: licenseVerified, // we read the real license live; unverified ⇒ false (deny-by-default)
      maturity: deriveMaturity(repo, this.now()),
      description: repo.description ?? undefined, // repo-sourced TEXT — INERT DATA
    };

    return {
      evaluationInput,
      repoUrl: repo.url,
      rawLicenseUrl: usedUrl,
      licenseVerified,
      licenseHint: agreement.hint,
      licenseFromRawText: agreement.fromText,
      licenseDisagreement: agreement.disagreement,
      notes,
    };
  }

  /** Try each LICENSE variant on the default branch; the first non-empty 200 wins. Raw host needs no token. */
  private async fetchLicenseText(repo: DiscoveredRepo): Promise<{ text: string; url: string } | null> {
    for (const file of LICENSE_FILE_VARIANTS) {
      const url = rawLicenseUrl(this.rawBase, repo.owner, repo.name, repo.defaultBranch, file);
      const res = await this.fetchImpl!(url, { headers: { 'User-Agent': 'ece-repo-scout' } });
      if (res.ok) {
        const text = await res.text();
        if (text && text.trim().length > 0) return { text, url };
      }
    }
    return null;
  }
}

/** Token-free error label — name + (if present) HTTP status only. Never the token, never a response body. */
function errName(e: unknown): string {
  if (e instanceof Error) return e.message.replace(/\s+/g, ' ').slice(0, 120);
  return 'unknown error';
}
