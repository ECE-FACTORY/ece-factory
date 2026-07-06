// Live Super-App Blueprint wiring (VI Wave — JUDGMENT engine 7, composition layer). Wires the advisory Super-App
// Blueprint engine to the REAL Phase-1 Capability Reuse Graph (consumed read-only for GROUNDING module anchoring)
// and the allowlist-redacted hash-chain auditor. Thin composition: NO guard logic, NO gate/bridge, NO mutation, and
// — critically — NO build-the-app / launch / ship path. It RECOMMENDS a blueprint grounded in cited facts, flags
// unanchored modules as honest gaps + network/market claims as external, and records it. An actual build routes
// through the factory's NORMAL gated build path, never here. No LLM is wired in this slice (a deterministic composer
// satisfies the discipline); if one is added later, the FACTS must still come from the graph and no secret/key may
// enter its prompts or the audit. Mirrors the prior judgment adapters.

import { RedactionEngine } from '../factory-shared/redaction-engine/redaction-engine.js';
import { SecretPatternRedactor } from '../layer-4-build-harden/build-observer/build-observer.js';
import type { AuditSink } from '../factory-shared/audit-engine/sink.js';
import type { HumanActor, Environment } from '../factory-shared/audit-engine/schema.js';
import {
  SuperAppBlueprintEngine,
  SuperAppBlueprintAuditor,
  SUPERAPP_AUDIT_ALLOWLIST,
  type GraphReader,
} from '../layer-6-venture-intel/super-app-blueprint/super-app-blueprint.js';

/** The advisory Super-App Blueprint engine, grounded on an already-built graph (the Phase-1 CapabilityReuseGraph
 *  satisfies GraphReader structurally). Uses the Observer's secret scrubber on the concept text + basis. */
export function factorySuperAppBlueprintEngine(graph: GraphReader): SuperAppBlueprintEngine {
  return new SuperAppBlueprintEngine(graph, SecretPatternRedactor);
}

/** Service identity for super-app-blueprint evidence (a service actor, never 'claude'/a fake human). */
export const SUPERAPP_ACTOR: HumanActor = { user_id: 'super-app-blueprint', email: '', role: 'service' };

export function factorySuperAppBlueprintAuditor(
  sink: Pick<AuditSink, 'appendRead'>,
  organizationId: string,
  actor: HumanActor = SUPERAPP_ACTOR,
  environment: Environment = 'local',
): SuperAppBlueprintAuditor {
  return new SuperAppBlueprintAuditor(sink, new RedactionEngine(SUPERAPP_AUDIT_ALLOWLIST), organizationId, actor, environment);
}
