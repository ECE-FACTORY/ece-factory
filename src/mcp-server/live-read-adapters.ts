// Live READ_ONLY adapters (Phase 9.0, Part 2) — real read-only sources behind the READ_ONLY tier.
//
// Each method is a READ-ONLY consumer of a LIVE store (real registries, the real audit sink, the real tool
// registry, real governance docs). There is no write path here. The live read still flows through the full
// guard stack: the bridge calls these ports INSIDE its audited/redacted/permissioned read path — these
// adapters only fetch the real data. The server's DB role stays SELECT-only on the system of record.
//
// Sources are INJECTED (no concrete cross-engine import beyond types), so this layer is testable and the
// composition root decides what is live. Only the READ_ONLY tier is wired live this phase; write/external
// stay on fakes (wired in server.ts).

import type { FactoryReadPorts, FactoryReadParams } from '../features/mcp-bridge/factory-read-tools.js';
import type { ToolRegistryReader } from '../features/tool-registry/tool-registry.js';

/** Minimal read shapes over the live stores (structural — no concrete store import). */
export interface ListReader<T> { list(): Promise<T[]>; }
export interface AuditSummaryReader { readEntries(organizationId: string, opts?: { limit?: number }): Promise<unknown[]>; }
/** Reads a named governance document live (real file/source), read-only. */
export type GovernanceDocReader = (doc: string) => Promise<unknown>;

export interface LiveReadSources {
  toolRegistry: ToolRegistryReader; // the REAL registry (live tool map)
  riskStore: ListReader<unknown>; // real PostgresRiskRegisterStore
  domainStore: ListReader<unknown>; // real PostgresDomainRegistryStore
  projectStore: ListReader<unknown>; // real PostgresProjectRegistryStore
  auditReader: AuditSummaryReader; // real audit sink
  /** Live read of a governance doc (factory/wave/module status, review log, open items, plans, features). */
  doc: GovernanceDocReader;
}

export class LiveFactoryReadPorts implements FactoryReadPorts {
  constructor(private readonly s: LiveReadSources) {}

  // ── governance state derived from live docs (read-only) ──
  factoryStatus(): Promise<unknown> { return this.s.doc('factory_status'); }
  waveStatus(): Promise<unknown> { return this.s.doc('wave_status'); }
  moduleStatus(): Promise<unknown> { return this.s.doc('module_status'); }
  openGates(): Promise<unknown> { return this.s.doc('open_gates'); }
  reviewLog(): Promise<unknown> { return this.s.doc('review_log'); }
  evidencePack(params: FactoryReadParams): Promise<unknown> { return this.s.doc(`evidence_pack:${params.ref ?? ''}`); }
  openItems(): Promise<unknown> { return this.s.doc('open_items'); }
  featureRegistry(): Promise<unknown> { return this.s.doc('feature_registry'); }
  productCreationPlan(params: FactoryReadParams): Promise<unknown> { return this.s.doc(`product_creation_plan:${params.ref ?? ''}`); }
  repoBuildPlan(params: FactoryReadParams): Promise<unknown> { return this.s.doc(`repo_build_plan:${params.ref ?? ''}`); }

  // ── registries read live from their real append-only stores ──
  domainRegistry(): Promise<unknown> { return this.s.domainStore.list(); }
  projectRegistry(): Promise<unknown> { return this.s.projectStore.list(); }
  riskRegister(): Promise<unknown> { return this.s.riskStore.list(); }

  // ── the live tool map + the live audit trail (permissioned capabilities) ──
  toolRegistry(): Promise<unknown> { return Promise.resolve(this.s.toolRegistry.list()); }
  auditSummary(params: FactoryReadParams): Promise<unknown> {
    return this.s.auditReader.readEntries(params.organizationId ?? '', { limit: 50 });
  }
}
