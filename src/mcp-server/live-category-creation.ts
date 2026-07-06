// Live Category Creation wiring (VI Wave — first JUDGMENT engine, composition layer). Wires the advisory
// Category Creation engine to the REAL Phase-1 Capability Reuse Graph (consumed read-only for GROUNDING facts)
// and the allowlist-redacted hash-chain auditor. Thin composition: NO guard logic, NO gate/bridge, NO mutation —
// it grounds an opinion in cited facts and records it. It does NOT modify the graph. No LLM is wired in this
// slice (a deterministic thesis-composer over the cited facts satisfies the discipline); if one is added later,
// the FACTS must still come from the graph and no secret/key may enter its prompts or the audit.

import { RedactionEngine } from '../features/redaction-engine/redaction-engine.js';
import { SecretPatternRedactor } from '../features/build-observer/build-observer.js';
import type { AuditSink } from '../features/audit-engine/sink.js';
import type { HumanActor, Environment } from '../features/audit-engine/schema.js';
import {
  CategoryCreationEngine,
  CategoryThesisAuditor,
  CATEGORY_AUDIT_ALLOWLIST,
  type GraphReader,
} from '../features/category-creation/category-creation.js';

/** The advisory Category Creation engine, grounded on an already-built graph (the Phase-1 CapabilityReuseGraph
 *  satisfies GraphReader structurally). Uses the Observer's secret scrubber on the concept text + basis. */
export function factoryCategoryCreationEngine(graph: GraphReader): CategoryCreationEngine {
  return new CategoryCreationEngine(graph, SecretPatternRedactor);
}

/** Service identity for category-thesis evidence (a service actor, never 'claude'/a fake human). */
export const CATEGORY_ACTOR: HumanActor = { user_id: 'category-creation', email: '', role: 'service' };

export function factoryCategoryThesisAuditor(
  sink: Pick<AuditSink, 'appendRead'>,
  organizationId: string,
  actor: HumanActor = CATEGORY_ACTOR,
  environment: Environment = 'local',
): CategoryThesisAuditor {
  return new CategoryThesisAuditor(sink, new RedactionEngine(CATEGORY_AUDIT_ALLOWLIST), organizationId, actor, environment);
}
