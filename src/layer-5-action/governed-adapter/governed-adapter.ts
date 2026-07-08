// Layer-5 GOVERNED ADAPTER — the CONTRACT every Layer-5 write adapter must satisfy.
//
// SOVEREIGN-ADAPTER DOCTRINE (see governed-adapter.feature.md): the AUTHORITY is the ApprovalGate, never a
// connector. An MCP bridge (or any transport) is an OPTIONAL connector; remove it and the adapter is still
// sovereign — the gate, the audit, and the intent-binding live HERE, not in the transport. This contract is
// where the shared write-governance is defined ONCE and reused by every concrete adapter (GitHub is the first).
//
// SAFETY BY CONSTRUCTION (identical guarantees for every adapter that implements this contract):
//   • The write-capable call `shapePlan(intent, approval: ConsumedApproval, …)` is typed to REQUIRE the real
//     branded `ConsumedApproval` (src/layer-5-action/mcp-bridge/tool-classes.ts:100-104). Its mint
//     `mintConsumedApproval` (tool-classes.ts:105) is MODULE-PRIVATE to the bridge — nothing here can construct
//     a token. So plan-shaping is type-level UNREACHABLE without a genuine, dispatcher-minted approval.
//   • The ONLY way a token exists is the REAL ClassDispatcher (tool-classes.ts:135) consuming a still-held,
//     human-APPROVED, per-action-BOUND approval via the REAL BridgeApprovalGate (tool-classes.ts:67), which
//     rejects self-approval and any "claude" approver (tool-classes.ts:87). We mint NOTHING; we consume the gate.
//   • No token ⇒ the dispatcher yields STOP_FOR_APPROVAL and no plan is produced (deny-by-default). Audit the refusal.
//   • The audit intent is AWAITED before the plan is built — a failed audit yields NO plan (audit-before-plan).
//   • The approval is BOUND to the specific intent: `boundIntentHash` is a stable fingerprint of the exact
//     (tool, target, payload) the human approved; the gate independently enforces that same binding at consume.
//   • DRY-RUN ONLY: `planWrite` returns an inert PLANNED-WRITE descriptor (dryRun/plannedOnly). There is NO
//     execute(), NO mutating fetch, NO executor anywhere in this contract. The real executor is a separate,
//     later, human-approved build.
//   • The adapter holds only an ABSTRACT scoped-credential REFERENCE (never a secret) — unused in dry-run, and
//     never logged or emitted.

import {
  BridgeApprovalGate,
  ClassDispatcher,
  canonicalPayload,
  type ConsumedApproval,
  type ApprovalGateReader,
  type ApprovalBinding,
} from '../mcp-bridge/tool-classes.js';

// Re-export the real gate types so concrete adapters depend on THIS contract, not on the transport module.
export { canonicalPayload };
export type { ConsumedApproval, ApprovalGateReader, ApprovalBinding };

/**
 * An abstract, scoped credential REFERENCE — a handle plus its scopes, NEVER the secret itself. Unused during
 * dry-run planning; carried so a later, separate, human-approved executor can resolve it. Never logged/emitted.
 */
export interface ScopedCredentialRef {
  readonly ref: string;
  readonly scopes: readonly string[];
}

/** The inert PLANNED-WRITE base every adapter's descriptor extends. There is no execution — this is data. */
export interface PlannedWrite {
  readonly dryRun: true;
  readonly plannedOnly: true;
  /** Stable fingerprint of the exact intent the approval was bound to (audit + human inspection). */
  readonly boundIntentHash: string;
  /** The single-use approval this plan is bound to (id only — never a secret). */
  readonly boundToApprovalId: string;
  readonly note: string;
}

export const PLANNED_ONLY_NOTE =
  'PLANNED ONLY — not executed. No real external write exists in this build; the real executor is a separate, ' +
  'later, human-approved build.';

// ── The reusable INTENT-BINDING primitive (GitHub-agnostic) ─────────────────────────────────────────────
/** Canonical string form of the exact action an approval is bound to: (tool, target, payload). */
export function canonicalBinding(b: ApprovalBinding): string {
  return JSON.stringify([b.tool, b.target ?? '', b.payloadJson ?? canonicalPayload(undefined)]);
}
/**
 * A stable, dependency-free fingerprint (FNV-1a/32) of the bound intent. This is the reusable primitive: the
 * approval is bound to THIS intent. ENFORCEMENT of the binding is the ApprovalGate's per-action check
 * (tool-classes.ts:88-90) at consume time; this hash is the provable fingerprint we record in the audit and
 * surface in the plan, so a human can confirm the plan matches exactly what was approved.
 */
export function boundIntentHash(b: ApprovalBinding): string {
  const s = canonicalBinding(b);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

// ── Write-ahead audit seam (the real Audit Engine attaches here at composition) ─────────────────────────
// A minimal, DB-free subset of the Audit Engine's AuditSink (factory-shared/audit-engine/sink.ts): append an
// INTENT before acting, a RESULT after, or a REFUSAL when denied. No hash-chain/Postgres is pulled in here.
export interface HumanActorLite {
  readonly user_id: string;
  readonly email?: string;
  readonly role?: string;
}
export interface GovernedAuditIntent {
  readonly tool: string;
  readonly organization_id: string;
  readonly human_actor: HumanActorLite;
  readonly approval: { required: true; captured: true; approved_by?: string };
  readonly authz: { decision: 'ALLOW'; reason: string };
  readonly request_summary: Record<string, unknown>;
  readonly environment: 'local' | 'staging' | 'production';
  readonly dryRun: true;
}
export interface GovernedAuditResult {
  readonly tool: string;
  readonly organization_id: string;
  readonly status: 'success';
  readonly dryRun: true;
  readonly plannedOnly: true;
}
export interface GovernedAuditRefusal {
  readonly tool: string;
  readonly organization_id: string;
  readonly human_actor: HumanActorLite;
  readonly stage: string;
  readonly decision: 'STOP_FOR_APPROVAL' | 'REFUSE';
  readonly reason: string;
  readonly environment: 'local' | 'staging' | 'production';
}
export interface GovernedAuditRecorder {
  appendIntent(entry: GovernedAuditIntent): Promise<void> | void;
  appendResult(entry: GovernedAuditResult): Promise<void> | void;
  appendRefusal(entry: GovernedAuditRefusal): Promise<void> | void;
}

// ── The governed-write chain (dry-run) ──────────────────────────────────────────────────────────────────
export interface GovernedWriteContext<I> {
  readonly intent: I;
  /** The Approval Gate action id whose single-use human approval authorizes THIS plan. */
  readonly approvalActionId: string;
  /** The REAL Approval Gate engine (structural read). We consume it; we never mint into it. */
  readonly gate: ApprovalGateReader;
  /** The requesting agent id — the BridgeApprovalGate rejects it as a self-approver. */
  readonly caller: string;
  readonly audit: GovernedAuditRecorder;
  /** The human on whose behalf this runs — attributed in the audit. Never "claude". */
  readonly human: HumanActorLite;
  readonly organizationId: string;
  readonly environment: 'local' | 'staging' | 'production';
}

export type GovernedWriteResult<P extends PlannedWrite> =
  | { readonly ok: true; readonly status: 'planned-only'; readonly planned: P; readonly approvalId: string; readonly approvedBy: string; readonly boundIntentHash: string }
  | { readonly ok: false; readonly status: 'STOP_FOR_APPROVAL' | 'refused'; readonly reason: string; readonly planned: null };

/**
 * The CONTRACT. A concrete adapter supplies only two GitHub-agnostic-shaped hooks:
 *   • `intentBinding(intent)` — reduce an intent to the (tool, target, payload) the approval must be bound to.
 *   • `shapePlan(intent, approval, boundIntentHash)` — the type-gated, INERT plan shaping (adapter-specific).
 * The shared write-governance (gate, fail-closed, write-ahead audit, attribution, intent-binding) lives HERE
 * and is NOT re-implemented per adapter.
 */
export abstract class GovernedAdapter<I, P extends PlannedWrite> {
  constructor(protected readonly credential: ScopedCredentialRef) {}

  /** Adapter-specific: the exact (tool, target, payload) an approval must be bound to for this intent. */
  abstract intentBinding(intent: I): ApprovalBinding;

  /**
   * Adapter-specific, TYPE-GATED write-capable call: shape the inert planned-write. It CANNOT be invoked without
   * a real `ConsumedApproval`. It performs NO I/O — it returns data only.
   */
  protected abstract shapePlan(intent: I, approval: ConsumedApproval, boundIntentHash: string): P;

  /** The reusable intent-binding fingerprint for an intent (audit + inspection). */
  intentHash(intent: I): string {
    return boundIntentHash(this.intentBinding(intent));
  }

  /**
   * Run the governed dry-run chain: dispatch APPROVAL_REQUIRED_WRITE through the REAL dispatcher (no token ⇒
   * STOP_FOR_APPROVAL); on approval WRITE-AHEAD AUDIT the intent BEFORE shaping the inert plan; return the plan
   * for human inspection. No real action ever happens.
   */
  async planWrite(ctx: GovernedWriteContext<I>): Promise<GovernedWriteResult<P>> {
    const binding = this.intentBinding(ctx.intent);
    const tool = binding.tool;
    const intentHash = boundIntentHash(binding);
    // Attribution comes from what the REAL gate recorded — the human who actually approved this action id.
    const approvedBy = ctx.gate.get(ctx.approvalActionId)?.resolution?.approver?.user_id;

    const bridge = new BridgeApprovalGate(ctx.gate, ctx.caller); // single-use + per-action + no self-approval
    const dispatcher = new ClassDispatcher(bridge);

    let outcome:
      | Awaited<ReturnType<ClassDispatcher['dispatch']>>
      | { status: 'audit-failed'; reason: string };
    try {
      outcome = await dispatcher.dispatch<never, never, P>(
        'APPROVAL_REQUIRED_WRITE',
        {
          // Reachable ONLY with a genuine ConsumedApproval the dispatcher minted after consuming the human's
          // still-held per-action approval. We do not (and cannot) mint one ourselves.
          approvalWrite: async (approval): Promise<P> => {
            // WRITE-AHEAD AUDIT: recorded and AWAITED before the plan exists. If this throws, no plan is produced.
            await ctx.audit.appendIntent({
              tool,
              organization_id: ctx.organizationId,
              human_actor: ctx.human,
              approval: { required: true, captured: true, approved_by: approvedBy },
              authz: { decision: 'ALLOW', reason: 'single-use, per-action, human-approved ConsumedApproval consumed' },
              request_summary: { target: binding.target, boundIntentHash: intentHash },
              environment: ctx.environment,
              dryRun: true,
            });
            // Only AFTER the audit is durable do we shape the inert plan.
            return this.shapePlan(ctx.intent, approval, intentHash);
          },
        },
        { approvalActionId: ctx.approvalActionId, approvalBinding: binding, tool },
      );
    } catch (err) {
      // The plan is produced ONLY after a successful write-ahead audit. A thrown audit ⇒ no plan is returned;
      // audit-before-plan is a hard precondition, not a best-effort log.
      outcome = { status: 'audit-failed', reason: err instanceof Error ? err.message : String(err) };
    }

    if (outcome.status === 'executed') {
      await ctx.audit.appendResult({ tool, organization_id: ctx.organizationId, status: 'success', dryRun: true, plannedOnly: true });
      return {
        ok: true,
        status: 'planned-only',
        planned: outcome.result as P,
        approvalId: outcome.approvalId,
        approvedBy: approvedBy ?? '',
        boundIntentHash: intentHash,
      };
    }

    // FAIL CLOSED — no valid single-use approval (or the write-ahead audit failed) ⇒ NO plan produced. Audit it.
    const reason =
      'reason' in outcome && typeof outcome.reason === 'string'
        ? outcome.reason
        : 'execution withheld (deny-by-default)';
    const status: 'STOP_FOR_APPROVAL' | 'refused' = outcome.status === 'refused' ? 'refused' : 'STOP_FOR_APPROVAL';
    await ctx.audit.appendRefusal({
      tool,
      organization_id: ctx.organizationId,
      human_actor: ctx.human,
      stage: 'governed-adapter',
      decision: status === 'refused' ? 'REFUSE' : 'STOP_FOR_APPROVAL',
      reason,
      environment: ctx.environment,
    });
    return { ok: false, status, reason, planned: null };
  }
}
