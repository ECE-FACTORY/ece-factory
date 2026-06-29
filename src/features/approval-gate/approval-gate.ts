// Approval Gate Engine (Module 17) — routes high-risk / STOP_FOR_APPROVAL actions to a human.
//
// CORE GUARANTEE — per-action, never generalized: one captured approval resolves exactly ONE
// specific queued action, bound to that action's UNIQUE id (never shape-derived — two identical-shape
// actions get distinct ids, so approving A can never authorize B). An approval is single-use and
// deny-by-default: no captured APPROVE ⇒ the action stays held. The approver is a real human, never "claude".
//
// STANDALONE-PACKAGEABLE: imports NOTHING from any other engine. The STOP_FOR_APPROVAL signal (Permission
// Engine) and STOP decision (Review Engine) are consumed by mapping them into request() — shown in tests.
// Audit of capture/resolve is emitted through an injected hook (routed to the Audit Engine at composition).

export type ApprovalState = 'held' | 'approved' | 'rejected' | 'expired';
export type ApprovalDecisionType = 'APPROVE' | 'REJECT';

export interface Principal {
  user_id: string;
  email?: string;
  role?: string;
}

export interface ActionDescriptor {
  tool: string;
  scope?: string;
  target?: string;
  before?: unknown;
  after?: unknown;
  risk: string;
  reversible: 'yes' | 'no' | 'soft-only';
  requestedBy: Principal;
  /** Optional approval window (epoch ms). After this, the action expires (not approved). */
  expiresAtMs?: number;
}

export interface ApprovalRecord {
  approvalId: string;
  actionId: string;
  approver: Principal;
  decision: ApprovalDecisionType;
  reason: string;
  atMs: number;
  atIso: string;
}

export interface QueuedApproval {
  actionId: string;
  action: ActionDescriptor;
  state: ApprovalState;
  requestedAtMs: number;
  resolution?: ApprovalRecord;
}

export interface ApprovalDecisionInput {
  actionId: string; // MUST match a specific queued action — the binding identity
  approver: Principal;
  decision: ApprovalDecisionType;
  reason: string;
}

export interface ApprovalResult {
  ok: boolean; // was this a valid, accepted resolution attempt?
  state: ApprovalState; // resulting state of the action
  record?: ApprovalRecord;
  reason?: string; // why denied at the gate level
}

export interface ApprovalAuditEvent {
  type: 'requested' | 'approved' | 'rejected' | 'expired';
  actionId: string;
  tool: string;
  approver?: string;
  reason?: string;
  atIso: string;
}
export interface ApprovalAuditHook {
  record(e: ApprovalAuditEvent): void | Promise<void>;
}

export interface ApprovalGateOptions {
  now?: () => number;
  idgen?: () => string;
  audit?: ApprovalAuditHook;
}

export class ApprovalGate {
  private readonly queue = new Map<string, QueuedApproval>();
  private counter = 0;
  private approvalCounter = 0;
  private readonly now: () => number;
  private readonly idgen: () => string;
  private readonly audit?: ApprovalAuditHook;

  constructor(opts?: ApprovalGateOptions) {
    this.now = opts?.now ?? (() => Date.now());
    this.idgen = opts?.idgen ?? (() => `act_${++this.counter}`);
    this.audit = opts?.audit;
  }

  /** Hold an approval-required action. Returns a UNIQUE actionId (never shape-derived). */
  request(action: ActionDescriptor): QueuedApproval {
    const actionId = this.idgen();
    const q: QueuedApproval = { actionId, action, state: 'held', requestedAtMs: this.now() };
    this.queue.set(actionId, q);
    this.emit('requested', q);
    return q;
  }

  get(actionId: string): QueuedApproval | undefined {
    return this.queue.get(actionId);
  }

  /** Deny-by-default: true ONLY if this specific action has a captured APPROVE. */
  isApproved(actionId: string): boolean {
    return this.queue.get(actionId)?.state === 'approved';
  }

  /** Resolve exactly ONE specific queued action with a single-use, per-action approval. */
  resolve(input: ApprovalDecisionInput): ApprovalResult {
    const q = this.queue.get(input.actionId);
    if (!q) {
      return { ok: false, state: 'held', reason: `no queued action with id "${input.actionId}" — this approval does not match any specific held action` };
    }
    const approverId = input.approver?.user_id?.trim();
    if (!approverId) return { ok: false, state: q.state, reason: 'approver is required (a real human)' };
    if (approverId.toLowerCase() === 'claude') {
      return { ok: false, state: q.state, reason: 'approver may not be "claude" — approval must be a real human' };
    }
    // single-use: only a still-held action can be resolved
    if (q.state !== 'held') {
      return { ok: false, state: q.state, reason: `action already ${q.state} — approval is single-use and cannot resolve it again` };
    }
    // expiry
    if (q.action.expiresAtMs !== undefined && this.now() > q.action.expiresAtMs) {
      q.state = 'expired';
      this.emit('expired', q);
      return { ok: false, state: 'expired', reason: 'approval window expired — not approved' };
    }
    if (!input.reason?.trim()) return { ok: false, state: q.state, reason: 'an approval reason is required' };

    const atMs = this.now();
    const record: ApprovalRecord = {
      approvalId: `apr_${++this.approvalCounter}`,
      actionId: q.actionId,
      approver: input.approver,
      decision: input.decision,
      reason: input.reason,
      atMs,
      atIso: new Date(atMs).toISOString(),
    };
    q.resolution = record;
    q.state = input.decision === 'APPROVE' ? 'approved' : 'rejected';
    this.emit(q.state === 'approved' ? 'approved' : 'rejected', q, record);
    return { ok: true, state: q.state, record };
  }

  private emit(type: ApprovalAuditEvent['type'], q: QueuedApproval, record?: ApprovalRecord): void {
    if (record && record.approver.user_id.trim().toLowerCase() === 'claude') {
      throw new Error('approval actor may not be "claude"');
    }
    const event: ApprovalAuditEvent = {
      type,
      actionId: q.actionId,
      tool: q.action.tool,
      approver: record?.approver.user_id,
      reason: record?.reason,
      atIso: new Date(this.now()).toISOString(),
    };
    void this.audit?.record(event);
  }
}
