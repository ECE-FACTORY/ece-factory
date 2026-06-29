// AuditSink — the storage seam (ARCHITECTURE §8). The sequencer and all callers
// depend ONLY on this interface, never on a concrete store. The default
// PostgresHashChainSink returns null from proof(); a future VerifiableLogSink
// (Trillian/Rekor/Tessera) attaches behind this same interface, additively.
//
// This file is STORAGE-SEAM types only. It contains NO §2 sequencer control flow.

import type {
  HumanActor,
  SessionInfo,
  ToolInfo,
  AuthorizationInfo,
  ApprovalInfo,
  DashboardInfo,
  Environment,
} from './schema.js';

/** External-verifiability proof. Non-null only for a VerifiableLogSink. */
export interface InclusionProof {
  log: string;
  leaf_index: number;
  root_hash: string;
  proof_path: string[];
}

export interface VerifyResult {
  ok: boolean;
  /** seq of the first entry whose content hash or chain linkage failed. */
  first_broken_seq?: number;
  checked: number;
}

export interface AppendResult {
  seq: number;
  entry_hash: string;
}

export interface IntentInput {
  organization_id: string;
  human_actor: HumanActor;
  via?: string;
  session: SessionInfo;
  tool: ToolInfo;
  request_summary?: Record<string, unknown>;
  authz: AuthorizationInfo;
  approval?: ApprovalInfo;
  dashboard?: DashboardInfo;
  environment: Environment;
}

export interface ResultPayload {
  status: 'success' | 'error';
  error_code?: string;
  duration_ms: number;
}

export interface ReadInput {
  organization_id: string;
  human_actor: HumanActor;
  session: SessionInfo;
  query_range?: Record<string, unknown>;
  rows_returned?: number;
}

export interface EntryRef {
  organization_id: string;
  seq: number;
}

/** A committed intent with no matching result — a possible partial action (§I3). */
export interface OrphanedIntent {
  intent_id: string;
  seq: number;
  ts: string;
}

/** Minimal, data-minimized projection of an audit entry returned by the viewer (§14). */
export interface AuditRow {
  kind: 'intent' | 'result' | 'read' | 'refusal';
  seq: number;
  organization_id: string;
  ts: string;
  entry_hash: string;
}

/** A denied attempt — recorded in its OWN table, never as a result-less intent. */
export interface RefusalInput {
  organization_id: string;
  human_actor: HumanActor;
  via?: string;
  session: SessionInfo;
  tool: ToolInfo;
  stage: string;
  decision: 'REFUSE' | 'STOP_FOR_APPROVAL';
  reason?: string;
  environment: Environment;
}

export interface AuditSink {
  appendIntent(entry: IntentInput): Promise<AppendResult & { intent_id: string }>;
  appendResult(intentRef: { intent_id: string; organization_id: string }, result: ResultPayload): Promise<AppendResult>;
  appendRead(entry: ReadInput): Promise<AppendResult>;
  /** Record a denied attempt as a distinct, chained refusal entry (never an intent). */
  appendRefusal(entry: RefusalInput): Promise<AppendResult>;
  verifyChain(organization_id: string): Promise<VerifyResult>;
  /** Read audit entries for an org (RLS-scoped), data-minimized projection. */
  readEntries(organization_id: string, opts?: { limit?: number }): Promise<AuditRow[]>;
  /** Intents with no matching result, older than the grace window (§I3 orphan detection). */
  orphanedIntents(organization_id: string, olderThanSeconds?: number): Promise<OrphanedIntent[]>;
  /** Extension point: null for the Postgres sink; a Merkle proof for a verifiable-log sink. */
  proof(entryRef: EntryRef): InclusionProof | null;
}

// ---------------------------------------------------------------------------
// Redaction-before-write SEAM (Action-Layer §E / ARCHITECTURE §3).
// The audit sink defines this port; the concrete implementation (Module 24,
// the Redaction Engine — deny-by-default, allowlist-based) is INJECTED. The sink
// never imports a concrete redactor, keeping the engines independently packageable.
// ---------------------------------------------------------------------------
export interface RedactionPolicy {
  redactSummary(summary: Record<string, unknown> | undefined): Record<string, unknown> | undefined;
}
