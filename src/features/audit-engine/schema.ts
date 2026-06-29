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

/** Fixed, documented genesis seed for the per-org hash chain (ARCHITECTURE §5). */
export const GENESIS_PREV_HASH = '0'.repeat(64);

/** Recursively sort object keys so serialization is order-independent (jsonb-safe). */
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    const src = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(src).sort()) out[k] = sortKeys(src[k]);
    return out;
  }
  return value;
}

/**
 * Canonical serialization — the stable byte contract every AuditSink hashes/proves
 * over (ARCHITECTURE §5/§8 guarantee #2: defined once, shared by all sinks).
 * Deterministic: identical logical content → identical bytes, regardless of key order.
 * Excludes the hash columns (prev_hash/entry_hash), the DB-generated pk, and ts
 * (see ARCHITECTURE §5 / UPSTREAM note: ts/pk are out of the hashed content).
 */
export function canonicalSerialize(content: Record<string, unknown>): string {
  return JSON.stringify(sortKeys(content));
}

// ---- Per-kind canonical content builders. Used IDENTICALLY by append and verify,
// so a row read back from the DB hashes to the same value it had when written. ----

export interface IntentContentSource {
  seq: number | string;
  organization_id: string;
  human_actor: unknown;
  via?: unknown;
  session: unknown;
  tool: unknown;
  request_summary?: unknown;
  authz: unknown;
  approval?: unknown;
  dashboard?: unknown;
  environment: unknown;
}
export function intentContent(s: IntentContentSource): Record<string, unknown> {
  return {
    kind: 'intent',
    seq: Number(s.seq),
    organization_id: s.organization_id,
    human_actor: s.human_actor,
    via: s.via ?? null,
    session: s.session,
    tool: s.tool,
    request_summary: s.request_summary ?? null,
    authz: s.authz,
    approval: s.approval ?? null,
    dashboard: s.dashboard ?? null,
    environment: s.environment,
    status: 'intent',
  };
}

export interface ResultContentSource {
  seq: number | string;
  organization_id: string;
  intent_id: string;
  result: unknown;
  status: 'success' | 'error';
}
export function resultContent(s: ResultContentSource): Record<string, unknown> {
  return {
    kind: 'result',
    seq: Number(s.seq),
    organization_id: s.organization_id,
    intent_id: s.intent_id,
    result: s.result,
    status: s.status,
  };
}

export interface ReadContentSource {
  seq: number | string;
  organization_id: string;
  human_actor: unknown;
  session: unknown;
  query_range?: unknown;
  rows_returned?: unknown;
}
export function readContent(s: ReadContentSource): Record<string, unknown> {
  return {
    kind: 'read',
    seq: Number(s.seq),
    organization_id: s.organization_id,
    human_actor: s.human_actor,
    session: s.session,
    query_range: s.query_range ?? null,
    rows_returned: s.rows_returned ?? null,
  };
}
