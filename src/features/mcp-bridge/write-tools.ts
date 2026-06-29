// Approval-Gated Internal Write Tools (Phase 8.3, APPROVAL_REQUIRED_WRITE class) — the first tools that
// MUTATE internal factory state. INTERNAL ONLY: no git, GitHub, CRM, email, or deploy. Each write executes
// ONLY with a single-use, per-action, human-approved, unforgeable ConsumedApproval token (see tool-classes.ts).
//
// Each tool mutates an append-only/audited internal store via an injected port (Risk Register, review log,
// OPEN_ITEMS, sign-off log, …). The mutation lands as a new snapshot — no silent overwrite — bracketed by
// write-ahead audit (intent before, result after). Registered with the registry's WRITE class (readOrWrite
// 'write', blastRadius 1), which the bridge's 4-class mapping resolves to APPROVAL_REQUIRED_WRITE.

import type { ToolDefinition } from '../tool-registry/tool-registry.js';
import type { ToolRegistrar } from './factory-read-tools.js';

export const WRITE_TOOLS = [
  'record_review_decision', 'record_human_signoff', 'create_open_item',
  'record_approval_gate', 'update_risk_status', 'record_wave_signoff',
] as const;
export type WriteTool = (typeof WRITE_TOOLS)[number];

/** Sign-offs are the highest-authority internal writes — admin-only (per-tool permissioning). */
export const ELEVATED_WRITE_TOOLS: ReadonlySet<WriteTool> = new Set(['record_human_signoff', 'record_wave_signoff']);

export interface WriteParams {
  /** The Approval Gate action id whose single-use, per-action human approval authorizes THIS write. */
  approvalActionId?: string;
  /** Optional target the approval is bound to (e.g. the risk key being transitioned). */
  target?: string;
  /** The mutation payload — also the per-action binding (the approval was granted for exactly this). */
  payload?: Record<string, unknown>;
}

/** A committed write record returned by an append-only store (a new snapshot — never an overwrite). */
export type WriteRecord = Record<string, unknown>;

/**
 * Append-only write ports into internal factory stores. Each appends a new snapshot and returns it. There is
 * no overwrite/delete method — the registries this maps onto are append-only by DB posture.
 */
export interface WriteStores {
  recordReviewDecision(params: WriteParams): Promise<WriteRecord>;
  recordHumanSignoff(params: WriteParams): Promise<WriteRecord>;
  createOpenItem(params: WriteParams): Promise<WriteRecord>;
  recordApprovalGate(params: WriteParams): Promise<WriteRecord>;
  updateRiskStatus(params: WriteParams): Promise<WriteRecord>;
  recordWaveSignoff(params: WriteParams): Promise<WriteRecord>;
}

function writeDef(name: WriteTool, purpose: string, requiredRole: string): ToolDefinition {
  return {
    name,
    purpose,
    readOrWrite: 'write', // → APPROVAL_REQUIRED_WRITE in the bridge's 4-class taxonomy
    classification: 'WRITE_LOW_RISK',
    permissionLevel: 'write',
    requiredRole,
    // The single-use ConsumedApproval token is the approval mechanism (per-action, enforced at dispatch);
    // the registry-level approvalRequired STOP is not used here so the token path is the one gate.
    approvalRequired: false,
    serverSideRedaction: true,
    auditBehavior: 'write-ahead audited mutation (intent before, result after)',
    instructionBoundaryNotes: 'payload is inert data; the write requires a human-approved per-action token',
    blastRadius: 1, // single-record write (registry invariant for write tools)
    reversible: 'soft-only', // append-only snapshots — superseded, never hard-overwritten
    idempotent: false,
    environments: ['local', 'staging', 'production'],
    owner: 'ECE',
    status: 'enabled',
  };
}

/** Register the 6 APPROVAL_REQUIRED_WRITE internal tools. Sign-offs are admin-only. Idempotent per tool. */
export function registerWriteTools(registry: ToolRegistrar): void {
  const defs: ToolDefinition[] = [
    writeDef('record_review_decision', 'Append a review decision to the review log (PASS/FAIL/REVISE/STOP).', 'operator'),
    writeDef('record_human_signoff', 'Record a human sign-off on a gate.', 'admin'),
    writeDef('create_open_item', 'Append a new open item to the open-items register.', 'operator'),
    writeDef('record_approval_gate', 'Record an approval-gate outcome.', 'operator'),
    writeDef('update_risk_status', 'Append a risk status transition (Risk Register append-only snapshot).', 'operator'),
    writeDef('record_wave_signoff', 'Record a wave-boundary sign-off.', 'admin'),
  ];
  for (const def of defs) {
    if (!registry.has(def.name)) registry.register(def);
  }
}
