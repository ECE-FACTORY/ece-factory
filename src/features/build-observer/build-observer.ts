// Run/Build Observer (Factory capability #2) — OBSERVES, never ACTS.
//
// The Observer watches a build or run the factory (or operator) is ALREADY performing, captures what happened
// (command, timing, exit status, bounded+redacted output, and the artifacts produced with integrity hashes),
// and hands back one immutable ObservationRecord per event. A separate auditor records that record to the
// factory's hash-chained append-only audit, so "what the factory built/ran, and how it went" becomes
// tamper-evident evidence. Same discipline as the Policy Engine: it REPORTS, it never DECIDES or ACTS.
//
// SAFETY (observe-only, proven structurally):
//   • The Observer holds NO gate / approval / mint / bridge reference and exposes NO method to start a
//     consequential action, approve anything, or modify what it watches. Its only capability is observe() → data.
//   • It imports NOTHING from the gate/gauntlet/bridge/external-action modules (a source-scan test asserts this).
//   • The thing it watches is an injected `BuildRun` — a NON-consequential local build/run/test that returns
//     process output. Observing a build does NOT grant permission to run it, and the Observer cannot turn a
//     `BuildRun` into a gated external action: a `BuildRun` carries no capability, target, or approval.
//   • Secrets in observed output are redacted BEFORE anything is recorded (deny-by-default free-text scrub +
//     the factory's allowlist redaction for the audited summary) — no token/key ever lands in a record or audit.
//
// STANDALONE-PACKAGEABLE: every cross-engine reference is `import type` (zero runtime coupling); the audit sink
// and the redactor are injected as ports.
//
// DOWNSTREAM (do NOT build now): the ObservationRecord is shaped for Local Preview (#3) and App Packaging (#4)
// — status (did it succeed), artifacts[].{path,bytes,sha256} (what was built, where, and integrity hashes),
// and bounded output. Those consumers read this record; they are out of scope here.

import type { AuditSink, AppendResult } from '../audit-engine/sink.js';
import type { HumanActor, SessionInfo, Environment } from '../audit-engine/schema.js';
import type { RedactionEngine } from '../redaction-engine/redaction-engine.js';

// ── the observation record (the evidence unit; also the preview/packaging input) ────────────────────────────
export interface ObservedArtifact {
  /** where the artifact is (a path/locator the operator or packaging step can resolve) */
  path: string;
  /** size in bytes */
  bytes: number;
  /** SHA-256 of the artifact's bytes (hex) — integrity for preview/packaging */
  sha256: string;
}

export type ObservationStatus = 'success' | 'failure';
export type ObservationKind = 'build' | 'run' | 'test';

export interface ObservationRecord {
  observationId: string;
  kind: ObservationKind;
  /** the command/target observed (already secret-scrubbed) */
  command: string;
  target: string | null;
  startedAtIso: string;
  endedAtIso: string;
  durationMs: number;
  /** derived from the exit code: 0 ⇒ success, anything else (or null) ⇒ failure */
  status: ObservationStatus;
  exitCode: number | null;
  /** bounded + secret-scrubbed */
  stdout: string;
  stderr: string;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
  /** files produced by the build/run, with integrity hashes (for preview + packaging) */
  artifacts: ObservedArtifact[];
}

/** What a watched build/run produces. The Observer WATCHES this — it does not decide to run a consequential
 *  action. `run` MUST be a NON-consequential local build/run/test, never a gated external action. A BuildOutcome
 *  carries no capability/approval/target, so it can never be a gated external effect. */
export interface BuildOutcome {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  artifactPaths?: string[];
}
export type BuildRun = () => Promise<BuildOutcome>;

export interface ObserveInput {
  kind: ObservationKind;
  command: string;
  target?: string;
  run: BuildRun;
  /** artifact locators to hash; falls back to whatever the run reports it produced */
  artifactPaths?: string[];
}

/** Reads an artifact's size + content hash. Injected (the Node adapter supplies fs+crypto); pure + testable.
 *  Returns null if the artifact is absent/unreadable (then it is simply omitted from the record). */
export type ArtifactProbe = (path: string) => { bytes: number; sha256: string } | null;

/** Free-text secret scrubber port. A conservative deny-by-default default is provided below. */
export interface TextRedactor {
  redact(text: string): string;
}

// Known secret shapes masked out of any observed free text BEFORE it is recorded or audited. Deny-by-default in
// spirit: it does not try to be clever, it masks the concrete high-risk shapes (tokens, bearer creds, secret
// env assignments, DSN passwords) so a build that echoes a token never leaks it into evidence.
const SECRET_PATTERNS: RegExp[] = [
  /gh[pousr]_[A-Za-z0-9]{20,}/g,                                   // GitHub PAT / OAuth / server tokens
  /github_pat_[A-Za-z0-9_]{20,}/g,                                 // GitHub fine-grained PAT
  /\bBearer\s+[A-Za-z0-9._\-]{8,}/gi,                              // Authorization: Bearer <token>
  /\b[A-Za-z0-9_]*(?:TOKEN|SECRET|PASSWORD|APIKEY|API_KEY|PRIVATE_KEY)\b\s*[=:]\s*("[^"]*"|'[^']*'|\S+)/gi, // KEY=secret
  /\bpostgres(?:ql)?:\/\/[^\s:@/]+:[^\s@/]+@/gi,                   // postgres://user:password@host
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, // PEM private keys
];

/** The default free-text redactor — masks known secret shapes with [REDACTED]. */
export const SecretPatternRedactor: TextRedactor = {
  redact(text: string): string {
    if (!text) return text;
    let out = text;
    for (const re of SECRET_PATTERNS) out = out.replace(re, '[REDACTED]');
    return out;
  },
};

export interface ObserverConfig {
  /** cap on captured stdout/stderr length (each) — default 64 KiB */
  maxOutputBytes?: number;
  /** injectable clock (ms) for deterministic timing/ids in tests — default Date.now */
  now?: () => number;
  /** injectable free-text secret scrubber — default SecretPatternRedactor */
  redactor?: TextRedactor;
  /** injectable id derivation — default derives from kind + start + target/command */
  makeId?: (input: ObserveInput, startMs: number) => string;
}

const DEFAULT_MAX_OUTPUT = 64 * 1024;

/**
 * The general-purpose Observer core. Give it any `BuildRun` to watch; it returns an ObservationRecord. It has
 * exactly one method — observe() — and holds no gate/approval/bridge reference. It cannot approve, mint, gate,
 * or initiate a consequential action; it cannot modify what it watches (it only awaits the injected run and
 * reads artifact bytes through the injected probe).
 */
export class BuildObserver {
  private readonly maxOutputBytes: number;
  private readonly now: () => number;
  private readonly redactor: TextRedactor;
  private readonly makeId: (input: ObserveInput, startMs: number) => string;

  constructor(private readonly probe: ArtifactProbe, cfg: ObserverConfig = {}) {
    this.maxOutputBytes = cfg.maxOutputBytes ?? DEFAULT_MAX_OUTPUT;
    this.now = cfg.now ?? (() => Date.now());
    this.redactor = cfg.redactor ?? SecretPatternRedactor;
    this.makeId = cfg.makeId ?? ((input, startMs) => `obs-${input.kind}-${startMs.toString(36)}-${slug(input.target ?? input.command)}`);
  }

  async observe(input: ObserveInput): Promise<ObservationRecord> {
    const startMs = this.now();
    const startedAtIso = new Date(startMs).toISOString();

    // WATCH: await the already-decided local build/run. The Observer neither chooses to run a consequential
    // action nor can it — `run` is an injected non-consequential process that returns plain output.
    const outcome = await input.run();

    const endMs = this.now();
    const endedAtIso = new Date(endMs).toISOString();

    const [stdout, stdoutTruncated] = this.bound(this.redactor.redact(outcome.stdout ?? ''));
    const [stderr, stderrTruncated] = this.bound(this.redactor.redact(outcome.stderr ?? ''));

    const paths = input.artifactPaths ?? outcome.artifactPaths ?? [];
    const artifacts: ObservedArtifact[] = [];
    for (const p of paths) {
      const probed = this.probe(p);
      if (probed) artifacts.push({ path: p, bytes: probed.bytes, sha256: probed.sha256 });
    }

    return {
      observationId: this.makeId(input, startMs),
      kind: input.kind,
      command: this.redactor.redact(input.command),
      target: input.target ?? null,
      startedAtIso,
      endedAtIso,
      durationMs: Math.max(0, endMs - startMs),
      status: outcome.exitCode === 0 ? 'success' : 'failure',
      exitCode: outcome.exitCode,
      stdout,
      stderr,
      stdoutTruncated,
      stderrTruncated,
      artifacts,
    };
  }

  private bound(text: string): [string, boolean] {
    if (text.length <= this.maxOutputBytes) return [text, false];
    return [text.slice(0, this.maxOutputBytes) + '\n…[truncated]', true];
  }
}

function slug(s: string): string {
  return (s || 'observation').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'observation';
}

// ── audit tie-in (the C in A+C) — record an observation to the hash-chain, immutably ────────────────────────
/** The exact keys allowed onto the chain for an observation summary (deny-by-default via the factory redactor).
 *  Only safe metadata + artifact integrity — never raw secrets (the free text is already scrubbed too). */
export const OBSERVATION_AUDIT_ALLOWLIST: readonly string[] = [
  'observation', 'kind', 'command', 'target', 'status', 'exitCode', 'durationMs',
  'startedAtIso', 'endedAtIso', 'artifacts', 'path', 'bytes', 'sha256',
  'stdoutBytes', 'stderrBytes', 'stdoutTruncated', 'stderrTruncated', 'environment',
];

/**
 * Records an ObservationRecord to the factory's append-only, hash-chained audit via the audit-of-reads append
 * path — the SAME store + pattern the Decision Console audit uses. It holds ONLY `appendRead` (no gate, no
 * approval, no bridge) and a redactor; it can persist evidence and nothing else. The summary passes through the
 * factory's allowlist redactor before it is written, so only safe metadata + artifact hashes reach the chain.
 */
export class ObservationAuditor {
  constructor(
    private readonly sink: Pick<AuditSink, 'appendRead'>,
    private readonly redactor: Pick<RedactionEngine, 'redactSummary'>,
    private readonly organizationId: string,
    private readonly actor: HumanActor,
    private readonly environment: Environment = 'local',
    private readonly session: SessionInfo = { session_id: 'build-observer' },
  ) {}

  async record(rec: ObservationRecord): Promise<AppendResult> {
    const summary = this.redactor.redactSummary({
      observation: rec.observationId,
      kind: rec.kind,
      command: rec.command,
      target: rec.target,
      status: rec.status,
      exitCode: rec.exitCode,
      durationMs: rec.durationMs,
      startedAtIso: rec.startedAtIso,
      endedAtIso: rec.endedAtIso,
      artifacts: rec.artifacts.map((a) => ({ path: a.path, bytes: a.bytes, sha256: a.sha256 })),
      stdoutBytes: rec.stdout.length,
      stderrBytes: rec.stderr.length,
      stdoutTruncated: rec.stdoutTruncated,
      stderrTruncated: rec.stderrTruncated,
      environment: this.environment,
    });
    return this.sink.appendRead({
      organization_id: this.organizationId,
      human_actor: this.actor,
      session: this.session,
      query_range: summary,
      rows_returned: rec.artifacts.length,
    });
  }
}
