// Live Platform Blueprint / Venture Roadmap wiring (VI Wave — MIXED engine, composition layer). Wires the mixed
// engine to the REAL Phase-1 Capability Reuse Graph (consumed read-only for BOTH the re-derivable structural
// component→capability mapping AND the grounded roadmap opinion) and the allowlist-redacted hash-chain auditor.
// Thin composition: NO guard logic, NO gate/bridge, NO mutation, and — critically — NO build / invoke-Repo-Builder
// path. The Platform Blueprint FEEDS the Repo Builder as DATA; an actual build routes through the factory's NORMAL
// gated build path, never here. No LLM is wired in this slice; if one is added later, the STRUCTURAL half must stay
// deterministic/re-derivable, the JUDGMENT half's FACTS must still come from the graph, and no secret/key may enter
// its prompts or the audit. Mirrors the prior VI adapters.

import { RedactionEngine } from '../features/redaction-engine/redaction-engine.js';
import { SecretPatternRedactor } from '../features/build-observer/build-observer.js';
import type { AuditSink } from '../features/audit-engine/sink.js';
import type { HumanActor, Environment } from '../features/audit-engine/schema.js';
import {
  PlatformBlueprintRoadmapEngine,
  PlatformBlueprintRoadmapAuditor,
  MIXED_AUDIT_ALLOWLIST,
  type GraphReader,
} from '../features/platform-blueprint-roadmap/platform-blueprint-roadmap.js';

/** The mixed Platform Blueprint / Venture Roadmap engine, grounded on an already-built graph (the Phase-1
 *  CapabilityReuseGraph satisfies GraphReader structurally). Uses the Observer's secret scrubber. */
export function factoryPlatformBlueprintRoadmapEngine(graph: GraphReader): PlatformBlueprintRoadmapEngine {
  return new PlatformBlueprintRoadmapEngine(graph, SecretPatternRedactor);
}

/** Service identity for platform-blueprint/roadmap evidence (a service actor, never 'claude'/a fake human). */
export const PLATFORMROADMAP_ACTOR: HumanActor = { user_id: 'platform-blueprint-roadmap', email: '', role: 'service' };

export function factoryPlatformBlueprintRoadmapAuditor(
  sink: Pick<AuditSink, 'appendRead'>,
  organizationId: string,
  actor: HumanActor = PLATFORMROADMAP_ACTOR,
  environment: Environment = 'local',
): PlatformBlueprintRoadmapAuditor {
  return new PlatformBlueprintRoadmapAuditor(sink, new RedactionEngine(MIXED_AUDIT_ALLOWLIST), organizationId, actor, environment);
}
