// Live External Harvest Composer wiring (Venture Intelligence Wave — Phase 3, composition layer). Wires the
// deterministic composer to the REAL Wave-3 sourcing engines (License / Scoring / Sovereign Readiness /
// White-Label), driving them through their existing interfaces — REUSED, never reimplemented. Thin composition:
// NO guard logic, NO gate/bridge, NO mutation — it drives the engines read-only and classifies.

import { RedactionEngine } from '../factory-shared/redaction-engine/redaction-engine.js';
import { SecretPatternRedactor } from '../layer-4-build-harden/build-observer/build-observer.js';
import { classifyLicense } from '../layer-3-harvest/license-compliance/license-compliance.js';
import { scoreCandidate } from '../layer-3-harvest/scoring-engine/scoring-engine.js';
import { assessSovereignReadiness } from '../layer-3-harvest/sovereign-readiness/sovereign-readiness.js';
import { assessWhiteLabel } from '../layer-4-build-harden/white-label/white-label.js';
import type { AuditSink } from '../factory-shared/audit-engine/sink.js';
import type { HumanActor, Environment } from '../factory-shared/audit-engine/schema.js';
import {
  ExternalHarvestComposer,
  HarvestDecisionAuditor,
  HARVEST_AUDIT_ALLOWLIST,
  type SourcingEngines,
} from '../layer-3-harvest/external-harvest-composer/external-harvest-composer.js';

/** The REAL Wave-3 sourcing engines bundled behind the composer's port (the actual factory engines, reused). */
export const REAL_SOURCING_ENGINES: SourcingEngines = {
  classifyLicense,
  // The composer's port is sovereign (the external-harvest path); bind the mode explicitly, never defaulted.
  scoreCandidate: (c) => scoreCandidate(c, 'sovereign'),
  assessSovereignReadiness: (d) => ({ verdict: assessSovereignReadiness(d).verdict }),
  assessWhiteLabel: (e) => ({ verdict: assessWhiteLabel(e).verdict }),
};

/** The factory's External Harvest Composer, driving the real sourcing engines. */
export function factoryExternalHarvestComposer(): ExternalHarvestComposer {
  return new ExternalHarvestComposer(REAL_SOURCING_ENGINES, SecretPatternRedactor);
}

/** Service identity for harvest-decision evidence (a service actor, never 'claude'/a fake human). */
export const HARVEST_ACTOR: HumanActor = { user_id: 'external-harvest-composer', email: '', role: 'service' };

export function factoryHarvestDecisionAuditor(
  sink: Pick<AuditSink, 'appendRead'>,
  organizationId: string,
  actor: HumanActor = HARVEST_ACTOR,
  environment: Environment = 'local',
): HarvestDecisionAuditor {
  return new HarvestDecisionAuditor(sink, new RedactionEngine(HARVEST_AUDIT_ALLOWLIST), organizationId, actor, environment);
}
