// Decision Console (Wave 6, Piece 1) — the human-approval SEAT the gate has always required but never had.
//
// THE CORE PROPERTY (the whole point): when a consequential action hits STOP_FOR_APPROVAL it becomes a
// PENDING item in this queue. A real, identified human operator views the queue and APPROVES or REFUSES.
// APPROVE mints EXACTLY the gate's existing single-use, per-action, unforgeable, human-attributed approval —
// by calling the Approval Gate's own request/resolve (NOT a new/parallel mechanism). The action then still
// runs the FULL UNCHANGED Phase 8.4 gauntlet, which consumes that approval. This is the legitimate SOURCE of
// the approval the gate already requires — it is NOT a bypass and it touches NO guard.
//
// SEPARATION OF DUTIES is enforced at the seat: the approver must be a real human — never 'claude', never the
// proposing caller, never the action's requester, never anonymous. (The bridge's BridgeApprovalGate enforces
// approver≠caller again at consume — defense in depth.)
//
// STANDALONE-PACKAGEABLE: imports NOTHING at runtime from any other engine — the Approval Gate is injected as
// a narrow port (`ConsoleApprovalQueue`), the audit as a sink. Cross-engine references are `import type` only.

import type { ActionDescriptor, Principal, QueuedApproval, ApprovalResult } from '../../layer-1-law/approval-gate/approval-gate.js';

/** Metadata the Console shows for a real decision — NOT part of the approval binding; the approver is separate. */
export interface EnqueueMeta {
  /** The tool's tier, e.g. 'APPROVAL_REQUIRED_WRITE (external)'. */
  tier: string;
  /** Blast radius — how many external targets one approval authorizes (the gate enforces 1). */
  blastRadius: number;
  /** Who PROPOSED the action (the AI conduit / autopilot / caller). NEVER allowed to be the approver. */
  proposingCaller: string;
}

/** What the operator sees per pending item — enough for a real decision; `descriptor` is the exact bound target/effect. */
export interface PendingItem {
  actionId: string;
  tool: string;
  target?: string;
  effect?: string;
  descriptor: ActionDescriptor;
  tier: string;
  blastRadius: number;
  reversibility: ActionDescriptor['reversible'];
  proposingCaller: string;
  requestedAtIso: string;
}

export type ConsoleDecisionOutcome =
  | { status: 'APPROVED'; actionId: string; approvalId: string; approver: string }
  | { status: 'REFUSED'; actionId: string; approver: string }
  | { status: 'rejected'; reason: string }; // the SEAT rejected the operation (bad/absent identity, unknown item, gate said no)

export interface ConsoleAuditEvent {
  type: 'enqueued' | 'approved' | 'refused' | 'resolve-rejected';
  actionId: string;
  tool: string;
  operator?: string;        // the approver (approve/refuse) — the real human, attributed
  proposingCaller?: string;
  reason?: string;
  atIso: string;
}

/** Append-only audit sink for Console queue transitions. In-memory here; routable to the Audit Engine at composition. */
export interface ConsoleAuditSink {
  append(e: ConsoleAuditEvent): void | Promise<void>;
}

/** Append-only in-memory audit — entries are only ever appended; reads return a copy (never mutated). */
export class InMemoryConsoleAudit implements ConsoleAuditSink {
  private readonly log: ConsoleAuditEvent[] = [];
  append(e: ConsoleAuditEvent): void { this.log.push(e); }
  entries(): readonly ConsoleAuditEvent[] { return this.log.slice(); }
}

/**
 * The narrow port over the Approval Gate ENGINE (Module 17) — the Console depends only on this. `ApprovalGate`
 * satisfies it structurally. The Console mints approvals ONLY through `request`/`resolve` here — i.e. through
 * the gate's own single-use, per-action, human-attributed mechanism. There is no other approval path.
 */
export interface ConsoleApprovalQueue {
  request(action: ActionDescriptor): QueuedApproval;
  get(actionId: string): QueuedApproval | undefined;
  resolve(input: { actionId: string; approver: Principal; decision: 'APPROVE' | 'REJECT'; reason: string }): ApprovalResult;
}

export class DecisionConsole {
  private readonly meta = new Map<string, EnqueueMeta>();
  private readonly order: string[] = []; // enqueue order, for a stable queue view

  constructor(
    private readonly queue: ConsoleApprovalQueue,
    private readonly audit: ConsoleAuditSink,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /**
   * Enqueue a STOP_FOR_APPROVAL action as a pending item. This calls the gate's OWN `request` — the item is a
   * genuine held Approval-Gate action, not a shadow copy. Returns its actionId (the approval binding identity).
   */
  enqueue(descriptor: ActionDescriptor, meta: EnqueueMeta): string {
    const q = this.queue.request(descriptor);
    this.meta.set(q.actionId, meta);
    this.order.push(q.actionId);
    void this.audit.append({ type: 'enqueued', actionId: q.actionId, tool: descriptor.tool, proposingCaller: meta.proposingCaller, atIso: this.iso() });
    return q.actionId;
  }

  /** The pending queue — items still HELD (awaiting a human). Each carries its exact bound descriptor. */
  listPending(): PendingItem[] {
    const items: PendingItem[] = [];
    for (const actionId of this.order) {
      const q = this.queue.get(actionId);
      const m = this.meta.get(actionId);
      if (!q || !m || q.state !== 'held') continue;
      items.push(this.toItem(q, m));
    }
    return items;
  }

  get(actionId: string): PendingItem | undefined {
    const q = this.queue.get(actionId);
    const m = this.meta.get(actionId);
    return q && m ? this.toItem(q, m) : undefined;
  }

  /** APPROVE — mint the gate's real single-use, per-action, human-attributed approval, attributed to `operator`. */
  approve(actionId: string, operator: Principal, reason: string): ConsoleDecisionOutcome {
    return this.decide(actionId, operator, reason, 'APPROVE');
  }

  /** REFUSE — record the refusal; no token is minted, the action never commits. */
  refuse(actionId: string, operator: Principal, reason: string): ConsoleDecisionOutcome {
    return this.decide(actionId, operator, reason, 'REJECT');
  }

  private decide(actionId: string, operator: Principal | undefined, reason: string, decision: 'APPROVE' | 'REJECT'): ConsoleDecisionOutcome {
    const q = this.queue.get(actionId);
    const m = this.meta.get(actionId);
    if (!q || !m) return this.reject(actionId, '(unknown)', `no pending item "${actionId}"`);
    const tool = q.action.tool;

    // ── OPERATOR IDENTITY IS REAL — no anonymous, no AI, no self-approval (separation of duties) ──
    const op = operator?.user_id?.trim();
    if (!op) return this.reject(actionId, tool, 'operator identity is required — anonymous approval is refused');
    const opLc = op.toLowerCase();
    if (opLc === 'claude') return this.reject(actionId, tool, 'the AI ("claude") cannot approve — a real human operator is required');
    if (opLc === m.proposingCaller.trim().toLowerCase()) return this.reject(actionId, tool, 'separation of duties — the proposing caller cannot approve its own action');
    if (opLc === q.action.requestedBy.user_id.trim().toLowerCase()) return this.reject(actionId, tool, 'separation of duties — the requester cannot approve its own action');
    if (!reason?.trim()) return this.reject(actionId, tool, 'a decision reason is required');

    // Mint/record through the gate's OWN resolve — the SAME single-use token the 8.4 gauntlet consumes.
    const res = this.queue.resolve({ actionId, approver: operator!, decision, reason });
    if (!res.ok || !res.record) return this.reject(actionId, tool, res.reason ?? 'the approval gate rejected the resolution');

    if (decision === 'APPROVE') {
      void this.audit.append({ type: 'approved', actionId, tool, operator: op, proposingCaller: m.proposingCaller, reason, atIso: this.iso() });
      return { status: 'APPROVED', actionId, approvalId: res.record.approvalId, approver: op };
    }
    void this.audit.append({ type: 'refused', actionId, tool, operator: op, proposingCaller: m.proposingCaller, reason, atIso: this.iso() });
    return { status: 'REFUSED', actionId, approver: op };
  }

  private reject(actionId: string, tool: string, reason: string): ConsoleDecisionOutcome {
    void this.audit.append({ type: 'resolve-rejected', actionId, tool, reason, atIso: this.iso() });
    return { status: 'rejected', reason };
  }

  private toItem(q: QueuedApproval, m: EnqueueMeta): PendingItem {
    return {
      actionId: q.actionId,
      tool: q.action.tool,
      target: q.action.target,
      effect: effectOf(q.action),
      descriptor: q.action,
      tier: m.tier,
      blastRadius: m.blastRadius,
      reversibility: q.action.reversible,
      proposingCaller: m.proposingCaller,
      requestedAtIso: new Date(q.requestedAtMs).toISOString(),
    };
  }

  private iso(): string { return new Date(this.now()).toISOString(); }
}

/** Best-effort human-readable effect from the bound descriptor (the `after` carries system/effect for externals). */
function effectOf(action: ActionDescriptor): string | undefined {
  const after = action.after as { effect?: unknown } | undefined;
  if (after && typeof after === 'object' && typeof after.effect === 'string') return after.effect;
  return undefined;
}
