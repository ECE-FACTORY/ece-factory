// Module 23 Audit Engine — schema types + canonical-serialization SIGNATURE STUB.
// Phase 3.1: TYPES / SIGNATURES ONLY. No hashing, no sequencer, no AuditSink bodies.
// The hash-chain and canonical serialization are implemented in a later phase (§5/§2).
// Mirrors infra/migrations/0001_audit_schema.sql and ARCHITECTURE.md §3.

export type Environment = 'local' | 'staging' | 'production';

/** The authenticated human — never the model. (DB also enforces this via CHECK.) */
export interface HumanActor {
  user_id: string;
  email: string;
  role: string;
}

export interface SessionInfo {
  session_id: string;
  connector_id?: string;
  connector_type?: string;
  source_application?: string;
}

export interface ToolInfo {
  name: string;
  classification?: string;
  permission_level?: string;
  version?: string;
}

export interface AuthorizationInfo {
  permission_checked?: boolean;
  decision: 'ALLOW' | 'REFUSE' | 'STOP_FOR_APPROVAL';
  reason?: string;
}

export interface ApprovalInfo {
  required: boolean;
  captured?: boolean;
  approved_by?: string;
  approval_timestamp?: string;
}

export interface DashboardInfo {
  endpoint?: string;
  method?: string;
  direct_database_access: boolean;
}

/** Hash-chain columns. Populated by the sequencer/hash-chain later — not here. */
export interface ChainFields {
  seq: number;
  prev_hash: string | null;
  entry_hash: string | null;
}

export interface AuditIntent extends ChainFields {
  intent_id: string;
  ts: string;
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
  status: 'intent';
}

export interface AuditResult extends ChainFields {
  result_id: string;
  intent_id: string;
  ts: string;
  organization_id: string;
  result: { status: 'success' | 'error'; error_code?: string; duration_ms: number };
  status: 'success' | 'error';
}

export interface AuditReadLog extends ChainFields {
  read_id: string;
  ts: string;
  organization_id: string;
  human_actor: HumanActor;
  session: SessionInfo;
  query_range?: Record<string, unknown>;
  rows_returned?: number;
}

export type AuditEntry = AuditIntent | AuditResult | AuditReadLog;

/**
 * Canonical serialization of an audit entry's content (excluding hash columns),
 * the stable byte contract every AuditSink hashes/proves over (ARCHITECTURE §5/§8).
 *
 * STUB — signature only. Implemented with the hash-chain in a later phase.
 */
export function canonicalSerialize(_entry: AuditEntry): string {
  throw new Error('canonicalSerialize: not implemented in Phase 3.1 (hash-chain lands in the sequencer phase)');
}
