// Layer-4 BUILD PLANNER — SLICE 1. Turns an ALREADY-APPROVED harvest decision into an INERT BuildPlan, then
// feeds that plan to the gated Layer-5 filesystem dry-run adapter to obtain an inert PlannedFilesystemWrite.
//
// SEPARATION OF CONCERNS (the whole point of this file):
//   • Harvest decides WHAT to build (repo-scout → grade → decideSourcing). Layer 4 plans HOW.
//   • This planner CONSUMES a decision; it does NOT re-scout, re-grade, or re-decide. It reads the fields of
//     the REAL `SubDomainResult` (harvest-orchestrator.ts:118-124) exactly as given — no scoring logic here.
//
// SAFETY BY CONSTRUCTION (this file, specifically):
//   • NO node:fs import anywhere. No writeFile/mkdir/rm — the planner returns DATA (a BuildPlan) and DELEGATES
//     all scaffold planning to the filesystem adapter, which is itself incapable (no node:fs) and gated.
//   • It CANNOT self-approve. To even be called it must RECEIVE an `ApprovedBuildDecision`, whose `approval`
//     field is a REAL branded `ConsumedApproval` (../../layer-5-action/mcp-bridge/tool-classes.ts:100-104).
//     That token's mint `mintConsumedApproval` (tool-classes.ts:105) is MODULE-PRIVATE to the bridge and the
//     brand symbol (tool-classes.ts:99) is unexported — so NOTHING in Layer 4 can construct one. This planner
//     imports the CONTRACT's re-exported TYPE only (governed-adapter.ts:37); it mints nothing and calls no mint.
//   • The scaffold write is a SECOND, independent human gate: `planBuild` hands the derived scaffold intent to
//     the filesystem adapter's `planWrite`, which consumes its OWN real Approval Gate action (no approval ⇒
//     fail closed, no plan). The planner reaches no write itself.
//   • Sandbox only: the scaffold base path is a throwaway `/tmp/ece-dryrun-…` path — never a real product tree.

import {
  FilesystemAdapterDryRun,
  SANDBOX_PATH_PREFIX,
  type FilesystemScaffoldIntentDryRun,
  type ScaffoldEntrySpec,
  type PlannedFilesystemWrite,
} from '../../layer-5-action/filesystem-adapter-dryrun/filesystem-adapter-dryrun.js';
import type {
  ConsumedApproval,
  ScopedCredentialRef,
  GovernedWriteContext,
  GovernedWriteResult,
} from '../../layer-5-action/governed-adapter/governed-adapter.js';
import type { SubDomainResult, SourcingDecision, GradedCandidate } from '../../layer-3-harvest/harvest-orchestrator/harvest-orchestrator.js';

// ── The APPROVED-DECISION SEAM ──────────────────────────────────────────────────────────────────────────
// A small typed adapter between harvest and Layer 4. Harvest emits a `SubDomainResult` inside a `HarvestReport`
// whose terminal status is 'STOP-AWAITING-HUMAN-APPROVAL' (harvest-orchestrator.ts:146) — a PROPOSAL, never an
// approved artifact. There is no harvest type that says "a human approved THIS fork." This seam is that type.
//
// Its `approval` is a REAL `ConsumedApproval`. Because that token can only be minted by the module-private
// `mintConsumedApproval` (tool-classes.ts:105) after the real dispatcher consumes a still-held, human-APPROVED,
// per-action Approval Gate action, an `ApprovedBuildDecision` CANNOT be fabricated inside Layer 4. The planner
// can only RECEIVE one already assembled by the upstream command layer that ran the gate.
export interface ApprovedBuildDecision {
  /** The REAL harvest decision unit — consumed as given. Must be a FORK with a non-null spine. */
  readonly decision: SubDomainResult;
  /** UNFORGEABLE proof this decision was human-approved. Module-private mint — Layer 4 cannot construct it. */
  readonly approval: ConsumedApproval;
  /** The human the Approval Gate recorded as approver. Never "claude". */
  readonly approvedBy: string;
  /** Provenance of the harvest report this decision came from. */
  readonly sourceReport: { readonly domain: string; readonly generatedAtIso: string };
  /**
   * OPTIONAL, ADDITIVE (Phase: deciding→building seam). The human's MEASURED air-gap assessment that promoted
   * this spine EXTEND→FORK — the one sovereign dimension the harvest machine never measures. Populated by the
   * Layer-2 build-decision-seam; the planner does not read it (Layer 4 still consumes the decision verbatim).
   * `gateActionId` is the REAL approved Approval-Gate action id the promotion was consumed against — never a
   * placeholder. `value` is a measurement, so 'yes' | 'partial' | 'no' (never 'unknown').
   */
  readonly airGapAssessment?: {
    readonly value: 'yes' | 'partial' | 'no';
    readonly rationale: string;
    readonly measuredBy: string;
    readonly gateActionId: string;
  };
}

/** How faithful a section of the plan is: a real plan we can act on, or a placeholder for a later slice. */
export type PlanFidelity = 'real-plan' | 'placeholder';

/** A section of the BuildPlan, self-describing about whether it is a real plan or a placeholder. */
export interface PlanSection<T> {
  readonly fidelity: PlanFidelity;
  readonly note: string;
  readonly value: T;
}

/** One node of the product skeleton the plan describes. Path is RELATIVE to the sandbox base path. */
export interface ProductScaffoldNode {
  readonly path: string;
  readonly kind: 'dir' | 'file';
  readonly contents?: string;
}

/**
 * The inert BuildPlan: pure DATA describing the product that WOULD be built by forking the approved repo.
 * Deterministic for a given ApprovedBuildDecision. Nothing here is executed; it is a plan, not an action.
 */
export interface BuildPlan {
  readonly kind: 'build-plan';
  /** Echoed straight from the approved decision — NOT re-derived. */
  readonly forDecision: {
    readonly domain: string;
    readonly subDomainKey: string;
    readonly subDomainTitle: string;
    readonly sourcing: SourcingDecision;
    readonly approvedBy: string;
    readonly generatedAtIso: string;
  };
  /** Read off the approved spine (identity/record/score). The planner does not re-score or re-license. */
  readonly forkTarget: {
    readonly host: string;
    readonly owner: string;
    readonly name: string;
    readonly repoUrl: string;
    readonly license: { readonly detected: string; readonly decision: string; readonly oneLine: string };
    readonly score: { readonly total: number; readonly band: string };
  };
  /** Throwaway dry-run sandbox the scaffold WOULD land in (/tmp/ece-dryrun-…). Never a real product tree. */
  readonly sandbox: { readonly basePath: string };
  /** REAL PLAN — the directory/file skeleton; this is what drives the filesystem scaffold intent. */
  readonly productStructure: PlanSection<readonly ProductScaffoldNode[]>;
  /** REAL PLAN — notes on wrapping/forking the target repo (mechanics are a later slice). */
  readonly forkIntegration: PlanSection<readonly string[]>;
  /** REAL PLAN — the source-of-truth docs to generate (paths + purpose; bodies are a later slice). */
  readonly sourceOfTruthDocs: PlanSection<readonly { readonly path: string; readonly purpose: string }[]>;
  /** PLACEHOLDER — a feature-registry stub; real entries are a later slice. */
  readonly featureRegistryStub: PlanSection<{ readonly registry: string; readonly entries: readonly string[] }>;
  /** REAL PLAN (identity) — packaging manifest name/type/license, echoed from the decision. */
  readonly packagingManifest: PlanSection<{ readonly name: string; readonly type: string; readonly license: string; readonly forkOf: string }>;
  /** PLACEHOLDER — Arabic-first layer + ECE branding are noted as PLANNED STEPS, not executed here. */
  readonly hardening: PlanSection<{ readonly arabicFirstLayer: string; readonly eceBranding: string }>;
  /** Explicit self-description: what in this plan is real vs a placeholder for a later slice. */
  readonly honesty: { readonly realPlan: readonly string[]; readonly placeholder: readonly string[] };
}

/** The gate-backed context for the SCAFFOLD write, minus the intent (the planner derives the intent). */
export type ScaffoldGrant = Omit<GovernedWriteContext<FilesystemScaffoldIntentDryRun>, 'intent'>;

/** Everything the planner needs: the approved decision, the scaffold gate grant, and a sandbox credential ref. */
export interface BuildPlannerInput {
  readonly approved: ApprovedBuildDecision;
  readonly scaffoldGrant: ScaffoldGrant;
  readonly credential: ScopedCredentialRef;
}

export interface BuildPlannerResult {
  /** The inert BuildPlan — always emitted (pure, deterministic data). */
  readonly buildPlan: BuildPlan;
  /** The gated filesystem dry-run outcome. `ok:false` (planned:null) when the scaffold approval is absent. */
  readonly scaffold: GovernedWriteResult<PlannedFilesystemWrite>;
}

/** A spine that is present — narrowing helper for a FORK decision. */
function requireForkSpine(d: SubDomainResult): GradedCandidate {
  if (d.decision !== 'FORK') {
    throw new Error(`build-planner consumes FORK decisions only; got "${d.decision}" — Layer 4 does not re-decide`);
  }
  if (d.spine === null) {
    throw new Error('build-planner requires a non-null spine for a FORK decision');
  }
  return d.spine;
}

/** Deterministic throwaway sandbox base path for a fork target. No clock, no randomness — pure of the identity. */
export function sandboxBasePathFor(spine: GradedCandidate): string {
  const slug = `${spine.identity.owner}-${spine.identity.name}`.toLowerCase().replace(/[^a-z0-9-]+/g, '-');
  return `${SANDBOX_PATH_PREFIX}docassemble-${slug}`;
}

/**
 * PURE TRANSFORM: an approved decision → an inert BuildPlan. Reads the SubDomainResult fields as given; invents
 * no scoring/licensing/decision. Deterministic: the same ApprovedBuildDecision always yields the same BuildPlan.
 */
export function buildPlanFor(approved: ApprovedBuildDecision): BuildPlan {
  const d = approved.decision;
  const spine = requireForkSpine(d);
  const id = spine.identity;
  const rec = spine.record;
  const productName = `ece-${id.name.toLowerCase()}`;
  const basePath = sandboxBasePathFor(spine);
  const forkRef = `${id.host}/${id.owner}/${id.name}`;

  // REAL PLAN — the product skeleton. This tree is what the filesystem scaffold intent is derived from.
  const productStructure: readonly ProductScaffoldNode[] = [
    { path: 'README.md', kind: 'file', contents: `# ${productName}\n\nECE-wrapped product — FORK of ${forkRef} (${d.subDomain.title}).\n` },
    { path: 'ece.manifest.json', kind: 'file', contents: `{\n  "name": "${productName}",\n  "forkOf": "${forkRef}",\n  "license": "${rec.licenseDetected}"\n}\n` },
    { path: 'docs', kind: 'dir' },
    { path: 'docs/SOURCE_OF_TRUTH.md', kind: 'file', contents: `# Source of Truth — ${productName}\n\n(Planned: authored in a later slice.)\n` },
    { path: 'docs/FORK_INTEGRATION.md', kind: 'file', contents: `# Fork Integration — ${forkRef}\n\n(Planned: fork mechanics authored in a later slice.)\n` },
    { path: 'src', kind: 'dir' },
    { path: 'src/index.ts', kind: 'file', contents: `// ${productName} entrypoint — planned scaffold, inert.\nexport const PRODUCT = ${JSON.stringify(productName)};\n` },
    { path: 'src/fork', kind: 'dir' },
    { path: 'src/fork/README.md', kind: 'file', contents: `# Fork wrapper seam for ${forkRef}\n\n(Planned: the fork is wrapped here — no repo fork performed in this slice.)\n` },
    { path: 'src/i18n', kind: 'dir' },
    { path: 'src/i18n/ar.placeholder.json', kind: 'file', contents: `{ "_placeholder": "Arabic-first layer is a PLANNED step, not generated here." }\n` },
    { path: 'branding', kind: 'dir' },
    { path: 'branding/PLACEHOLDER.md', kind: 'file', contents: `# ECE branding\n\nPLACEHOLDER — branding assets are a PLANNED step, not generated in this slice.\n` },
    { path: 'feature-registry.stub.json', kind: 'file', contents: `{ "registry": "${productName}", "entries": [], "_stub": true }\n` },
  ];

  return {
    kind: 'build-plan',
    forDecision: {
      domain: approved.sourceReport.domain,
      subDomainKey: d.subDomain.key,
      subDomainTitle: d.subDomain.title,
      sourcing: d.decision,
      approvedBy: approved.approvedBy,
      generatedAtIso: approved.sourceReport.generatedAtIso,
    },
    forkTarget: {
      host: id.host,
      owner: id.owner,
      name: id.name,
      repoUrl: spine.repoUrl,
      license: { detected: rec.licenseDetected, decision: String(rec.licenseDecision), oneLine: spine.licenseOneLine },
      score: { total: spine.score.total, band: spine.score.band },
    },
    sandbox: { basePath },
    productStructure: {
      fidelity: 'real-plan',
      note: 'The product directory/file skeleton — drives the filesystem scaffold intent.',
      value: productStructure,
    },
    forkIntegration: {
      fidelity: 'real-plan',
      note: 'Notes on wrapping the fork; the actual fork mechanics are a later slice (no repo fork here).',
      value: [
        `FORK ${forkRef} (score ${spine.score.total}/100, band "${spine.score.band}"), license ${rec.licenseDetected} (${String(rec.licenseDecision)}).`,
        `Wrap upstream under src/fork/ and expose the ECE product surface from src/index.ts.`,
        `Air-gap suitability recorded as "${rec.airGapSuitability}", white-label fit "${rec.whiteLabelFit}" — carried from the decision, not re-assessed.`,
      ],
    },
    sourceOfTruthDocs: {
      fidelity: 'real-plan',
      note: 'The docs to generate — paths and purpose are planned; bodies are authored in a later slice.',
      value: [
        { path: 'docs/SOURCE_OF_TRUTH.md', purpose: 'The single source of truth for the product build.' },
        { path: 'docs/FORK_INTEGRATION.md', purpose: 'How the upstream fork is integrated and kept in sync.' },
      ],
    },
    featureRegistryStub: {
      fidelity: 'placeholder',
      note: 'Stub only — real feature-registry entries are populated in a later slice.',
      value: { registry: productName, entries: [] },
    },
    packagingManifest: {
      fidelity: 'real-plan',
      note: 'Manifest identity (name/type/license/forkOf) echoed from the decision; full packaging is a later slice.',
      value: { name: productName, type: 'ece-forked-product', license: rec.licenseDetected, forkOf: forkRef },
    },
    hardening: {
      fidelity: 'placeholder',
      note: 'Arabic-first layer and ECE branding are noted as PLANNED steps — not executed in this slice.',
      value: {
        arabicFirstLayer: 'PLANNED: add an Arabic-first i18n layer (src/i18n) — not generated here.',
        eceBranding: 'PLANNED: apply ECE branding (branding/) — not generated here.',
      },
    },
    honesty: {
      realPlan: [
        'product structure / scaffold skeleton',
        'fork-integration notes',
        'source-of-truth doc list (paths + purpose)',
        'packaging manifest identity (name/type/license/forkOf)',
      ],
      placeholder: [
        'feature-registry entries (stub only)',
        'Arabic-first i18n layer (planned step, not generated)',
        'ECE branding assets (planned step, not generated)',
        'fork mechanics (notes only — no repo fork performed)',
        'source-of-truth doc bodies (paths listed; content not authored)',
      ],
    },
  };
}

/** Map the BuildPlan's product skeleton into the filesystem adapter's scaffold intent (sandbox path only). */
export function toScaffoldIntent(plan: BuildPlan, approvedDecisionRef: string): FilesystemScaffoldIntentDryRun {
  const entries: readonly ScaffoldEntrySpec[] = plan.productStructure.value.map((n): ScaffoldEntrySpec =>
    n.kind === 'file' ? { path: n.path, kind: 'file', contents: n.contents ?? '' } : { path: n.path, kind: 'dir' },
  );
  return {
    kind: 'filesystem-scaffold',
    approvedDecision: approvedDecisionRef,
    basePath: plan.sandbox.basePath,
    entries,
  };
}

/**
 * The planner entrypoint. CONSUMES an ApprovedBuildDecision (unforgeable — see the seam above), emits the inert
 * BuildPlan, derives the sandbox scaffold intent, and DELEGATES to the gated filesystem dry-run adapter. It
 * reaches NO write itself; the adapter consumes its own real Approval Gate action (fail-closed without one).
 */
export async function planBuild(input: BuildPlannerInput): Promise<BuildPlannerResult> {
  const { approved, scaffoldGrant, credential } = input;
  const buildPlan = buildPlanFor(approved);
  const approvedDecisionRef = `${approved.sourceReport.domain}/${approved.decision.subDomain.key}`;
  const intent = toScaffoldIntent(buildPlan, approvedDecisionRef);

  // DELEGATE to the gated Layer-5 adapter. The planner does not (and cannot) mint an approval; the adapter
  // consumes the human-approved scaffold gate carried on `scaffoldGrant`. No approval ⇒ fail closed, no plan.
  const adapter = new FilesystemAdapterDryRun(credential);
  const scaffold = await adapter.planWrite({ ...scaffoldGrant, intent });

  return { buildPlan, scaffold };
}
