// Platform Blueprint / Venture Roadmap (Venture Intelligence Wave — MIXED engine; part STRUCTURAL, part JUDGMENT).
//
// This engine is UNIQUE in the VI wave: it emits BOTH a re-derivable STRUCTURAL part and an advisory JUDGMENT part,
// CLEANLY SEPARATED — two distinct objects, each carrying its OWN advisory marking, meeting its OWN bar. A consumer
// can tell exactly which part is re-derivable fact and which is opinion. No opinion leaks into the structural part;
// no unproven claim rides in the advisory:false half.
//
//   • STRUCTURAL half — PLATFORM BLUEPRINT (`advisory: false`, re-derivable): the architecture surface that FEEDS
//     the structural Repo Builder — a DETERMINISTIC, re-derivable mapping of the venture's needed components to
//     structural facts (which components map to EXISTING capabilities via the Reuse Graph). DENY-BY-DEFAULT: a
//     component with no matching capability is an `unmapped` gap — NEVER fabricated as covered. Same guarantee as
//     Phases 1–4 (deterministic, re-derivable, deny-by-default). It is NOT opinion. It FEEDS the Repo Builder as
//     DATA — it does NOT invoke it or build anything (an actual build routes through the factory's gated path).
//   • JUDGMENT half — VENTURE ROADMAP (`advisory: true`, opinion): the strategic sequencing across the requirement's
//     horizons (30 / 60 / 90-day, 6 / 12-month) — grounded in cited backbone facts, honest about uncertainty. Same
//     discipline as the 8 judgment engines. It is OPINION; it never presents as re-derivable proof.
//
// Governed by BOTH REQUIREMENT_JUDGMENT_ENGINE_DISCIPLINE.md (judgment half) and the structural-engine bar
// (structural half). PLAN-ONLY / no-self-execute throughout (type-level) — neither half has execute/create/approve/
// mint/mutate/deploy, and critically NO build / invoke-Repo-Builder path. Instruction-boundary; never-drives-action;
// audited+redacted. STANDALONE-PACKAGEABLE (§7): every cross-engine reference is `import type` / injected; self-
// contained — no cross-VI-engine / repo-builder dependency.

import type { CapabilityNode, CapabilityQuery } from '../../factory-shared/capability-reuse-graph/capability-reuse-graph.js';
import type { TextRedactor } from '../../layer-4-build-harden/build-observer/build-observer.js';
import type { AuditSink, AppendResult } from '../../factory-shared/audit-engine/sink.js';
import type { HumanActor, SessionInfo, Environment } from '../../factory-shared/audit-engine/schema.js';
import type { RedactionEngine } from '../../factory-shared/redaction-engine/redaction-engine.js';

/** The read-only slice of the Phase-1 graph both halves ground on (never mutated). */
export interface GraphReader { search(q?: CapabilityQuery): CapabilityNode[] }

/** The single plan-only status literal. Forbidden statuses are not part of the type. */
export type PlanOnlyStatus = 'VENTURE-BLUEPRINT-AWAITING-HUMAN-APPROVAL';

/** One CITED fact — traces to a real structural-backbone node (or a Phase-4 verdict). NOT an opinion. */
export interface CitedFact {
  kind: 'capability' | 'sourcing-verdict';
  ref: string;
  name: string;
  note: string;
}

export type Confidence = 'insufficient-basis' | 'low' | 'moderate' | 'speculative-high';

// ── STRUCTURAL half — Platform Blueprint (advisory:false, re-derivable) ──────────────────────────────────────
export type ComponentStatus = 'existing' | 'unmapped';

/** A deterministic mapping of a needed component to structural facts. NOT opinion. */
export interface ComponentMapping {
  component: string;
  /** cited real capabilities that cover this component (empty ⇒ `unmapped`). */
  mappedTo: CitedFact[];
  /** `existing` = covered by a real capability; `unmapped` = deny-by-default gap (NEVER fabricated as covered). */
  status: ComponentStatus;
}

/** THE STRUCTURAL HALF — re-derivable FACT. `advisory: false` (literal). */
export interface PlatformBlueprint {
  /** LITERAL false — this half is re-derivable structural FACT, never opinion. */
  advisory: false;
  /** the deterministic component→capability mapping (sorted; re-derivable). */
  components: ComponentMapping[];
  /** components covered by existing capabilities (grounded). */
  existingComponents: string[];
  /** components with NO matching capability — deny-by-default gaps (not fabricated as covered). */
  unmappedComponents: string[];
  /** the UNION of cited capabilities the mapping rests on. */
  groundedOn: CitedFact[];
  /** LITERAL true — this blueprint is DATA that FEEDS the structural Repo Builder; it does NOT invoke it. */
  feedsRepoBuilder: true;
}

// ── JUDGMENT half — Venture Roadmap (advisory:true, opinion) ──────────────────────────────────────────────────
export const ROADMAP_HORIZONS = ['30-day', '60-day', '90-day', '6-month', '12-month'] as const;
export type RoadmapHorizon = (typeof ROADMAP_HORIZONS)[number];

/** One roadmap phase — the strategic sequencing OPINION for a horizon, grounded on cited facts. */
export interface RoadmapPhase {
  horizon: RoadmapHorizon;
  /** OPINION (advisory) — the sequencing/priority for this horizon. */
  opinion: string;
  /** cited capabilities the opinion is grounded on (may be empty for gap-focused later horizons). */
  groundedOn: CitedFact[];
}

/** THE JUDGMENT HALF — advisory OPINION. `advisory: true` (literal). */
export interface VentureRoadmap {
  /** LITERAL true — this half is advisory OPINION, never re-derivable proof. */
  advisory: true;
  /** the sequencing across the requirement's horizons (30/60/90-day, 6/12-month). */
  phases: RoadmapPhase[];
  /** honest confidence signal (§5). */
  confidence: Confidence;
  /** an explicit statement of the basis / its insufficiency (§5). */
  basis: string;
}

/** THE MIXED ASSESSMENT — the two halves are DISTINCT objects, each with its OWN advisory marking (no bleed). */
export interface PlatformBlueprintRoadmapAssessment {
  /** echoed inert concept text (secret-scrubbed) */
  concept: string;
  /** the plan-only status. */
  status: PlanOnlyStatus;
  /** the STRUCTURAL half — advisory:false, re-derivable fact. */
  platformBlueprint: PlatformBlueprint;
  /** the JUDGMENT half — advisory:true, opinion. */
  ventureRoadmap: VentureRoadmap;
  /** LITERAL true — recommends a blueprint + roadmap; does NOT invoke the Repo Builder or build anything. */
  recommendsOnly: true;
}

export interface VentureNeeds {
  /** inert DATA — never instruction */
  description: string;
  /** the components the venture needs — the STRUCTURAL half maps these deterministically. */
  components: string[];
  sourcingVerdicts?: Array<{ capability: string; verdict: string }>;
}

const IDENTITY_REDACTOR: TextRedactor = { redact: (s) => s };
const PLAN_ONLY: PlanOnlyStatus = 'VENTURE-BLUEPRINT-AWAITING-HUMAN-APPROVAL';

function norm(s: string): string { return String(s ?? '').toLowerCase(); }
function byRef(a: CitedFact, b: CitedFact): number { return a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0; }

/**
 * Emits a re-derivable STRUCTURAL Platform Blueprint (advisory:false) AND an advisory JUDGMENT Venture Roadmap
 * (advisory:true), CLEANLY SEPARATED. Its ONLY method is assess() → data. It holds no gate/approval/bridge
 * reference and — critically — NO build / invoke-Repo-Builder path. The structural mapping is a deterministic
 * function of (needs, graph); the roadmap is an opinion composed over the same cited facts.
 */
export class PlatformBlueprintRoadmapEngine {
  constructor(private readonly graph: GraphReader, private readonly redactor: TextRedactor = IDENTITY_REDACTOR) {}

  assess(needs: VentureNeeds): PlatformBlueprintRoadmapAssessment {
    const components = (needs.components ?? []).map(norm).filter((c) => c.length > 0);
    const conceptText = this.redactor.redact(String(needs.description ?? ''));

    // ── STRUCTURAL half: DETERMINISTIC, re-derivable component→capability mapping (deny-by-default) ──
    const groundedMap = new Map<string, CitedFact>();
    const mappings: ComponentMapping[] = components.map((component): ComponentMapping => {
      const mappedTo = this.citeForTerms([component]);
      for (const f of mappedTo) if (!groundedMap.has(f.ref)) groundedMap.set(f.ref, f);
      return { component, mappedTo, status: mappedTo.length > 0 ? 'existing' : 'unmapped' };
    }).sort((a, b) => (a.component < b.component ? -1 : a.component > b.component ? 1 : 0));

    // optional Phase-4 sourcing verdicts join the structural grounding (still re-derivable facts).
    for (const v of needs.sourcingVerdicts ?? []) {
      const ref = `verdict:${norm(v.capability)}`;
      if (!groundedMap.has(ref)) groundedMap.set(ref, { kind: 'sourcing-verdict', ref, name: v.capability, note: `sourcing verdict ${v.verdict}` });
    }
    const structuralGrounded = [...groundedMap.values()].sort(byRef);
    const existingComponents = mappings.filter((m) => m.status === 'existing').map((m) => m.component);
    const unmappedComponents = mappings.filter((m) => m.status === 'unmapped').map((m) => m.component);

    const platformBlueprint: PlatformBlueprint = {
      advisory: false,
      components: mappings,
      existingComponents,
      unmappedComponents,
      groundedOn: structuralGrounded,
      feedsRepoBuilder: true,
    };

    // ── JUDGMENT half: advisory sequencing OPINION over the cited facts (honest uncertainty) ──
    const existingFacts = mappings.filter((m) => m.status === 'existing').flatMap((m) => m.mappedTo).sort(byRef);
    const dedupExisting = [...new Map(existingFacts.map((f) => [f.ref, f])).values()].sort(byRef);
    const confidence = this.confidenceFor(dedupExisting.length);
    const ventureRoadmap: VentureRoadmap = {
      advisory: true,
      phases: this.roadmapPhases(dedupExisting, existingComponents, unmappedComponents),
      confidence,
      basis: this.redactor.redact(
        dedupExisting.length === 0
          ? 'insufficient-basis: no existing ECE capability grounds a sequencing opinion (all needed components are unmapped gaps) — the roadmap is speculation, not asserted (§5).'
          : `${confidence}: the roadmap sequencing is OPINION grounded on ${dedupExisting.length} cited existing-capability fact(s); the unmapped components are structural gaps (see the Platform Blueprint), sequenced later as build/buy items. Never a re-derivable proof.`,
      ),
    };

    return { concept: conceptText, status: PLAN_ONLY, platformBlueprint, ventureRoadmap, recommendsOnly: true };
  }

  private roadmapPhases(existing: CitedFact[], existingComponents: string[], unmapped: string[]): RoadmapPhase[] {
    if (existing.length === 0) {
      return ROADMAP_HORIZONS.map((horizon) => ({
        horizon,
        opinion: `OPINION (insufficient basis): no existing ECE capability to sequence for ${horizon} — every needed component is an unmapped gap (see the Platform Blueprint); a roadmap here would be speculation.`,
        groundedOn: [],
      }));
    }
    const lead = existing[0];
    const names = existing.map((f) => f.name);
    const cites = existing.map((f) => f.ref);
    const gapNote = unmapped.length ? ` unmapped gaps to build/buy later: [${unmapped.join(', ')}]` : ' (no unmapped gaps)';
    return [
      { horizon: '30-day', opinion: `OPINION (advisory): quick wins on ECE's cited existing capabilit${existing.length === 1 ? 'y' : 'ies'} ${names.join(', ')} [${cites.join(', ')}] — ship the strongest existing component first (${existingComponents[0] ?? 'core'}).`, groundedOn: existing },
      { horizon: '60-day', opinion: `OPINION (advisory): harden/extend the existing capabilities (${names.join(', ')}) into a coherent first product surface.`, groundedOn: existing },
      { horizon: '90-day', opinion: `OPINION (advisory): integrate the existing capabilities behind ${lead.name} [${lead.ref}] into a platform surface; begin scoping${gapNote}.`, groundedOn: [lead] },
      { horizon: '6-month', opinion: `OPINION (advisory): begin the highest-priority${gapNote} via the factory's gated build/buy path — NOT built here.`, groundedOn: existing },
      { horizon: '12-month', opinion: `OPINION (advisory): complete the ecosystem — the sequencing beyond this horizon is low-confidence and needs revisiting with fresh facts.`, groundedOn: existing },
    ];
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
    return out.sort(byRef);
  }

  private confidenceFor(n: number): Confidence {
    if (n === 0) return 'insufficient-basis';
    if (n <= 2) return 'low';
    if (n <= 5) return 'moderate';
    return 'speculative-high';
  }
}

// ── audit tie-in — record BOTH halves (with their distinct advisory markings) to the hash-chain ───────────────
export const MIXED_AUDIT_ALLOWLIST: readonly string[] = [
  'platformRoadmap', 'event', 'status', 'recommendsOnly', 'terms', 'platformBlueprint', 'advisory', 'existingComponents',
  'unmappedComponents', 'feedsRepoBuilder', 'ventureRoadmap', 'confidence', 'basis', 'horizons', 'groundedOn',
  'kind', 'ref', 'name', 'citedCount', 'environment',
];

export class PlatformBlueprintRoadmapAuditor {
  constructor(
    private readonly sink: Pick<AuditSink, 'appendRead'>,
    private readonly redactor: Pick<RedactionEngine, 'redactSummary'>,
    private readonly organizationId: string,
    private readonly actor: HumanActor,
    private readonly environment: Environment = 'local',
    private readonly session: SessionInfo = { session_id: 'platform-blueprint-roadmap' },
  ) {}

  async record(a: PlatformBlueprintRoadmapAssessment, terms: string[]): Promise<AppendResult> {
    const summary = this.redactor.redactSummary({
      platformRoadmap: 'assess',
      event: 'platformroadmap.assessed',
      status: a.status,
      recommendsOnly: a.recommendsOnly,
      terms,
      platformBlueprint: {
        advisory: a.platformBlueprint.advisory, // false — recorded distinctly
        existingComponents: a.platformBlueprint.existingComponents,
        unmappedComponents: a.platformBlueprint.unmappedComponents,
        feedsRepoBuilder: a.platformBlueprint.feedsRepoBuilder,
        groundedOn: a.platformBlueprint.groundedOn.map((f) => ({ kind: f.kind, ref: f.ref, name: f.name })),
      },
      ventureRoadmap: {
        advisory: a.ventureRoadmap.advisory, // true — recorded distinctly
        confidence: a.ventureRoadmap.confidence,
        basis: a.ventureRoadmap.basis,
        horizons: a.ventureRoadmap.phases.map((p) => p.horizon),
      },
      citedCount: a.platformBlueprint.groundedOn.length,
      environment: this.environment,
    });
    return this.sink.appendRead({ organization_id: this.organizationId, human_actor: this.actor, session: this.session, query_range: summary, rows_returned: a.platformBlueprint.groundedOn.length });
  }
}
