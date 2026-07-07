// Repo Scout Signals (Layer 3) — the READ-ONLY companion to repo-scout. Given a repo the scout already
// discovered (owner/repo + default branch), it reads ADDITIONAL public, read-only GitHub signals and emits
// them for the FOUR scoring dimensions the base scout cannot source — EACH WITH A CONFIDENCE LEVEL. It
// SOURCES signals; it does NOT decide fork/extend/build and does NOT grade.
//
// THE CONFIDENCE CONTRACT (the honesty mechanism) — every dimension emits:
//     { value, confidence: 'measured' | 'partial' | 'not-mechanizable', evidence[] }
//   • measured        — derived from real fetched data; a grader may raise confidence from this.
//   • partial         — some real evidence, but incomplete/uncertain; contributes only weakly.
//   • not-mechanizable — cannot be honestly judged from read-only data; leaves the dimension
//                        deny-by-default exactly as today. NEVER a fabricated value.
// Enrichment can only SHARPEN a decision where real evidence exists — it must never manufacture confidence.
//
// THE FOUR DIMENSIONS, enriched as far as honestly possible AND NO FURTHER:
//   1. MAINTAINABILITY  → 'measured'  from commit recency, contributors, open issues, releases, tests + CI.
//   2. ARCHITECTURE     → 'measured' when a dependency manifest is readable, else 'partial' from the tree.
//                         A structural proxy only — 'strong' FIT needs human review, so it is NEVER emitted.
//   3. AIR-GAP FIT      → 'partial' ALWAYS (or 'not-mechanizable'). Absence of a cloud dep is NOT proof of
//                         air-gap safety, so 'measured'/'yes' are NEVER emitted from manifest-reading alone.
//   4. WHITE-LABEL FIT  → 'not-mechanizable' — rebrandability is an architectural/legal judgment. Weak
//                         signals may be noted, but the confidence stays not-mechanizable; no fabricated score.
//
// TOKEN + NETWORK: same discipline as repo-scout. The token is read only from the constructor, held in a
// private #token field, used ONLY in the Authorization header, and NEVER logged/emitted/redacted-into-output.
// All network egress lives HERE. No token / unreachable ⇒ FAIL CLOSED: every dimension 'not-mechanizable'
// with an honest reason — never invented data.
//
// READ-ONLY / STANDALONE: imports only the grader RATING TYPES (import type); reaches no write/external path.

import { normalizeGithubToken } from '../../factory-shared/github-token/github-token.js';
import type { ArchFitRating, MaintainabilityRating } from '../scoring-engine/scoring-engine.js';
import type { AirGapSuitability, WhiteLabelFit } from '../repo-intelligence/repo-intelligence.js';

// ── Public shapes ────────────────────────────────────────────────────────────────────────────────────

export type Confidence = 'measured' | 'partial' | 'not-mechanizable';

export interface DimensionSignal<V> {
  value: V;
  confidence: Confidence;
  evidence: string[];
}

export interface SignalTarget {
  owner: string;
  name: string;
  /** default branch (from the base scout's discovery). */
  branch: string;
}

export type SignalsStatus = 'OK' | 'FAILED_CLOSED';

export interface RepoSignals {
  status: SignalsStatus;
  target: SignalTarget;
  maintainability: DimensionSignal<MaintainabilityRating | 'unknown'>;
  architecture: DimensionSignal<ArchFitRating | 'unknown'>;
  airGap: DimensionSignal<AirGapSuitability>;
  whiteLabel: DimensionSignal<WhiteLabelFit>;
  reason?: string; // set on FAILED_CLOSED
}

export interface RepoScoutSignalsOptions {
  token?: string;
  fetchImpl?: typeof fetch;
  apiBase?: string;
  rawBase?: string;
  now?: () => number;
}

// ── Fact bundles the pure derivations consume (assembled from fetched data) ────────────────────────────

export interface MaintainabilityFacts {
  commitRecencyDays?: number; // days since last push
  contributors?: number;
  openIssues?: number;
  releases?: number;
  hasTests: boolean;
  hasCI: boolean;
  archived?: boolean;
}
export interface ArchitectureFacts {
  manifestReadable: boolean;
  treeReadable: boolean;
  primaryLanguage?: string;
  dependencyCount?: number;
  modular?: boolean;
}
export interface AirGapFacts {
  manifestReadable: boolean;
  cloudBlockers: string[]; // named hard cloud/SaaS/phone-home dependencies found in the manifest
}
export interface WhiteLabelFacts {
  brandingHits: string[]; // weak signals only (trademark files, hardcoded product strings)
}

// ── Config: cloud / SaaS / phone-home dependency patterns (read-only heuristics) ───────────────────────

export const CLOUD_DEP_PATTERNS: { re: RegExp; label: string }[] = [
  { re: /aws-sdk|@aws-sdk|\bboto3\b|\baioboto/i, label: 'AWS SDK' },
  { re: /@google-cloud|googleapis|firebase/i, label: 'Google Cloud / Firebase' },
  { re: /@azure|\bazure-/i, label: 'Azure SDK' },
  { re: /\bsentry\b|@sentry/i, label: 'Sentry (hosted error telemetry)' },
  { re: /datadog|new-?relic/i, label: 'APM telemetry (Datadog/New Relic)' },
  { re: /segment|mixpanel|amplitude|analytics/i, label: 'product analytics / telemetry' },
  { re: /auth0|okta|@clerk/i, label: 'hosted identity (Auth0/Okta/Clerk)' },
  { re: /twilio|sendgrid|mailgun|@sendgrid/i, label: 'hosted comms (Twilio/SendGrid/Mailgun)' },
];

// ── Pure derivations (unit-testable with NO network) ───────────────────────────────────────────────────

export function deriveMaintainability(f: MaintainabilityFacts): DimensionSignal<MaintainabilityRating | 'unknown'> {
  const evidence: string[] = [];
  if (f.commitRecencyDays !== undefined) evidence.push(`last push ${f.commitRecencyDays}d ago`);
  if (f.contributors !== undefined) evidence.push(`${f.contributors} contributor(s)`);
  if (f.openIssues !== undefined) evidence.push(`${f.openIssues} open issues`);
  if (f.releases !== undefined) evidence.push(`${f.releases} recent release(s)`);
  evidence.push(f.hasCI ? 'CI config present' : 'no CI config found');
  evidence.push(f.hasTests ? 'tests present' : 'no tests found');

  let value: MaintainabilityRating;
  const stale = f.commitRecencyDays !== undefined && f.commitRecencyDays > 365;
  if (f.archived === true || (stale && !f.hasTests && !f.hasCI)) {
    value = 'unsafe';
  } else if (stale || ((f.contributors ?? 0) <= 1 && !f.hasCI)) {
    value = 'hard';
  } else if ((f.commitRecencyDays ?? 999) <= 90 && (f.contributors ?? 0) >= 5 && f.hasCI && f.hasTests) {
    value = 'clean';
  } else {
    value = 'maintainable';
  }
  return { value, confidence: 'measured', evidence };
}

export function deriveArchitecture(f: ArchitectureFacts): DimensionSignal<ArchFitRating | 'unknown'> {
  if (!f.manifestReadable && !f.treeReadable) {
    return { value: 'unknown', confidence: 'not-mechanizable', evidence: ['neither dependency manifest nor repo tree was readable'] };
  }
  const evidence: string[] = [];
  if (f.primaryLanguage) evidence.push(`primary language ${f.primaryLanguage}`);
  if (f.dependencyCount !== undefined) evidence.push(`${f.dependencyCount} direct dependencies`);
  if (f.modular !== undefined) evidence.push(f.modular ? 'modular layout (packages/modules/apps dirs)' : 'monolithic layout');
  evidence.push('NOTE: structural proxy only — architectural FIT to ECE needs requires human review; "strong" is never emitted mechanically');

  const confidence: Confidence = f.manifestReadable ? 'measured' : 'partial';
  let value: ArchFitRating;
  const deps = f.dependencyCount ?? undefined;
  if (deps !== undefined && deps > 150) value = 'possible';       // very heavy dependency surface
  else if (f.modular === true && (deps === undefined || deps <= 80)) value = 'good'; // capped at good, never strong
  else value = 'possible';
  return { value, confidence, evidence };
}

export function deriveAirGap(f: AirGapFacts): DimensionSignal<AirGapSuitability> {
  if (!f.manifestReadable) {
    return { value: 'unknown', confidence: 'not-mechanizable', evidence: ['no dependency manifest readable — cannot inspect for cloud/SaaS dependencies'] };
  }
  if (f.cloudBlockers.length > 0) {
    return { value: 'no', confidence: 'partial', evidence: [`hard cloud/SaaS/phone-home dependency found: ${f.cloudBlockers.join(', ')}`, 'PARTIAL: manifest evidence of a blocker; a physical air-gap test is still required'] };
  }
  // Absence of a cloud dependency is NOT proof of air-gap safety.
  return { value: 'partial', confidence: 'partial', evidence: ['no hard cloud/SaaS dependency found in the manifest', 'PARTIAL BY NATURE: absence of evidence is not proof — never "yes"/"measured" from manifest-reading alone'] };
}

export function deriveWhiteLabel(f: WhiteLabelFacts): DimensionSignal<WhiteLabelFit> {
  const evidence = ['rebrandability is an architectural/legal judgment, not a fetchable fact — NOT MECHANIZABLE'];
  if (f.brandingHits.length > 0) evidence.push(`weak signals only (not scored): ${f.brandingHits.slice(0, 5).join(', ')}`);
  return { value: 'unknown', confidence: 'not-mechanizable', evidence };
}

// ── Pure parsers/analyzers over fetched text (unit-testable with NO network) ────────────────────────────

/** Count direct dependencies + collect their names from a manifest. Best-effort per ecosystem. */
export function parseManifestDeps(filename: string, text: string): { count: number; names: string[] } {
  try {
    if (filename === 'package.json') {
      const j = JSON.parse(text) as { dependencies?: Record<string, string> };
      const names = Object.keys(j.dependencies ?? {});
      return { count: names.length, names };
    }
    if (filename === 'go.mod') {
      const names = [...text.matchAll(/^\s*([\w./-]+)\s+v\d/gm)].map((m) => m[1]);
      return { count: names.length, names };
    }
    if (filename === 'requirements.txt') {
      const names = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).map((l) => l.split(/[=<>!~ ]/)[0]);
      return { count: names.length, names };
    }
    if (filename === 'pom.xml') {
      const names = [...text.matchAll(/<artifactId>([^<]+)<\/artifactId>/g)].map((m) => m[1]);
      return { count: names.length, names };
    }
    if (filename === 'Cargo.toml') {
      const dep = /\[dependencies\]([\s\S]*?)(\n\[|$)/.exec(text)?.[1] ?? '';
      const names = [...dep.matchAll(/^\s*([\w-]+)\s*=/gm)].map((m) => m[1]);
      return { count: names.length, names };
    }
  } catch { /* fall through to empty */ }
  return { count: 0, names: [] };
}

/** Which manifest filenames the module looks for, in order. */
export const MANIFEST_FILES = ['package.json', 'go.mod', 'requirements.txt', 'pom.xml', 'Cargo.toml', 'build.gradle'] as const;

/** Find cloud/SaaS/phone-home blockers among dependency names + raw manifest text. */
export function detectCloudBlockers(names: string[], manifestText: string): string[] {
  const hay = `${names.join(' ')} ${manifestText}`;
  const hits = new Set<string>();
  for (const { re, label } of CLOUD_DEP_PATTERNS) if (re.test(hay)) hits.add(label);
  return [...hits];
}

/** Analyze a repo tree (array of paths) for tests, CI, and a modular layout. */
export function analyzeTree(paths: string[]): { hasTests: boolean; hasCI: boolean; modular: boolean } {
  const hasCI = paths.some((p) => /^\.github\/workflows\/.+/.test(p) || /^(\.travis\.yml|\.gitlab-ci\.yml|azure-pipelines\.yml|Jenkinsfile|\.circleci\/config\.yml)$/.test(p));
  const hasTests = paths.some((p) => /(^|\/)(tests?|__tests__|spec)(\/|$)/i.test(p) || /\.(test|spec)\.[a-z]+$/i.test(p));
  const modular = paths.some((p) => /^(packages|modules|apps|libs)\/.+/.test(p));
  return { hasTests, hasCI, modular };
}

// ── The signals scout ──────────────────────────────────────────────────────────────────────────────────

export class RepoScoutSignals {
  readonly #token: string | undefined;
  private readonly fetchImpl: typeof fetch | undefined;
  private readonly apiBase: string;
  private readonly rawBase: string;
  private readonly now: () => number;

  constructor(opts: RepoScoutSignalsOptions = {}) {
    // Single shared guard: missing / blank / whitespace-only / malformed ⇒ treated as NO TOKEN (fail-closed).
    this.#token = normalizeGithubToken(opts.token);
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch;
    this.apiBase = (opts.apiBase ?? 'https://api.github.com').replace(/\/$/, '');
    this.rawBase = (opts.rawBase ?? 'https://raw.githubusercontent.com').replace(/\/$/, '');
    this.now = opts.now ?? (() => Date.now());
  }

  private redact(s: string): string {
    return this.#token ? s.split(this.#token).join('[REDACTED]') : s;
  }

  private failClosed(target: SignalTarget, reason: string): RepoSignals {
    const ev = [reason];
    return {
      status: 'FAILED_CLOSED',
      target,
      maintainability: { value: 'unknown', confidence: 'not-mechanizable', evidence: ev },
      architecture: { value: 'unknown', confidence: 'not-mechanizable', evidence: ev },
      airGap: { value: 'unknown', confidence: 'not-mechanizable', evidence: ev },
      whiteLabel: { value: 'unknown', confidence: 'not-mechanizable', evidence: ev },
      reason,
    };
  }

  /** Read all four dimensions' signals for one repo. Fails closed (no fabrication) on no token/unreachable. */
  async gather(target: SignalTarget): Promise<RepoSignals> {
    if (!this.#token) return this.failClosed(target, 'no GITHUB_TOKEN — signals scout refuses to source without a read-only token (fail-closed)');
    if (!this.fetchImpl) return this.failClosed(target, 'no fetch implementation available — cannot reach GitHub (fail-closed)');

    // Primary read: repo metadata. Network failure here ⇒ fail closed for this repo (no fabricated signals).
    let meta: RepoMeta | null;
    try {
      meta = await this.getRepoMeta(target);
    } catch (e) {
      return this.failClosed(target, this.redact(`network unreachable / API error: ${errName(e)}`));
    }
    if (!meta) return this.failClosed(target, 'repo metadata not readable (404 / private) — nothing to source');

    // Secondary reads are tolerant: a miss DEGRADES confidence, it does not fabricate.
    const treePaths = await this.getTreePaths(target).catch(() => null);
    const contributors = await this.getContributorCount(target).catch(() => undefined);
    const releases = await this.getReleaseCount(target).catch(() => undefined);
    const manifest = await this.getFirstManifest(target).catch(() => null);

    const tree = treePaths ? analyzeTree(treePaths) : { hasTests: false, hasCI: false, modular: false };
    const parsed = manifest ? parseManifestDeps(manifest.file, manifest.text) : null;
    const blockers = manifest && parsed ? detectCloudBlockers(parsed.names, manifest.text) : [];

    const commitRecencyDays = meta.pushedAtIso ? daysSince(meta.pushedAtIso, this.now()) : undefined;

    const maintainability = deriveMaintainability({
      commitRecencyDays, contributors, openIssues: meta.openIssues, releases,
      hasTests: tree.hasTests, hasCI: tree.hasCI, archived: meta.archived,
    });
    const architecture = deriveArchitecture({
      manifestReadable: !!manifest, treeReadable: !!treePaths,
      primaryLanguage: meta.language, dependencyCount: parsed?.count, modular: treePaths ? tree.modular : undefined,
    });
    const airGap = deriveAirGap({ manifestReadable: !!manifest, cloudBlockers: blockers });
    const whiteLabel = deriveWhiteLabel({ brandingHits: treePaths ? brandingHitsFromTree(treePaths) : [] });

    return { status: 'OK', target, maintainability, architecture, airGap, whiteLabel };
  }

  // ── network reads (all token-safe; raw host needs no token) ──────────────────────────────────────────
  private async apiGet(path: string): Promise<Response> {
    return this.fetchImpl!(`${this.apiBase}${path}`, {
      headers: { Authorization: `Bearer ${this.#token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'ece-repo-scout-signals' },
    });
  }

  private async getRepoMeta(t: SignalTarget): Promise<RepoMeta | null> {
    const res = await this.apiGet(`/repos/${t.owner}/${t.name}`);
    if (!res.ok) return null;
    const j = (await res.json()) as Record<string, unknown>;
    return {
      pushedAtIso: typeof j.pushed_at === 'string' ? j.pushed_at : undefined,
      openIssues: typeof j.open_issues_count === 'number' ? j.open_issues_count : undefined,
      language: typeof j.language === 'string' ? j.language : undefined,
      archived: typeof j.archived === 'boolean' ? j.archived : undefined,
    };
  }

  private async getTreePaths(t: SignalTarget): Promise<string[] | null> {
    const res = await this.apiGet(`/repos/${t.owner}/${t.name}/git/trees/${t.branch}?recursive=1`);
    if (!res.ok) return null;
    const j = (await res.json()) as { tree?: { path?: unknown }[] };
    if (!Array.isArray(j.tree)) return null;
    return j.tree.map((e) => (typeof e.path === 'string' ? e.path : '')).filter(Boolean);
  }

  private async getContributorCount(t: SignalTarget): Promise<number | undefined> {
    const res = await this.apiGet(`/repos/${t.owner}/${t.name}/contributors?per_page=1&anon=1`);
    if (!res.ok) return undefined;
    const last = parseLastPage(res.headers.get('link'));
    if (last !== undefined) return last; // one contributor per page ⇒ last page ≈ contributor count
    const arr = (await res.json()) as unknown[];
    return Array.isArray(arr) ? arr.length : undefined;
  }

  private async getReleaseCount(t: SignalTarget): Promise<number | undefined> {
    const res = await this.apiGet(`/repos/${t.owner}/${t.name}/releases?per_page=10`);
    if (!res.ok) return undefined;
    const arr = (await res.json()) as unknown[];
    return Array.isArray(arr) ? arr.length : undefined;
  }

  private async getFirstManifest(t: SignalTarget): Promise<{ file: string; text: string } | null> {
    for (const file of MANIFEST_FILES) {
      const res = await this.fetchImpl!(`${this.rawBase}/${t.owner}/${t.name}/${t.branch}/${file}`, { headers: { 'User-Agent': 'ece-repo-scout-signals' } });
      if (res.ok) {
        const text = await res.text();
        if (text && text.trim()) return { file, text };
      }
    }
    return null;
  }
}

interface RepoMeta { pushedAtIso?: string; openIssues?: number; language?: string; archived?: boolean }

// ── small pure utilities ───────────────────────────────────────────────────────────────────────────────

export function parseLastPage(linkHeader: string | null): number | undefined {
  if (!linkHeader) return undefined;
  const m = /[?&]page=(\d+)>;\s*rel="last"/.exec(linkHeader);
  return m ? Number(m[1]) : undefined;
}

export function daysSince(iso: string, nowMs: number): number | undefined {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return undefined;
  return Math.max(0, Math.floor((nowMs - t) / (24 * 60 * 60 * 1000)));
}

function brandingHitsFromTree(paths: string[]): string[] {
  return paths.filter((p) => /(^|\/)(trademark|TRADEMARK|BRANDING|branding)(\.|$|\/)/.test(p)).slice(0, 5);
}

function errName(e: unknown): string {
  if (e instanceof Error) return e.message.replace(/\s+/g, ' ').slice(0, 120);
  return 'unknown error';
}
