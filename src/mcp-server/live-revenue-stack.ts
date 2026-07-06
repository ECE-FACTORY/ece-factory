// Live Revenue Stack wiring (VI Wave — JUDGMENT engine 3, composition layer). Wires the advisory Revenue Stack
// engine to the REAL Phase-1 Capability Reuse Graph (consumed read-only for GROUNDING facts) and the
// allowlist-redacted hash-chain auditor. Thin composition: NO guard logic, NO gate/bridge, NO mutation — it grounds
// an opinion in cited internal facts (flagging external pricing needs) and records it. No LLM is wired in this slice
// (a deterministic composer satisfies the discipline); if one is added later, the FACTS must still come from the
// graph and no secret/key may enter its prompts or the audit. Mirrors the Category-Creation / Moat adapters.

import { RedactionEngine } from '../features/redaction-engine/redaction-engine.js';
import { SecretPatternRedactor } from '../features/build-observer/build-observer.js';
import type { AuditSink } from '../features/audit-engine/sink.js';
import type { HumanActor, Environment } from '../features/audit-engine/schema.js';
import {
  RevenueStackEngine,
  RevenueStackAuditor,
  REVENUE_AUDIT_ALLOWLIST,
  type GraphReader,
} from '../features/revenue-stack/revenue-stack.js';

/** The advisory Revenue Stack engine, grounded on an already-built graph (the Phase-1 CapabilityReuseGraph
 *  satisfies GraphReader structurally). Uses the Observer's secret scrubber on the concept text + basis. */
export function factoryRevenueStackEngine(graph: GraphReader): RevenueStackEngine {
  return new RevenueStackEngine(graph, SecretPatternRedactor);
}

/** Service identity for revenue-stack evidence (a service actor, never 'claude'/a fake human). */
export const REVENUE_ACTOR: HumanActor = { user_id: 'revenue-stack', email: '', role: 'service' };

export function factoryRevenueStackAuditor(
  sink: Pick<AuditSink, 'appendRead'>,
  organizationId: string,
  actor: HumanActor = REVENUE_ACTOR,
  environment: Environment = 'local',
): RevenueStackAuditor {
  return new RevenueStackAuditor(sink, new RedactionEngine(REVENUE_AUDIT_ALLOWLIST), organizationId, actor, environment);
}
