// App Packaging Flow (Factory capability #4) — the GOVERNED packaging flow: version → checksum → SBOM → record,
// GATED ON #3 COMPLIANCE. Implements §2 of REQUIREMENT_PRODUCT_DELIVERY_AND_LOCAL_RUNNABLE.md ("at completion,
// packaged as a downloadable app"), enforcing the completion gate: *you cannot package what isn't seen + run-
// compliant.* It takes a build's PreviewStatusReport + StandardCompliance (capability #3) and the Observer's
// ObservationRecord (capability #2) and REFUSES to package unless the build was observed to succeed, is standard-
// compliant, and its declared artifacts are present. The refusal is the heart of this capability.
//
// GENERATE-ONLY (safety, same discipline as #2/#3):
//   • Holds NO gate / approval / mint / bridge reference and exposes NO method to approve, mint, or initiate a
//     consequential action, or to modify the source build. Its only capability is package() → a local artifact +
//     a recorded manifest. A source-scan test asserts it imports nothing from the gate/gauntlet/bridge/external
//     modules, and it has NO publish/release/upload method.
//   • Producing a LOCAL package is NOT a gated action. EXTERNAL publish/release (uploading the artifact to a
//     registry / GitHub release / notarization service) is OUT OF SCOPE here and is a FUTURE GATED action — it is
//     deliberately absent from this flow.
//   • Mac bundling is a PLUGGABLE adapter (MacBundler) — the flow core is bundler-agnostic; a real electron/tauri/
//     pkgbuild adapter drops in later without changing the flow.
//   • Redaction applies: free text (install instructions / names) is scrubbed before it lands in a manifest, and
//     the audited summary passes the factory's allowlist redactor — no secret in a manifest or on the chain.
//
// STANDALONE-PACKAGEABLE: every cross-engine reference is `import type` (zero runtime coupling); the bundler, the
// dependency resolver, the fs ports, the redactor and the audit sink are injected.

import type { ObservationRecord } from '../build-observer/build-observer.js';
import type { ArtifactProbe, TextRedactor } from '../build-observer/build-observer.js';
import type { PreviewStatusReport, StandardCompliance } from '../local-preview/local-preview.js';
import type { LicenseInput, ComplianceResult } from '../../layer-3-harvest/license-compliance/license-compliance.js';
import type { AuditSink, AppendResult } from '../../factory-shared/audit-engine/sink.js';
import type { HumanActor, SessionInfo, Environment } from '../../factory-shared/audit-engine/schema.js';
import type { RedactionEngine } from '../../factory-shared/redaction-engine/redaction-engine.js';

// ── SBOM + checksum + manifest shapes ───────────────────────────────────────────────────────────────────────
export interface SbomComponent { name: string; version: string; license: string; decision: ComplianceResult['decision'] }
export interface Sbom {
  format: 'ece-sbom/1';
  subject: string;
  version: string;
  generatedFromObservation: string;
  components: SbomComponent[];
}
export interface PackageChecksum { path: string; sha256: string; bytes: number }
export interface PackageManifest {
  name: string;
  version: string;
  kind: string;
  bundler: string;
  format: string;
  createdAtIso: string;
  /** ref back to the #2 observation this package was built from */
  sourceObservationId: string;
  /** the #3 verdict AT PACKAGE TIME — honest evidence of why packaging was allowed */
  complianceAtPackage: { compliant: boolean; gaps: string[] };
  /** SHA-256 over each produced package artifact */
  artifacts: PackageChecksum[];
  sbom: Sbom;
  /** installable/runnable WITHOUT opening the source repo (the package is the release artifact) */
  install: { instructions: string; runsWithoutRepo: boolean };
  serious: boolean;
}
export type PackageOutcome =
  | { status: 'refused'; reason: string; gaps: string[] }
  | { status: 'packaged'; manifest: PackageManifest };

// ── the pluggable Mac bundler (adapter interface) ───────────────────────────────────────────────────────────
export interface BundleRequest {
  name: string;
  version: string;
  kind: string;
  outDir: string;
  /** the source build's artifacts (from the observation) to bundle */
  sourceArtifacts: PackageChecksum[];
}
export interface BundleResult {
  bundler: string;
  format: string;          // e.g. 'macapp-dir', 'dmg', 'pkg'
  artifactPaths: string[]; // the produced package artifact(s) on local disk
  installInstructions: string;
}
/** Swappable Mac bundler. The default writes a structured .app directory a real .dmg step consumes; a real
 *  electron/tauri/pkgbuild bundler implements the SAME interface and drops in without touching the flow. */
export interface MacBundler { bundle(req: BundleRequest): Promise<BundleResult> }

// ── dependency knowledge for the SBOM (reuses the factory's license classifier) ─────────────────────────────
export interface RawDependency { name: string; version: string; licenseText?: string; declaredSpdx?: string }
export type DependencyResolver = () => RawDependency[] | Promise<RawDependency[]>;
/** The factory's existing license classifier, injected as a port (Module 10). */
export type LicenseClassifier = (input: LicenseInput) => ComplianceResult;

// ── fs ports (injected; the Node adapter supplies real fs+crypto — the core stays pure/testable) ────────────
export type PackageWriter = (manifest: PackageManifest, outDir: string) => Promise<{ manifestPath: string }>;
/** Returns the set of already-packaged versions for a name (for no-silent-clobber). */
export type ExistingVersions = (name: string, outDir: string) => Promise<Set<string>> | Set<string>;

const IDENTITY_REDACTOR: TextRedactor = { redact: (s) => s };

export interface PackagingConfig {
  redactor?: TextRedactor;
  now?: () => number;
  existingVersions?: ExistingVersions;
}

export interface PackageInput {
  report: PreviewStatusReport;
  compliance: StandardCompliance;
  observation: ObservationRecord;
  outDir: string;
  /** serious/client release ⇒ checksums+SBOM mandatory (this flow always produces them). */
  serious?: boolean;
}

/**
 * The governed packaging flow core. It is bundler-agnostic (the MacBundler is injected) and GENERATE-ONLY: its
 * one method, package(), gates on #3 compliance, then versions → bundles → checksums → SBOM → records. It cannot
 * approve/mint/act, modify the source build, or publish externally.
 */
export class AppPackagingFlow {
  private readonly redactor: TextRedactor;
  private readonly now: () => number;
  private readonly existingVersions: ExistingVersions;

  constructor(
    private readonly bundler: MacBundler,
    private readonly deps: DependencyResolver,
    private readonly classifyLicense: LicenseClassifier,
    private readonly hashArtifact: ArtifactProbe,
    private readonly writeManifest: PackageWriter,
    cfg: PackagingConfig = {},
  ) {
    this.redactor = cfg.redactor ?? IDENTITY_REDACTOR;
    this.now = cfg.now ?? (() => Date.now());
    this.existingVersions = cfg.existingVersions ?? (() => new Set<string>());
  }

  /** The completion-gate check: package ONLY a build that was seen + run-compliant. Returns the refusal reason
   *  and the specific compliance gaps if it may not be packaged. Pure — no side effects. */
  private gateOnCompliance(input: PackageInput): { ok: true } | { ok: false; reason: string; gaps: string[] } {
    const { report, compliance, observation } = input;
    const gaps = [...compliance.gaps];
    if (observation.observationId !== report.observationId) {
      return { ok: false, reason: 'observation does not match the preview report (mismatched build); refusing to package', gaps };
    }
    if (observation.status !== 'success' || !report.built) {
      return { ok: false, reason: `refusing to package: the source build did not succeed (observed ${observation.status})`, gaps };
    }
    if (!compliance.compliant) {
      return { ok: false, reason: 'refusing to package: the build is NOT Local-Preview-compliant (not seen+run-compliant)', gaps };
    }
    if (!compliance.checks.declaredArtifactsPresent) {
      return { ok: false, reason: 'refusing to package: declared artifacts are not present in the observed build', gaps };
    }
    return { ok: true };
  }

  async package(input: PackageInput): Promise<PackageOutcome> {
    // 1. GATE ON #3 COMPLIANCE — the heart of this capability. Refuse anything not seen+run-compliant.
    const gate = this.gateOnCompliance(input);
    if (!gate.ok) return { status: 'refused', reason: gate.reason, gaps: gate.gaps };

    const { report, observation, outDir } = input;
    const name = report.name;
    const version = report.version;

    // 2. VERSIONED — never silently clobber an existing versioned artifact.
    const existing = await this.existingVersions(name, outDir);
    if (existing.has(version)) {
      return { status: 'refused', reason: `refusing to package: version ${version} of "${name}" is already packaged (no silent clobber — bump the version)`, gaps: [] };
    }

    // 3. BUNDLE (pluggable) — the source artifacts come from the tamper-evident observation.
    const sourceArtifacts: PackageChecksum[] = observation.artifacts.map((a) => ({ path: a.path, sha256: a.sha256, bytes: a.bytes }));
    const bundle = await this.bundler.bundle({ name, version, kind: report.kind, outDir, sourceArtifacts });

    // 4. CHECKSUMS — SHA-256 over each PRODUCED package artifact.
    const artifacts: PackageChecksum[] = [];
    for (const p of bundle.artifactPaths) {
      const h = this.hashArtifact(p);
      if (h) artifacts.push({ path: p, sha256: h.sha256, bytes: h.bytes });
    }

    // 5. SBOM — deps + versions + licenses (reusing the factory's license classifier).
    const raw = await this.deps();
    const components: SbomComponent[] = raw.map((d) => {
      const r = this.classifyLicense({ text: d.licenseText, declaredSpdx: d.declaredSpdx, source: d.name });
      return { name: d.name, version: d.version, license: r.detected !== 'unknown' ? r.detected : (d.declaredSpdx ?? 'unknown'), decision: r.decision };
    });
    const sbom: Sbom = { format: 'ece-sbom/1', subject: name, version, generatedFromObservation: observation.observationId, components };

    // 6. RECORD — write the package manifest alongside the artifact (audit tie-in is a separate injected auditor).
    const manifest: PackageManifest = {
      name,
      version,
      kind: report.kind,
      bundler: bundle.bundler,
      format: bundle.format,
      createdAtIso: new Date(this.now()).toISOString(),
      sourceObservationId: observation.observationId,
      complianceAtPackage: { compliant: input.compliance.compliant, gaps: input.compliance.gaps },
      artifacts,
      sbom,
      install: { instructions: this.redactor.redact(bundle.installInstructions), runsWithoutRepo: true },
      serious: input.serious ?? false,
    };
    await this.writeManifest(manifest, outDir);
    return { status: 'packaged', manifest };
  }
}

// ── audit tie-in (reuse) — record what was packaged, from which compliant build, immutably ──────────────────
export const PACKAGING_AUDIT_ALLOWLIST: readonly string[] = [
  'package', 'name', 'version', 'kind', 'bundler', 'format', 'createdAtIso', 'sourceObservation', 'compliant',
  'gaps', 'artifacts', 'path', 'sha256', 'bytes', 'sbom', 'components', 'license', 'decision', 'serious',
  'runsWithoutRepo', 'environment',
];

/**
 * Records a PackageManifest to the append-only, hash-chained audit via the audit-of-reads path — the SAME store +
 * pattern #2/#3 use — so "what was packaged, from which compliant build, with which integrity hashes" is
 * tamper-evident evidence. Holds ONLY `appendRead` + a redactor; it cannot approve/commit/act/publish.
 */
export class PackagingAuditor {
  constructor(
    private readonly sink: Pick<AuditSink, 'appendRead'>,
    private readonly redactor: Pick<RedactionEngine, 'redactSummary'>,
    private readonly organizationId: string,
    private readonly actor: HumanActor,
    private readonly environment: Environment = 'local',
    private readonly session: SessionInfo = { session_id: 'app-packaging' },
  ) {}

  async record(manifest: PackageManifest): Promise<AppendResult> {
    const summary = this.redactor.redactSummary({
      package: manifest.name,
      name: manifest.name,
      version: manifest.version,
      kind: manifest.kind,
      bundler: manifest.bundler,
      format: manifest.format,
      createdAtIso: manifest.createdAtIso,
      sourceObservation: manifest.sourceObservationId,
      compliant: manifest.complianceAtPackage.compliant,
      gaps: manifest.complianceAtPackage.gaps,
      artifacts: manifest.artifacts.map((a) => ({ path: a.path, sha256: a.sha256, bytes: a.bytes })),
      sbom: { components: manifest.sbom.components.map((c) => ({ name: c.name, version: c.version, license: c.license, decision: c.decision })) },
      serious: manifest.serious,
      runsWithoutRepo: manifest.install.runsWithoutRepo,
      environment: this.environment,
    });
    return this.sink.appendRead({
      organization_id: this.organizationId,
      human_actor: this.actor,
      session: this.session,
      query_range: summary,
      rows_returned: manifest.artifacts.length,
    });
  }
}
