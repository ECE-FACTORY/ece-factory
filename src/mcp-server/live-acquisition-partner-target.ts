// Live Acquisition/Partner Target wiring (VI Wave — JUDGMENT engine 5, composition layer). Wires the advisory
// engine to the REAL Phase-1 Capability Reuse Graph (consumed read-only for GROUNDING the capability-gap analysis)
// and the allowlist-redacted hash-chain auditor. Thin composition: NO guard logic, NO gate/bridge, NO mutation, and
// — critically — NO acquire/partner/contact/deal path. It grounds a complement opinion in cited facts, flags any
// external-company identity as UNVERIFIED, and records it. No LLM is wired in this slice (a deterministic composer
// satisfies the discipline); if one is added later, the FACTS must still come from the graph, no company may be
// asserted as fact, and no secret/key may enter its prompts or the audit. Mirrors the prior judgment adapters.

import { RedactionEngine } from '../features/redaction-engine/redaction-engine.js';
import { SecretPatternRedactor } from '../features/build-observer/build-observer.js';
import type { AuditSink } from '../features/audit-engine/sink.js';
import type { HumanActor, Environment } from '../features/audit-engine/schema.js';
import {
  AcquisitionPartnerTargetEngine,
  AcquisitionPartnerAuditor,
  ACQPARTNER_AUDIT_ALLOWLIST,
  type GraphReader,
} from '../features/acquisition-partner-target/acquisition-partner-target.js';

/** The advisory Acquisition/Partner Target engine, grounded on an already-built graph (the Phase-1
 *  CapabilityReuseGraph satisfies GraphReader structurally). Uses the Observer's secret scrubber. */
export function factoryAcquisitionPartnerTargetEngine(graph: GraphReader): AcquisitionPartnerTargetEngine {
  return new AcquisitionPartnerTargetEngine(graph, SecretPatternRedactor);
}

/** Service identity for acquisition/partner evidence (a service actor, never 'claude'/a fake human). */
export const ACQPARTNER_ACTOR: HumanActor = { user_id: 'acquisition-partner-target', email: '', role: 'service' };

export function factoryAcquisitionPartnerAuditor(
  sink: Pick<AuditSink, 'appendRead'>,
  organizationId: string,
  actor: HumanActor = ACQPARTNER_ACTOR,
  environment: Environment = 'local',
): AcquisitionPartnerAuditor {
  return new AcquisitionPartnerAuditor(sink, new RedactionEngine(ACQPARTNER_AUDIT_ALLOWLIST), organizationId, actor, environment);
}
