// Local Preview Standard — generator + compliance checker (Factory capability #3).
//
// This is the CHECKABLE half of docs/LOCAL_PREVIEW_STANDARD.md (which implements §1 of the governance
// requirement REQUIREMENT_PRODUCT_DELIVERY_AND_LOCAL_RUNNABLE.md). It consumes a built thing's declared
// PreviewManifest + the Run/Build Observer's ObservationRecord (capability #2 — did it build, which artifacts
// exist + their hashes) and produces an HONEST Preview/Status Report: what the thing is, whether it actually
// built/ran (from tamper-evident observation, never a claim), the local run commands, a demo pointer, and the
// current-vs-missing capability status — plus a standard-compliance verdict with the specific gaps.
//
// REPORT/GENERATE-ONLY (safety, same discipline as the Observer):
//   • It holds NO gate / approval / mint / bridge reference and exposes NO method to start a consequential
//     action, approve anything, or modify the build. Its only capabilities are generate()/checkStandard() → data.
//   • It imports NOTHING from the gate/gauntlet/bridge/external-action modules (a source-scan test asserts this).
//   • It does NOT launch anything. It reads the observation + manifest and reports. Executing a declared preview
//     command is the operator's action (or the Observer's local, non-consequential spawn) — never done here, and
//     never a gated external action.
//   • HONEST status is mandatory: build state comes only from the ObservationRecord. If the build failed or a
//     declared artifact is missing, the report says so; "what's missing" is a first-class output, never hidden.
//   • Redaction applies: free-text (commands / summary) is scrubbed before it appears in the report, and the
//     audited summary passes the factory's allowlist redactor — no secret lands in a report or on the chain.
//
// STANDALONE-PACKAGEABLE: every cross-engine reference is `import type` (zero runtime coupling); the Observer
// record type, the redactor, and the audit sink are injected/typed as ports.

import type { ObservationRecord } from '../build-observer/build-observer.js';
import type { TextRedactor } from '../build-observer/build-observer.js';
import type { AuditSink, AppendResult } from '../audit-engine/sink.js';
import type { HumanActor, SessionInfo, Environment } from '../audit-engine/schema.js';
import type { RedactionEngine } from '../redaction-engine/redaction-engine.js';

// ── the declared manifest (the standard's required declarations) ────────────────────────────────────────────
export type CapabilityState = 'present' | 'partial' | 'absent';
export interface DeclaredCapability { id: string; description: string; state: CapabilityState }

/** Declared, copy-pasteable local commands. `run`, `preview`, `status` are REQUIRED for compliance. */
export interface RunCommands { install?: string; run?: string; preview?: string; status?: string }
export interface DemoSpec { command: string; description: string }

export interface PreviewManifest {
  name: string;
  kind: 'module' | 'product-slice' | 'app';
  version: string;
  runCommands: RunCommands;
  demo?: DemoSpec;
  capabilities: DeclaredCapability[];
  /** artifact locators the build is expected to produce; if declared, they must be observed present */
  artifacts: string[];
}

// ── the generated report (honest current-vs-missing) ────────────────────────────────────────────────────────
export interface ReportArtifact { path: string; observed: boolean; bytes: number | null; sha256: string | null }

export interface StandardCompliance {
  compliant: boolean;
  /** specific, honest gaps — empty iff compliant */
  gaps: string[];
  checks: {
    requiredCommandsDeclared: boolean;
    capabilitiesDeclared: boolean;
    demoDeclared: boolean;
    buildSucceeded: boolean;
    declaredArtifactsPresent: boolean;
  };
}

export interface PreviewStatusReport {
  name: string;
  kind: PreviewManifest['kind'];
  version: string;
  /** strictly from the observation — never overstated */
  built: boolean;
  observationId: string;
  observedStatus: ObservationRecord['status'];
  exitCode: number | null;
  observedAtIso: string;
  runCommands: RunCommands;
  demo: DemoSpec | null;
  present: DeclaredCapability[];
  partial: DeclaredCapability[];
  missing: DeclaredCapability[];
  artifacts: ReportArtifact[];
  compliance: StandardCompliance;
  /** one honest human line (secret-scrubbed) */
  summary: string;
}

const IDENTITY_REDACTOR: TextRedactor = { redact: (s) => s };

/**
 * The general Preview/Status generator. Give it any manifest + the Observer's record for that build; it returns
 * a Preview/Status Report and a compliance verdict. It has exactly two methods — generate() and checkStandard()
 * — and holds no gate/approval/bridge reference. It cannot approve, mint, gate, act, or modify the build.
 */
export class LocalPreviewGenerator {
  private readonly redactor: TextRedactor;
  constructor(redactor: TextRedactor = IDENTITY_REDACTOR) {
    this.redactor = redactor;
  }

  /** Verify a build against the Local Preview Standard. Honest: build state comes only from the observation. */
  checkStandard(manifest: PreviewManifest, observation: ObservationRecord): StandardCompliance {
    const rc = manifest.runCommands ?? {};
    const requiredCommandsDeclared = !!(rc.run?.trim() && rc.preview?.trim() && rc.status?.trim());
    const capabilitiesDeclared = Array.isArray(manifest.capabilities) && manifest.capabilities.length > 0;
    const demoDeclared = !!manifest.demo?.command?.trim();
    const buildSucceeded = observation.status === 'success';
    const observedPaths = new Set(observation.artifacts.map((a) => a.path));
    const missingArtifacts = (manifest.artifacts ?? []).filter((p) => !observedPaths.has(p));
    const declaredArtifactsPresent = missingArtifacts.length === 0;

    const gaps: string[] = [];
    if (!requiredCommandsDeclared) {
      const missing = (['run', 'preview', 'status'] as const).filter((k) => !rc[k]?.trim());
      gaps.push(`missing required run command(s): ${missing.join(', ')}`);
    }
    if (!capabilitiesDeclared) gaps.push('no capabilities declared (current-vs-missing status is required)');
    if (!buildSucceeded) gaps.push(`build did not succeed (observed status: ${observation.status}, exit ${observation.exitCode ?? 'null'})`);
    if (!declaredArtifactsPresent) gaps.push(`declared artifact(s) not observed: ${missingArtifacts.join(', ')}`);

    return {
      compliant: gaps.length === 0,
      gaps,
      checks: { requiredCommandsDeclared, capabilitiesDeclared, demoDeclared, buildSucceeded, declaredArtifactsPresent },
    };
  }

  /** Produce the honest Preview/Status Report for a built thing from its manifest + observation. */
  generate(manifest: PreviewManifest, observation: ObservationRecord): PreviewStatusReport {
    const byState = (s: CapabilityState) => (manifest.capabilities ?? []).filter((c) => c.state === s);
    const observedByPath = new Map(observation.artifacts.map((a) => [a.path, a]));
    const artifacts: ReportArtifact[] = (manifest.artifacts ?? []).map((p) => {
      const a = observedByPath.get(p);
      return a ? { path: p, observed: true, bytes: a.bytes, sha256: a.sha256 } : { path: p, observed: false, bytes: null, sha256: null };
    });
    const compliance = this.checkStandard(manifest, observation);
    const built = observation.status === 'success';
    const missing = byState('absent');

    // HONEST one-liner — reflects the observation, never overstates.
    const missingNote = missing.length ? `, ${missing.length} capability(ies) still missing` : '';
    const complianceNote = compliance.compliant ? 'local-preview-compliant' : `NON-COMPLIANT (${compliance.gaps.length} gap(s))`;
    const summary = this.redactor.redact(
      built
        ? `${manifest.name} v${manifest.version} built OK${missingNote} — ${complianceNote}`
        : `${manifest.name} v${manifest.version} did NOT build (observed ${observation.status})${missingNote} — ${complianceNote}`,
    );

    return {
      name: manifest.name,
      kind: manifest.kind,
      version: manifest.version,
      built,
      observationId: observation.observationId,
      observedStatus: observation.status,
      exitCode: observation.exitCode,
      observedAtIso: observation.endedAtIso,
      runCommands: this.scrubCommands(manifest.runCommands ?? {}),
      demo: manifest.demo ? { command: this.redactor.redact(manifest.demo.command), description: manifest.demo.description } : null,
      present: byState('present'),
      partial: byState('partial'),
      missing,
      artifacts,
      compliance,
      summary,
    };
  }

  private scrubCommands(rc: RunCommands): RunCommands {
    const out: RunCommands = {};
    for (const k of ['install', 'run', 'preview', 'status'] as const) {
      if (rc[k] != null) out[k] = this.redactor.redact(rc[k] as string);
    }
    return out;
  }
}

// ── audit tie-in (reuse) — record the report the operator was shown, immutably ──────────────────────────────
/** Keys allowed onto the chain for a preview report (deny-by-default via the factory redactor). Safe metadata +
 *  the honest compliance verdict + artifact integrity — never raw secrets. */
export const PREVIEW_AUDIT_ALLOWLIST: readonly string[] = [
  'preview', 'name', 'kind', 'version', 'built', 'observation', 'observedStatus', 'exitCode', 'observedAtIso',
  'compliant', 'gaps', 'present', 'partial', 'missing', 'id', 'state', 'artifacts', 'path', 'observed', 'sha256',
  'bytes', 'summary', 'environment',
];

/**
 * Records a generated Preview/Status Report to the factory's append-only, hash-chained audit via the
 * audit-of-reads append path — the SAME store + pattern the Observer/Console audits use — so "what state the
 * operator was shown" is inspectable evidence. Holds ONLY `appendRead` + a redactor; it cannot approve/commit/act.
 */
export class PreviewAuditor {
  constructor(
    private readonly sink: Pick<AuditSink, 'appendRead'>,
    private readonly redactor: Pick<RedactionEngine, 'redactSummary'>,
    private readonly organizationId: string,
    private readonly actor: HumanActor,
    private readonly environment: Environment = 'local',
    private readonly session: SessionInfo = { session_id: 'local-preview' },
  ) {}

  async record(report: PreviewStatusReport): Promise<AppendResult> {
    const summary = this.redactor.redactSummary({
      preview: report.name,
      name: report.name,
      kind: report.kind,
      version: report.version,
      built: report.built,
      observation: report.observationId,
      observedStatus: report.observedStatus,
      exitCode: report.exitCode,
      observedAtIso: report.observedAtIso,
      compliant: report.compliance.compliant,
      gaps: report.compliance.gaps,
      present: report.present.map((c) => ({ id: c.id, state: c.state })),
      partial: report.partial.map((c) => ({ id: c.id, state: c.state })),
      missing: report.missing.map((c) => ({ id: c.id, state: c.state })),
      artifacts: report.artifacts.map((a) => ({ path: a.path, observed: a.observed, sha256: a.sha256 })),
      summary: report.summary,
      environment: this.environment,
    });
    return this.sink.appendRead({
      organization_id: this.organizationId,
      human_actor: this.actor,
      session: this.session,
      query_range: summary,
      rows_returned: report.artifacts.length,
    });
  }
}
