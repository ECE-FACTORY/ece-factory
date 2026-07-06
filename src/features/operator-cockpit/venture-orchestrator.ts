// Venture Orchestrator — runs the PLAN-ONLY VI engines and passes their OUTPUTS to the pure-unifier composer.
//
// This is the "compose a Venture Blueprint from a concept" read: it constructs the real plan-only engines over the
// real Capability Reuse Graph, RUNS them (they execute/mutate/deploy NOTHING — each is advisory/structural + plan-only),
// tags each result with its engine name, and hands the collection to `VentureBlueprintComposer.compose(...)`. It adds
// NO action: it imports ONLY plan-only engines + the pure composer + the read-only graph — nothing from any guard /
// gate-mint / gauntlet / mcp-bridge / external adapter. The returned `VentureBlueprint` is the inert, human-routed
// artifact (status literal `VENTURE-BLUEPRINT-AWAITING-HUMAN-APPROVAL`; whatWeKnow/whatWeBelieve; inert proposals).

import { CategoryCreationEngine } from '../category-creation/category-creation.js';
import { PlatformBlueprintRoadmapEngine } from '../platform-blueprint-roadmap/platform-blueprint-roadmap.js';
import { VentureBlueprintComposer, type EngineOutput, type VentureBlueprint, type CitedFact } from '../venture-blueprint-composer/venture-blueprint-composer.js';
import type { GraphReader } from '../category-creation/category-creation.js';
import type { VentureComposer } from './operator-cockpit.js';

/** Derive simple grounding terms/components from the inert concept text (the engines do the real graph grounding). */
function terms(concept: string): string[] {
  return String(concept ?? '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2)
    .slice(0, 12);
}

/** Normalize an engine's cited facts to the composer's CitedFact shape (structurally identical across VI engines). */
function cites(list: ReadonlyArray<{ kind: string; ref: string; name: string; note: string }> | undefined): CitedFact[] {
  return (list ?? []).map((f) => ({ kind: f.kind === 'sourcing-verdict' ? 'sourcing-verdict' : 'capability', ref: f.ref, name: f.name, note: f.note }));
}

/**
 * The real orchestrator. Runs a representative set of the plan-only engines — the mixed Platform Blueprint / Venture
 * Roadmap (which yields BOTH an advisory:false structural half AND an advisory:true judgment half) plus the Category
 * Creation judgment engine — over the injected read-only graph, then composes. Every engine is plan-only; the graph
 * is consumed read-only (never mutated); the composer is a pure unifier. Nothing here can act.
 */
export class VentureOrchestrator implements VentureComposer {
  constructor(
    private readonly graph: GraphReader,
    private readonly composer: VentureBlueprintComposer = new VentureBlueprintComposer(),
  ) {}

  composeFromConcept(concept: string): VentureBlueprint {
    const t = terms(concept);

    // JUDGMENT — Category Creation (advisory:true), grounded against the real graph.
    const category = new CategoryCreationEngine(this.graph).propose({ description: concept, terms: t });

    // MIXED — Platform Blueprint (advisory:false, re-derivable) + Venture Roadmap (advisory:true), one call, no bleed.
    const mixed = new PlatformBlueprintRoadmapEngine(this.graph).assess({ description: concept, components: t });

    // Tag each plan-only OUTPUT with its engine name and hand the collection to the pure composer as DATA.
    const outputs: EngineOutput[] = [
      { engine: 'platform-blueprint', advisory: false, groundedOn: cites(mixed.platformBlueprint.groundedOn) },
      { engine: 'venture-roadmap', advisory: true, groundedOn: cites(mixed.ventureRoadmap.phases.flatMap((p) => p.groundedOn)) },
      { engine: 'category-creation', advisory: true, groundedOn: cites(category.groundedOn) },
    ];

    return this.composer.compose({ concept, outputs });
  }
}
