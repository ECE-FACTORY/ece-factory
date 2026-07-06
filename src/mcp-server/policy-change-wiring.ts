// Policy-change-as-gated-write (Wave 6, Piece 3). Changing the policy set is itself a consequential action that
// goes through the EXISTING gate/Console approval — NOT a new mechanism, NOT dual-approval:
//   propose (conduit) → an append-only CANDIDATE version + a pending item in the SAME Console queue (STOP) →
//   a single real operator APPROVES (mints the gate's own single-use, human-attributed token) → apply activates
//   the candidate + records an append-only, audited transition. Until approved, the candidate is INERT.
//
// It CANNOT weaken the guard stack: `apply` touches only the PolicyStore (PolicySet config) — it holds no
// reference to audit/redaction/kill/approval-config/sole-authority/FORBIDDEN. The AI can never approve (the
// gate + Console already bar 'claude'/the proposing caller; `apply` re-checks the approver defensively).

import type { PolicyStore, PolicyTransition } from '../layer-1-law/policy-engine/policy-store.js';
import type { PolicyRule } from '../layer-1-law/policy-engine/policy-engine.js';
import type { ActionDescriptor } from '../layer-1-law/approval-gate/approval-gate.js';
import type { EnqueueMeta } from '../layer-2-command/decision-console/decision-console.js';
import type { AuditSink } from '../factory-shared/audit-engine/sink.js';
import type { HumanActor, SessionInfo, Environment } from '../factory-shared/audit-engine/schema.js';

export const POLICY_CHANGE_TOOL = 'apply_policy_version';

/** The Console enqueue seam the service uses (DecisionConsole satisfies it) — it can ONLY enqueue a pending item. */
export interface PolicyChangeConsole {
  enqueue(descriptor: ActionDescriptor, meta: EnqueueMeta): string;
}
/** Read-only view of the approval gate — the service reads the human approval; it cannot mint or approve. */
export interface ApprovalReader {
  get(actionId: string): { state: string; resolution?: { approver: { user_id: string } } } | undefined;
}

// ── audit (append-only, Postgres, operator-attributed) ───────────────────────────────────────────────────
export interface PolicyChangeAuditEvent {
  type: 'version-proposed' | 'version-activated';
  candidateVersion: number;
  fromVersion?: number;
  approvedBy?: string;
  ruleCount: number;
  atIso: string;
}
export interface PolicyChangeAuditSink { append(e: PolicyChangeAuditEvent): void | Promise<void>; }

export class InMemoryPolicyChangeAudit implements PolicyChangeAuditSink {
  private readonly log: PolicyChangeAuditEvent[] = [];
  append(e: PolicyChangeAuditEvent): void { this.log.push(e); }
  entries(): readonly PolicyChangeAuditEvent[] { return this.log.slice(); }
}

export class PostgresPolicyChangeAudit implements PolicyChangeAuditSink {
  constructor(
    private readonly sink: Pick<AuditSink, 'appendRead'>,
    private readonly organizationId: string,
    private readonly environment: Environment = 'local',
    private readonly session: SessionInfo = { session_id: 'policy-change' },
  ) {}
  async append(e: PolicyChangeAuditEvent): Promise<void> {
    const who = e.approvedBy && e.approvedBy.trim() ? e.approvedBy : 'policy-change';
    const actor: HumanActor = { user_id: who, email: '', role: who === 'policy-change' ? 'service' : 'operator' };
    try {
      await this.sink.appendRead({
        organization_id: this.organizationId, human_actor: actor, session: this.session,
        query_range: { policyChangeEvent: e.type, candidateVersion: e.candidateVersion, fromVersion: e.fromVersion ?? null, approvedBy: e.approvedBy ?? null, ruleCount: e.ruleCount, atIso: e.atIso, environment: this.environment },
        rows_returned: 0,
      });
    } catch (err) {
      process.stderr.write(`[policy-change audit] failed to persist ${e.type} v${e.candidateVersion}: ${err instanceof Error ? err.message : String(err)}\n`);
    }
  }
}

// ── the service ──────────────────────────────────────────────────────────────────────────────────────────
export class PolicyChangeService {
  private readonly pending = new Map<string, number>(); // pendingActionId → candidate version

  constructor(
    private readonly store: PolicyStore,
    private readonly console: PolicyChangeConsole,
    private readonly gate: ApprovalReader,
    private readonly audit: PolicyChangeAuditSink = new InMemoryPolicyChangeAudit(),
    private readonly now: () => number = () => Date.now(),
  ) {}

  /**
   * Propose a policy change (a full new ruleset). Creates an append-only candidate version and enqueues a
   * gated pending item into the SAME Console queue. The candidate is INERT — the active policy is unchanged
   * and evaluations keep using the current version until a human approves.
   */
  propose(newRules: readonly PolicyRule[], proposer: string): { pendingActionId: string; candidateVersion: number } {
    const candidateVersion = this.store.proposeVersion(newRules);
    const descriptor: ActionDescriptor = {
      tool: POLICY_CHANGE_TOOL,
      target: `policy@v${candidateVersion}`,
      after: { candidateVersion, ruleCount: newRules.length },
      risk: 'WRITE_MEDIUM_RISK', reversible: 'soft-only',
      requestedBy: { user_id: proposer, email: '', role: 'service' },
    };
    const meta: EnqueueMeta = { tier: 'POLICY-CHANGE (gated write)', blastRadius: 1, proposingCaller: proposer };
    const pendingActionId = this.console.enqueue(descriptor, meta);
    this.pending.set(pendingActionId, candidateVersion);
    void this.audit.append({ type: 'version-proposed', candidateVersion, ruleCount: newRules.length, atIso: this.iso() });
    return { pendingActionId, candidateVersion };
  }

  isPolicyChange(actionId: string): boolean { return this.pending.has(actionId); }

  /**
   * Apply an approved policy change. It activates the candidate ONLY when the gate shows a genuine human
   * approval for this action (minted by the operator's Console click). Not approved ⇒ NOT applied (inert).
   * The AI can never approve: the gate/Console already bar it; this re-checks the approver defensively.
   */
  apply(actionId: string): { status: 'applied' | 'not-approved' | 'refused-approver'; activeVersion?: number } | undefined {
    const candidateVersion = this.pending.get(actionId);
    if (candidateVersion === undefined) return undefined; // not a policy change — let the caller handle it
    const q = this.gate.get(actionId);
    if (!q || q.state !== 'approved' || !q.resolution) return { status: 'not-approved' }; // inert until a real approval
    const approver = q.resolution.approver.user_id;
    if (!approver || approver.trim().toLowerCase() === 'claude') return { status: 'refused-approver' }; // AI cannot approve
    const transition: PolicyTransition = this.store.activate(candidateVersion, approver); // touches ONLY PolicySet config
    this.pending.delete(actionId);
    void this.audit.append({ type: 'version-activated', candidateVersion, fromVersion: transition.fromVersion, approvedBy: approver, ruleCount: this.store.active().rules.length, atIso: transition.atIso });
    return { status: 'applied', activeVersion: candidateVersion };
  }

  private iso(): string { return new Date(this.now()).toISOString(); }
}
