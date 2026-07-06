// Super-App Blueprint Engine (Venture Intelligence Wave — JUDGMENT engine 7; follows the Engines 1–6 template).
//
// Given a venture concept + the structural backbone's facts, it produces an ADVISORY super-app blueprint — an
// OPINION on how the venture could grow into a platform/ecosystem, across the requirement's module/surface set
// (core / enterprise / admin modules, client & partner portals, marketplace, analytics, automation, compliance,
// billing, API ecosystem, surfaces, ops center; §3b of REQUIREMENT_VENTURE_INTELLIGENCE_LAYER.md): the module set,
// how they compose, WHICH of ECE's real capabilities (cited from the backbone) ANCHOR each module, and the network/
// platform thesis. A module can ONLY be anchored by a capability ECE genuinely has (cited); a module with no real
// anchor is honestly flagged as an UNANCHORED gap (would need building, through the gated path) — never fabricated.
// It is a strategic opinion to inform a human, NOT a decision.
//
// TWO HONESTY BOUNDARIES:
//   • RECOMMENDS, NEVER BUILDS (this engine's specific one): it RECOMMENDS a blueprint — it has NO build-the-app /
//     execute / deploy path. An actual build routes through the factory's NORMAL gated build path, never here.
//   • NETWORK-EFFECT / MARKET claims are EXTERNAL: platform network effects / market adoption need external data the
//     backbone does NOT hold — FLAGGED (`externalDataNeeded`), never fabricated. Only module ANCHORING is grounded.
//
// Governed by blueprint/REQUIREMENT_JUDGMENT_ENGINE_DISCIPLINE.md — every clause enforced, identical to Engines 1–6:
//   §1 ADVISORY, NEVER PROOF — `advisory: true` (literal); OPINION distinct from CITED FACTS.
//   §2 GROUNDED — module anchoring read from the Reuse Graph; every capability claim cited by node id.
//   §3 PLAN-ONLY / NO-SELF-EXECUTE (type-level) — no execute/create/approve/mint/mutate/deploy AND NO build-the-app
//      / launch / ship path; single plan-only status.
//   §4 INSTRUCTION-BOUNDARY — the concept text is inert DATA (secret-scrubbed, echoed).
//   §5 HONEST UNCERTAINTY — confidence signal; thin ⇒ `insufficient-basis`; network/market claims flagged, not faked.
//   §6 AUDITED + REDACTED — records concept + opinion + CITED facts to the hash-chain.
//   §8 NEVER DRIVES A CONSEQUENTIAL ACTION — a blueprint RECOMMENDATION must NEVER trigger an actual build.
//
// STANDALONE-PACKAGEABLE (§7): every cross-engine reference is `import type` / injected. Self-contained — no
// cross-judgment-engine dependency; the judgment-tier shapes mirror the template by CONVENTION.

import type { CapabilityNode, CapabilityQuery } from '../capability-reuse-graph/capability-reuse-graph.js';
import type { TextRedactor } from '../build-observer/build-observer.js';
import type { AuditSink, AppendResult } from '../audit-engine/sink.js';
import type { HumanActor, SessionInfo, Environment } from '../audit-engine/schema.js';
import type { RedactionEngine } from '../redaction-engine/redaction-engine.js';

/** The read-only slice of the Phase-1 graph this engine grounds on (it never mutates it). */
export interface GraphReader { search(q?: CapabilityQuery): CapabilityNode[] }

/** The single plan-only status literal (§3). Forbidden statuses are not part of the type. */
export type PlanOnlyStatus = 'VENTURE-BLUEPRINT-AWAITING-HUMAN-APPROVAL';

/** One CITED fact — traces to a real structural-backbone node (or a Phase-4 verdict). NOT an opinion. */
export interface CitedFact {
  kind: 'capability' | 'sourcing-verdict';
  ref: string;
  name: string;
  note: string;
}

export type Confidence = 'insufficient-basis' | 'low' | 'moderate' | 'speculative-high';

/** The requirement's super-app module/surface set (§3b). */
export const SUPERAPP_MODULES = [
  'core-module', 'enterprise-module', 'admin-module', 'client-portal', 'partner-portal', 'marketplace',
  'analytics', 'automation', 'compliance', 'billing', 'api-ecosystem', 'surfaces', 'ops-center',
] as const;
export type SuperAppModule = (typeof SUPERAPP_MODULES)[number];

/** Deterministic keyword map — which structural capabilities ANCHOR each module (re-derivable). */
const MODULE_KEYWORDS: Record<SuperAppModule, readonly string[]> = {
  'core-module': ['engine', 'audit', 'sovereign'],
  'enterprise-module': ['audit', 'permission', 'policy', 'compliance'],
  'admin-module': ['registry', 'settings', 'permission', 'kill'],
  'client-portal': ['preview', 'package', 'observer'],
  'partner-portal': ['harvest', 'partner', 'registry', 'sourcing'],
  marketplace: ['registry', 'domain', 'harvest', 'package'],
  analytics: ['audit', 'observer', 'evidence', 'ledger'],
  automation: ['autopilot', 'engine', 'pipeline', 'workflow', 'scheduler'],
  compliance: ['compliance', 'license', 'redaction', 'audit', 'sovereign'],
  billing: ['billing', 'subscription', 'usage', 'invoice'],
  'api-ecosystem': ['bridge', 'mcp', 'api', 'gateway', 'tool-registry'],
  surfaces: ['preview', 'package', 'observer', 'ui'],
  'ops-center': ['audit', 'kill', 'observer', 'sovereign'],
};

/** One blueprint module — anchored by cited capabilities (fact) or an honest UNANCHORED gap (opinion, never faked). */
export interface BlueprintModule {
  module: SuperAppModule;
  /** true iff a real ECE capability anchors this module. */
  anchored: boolean;
  /** cited ECE capabilities that anchor this module (empty if unanchored). */
  anchoredBy: CitedFact[];
  /** OPINION (advisory) on the module's role/composition. */
  opinion: string;
  /** present iff unanchored — an honest gap: ECE has no cited capability for it; it would need building (gated path). */
  gapNote?: string;
}

/** THE ASSESSMENT — module anchoring grounded in cited facts; network/market flagged; RECOMMENDS, never builds. */
export interface SuperAppBlueprintAssessment {
  /** echoed inert concept text (secret-scrubbed) */
  concept: string;
  /** LITERAL true — JUDGMENT, never re-derivable proof (§1). */
  advisory: true;
  /** the plan-only status (§3). */
  status: PlanOnlyStatus;
  /** OPINION: the network/platform thesis (with the external caveat on network effects). */
  platformThesis: string;
  /** per-module blueprint (each anchored by cited capabilities, or an honest gap). */
  modules: BlueprintModule[];
  /** the modules ECE capabilities genuinely anchor (grounded) vs the unanchored gaps. */
  anchoredModules: SuperAppModule[];
  unanchoredModules: SuperAppModule[];
  /** LITERAL true — this engine RECOMMENDS a blueprint; it does NOT build the app (a build routes through the gate). */
  recommendsOnly: true;
  /** the UNION of all cited backbone facts (§2). */
  groundedOn: CitedFact[];
  /** honest confidence signal (§5). */
  confidence: Confidence;
  /** honest external-data boundary (§5) — network effects / market adoption need external data, never fabricated. */
  externalDataNeeded: string;
  /** an explicit statement of the basis / its insufficiency (§5). */
  basis: string;
}

export interface VentureConcept {
  /** inert DATA — never instruction */
  description: string;
  terms: string[];
  sourcingVerdicts?: Array<{ capability: string; verdict: string }>;
}

const IDENTITY_REDACTOR: TextRedactor = { redact: (s) => s };
const PLAN_ONLY: PlanOnlyStatus = 'VENTURE-BLUEPRINT-AWAITING-HUMAN-APPROVAL';
const EXTERNAL_NETWORK_NOTE = 'Platform network effects / market adoption / ecosystem demand require EXTERNAL data (real market signal) the structural backbone does not hold — FLAGGED, never fabricated. Only module ANCHORING from cited ECE capabilities is grounded here.';

function norm(s: string): string { return String(s ?? '').toLowerCase(); }

/**
 * Produces an advisory super-app blueprint grounded in cited backbone facts. Its ONLY method is assess() → data. It
 * holds no gate/approval/bridge reference and — critically — NO build-the-app / launch / ship path: it RECOMMENDS a
 * blueprint, it never builds one. The anchoring facts come from the graph; the module roles / platform thesis are an
 * opinion composed over those cited facts; network/market claims are FLAGGED external, never fabricated.
 */
export class SuperAppBlueprintEngine {
  constructor(private readonly graph: GraphReader, private readonly redactor: TextRedactor = IDENTITY_REDACTOR) {}

  assess(concept: VentureConcept): SuperAppBlueprintAssessment {
    const terms = (concept.terms ?? []).map(norm).filter((t) => t.length > 0);
    const conceptText = this.redactor.redact(String(concept.description ?? ''));

    // §5 CONCEPT GROUNDING GATE: a super-app anchored in ECE requires ECE capabilities relevant to the concept —
    // if none, there is no grounded blueprint (honest insufficient-basis), not a fabricated one.
    const conceptFacts = this.citeForTerms(terms);
    if (conceptFacts.length === 0) {
      const modules = SUPERAPP_MODULES.map((m): BlueprintModule => ({
        module: m, anchored: false, anchoredBy: [],
        opinion: `insufficient basis: no cited ECE capability anchors a ${m} for this concept (§5).`,
        gapNote: `no ECE capability relates to this concept — a ${m} would need building (through the gated path), not asserted here.`,
      }));
      return {
        concept: conceptText, advisory: true, status: PLAN_ONLY,
        platformThesis: 'OPINION: insufficient basis — the structural backbone cites no ECE capability for this concept, so no grounded super-app blueprint can be anchored.',
        modules, anchoredModules: [], unanchoredModules: [...SUPERAPP_MODULES], recommendsOnly: true,
        groundedOn: [], confidence: 'insufficient-basis', externalDataNeeded: EXTERNAL_NETWORK_NOTE,
        basis: this.redactor.redact('insufficient-basis: 0 backbone facts matched the concept terms — no confident super-app blueprint is recommended (§5).'),
      };
    }

    // §2 per-module ANCHORING: cite the real capabilities that anchor each module. No anchor ⇒ honest gap.
    const groundedAll: CitedFact[] = [];
    const seen = new Set<string>();
    const modules: BlueprintModule[] = SUPERAPP_MODULES.map((m) => {
      const anchoredBy = this.citeForTerms(MODULE_KEYWORDS[m]);
      for (const f of anchoredBy) if (!seen.has(f.ref)) { seen.add(f.ref); groundedAll.push(f); }
      if (anchoredBy.length === 0) {
        return {
          module: m, anchored: false, anchoredBy: [],
          opinion: `OPINION: no cited ECE capability anchors a ${m} yet.`,
          gapNote: `UNANCHORED gap: ECE has no cited capability for a ${m} — it would need building (through the factory's gated build path), never fabricated here.`,
        };
      }
      return {
        module: m, anchored: true, anchoredBy,
        opinion: `OPINION (advisory): the ${m} is anchored by ECE's cited capabilit${anchoredBy.length === 1 ? 'y' : 'ies'} ${anchoredBy.map((f) => f.name).join(', ')} [${anchoredBy.map((f) => f.ref).join(', ')}] — buildable because ECE genuinely has these.`,
      };
    });

    for (const v of concept.sourcingVerdicts ?? []) {
      const ref = `verdict:${norm(v.capability)}`;
      if (!seen.has(ref)) { seen.add(ref); groundedAll.push({ kind: 'sourcing-verdict', ref, name: v.capability, note: `sourcing verdict ${v.verdict}` }); }
    }
    groundedAll.sort((a, b) => (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0));

    const anchoredModules = modules.filter((m) => m.anchored).map((m) => m.module);
    const unanchoredModules = modules.filter((m) => !m.anchored).map((m) => m.module);
    const confidence = this.confidenceFor(groundedAll.length);

    return {
      concept: conceptText,
      advisory: true,
      status: PLAN_ONLY,
      platformThesis: `OPINION (${confidence}): a super-app composing ${anchoredModules.length} ECE-anchored module(s) [${anchoredModules.join(', ') || 'none'}] into a sovereign platform; ${unanchoredModules.length} module(s) [${unanchoredModules.join(', ') || 'none'}] are unanchored gaps to build. The platform/network thesis is an advisory read; network effects & market adoption need external data, not asserted here.`,
      modules,
      anchoredModules,
      unanchoredModules,
      recommendsOnly: true,
      groundedOn: groundedAll,
      confidence,
      externalDataNeeded: EXTERNAL_NETWORK_NOTE,
      basis: this.redactor.redact(`${confidence}: grounded on ${groundedAll.length} cited backbone anchoring fact(s). Module roles / platform thesis are OPINION on top; anchoring is the only fact, each cited; unanchored modules are honest gaps; network/market is EXTERNAL — flagged, not fabricated. RECOMMENDS a blueprint; does not build the app.`),
    };
  }

  private citeForTerms(terms: readonly string[]): CitedFact[] {
    const seen = new Set<string>();
    const out: CitedFact[] = [];
    for (const t of terms) {
      for (const n of this.graph.search({ text: t })) {
        if (seen.has(n.id)) continue;
        seen.add(n.id);
        out.push({ kind: 'capability', ref: n.id, name: n.name, note: `${n.kind} at ${n.source}${n.posture.hasTests ? ' (tested)' : ''}` });
      }
    }
    return out.sort((a, b) => (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0));
  }

  private confidenceFor(n: number): Confidence {
    if (n === 0) return 'insufficient-basis';
    if (n <= 2) return 'low';
    if (n <= 5) return 'moderate';
    return 'speculative-high';
  }
}

// ── audit tie-in (§6) — record concept, the assessment, and which facts it cited ──────────────────────────────
export const SUPERAPP_AUDIT_ALLOWLIST: readonly string[] = [
  'superApp', 'event', 'advisory', 'status', 'terms', 'platformThesis', 'anchoredModules', 'unanchoredModules',
  'recommendsOnly', 'confidence', 'basis', 'externalDataNeeded', 'groundedOn', 'kind', 'ref', 'name', 'citedCount', 'environment',
];

export class SuperAppBlueprintAuditor {
  constructor(
    private readonly sink: Pick<AuditSink, 'appendRead'>,
    private readonly redactor: Pick<RedactionEngine, 'redactSummary'>,
    private readonly organizationId: string,
    private readonly actor: HumanActor,
    private readonly environment: Environment = 'local',
    private readonly session: SessionInfo = { session_id: 'super-app-blueprint' },
  ) {}

  async record(assessment: SuperAppBlueprintAssessment, terms: string[]): Promise<AppendResult> {
    const summary = this.redactor.redactSummary({
      superApp: 'assess',
      event: 'superapp.blueprinted',
      advisory: assessment.advisory,
      status: assessment.status,
      terms,
      platformThesis: assessment.platformThesis,
      anchoredModules: assessment.anchoredModules,
      unanchoredModules: assessment.unanchoredModules,
      recommendsOnly: assessment.recommendsOnly,
      confidence: assessment.confidence,
      basis: assessment.basis,
      externalDataNeeded: assessment.externalDataNeeded,
      groundedOn: assessment.groundedOn.map((f) => ({ kind: f.kind, ref: f.ref, name: f.name })),
      citedCount: assessment.groundedOn.length,
      environment: this.environment,
    });
    return this.sink.appendRead({ organization_id: this.organizationId, human_actor: this.actor, session: this.session, query_range: summary, rows_returned: assessment.groundedOn.length });
  }
}
