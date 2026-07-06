// Live Venture Blueprint Composer wiring (VI Wave — CAPSTONE, composition layer). Wires the pure-unifier composer
// to the allowlist-redacted hash-chain auditor. Thin composition: NO guard logic, NO gate/bridge, NO mutation, and
// — critically — the composer orchestrates NO engine and routes NOTHING. The VI engines run separately upstream;
// their OUTPUTS are passed to compose() as data. The blueprint's proposals are INERT DATA a HUMAN routes through
// the existing gated pipeline; the composer never routes/proposes-into-pipeline/approves/executes. No LLM is wired;
// if one is added later it does not change any structural guarantee. Mirrors the prior VI adapters.

import { RedactionEngine } from '../features/redaction-engine/redaction-engine.js';
import { SecretPatternRedactor } from '../features/build-observer/build-observer.js';
import type { AuditSink } from '../features/audit-engine/sink.js';
import type { HumanActor, Environment } from '../features/audit-engine/schema.js';
import {
  VentureBlueprintComposer,
  VentureBlueprintAuditor,
  BLUEPRINT_AUDIT_ALLOWLIST,
} from '../features/venture-blueprint-composer/venture-blueprint-composer.js';

/** The pure-unifier Venture Blueprint Composer. Uses the Observer's secret scrubber on the concept + proposals. */
export function factoryVentureBlueprintComposer(): VentureBlueprintComposer {
  return new VentureBlueprintComposer(SecretPatternRedactor);
}

/** Service identity for venture-blueprint evidence (a service actor, never 'claude'/a fake human). */
export const BLUEPRINT_ACTOR: HumanActor = { user_id: 'venture-blueprint-composer', email: '', role: 'service' };

export function factoryVentureBlueprintAuditor(
  sink: Pick<AuditSink, 'appendRead'>,
  organizationId: string,
  actor: HumanActor = BLUEPRINT_ACTOR,
  environment: Environment = 'local',
): VentureBlueprintAuditor {
  return new VentureBlueprintAuditor(sink, new RedactionEngine(BLUEPRINT_AUDIT_ALLOWLIST), organizationId, actor, environment);
}
