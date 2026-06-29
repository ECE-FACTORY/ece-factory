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

export interface AuditSink {
  appendIntent(entry: IntentInput): Promise<AppendResult & { intent_id: string }>;
  appendResult(intentRef: { intent_id: string; organization_id: string }, result: ResultPayload): Promise<AppendResult>;
  appendRead(entry: ReadInput): Promise<AppendResult>;
  verifyChain(organization_id: string): Promise<VerifyResult>;
  /** Extension point: null for the Postgres sink; a Merkle proof for a verifiable-log sink. */
  proof(entryRef: EntryRef): InclusionProof | null;
}

// ---------------------------------------------------------------------------
// Redaction-before-write boundary (Action-Layer §E / ARCHITECTURE §3).
// This is the SEAM for Module 24 (Redaction Engine). The default below is a
// deny-by-default sensitive-KEY stripper applied to free-form payload summaries
// BEFORE hashing/writing, so sensitive data never enters an audit row in the clear.
// Module 24 will replace this with the full server-side, allowlist-based redactor.
// ---------------------------------------------------------------------------
export interface RedactionPolicy {
  redactSummary(summary: Record<string, unknown> | undefined): Record<string, unknown> | undefined;
}

const SENSITIVE_KEY = /(password|passwd|secret|token|api[_-]?key|credential|national[_-]?id|passport|ssn|iban|card|cvv|private[_-]?note|financial|salary|contract)/i;

function stripSensitive(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripSensitive);
  if (value && typeof value === 'object') {
    const src = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(src)) {
      if (SENSITIVE_KEY.test(k)) continue; // deny-by-default: drop the key entirely
      out[k] = stripSensitive(src[k]);
    }
    return out;
  }
  return value;
}

export const defaultRedactionPolicy: RedactionPolicy = {
  redactSummary(summary) {
    if (summary === undefined) return undefined;
    return stripSensitive(summary) as Record<string, unknown>;
  },
};
