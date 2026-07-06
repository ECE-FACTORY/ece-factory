// Live Moat Engine wiring (VI Wave — JUDGMENT engine 2, composition layer). Wires the advisory Moat engine to the
// REAL Phase-1 Capability Reuse Graph (consumed read-only for GROUNDING facts) and the allowlist-redacted
// hash-chain auditor. Thin composition: NO guard logic, NO gate/bridge, NO mutation — it grounds an opinion in
// cited facts and records it. It does NOT modify the graph. No LLM is wired in this slice (a deterministic
// composer over the cited facts satisfies the discipline); if one is added later, the FACTS must still come from
// the graph and no secret/key may enter its prompts or the audit. Mirrors the Category-Creation adapter.

import { RedactionEngine } from '../factory-shared/redaction-engine/redaction-engine.js';
import { SecretPatternRedactor } from '../layer-4-build-harden/build-observer/build-observer.js';
import type { AuditSink } from '../factory-shared/audit-engine/sink.js';
import type { HumanActor, Environment } from '../factory-shared/audit-engine/schema.js';
import {
  MoatEngine,
  MoatAssessmentAuditor,
  MOAT_AUDIT_ALLOWLIST,
  type GraphReader,
} from '../layer-6-venture-intel/moat-engine/moat-engine.js';

/** The advisory Moat engine, grounded on an already-built graph (the Phase-1 CapabilityReuseGraph satisfies
 *  GraphReader structurally). Uses the Observer's secret scrubber on the concept text + basis. */
export function factoryMoatEngine(graph: GraphReader): MoatEngine {
  return new MoatEngine(graph, SecretPatternRedactor);
}

/** Service identity for moat-assessment evidence (a service actor, never 'claude'/a fake human). */
export const MOAT_ACTOR: HumanActor = { user_id: 'moat-engine', email: '', role: 'service' };

export function factoryMoatAssessmentAuditor(
  sink: Pick<AuditSink, 'appendRead'>,
  organizationId: string,
  actor: HumanActor = MOAT_ACTOR,
  environment: Environment = 'local',
): MoatAssessmentAuditor {
  return new MoatAssessmentAuditor(sink, new RedactionEngine(MOAT_AUDIT_ALLOWLIST), organizationId, actor, environment);
}
