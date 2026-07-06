// Tool classification taxonomy (Phase 8.1) — the STRUCTURAL, dispatch-by-class spine of the MCP Bridge.
//
// Exactly four classes. Each class's limit is unrepresentable to violate (type + dispatch), the same way
// Phase 8.0's read-only was enforced at type + surface + DB-privilege:
//
//   READ_ONLY                — returns data; there is NO write/commit variant in its outcome.
//   DRAFT_ONLY               — success is the literal 'DRAFT-AWAITING-HUMAN-REVIEW'; NO committed/executed/
//                              approved variant exists. It cannot mutate state or write files.
//   APPROVAL_REQUIRED_WRITE  — execute is reachable ONLY with a single-use, branded ConsumedApproval token
//                              that only this module can mint (and only after the Approval Gate confirms a
//                              still-held, human-approved action). No token ⇒ STOP_FOR_APPROVAL; there is
//                              no execute path absent the token.
//   FORBIDDEN                — never callable; always refused. No success variant of any kind.
//
// DISPATCH-BY-CLASS: `dispatch(class, handlers)` invokes ONLY the handler for the tool's registered class.
// A lower-privilege class can never reach a higher-privilege path — the router selects by class, and the
// write path additionally requires the branded token, so selecting it without approval yields nothing.

export const TOOL_CLASSES = ['READ_ONLY', 'DRAFT_ONLY', 'APPROVAL_REQUIRED_WRITE', 'FORBIDDEN'] as const;
export type ToolClass = (typeof TOOL_CLASSES)[number];

/** The draft success literal. There is deliberately no committed/executed/approved sibling. */
export const DRAFT_STATUS = 'DRAFT-AWAITING-HUMAN-REVIEW';

/** The specific action an approval is bound to — tool + optional target + a canonical payload string. */
export interface ApprovalBinding {
  tool: string;
  target?: string;
  payloadJson?: string;
}
export interface ApprovalConsumption {
  approvalId: string;
}

/**
 * Port the dispatcher/bridge consult for APPROVAL_REQUIRED_WRITE. The approval is the entire safety:
 * single-use, per-action-bound, human-granted, unforgeable. Implementations MUST be single-use (a second
 * consume for the same action returns null) and per-action-bound (a token for action A returns null for B).
 */
export interface ApprovalGatePort {
  /** Non-consuming deny-by-default check: is this specific action humanly approved and not yet consumed? */
  isApprovedForAction(actionId: string, binding: ApprovalBinding): boolean;
  /** Single-use consume: returns a consumption iff approved+bound+unconsumed; marks it consumed; else null. */
  consumeApproval(actionId: string, binding: ApprovalBinding): ApprovalConsumption | null;
}

/** Minimal read shape over the Approval Gate engine (structural — no engine import). */
export interface ApprovalGateReader {
  get(actionId: string): {
    state: string;
    action: { tool: string; target?: string; after?: unknown };
    resolution?: { approvalId: string; approver: { user_id: string } };
  } | undefined;
}

/** Stable canonical string for an action payload, used for per-action binding without a crypto dep. */
export function canonicalPayload(payload: unknown): string {
  return JSON.stringify(payload ?? null);
}

/**
 * Bridge-layer adapter over the Wave-2 Approval Gate (engine untouched). Adds the three write-tier
 * guarantees the dispatcher needs: SINGLE-USE (a consumed action cannot be replayed), PER-ACTION BINDING
 * (tool+target+payload must match the approved descriptor), and SELF-APPROVAL REJECTION (the approver must
 * be a real human, never "claude" or the calling agent).
 */
export class BridgeApprovalGate implements ApprovalGatePort {
  private readonly consumed = new Set<string>();
  constructor(private readonly gate: ApprovalGateReader, private readonly caller?: string) {}

  isApprovedForAction(actionId: string, binding: ApprovalBinding): boolean {
    return this.check(actionId, binding) !== null;
  }

  consumeApproval(actionId: string, binding: ApprovalBinding): ApprovalConsumption | null {
    const ok = this.check(actionId, binding);
    if (!ok) return null;
    this.consumed.add(actionId); // SINGLE-USE: consumed on use; a replay fails the consumed-set check below
    return { approvalId: ok.approvalId };
  }

  private check(actionId: string | undefined, binding: ApprovalBinding): { approvalId: string } | null {
    if (!actionId || this.consumed.has(actionId)) return null; // single-use
    const q = this.gate.get(actionId);
    if (!q || q.state !== 'approved' || !q.resolution) return null; // deny-by-default: must be a captured APPROVE
    const approver = q.resolution.approver.user_id.trim().toLowerCase();
    if (approver === 'claude' || (this.caller && approver === this.caller.trim().toLowerCase())) return null; // no self-approval
    if (q.action.tool !== binding.tool) return null; // per-action: tool
    if ((q.action.target ?? '') !== (binding.target ?? '')) return null; // per-action: target
    if (canonicalPayload(q.action.after) !== (binding.payloadJson ?? canonicalPayload(undefined))) return null; // per-action: payload
    return { approvalId: q.resolution.approvalId };
  }
}

// ── Branded single-use approval token (structural no-execute-without-approval) ───────────────────────
// Only `mintConsumedApproval` (module-private) can produce one. The symbol key is not exported, so no
// code outside this module can construct a ConsumedApproval — hence a write handler typed to require one
// is unreachable except through this dispatcher after an approval check.
const APPROVAL_BRAND: unique symbol = Symbol('consumedApproval');
export interface ConsumedApproval {
  readonly approvalId: string;
  readonly tool: string;
  readonly [APPROVAL_BRAND]: true;
}
function mintConsumedApproval(approvalId: string, tool: string): ConsumedApproval {
  return { approvalId, tool, [APPROVAL_BRAND]: true };
}

// ── Per-class handlers and outcomes ──────────────────────────────────────────────────────────────────
export interface ClassHandlers<R, D, W> {
  /** READ_ONLY: produce data. */
  readOnly?: () => Promise<R>;
  /** DRAFT_ONLY: produce a draft. It is wrapped in the draft literal — it cannot be committed. */
  draftOnly?: () => Promise<D>;
  /** APPROVAL_REQUIRED_WRITE: execute. UNCALLABLE without a ConsumedApproval, which only this dispatcher mints. */
  approvalWrite?: (approval: ConsumedApproval) => Promise<W>;
  // FORBIDDEN has no handler slot — there is nothing to run.
}

export type ClassDispatchOutcome<R, D, W> =
  | { status: 'ok'; toolClass: 'READ_ONLY'; data: R }
  | { status: typeof DRAFT_STATUS; toolClass: 'DRAFT_ONLY'; draft: D }
  | { status: 'executed'; toolClass: 'APPROVAL_REQUIRED_WRITE'; result: W; approvalId: string }
  | { status: 'STOP_FOR_APPROVAL'; toolClass: 'APPROVAL_REQUIRED_WRITE'; reason: string }
  | { status: 'refused'; toolClass: ToolClass; stage: string; reason: string };

export interface DispatchContext {
  /** Required only for APPROVAL_REQUIRED_WRITE — the specific Approval Gate action id to consume. */
  approvalActionId?: string;
  /** The action binding the token must match (per-action). */
  approvalBinding?: ApprovalBinding;
  tool?: string;
}

export class ClassDispatcher {
  constructor(private readonly approval?: ApprovalGatePort) {}

  /**
   * Route a call to ONLY its class's execution path. The class is the dispatch key; no lower class can
   * reach a higher-privilege path because the router never offers it one.
   */
  async dispatch<R, D, W>(
    toolClass: ToolClass,
    handlers: ClassHandlers<R, D, W>,
    ctx: DispatchContext = {},
  ): Promise<ClassDispatchOutcome<R, D, W>> {
    switch (toolClass) {
      case 'READ_ONLY': {
        if (!handlers.readOnly) return refuse('READ_ONLY', 'dispatch', 'no read handler for a READ_ONLY tool');
        return { status: 'ok', toolClass: 'READ_ONLY', data: await handlers.readOnly() };
      }
      case 'DRAFT_ONLY': {
        if (!handlers.draftOnly) return refuse('DRAFT_ONLY', 'dispatch', 'no draft handler for a DRAFT_ONLY tool');
        // Structurally cannot commit: only a draft literal is ever produced — there is no committed branch.
        return { status: DRAFT_STATUS, toolClass: 'DRAFT_ONLY', draft: await handlers.draftOnly() };
      }
      case 'APPROVAL_REQUIRED_WRITE': {
        if (!handlers.approvalWrite) return refuse('APPROVAL_REQUIRED_WRITE', 'dispatch', 'no write handler');
        const approval = this.consume(ctx);
        if (!approval) {
          // No single-use token ⇒ execution is withheld; there is no execute path here.
          return { status: 'STOP_FOR_APPROVAL', toolClass: 'APPROVAL_REQUIRED_WRITE', reason: 'no single-use approval token — execution withheld (deny-by-default)' };
        }
        const result = await handlers.approvalWrite(approval);
        return { status: 'executed', toolClass: 'APPROVAL_REQUIRED_WRITE', result, approvalId: approval.approvalId };
      }
      case 'FORBIDDEN':
      default:
        return refuse('FORBIDDEN', 'forbidden', 'tool is FORBIDDEN — never callable');
    }
  }

  private consume(ctx: DispatchContext): ConsumedApproval | null {
    if (!ctx.approvalActionId || !this.approval) return null;
    const binding = ctx.approvalBinding ?? { tool: ctx.tool ?? '' };
    const c = this.approval.consumeApproval(ctx.approvalActionId, binding); // single-use + per-action (adapter)
    if (!c) return null;
    return mintConsumedApproval(c.approvalId, binding.tool);
  }
}

function refuse<R, D, W>(toolClass: ToolClass, stage: string, reason: string): ClassDispatchOutcome<R, D, W> {
  return { status: 'refused', toolClass, stage, reason };
}
