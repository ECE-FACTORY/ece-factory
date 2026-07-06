// Live Build/Buy/Partner/Acquire wiring (Venture Intelligence Wave — Phase 4, composition layer). Wires the
// deterministic superset engine + the allowlist-redacted auditor, and offers a full-backbone helper that runs
// Phase-2 (Internal Reuse) → Phase-3 (External Harvest, only if internal is absent) → Phase-4 (unify) end-to-end.
// Thin composition: NO guard logic, NO gate/bridge, NO mutation — it resolves the two legs' outputs.

import { RedactionEngine } from '../features/redaction-engine/redaction-engine.js';
import { SecretPatternRedactor } from '../features/build-observer/build-observer.js';
import type { AuditSink } from '../features/audit-engine/sink.js';
import type { HumanActor, Environment } from '../features/audit-engine/schema.js';
import type { InternalReuseEngine, NeededCapability } from '../features/internal-reuse-engine/internal-reuse-engine.js';
import type { ExternalHarvestComposer, ExternalCandidate } from '../features/external-harvest-composer/external-harvest-composer.js';
import {
  BuildBuyPartnerAcquireEngine,
  UnifiedSourcingAuditor,
  BBPA_AUDIT_ALLOWLIST,
  type StrategicSignal,
  type UnifiedSourcingDecision,
} from '../features/build-buy-partner-acquire/build-buy-partner-acquire.js';

/** The factory's Build/Buy/Partner/Acquire engine (structural, plan-only). */
export function factoryBuildBuyPartnerAcquireEngine(): BuildBuyPartnerAcquireEngine {
  return new BuildBuyPartnerAcquireEngine(SecretPatternRedactor);
}

/** Service identity for unified-sourcing evidence (a service actor, never 'claude'/a fake human). */
export const BBPA_ACTOR: HumanActor = { user_id: 'build-buy-partner-acquire', email: '', role: 'service' };

export function factoryUnifiedSourcingAuditor(
  sink: Pick<AuditSink, 'appendRead'>,
  organizationId: string,
  actor: HumanActor = BBPA_ACTOR,
  environment: Environment = 'local',
): UnifiedSourcingAuditor {
  return new UnifiedSourcingAuditor(sink, new RedactionEngine(BBPA_AUDIT_ALLOWLIST), organizationId, actor, environment);
}

/**
 * The FULL VI structural backbone end-to-end: Phase-2 internal reuse → Phase-3 external harvest (ONLY when
 * internal is genuinely absent, gated on the Phase-2 witness) → Phase-4 unified verdict. Composition only — it
 * calls each engine's read-only surface and hands the two DECISIONS to the resolver. `candidateFor` supplies the
 * external candidate for a given need (its inputs come from upstream Repo Intelligence in production).
 */
export function resolveCapabilitySourcing(
  reuse: InternalReuseEngine,
  harvest: ExternalHarvestComposer,
  engine: BuildBuyPartnerAcquireEngine,
  need: NeededCapability,
  candidateFor: (absence: 'BUILD_CUSTOM' | 'NEEDS_REVIEW') => ExternalCandidate,
  strategic?: StrategicSignal,
): UnifiedSourcingDecision {
  const internal = reuse.classify(need);
  // Phase-3 runs ONLY on an evidenced internal absence (BUILD_CUSTOM) — the anti-rebuild gate.
  const external = internal.classification === 'BUILD_CUSTOM'
    ? harvest.compose(candidateFor('BUILD_CUSTOM'))
    : undefined;
  return engine.decide({ capability: need.description, internal, external, strategic });
}
