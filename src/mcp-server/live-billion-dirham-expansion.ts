// Live Billion-Dirham Expansion wiring (VI Wave — JUDGMENT engine 8, composition layer). Wires the advisory
// Expansion engine to the REAL Phase-1 Capability Reuse Graph (consumed read-only for GROUNDING the per-stage
// capability support) and the allowlist-redacted hash-chain auditor. Thin composition: NO guard logic, NO
// gate/bridge, NO mutation. It grounds the expansion LOGIC in cited facts and flags ALL market/financial magnitudes
// as external — never fabricating a market size, growth rate, or billion-dirham number. No LLM is wired in this
// slice (a deterministic composer satisfies the discipline); if one is added later, the FACTS must still come from
// the graph, NO financial magnitude may be invented, and no secret/key may enter its prompts or the audit. Mirrors
// the prior judgment adapters.

import { RedactionEngine } from '../features/redaction-engine/redaction-engine.js';
import { SecretPatternRedactor } from '../features/build-observer/build-observer.js';
import type { AuditSink } from '../features/audit-engine/sink.js';
import type { HumanActor, Environment } from '../features/audit-engine/schema.js';
import {
  BillionDirhamExpansionEngine,
  ExpansionAuditor,
  EXPANSION_AUDIT_ALLOWLIST,
  type GraphReader,
} from '../features/billion-dirham-expansion/billion-dirham-expansion.js';

/** The advisory Billion-Dirham Expansion engine, grounded on an already-built graph (the Phase-1
 *  CapabilityReuseGraph satisfies GraphReader structurally). Uses the Observer's secret scrubber. */
export function factoryBillionDirhamExpansionEngine(graph: GraphReader): BillionDirhamExpansionEngine {
  return new BillionDirhamExpansionEngine(graph, SecretPatternRedactor);
}

/** Service identity for expansion evidence (a service actor, never 'claude'/a fake human). */
export const EXPANSION_ACTOR: HumanActor = { user_id: 'billion-dirham-expansion', email: '', role: 'service' };

export function factoryExpansionAuditor(
  sink: Pick<AuditSink, 'appendRead'>,
  organizationId: string,
  actor: HumanActor = EXPANSION_ACTOR,
  environment: Environment = 'local',
): ExpansionAuditor {
  return new ExpansionAuditor(sink, new RedactionEngine(EXPANSION_AUDIT_ALLOWLIST), organizationId, actor, environment);
}
