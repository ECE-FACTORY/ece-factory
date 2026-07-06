// Live First 10 Customers wiring (VI Wave — JUDGMENT engine 4, composition layer). Wires the advisory First-10 /
// GTM-wedge engine to the REAL Phase-1 Capability Reuse Graph (consumed read-only for GROUNDING facts) and the
// allowlist-redacted hash-chain auditor. Thin composition: NO guard logic, NO gate/bridge, NO mutation — it grounds
// an opinion in cited internal credibility facts (flagging external customer/market data needs) and records it. No
// LLM is wired in this slice (a deterministic composer satisfies the discipline); if one is added later, the FACTS
// must still come from the graph, no named customer/demand may be invented, and no secret/key may enter its prompts
// or the audit. Mirrors the Category-Creation / Moat / Revenue-Stack adapters.

import { RedactionEngine } from '../features/redaction-engine/redaction-engine.js';
import { SecretPatternRedactor } from '../features/build-observer/build-observer.js';
import type { AuditSink } from '../features/audit-engine/sink.js';
import type { HumanActor, Environment } from '../features/audit-engine/schema.js';
import {
  First10CustomersEngine,
  First10Auditor,
  FIRST10_AUDIT_ALLOWLIST,
  type GraphReader,
} from '../features/first-10-customers/first-10-customers.js';

/** The advisory First-10 engine, grounded on an already-built graph (the Phase-1 CapabilityReuseGraph satisfies
 *  GraphReader structurally). Uses the Observer's secret scrubber on the concept text + basis. */
export function factoryFirst10CustomersEngine(graph: GraphReader): First10CustomersEngine {
  return new First10CustomersEngine(graph, SecretPatternRedactor);
}

/** Service identity for first-10 evidence (a service actor, never 'claude'/a fake human). */
export const FIRST10_ACTOR: HumanActor = { user_id: 'first-10-customers', email: '', role: 'service' };

export function factoryFirst10Auditor(
  sink: Pick<AuditSink, 'appendRead'>,
  organizationId: string,
  actor: HumanActor = FIRST10_ACTOR,
  environment: Environment = 'local',
): First10Auditor {
  return new First10Auditor(sink, new RedactionEngine(FIRST10_AUDIT_ALLOWLIST), organizationId, actor, environment);
}
