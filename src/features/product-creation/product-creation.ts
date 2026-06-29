// Product Creation Engine (Module 6) — the Wave-4 capstone ORCHESTRATOR.
//
// WHAT IT DOES: given a domain + harvest result + project gate state (and the Wave 1–4 engine outputs),
// it COMPOSES a single governed product-creation plan that ties together:
//   • the domain reference          (Domain Registry — must be registered)
//   • the sourcing verdict          (Harvest Engine — FORK / EXTEND / BUILD)
//   • the repo build plan           (Repo Builder — plans only, never executes)
//   • the required-docs compliance  (Doc Engine)
//   • the feature-set compliance    (Feature Registry)
//   • the registered risks          (Risk Register — blocking ones surfaced, never buried)
//
// CORE GUARANTEE — IT PLANS / COMPOSES, IT NEVER EXECUTES OR APPROVES. The outcome status is the single
// literal 'PLAN-AWAITING-APPROVAL' (or 'REFUSED'). There is NO 'CREATED'/'EXECUTED'/'APPROVED'/'PROCEED'
// variant in the type — a human authorizes the plan downstream through a gated action layer.
//
// INHERITED GATES (composed, never re-implemented or weakened — ALL must hold simultaneously):
//   • never-self-executes   — no executed/created outcome exists (type-level).
//   • never-self-approves   — produces a recommendation; a human authorizes. No approved/proceed state.
//   • harvest-before-build  — gate not cleared (clearedToBuild !== true) OR harvest not approved ⇒ REFUSED.
//   • deny-by-default       — any unverifiable/missing composition input ⇒ REFUSED, never "probably fine".
//   • blocking-risks-surfaced — an unmitigated high/critical OPEN risk is surfaced as blocking in the plan.
//
// STANDALONE-PACKAGEABLE: every cross-engine reference is `import type` (zero runtime coupling); the only
// engine the orchestrator *invokes* (Repo Builder) and the risk surfacer are injected as ports.

import type { GateView } from '../project-registry/project-registry.js';
import type { DomainStatus } from '../domain-registry/domain-registry.js';
import type { Verdict } from '../scoring-engine/scoring-engine.js';
import type { BuildPlan, ForkedRepo, RepoBuildOutcome } from '../repo-builder/repo-builder.js';
import type { DocVerdict } from '../doc-engine/doc-engine.js';
import type { FeatureVerdict } from '../feature-registry/feature-registry.js';
import type { RiskRecord } from '../risk-register/risk-register.js';

/** A registered-domain reference (a minimal projection of a Domain Registry record). */
export interface DomainReference {
  name: string;
  status: DomainStatus;
}

/**
 * The harvest verdict for this product. Mirrors the Harvest Engine: it is ALWAYS awaiting human approval
 * (the harvest engine never self-approves). `approved` reflects the human's downstream decision and is the
 * authority for harvest-before-build — it is NOT something this engine grants.
 */
export interface HarvestVerdictView {
  verdict: Verdict; // FORK | EXTEND | BUILD
  status: 'STOP-AWAITING-HUMAN-APPROVAL';
  approved: boolean;
}

/** Ports — the engines this orchestrator invokes, injected so the engine stays standalone. */
export interface RepoBuilderPort {
  plan(req: { project: string; repo: string; gate: GateView; features?: string[]; forkedRepos?: ForkedRepo[] }): RepoBuildOutcome;
}
/** Structurally identical to Risk Register's `surfaceBlockingRisks` — the real function can be injected as-is. */
export type RiskSurfacerPort = (risks: RiskRecord[]) => RiskRecord[];

export interface ProductCreationPorts {
  repoBuilder: RepoBuilderPort;
  surfaceBlockingRisks: RiskSurfacerPort;
}

/** Everything the orchestrator composes into the plan (the gathered Wave 1–4 outputs for this product). */
export interface ProductCreationRequest {
  product: string;
  repo: string;
  domain: DomainReference | null;
  harvest: HarvestVerdictView | null;
  gate: GateView | null;
  docCompliance: DocVerdict | null;
  featureCompliance: FeatureVerdict | null;
  risks: RiskRecord[] | null;
  features?: string[];
  forkedRepos?: ForkedRepo[];
}

export interface ProductCreationPlan {
  product: string;
  domain: string;
  sourcingVerdict: Verdict;
  harvestStatus: 'STOP-AWAITING-HUMAN-APPROVAL';
  repoBuildPlan: BuildPlan;
  docCompliance: DocVerdict;
  featureCompliance: FeatureVerdict;
  blockingRisks: RiskRecord[];
  hasBlockingRisks: boolean;
  /** Human-readable summary of everything that must be resolved/seen before a human approves. Never buried. */
  blockingItems: string[];
  /** A recommendation for a human — never an approval/authorization. */
  recommendation: string;
  notes: string[];
}

/**
 * Outcome — a plan awaiting human approval, or a refusal. There is intentionally NO 'CREATED'/'EXECUTED'/
 * 'APPROVED'/'PROCEED' member: the engine cannot represent having created or approved a product.
 */
export type ProductCreationOutcome =
  | { status: 'PLAN-AWAITING-APPROVAL'; plan: ProductCreationPlan }
  | { status: 'REFUSED'; reason: string };

/** A domain is "registered" once it has moved past the bare 'idea' stage. */
const REGISTERED_DOMAIN_STATUSES: readonly DomainStatus[] = ['registered', 'harvesting', 'in-build', 'productized', 'live'];

export class ProductCreationEngine {
  constructor(private readonly ports: ProductCreationPorts) {}

  /** Compose the governed product-creation PLAN. Plans/recommends only — never creates, never approves. */
  compose(req: ProductCreationRequest): ProductCreationOutcome {
    // ── deny-by-default: required composition inputs must be present and verifiable ──────────────────
    if (!req?.product?.trim() || !req?.repo?.trim()) {
      return refuse('unverifiable input — product and repo are required (deny-by-default)');
    }
    if (!req.domain || !req.domain.name?.trim()) {
      return refuse('unregistered domain — no domain reference supplied (deny-by-default)');
    }
    if (!REGISTERED_DOMAIN_STATUSES.includes(req.domain.status)) {
      return refuse(`unregistered domain — "${req.domain.name}" is at status "${req.domain.status}", not registered (deny-by-default)`);
    }
    if (!req.harvest || typeof req.harvest.verdict !== 'string') {
      return refuse('missing harvest result — no sourcing verdict to compose (deny-by-default)');
    }
    if (!req.gate || typeof req.gate.clearedToBuild !== 'boolean') {
      return refuse('unverifiable gate state — clearedToBuild unknown (deny-by-default)');
    }
    if (req.docCompliance == null || req.featureCompliance == null) {
      return refuse('missing composition input — doc/feature compliance not provided (deny-by-default)');
    }
    if (req.risks == null) {
      return refuse('missing composition input — risk register snapshot not provided (deny-by-default)');
    }

    // ── harvest-before-build (inherited): no plan unless the gate is cleared AND the harvest is approved ─
    if (req.harvest.approved !== true) {
      return refuse('harvest not approved — no product is planned without an approved harvest (harvest-before-build)');
    }
    if (req.gate.clearedToBuild !== true) {
      return refuse(`not cleared to build — ${req.gate.reason} (harvest-before-build; no product is planned)`);
    }

    // ── compose the repo build plan (inherits Repo Builder's own gate; its refusal propagates) ─────────
    const repoOutcome = this.ports.repoBuilder.plan({
      project: req.product,
      repo: req.repo,
      gate: req.gate,
      features: req.features,
      forkedRepos: req.forkedRepos,
    });
    if (repoOutcome.status !== 'PLAN-AWAITING-APPROVAL') {
      return refuse(`repo build plan refused — ${repoOutcome.reason} (inherited gate)`);
    }

    // ── surface blocking risks (the Risk Register surfacer, injected) — surfaced, never buried ──────────
    const blockingRisks = this.ports.surfaceBlockingRisks(req.risks) ?? [];

    const blockingItems: string[] = [];
    for (const r of blockingRisks) {
      blockingItems.push(`BLOCKING RISK [${r.severity}/${r.type}] ${r.key}: ${r.title ?? '(no title)'} — status ${r.status}, unmitigated`);
    }
    if (req.docCompliance === 'Fail') blockingItems.push('doc compliance: Fail — required source-of-truth docs are not compliant');
    if (req.featureCompliance === 'Fail') blockingItems.push('feature compliance: Fail — the feature registry is not compliant');

    const recommendation = blockingItems.length === 0
      ? `Product plan for "${req.product}" composed (${req.harvest.verdict}); ready for human review/authorization.`
      : `Product plan for "${req.product}" composed (${req.harvest.verdict}) but has ${blockingItems.length} BLOCKING item(s) a human must resolve before authorizing.`;

    const plan: ProductCreationPlan = {
      product: req.product,
      domain: req.domain.name,
      sourcingVerdict: req.harvest.verdict,
      harvestStatus: 'STOP-AWAITING-HUMAN-APPROVAL',
      repoBuildPlan: repoOutcome.plan,
      docCompliance: req.docCompliance,
      featureCompliance: req.featureCompliance,
      blockingRisks,
      hasBlockingRisks: blockingRisks.length > 0,
      blockingItems,
      recommendation,
      notes: [
        'Composed by the Product Creation Engine (Module 6) — plans/recommends only; it does not create or approve.',
        'Authorization is a human action through a gated action layer; this plan is awaiting that approval.',
      ],
    };
    return { status: 'PLAN-AWAITING-APPROVAL', plan };
  }
}

function refuse(reason: string): ProductCreationOutcome {
  return { status: 'REFUSED', reason };
}
