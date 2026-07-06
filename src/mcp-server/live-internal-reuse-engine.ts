// Live Internal Reuse Engine wiring (Venture Intelligence Wave — Phase 2, composition layer). Wires the
// deterministic engine to the REAL Phase-1 Capability Reuse Graph (consumed read-only via its search port) and
// the allowlist-redacted hash-chain auditor. Thin composition: NO guard logic, NO gate/bridge, NO mutation —
// it reads graph facts and classifies. It does NOT modify Phase 1.

import { RedactionEngine } from '../factory-shared/redaction-engine/redaction-engine.js';
import { SecretPatternRedactor } from '../layer-4-build-harden/build-observer/build-observer.js';
import type { AuditSink } from '../factory-shared/audit-engine/sink.js';
import type { HumanActor, Environment } from '../factory-shared/audit-engine/schema.js';
import { factoryCapabilityGraph } from './live-capability-reuse-graph.js';
import {
  InternalReuseEngine,
  ReuseDecisionAuditor,
  REUSE_AUDIT_ALLOWLIST,
  type GraphReader,
} from '../layer-3-harvest/internal-reuse-engine/internal-reuse-engine.js';

/** The engine over an already-built graph (the Phase-1 CapabilityReuseGraph satisfies GraphReader structurally). */
export function factoryInternalReuseEngine(graph: GraphReader): InternalReuseEngine {
  return new InternalReuseEngine(graph, SecretPatternRedactor);
}

/** Convenience: build the real repo graph (Phase 1) and hand the engine a read-only view of it. */
export function factoryInternalReuseEngineFromRepo(repoRoot: string): InternalReuseEngine {
  return factoryInternalReuseEngine(factoryCapabilityGraph(repoRoot));
}

/** Service identity for reuse-decision evidence (a service actor, never 'claude'/a fake human). */
export const REUSE_ACTOR: HumanActor = { user_id: 'internal-reuse-engine', email: '', role: 'service' };

export function factoryReuseDecisionAuditor(
  sink: Pick<AuditSink, 'appendRead'>,
  organizationId: string,
  actor: HumanActor = REUSE_ACTOR,
  environment: Environment = 'local',
): ReuseDecisionAuditor {
  return new ReuseDecisionAuditor(sink, new RedactionEngine(REUSE_AUDIT_ALLOWLIST), organizationId, actor, environment);
}
