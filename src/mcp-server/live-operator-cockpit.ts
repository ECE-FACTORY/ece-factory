// Live Operator Cockpit wiring (read-surface layer — composition root). Assembles the pure-read + one-route-only
// cockpit from the REAL read functions the backend already exposes. Thin composition: NO guard logic, NO gate-mint,
// NO gauntlet, NO external adapter. The route endpoint is handed ONLY the EXISTING propose surface; the reads are
// handed the EXISTING read functions (Console queue, delivery-chain latest, the plan-only venture orchestrator, the
// audit sink, machine status). Mirrors the prior live-* adapters; adds no action path.

import { RedactionEngine } from '../features/redaction-engine/redaction-engine.js';
import { SecretPatternRedactor } from '../features/build-observer/build-observer.js';
import {
  OperatorCockpit,
  COCKPIT_AUDIT_ALLOWLIST,
  type OperatorCockpitPorts,
  type PendingQueueReader,
  type DeliveryChainReader,
  type VentureComposer,
  type AuditReader,
  type MachineStatusReader,
  type ProposeSurface,
} from '../features/operator-cockpit/operator-cockpit.js';
import { VentureOrchestrator } from '../features/operator-cockpit/venture-orchestrator.js';
import type { GraphReader } from '../features/category-creation/category-creation.js';
import type { AuditSink } from '../features/audit-engine/sink.js';
import type { HumanActor, Environment } from '../features/audit-engine/schema.js';

/** Service identity for cockpit route-audit evidence (a service actor, never 'claude'/a fake human). */
export const COCKPIT_ACTOR: HumanActor = { user_id: 'operator-cockpit', email: '', role: 'service' };

/** A delivery-chain latest-record provider that reports "nothing observed yet" — the honest default (no fabrication). */
export const EMPTY_DELIVERY: DeliveryChainReader = {
  latestObservation: () => null,
  latestPreview: () => null,
  latestPackage: () => null,
  latestRelease: () => null,
};

/** Build the plan-only venture orchestrator over the real Capability Reuse Graph. */
export function factoryVentureOrchestrator(graph: GraphReader): VentureOrchestrator {
  return new VentureOrchestrator(graph);
}

export interface CockpitWiring {
  pendingQueue: PendingQueueReader;      // bound to DecisionConsole.listPending (read-only)
  delivery?: DeliveryChainReader;        // latest delivery-chain records (defaults to EMPTY_DELIVERY)
  venture: VentureComposer;              // the plan-only orchestrator (factoryVentureOrchestrator)
  audit: AuditReader;                    // the real hash-chain sink (verifyChain + readEntries)
  machine: MachineStatusReader;          // the governance factory-status read
  propose: ProposeSurface;               // the EXISTING propose path — the route endpoint's ONLY action seam
  auditSink: Pick<AuditSink, 'appendRead'>; // hash-chain sink for recording the route enqueue
  organizationId: string;
  actor?: HumanActor;
  environment?: Environment;
}

/** Assemble the Operator Cockpit from the real read functions + the existing propose path. Adds no action path. */
export function factoryOperatorCockpit(w: CockpitWiring): OperatorCockpit {
  const ports: OperatorCockpitPorts = {
    pendingQueue: w.pendingQueue,
    delivery: w.delivery ?? EMPTY_DELIVERY,
    venture: w.venture,
    audit: w.audit,
    machine: w.machine,
    propose: w.propose,
    auditSink: w.auditSink,
    summaryRedactor: new RedactionEngine(COCKPIT_AUDIT_ALLOWLIST),
    responseRedactor: SecretPatternRedactor,
    organizationId: w.organizationId,
    actor: w.actor ?? COCKPIT_ACTOR,
    environment: w.environment ?? 'local',
  };
  return new OperatorCockpit(ports);
}
