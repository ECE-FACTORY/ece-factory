// Live Killer Demo wiring (VI Wave — JUDGMENT engine 6, composition layer). Wires the advisory Killer Demo engine
// to the REAL Phase-1 Capability Reuse Graph (consumed read-only for GROUNDING the demo's buildability) and the
// allowlist-redacted hash-chain auditor. Thin composition: NO guard logic, NO gate/bridge, NO mutation, and —
// critically — NO build/run/deploy/render/present-the-demo path. It RECOMMENDS a demo grounded in cited facts,
// flags audience/market impact as external, and records it. An actual demo build routes through the factory's
// NORMAL gated build path, never here. No LLM is wired in this slice (a deterministic composer satisfies the
// discipline); if one is added later, the FACTS must still come from the graph and no secret/key may enter its
// prompts or the audit. Mirrors the prior judgment adapters.

import { RedactionEngine } from '../features/redaction-engine/redaction-engine.js';
import { SecretPatternRedactor } from '../features/build-observer/build-observer.js';
import type { AuditSink } from '../features/audit-engine/sink.js';
import type { HumanActor, Environment } from '../features/audit-engine/schema.js';
import {
  KillerDemoEngine,
  KillerDemoAuditor,
  KILLERDEMO_AUDIT_ALLOWLIST,
  type GraphReader,
} from '../features/killer-demo/killer-demo.js';

/** The advisory Killer Demo engine, grounded on an already-built graph (the Phase-1 CapabilityReuseGraph satisfies
 *  GraphReader structurally). Uses the Observer's secret scrubber on the concept text + basis. */
export function factoryKillerDemoEngine(graph: GraphReader): KillerDemoEngine {
  return new KillerDemoEngine(graph, SecretPatternRedactor);
}

/** Service identity for killer-demo evidence (a service actor, never 'claude'/a fake human). */
export const KILLERDEMO_ACTOR: HumanActor = { user_id: 'killer-demo', email: '', role: 'service' };

export function factoryKillerDemoAuditor(
  sink: Pick<AuditSink, 'appendRead'>,
  organizationId: string,
  actor: HumanActor = KILLERDEMO_ACTOR,
  environment: Environment = 'local',
): KillerDemoAuditor {
  return new KillerDemoAuditor(sink, new RedactionEngine(KILLERDEMO_AUDIT_ALLOWLIST), organizationId, actor, environment);
}
