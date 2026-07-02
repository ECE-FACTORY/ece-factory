// Policy Engine — Console wiring (Wave 6, Piece 2). Surfaces the advisory policy read next to each pending
// action and, for HARD violations, WITHHOLDS approval at the Console seat — WITHOUT touching the gate.
//
// HARD vs SOFT (implemented — see the evidence pack):
//   • HARD violation ⇒ the action is policy-BLOCKED. `PolicyGatedSeat.approve` REFUSES to mint (it does NOT
//     call the inner seat / the gate) — non-overridable at the Console, like FORBIDDEN. The underlying gate is
//     UNCHANGED and remains the sole commit path; policy only ADDS a constraint (never removes one).
//   • SOFT violation ⇒ advisory. Approval proceeds through the unchanged seat/gate; the operator's required
//     reason RECORDS the override, and the evaluation + override are audited append-only.
//
// This is a DECORATOR over `OperatorSeat` at the composition/Console layer. The Policy Engine itself holds no
// gate/guard reference and cannot approve/commit; here it only informs the display and adds a Console-layer
// withhold. NO guard/gauntlet/gate/decision-console engine file is edited.

import type { OperatorSeat } from './decision-console-server.js';
import type { PendingItem, ConsoleDecisionOutcome } from '../features/decision-console/decision-console.js';
import type { Principal } from '../features/approval-gate/approval-gate.js';
import type { PolicyEvaluation, PolicyActionFacts } from '../features/policy-engine/policy-engine.js';
import type { PolicyEvaluator } from '../features/policy-engine/policy-store.js';
import type { AuditSink } from '../features/audit-engine/sink.js';
import type { HumanActor, SessionInfo, Environment } from '../features/audit-engine/schema.js';

/** A pending item enriched with its advisory policy read (for the Console display). */
export type PolicyPendingItem = PendingItem & { policy: PolicyEvaluation };

/** Map a pending item's bound descriptor → the read-only facts the Policy Engine inspects. */
export function factsFromPendingItem(item: PendingItem): PolicyActionFacts {
  const after = item.descriptor.after as Record<string, unknown> | undefined;
  const enveloped = !!after && typeof after === 'object' && ('payload' in after || 'system' in after); // external shape
  const payload = enveloped ? after!.payload : after;
  const environment = enveloped && typeof after!.environment === 'string' ? (after!.environment as string) : undefined;
  return {
    tool: item.tool, target: item.target, effect: item.effect, tier: item.tier,
    blastRadius: item.blastRadius, reversibility: item.reversibility, environment, payload,
  };
}

// ── audit (append-only, Postgres, operator-attributed) ───────────────────────────────────────────────────
export interface PolicyAuditEvent {
  type: 'evaluated' | 'policy-blocked-withheld' | 'soft-override-approved' | 'refused';
  actionId: string;
  tool: string;
  operator?: string;
  policyVersion: number;
  recommendation: string;
  policyBlocked: boolean;
  hardViolations: string[];
  reason?: string;
  atIso: string;
}
export interface PolicyAuditSink { append(e: PolicyAuditEvent): void | Promise<void>; }

export class InMemoryPolicyAudit implements PolicyAuditSink {
  private readonly log: PolicyAuditEvent[] = [];
  append(e: PolicyAuditEvent): void { this.log.push(e); }
  entries(): readonly PolicyAuditEvent[] { return this.log.slice(); }
}

/** Routes policy evaluations/decisions into the real append-only, hash-chained sink. Actor = operator or the
 *  'policy-engine' service — never 'claude'. The typed event is carried in query_range. */
export class PostgresPolicyAudit implements PolicyAuditSink {
  constructor(
    private readonly sink: Pick<AuditSink, 'appendRead'>,
    private readonly organizationId: string,
    private readonly environment: Environment = 'local',
    private readonly session: SessionInfo = { session_id: 'policy-engine' },
  ) {}
  async append(e: PolicyAuditEvent): Promise<void> {
    const isOp = !!(e.operator && e.operator.trim());
    const actor: HumanActor = { user_id: isOp ? e.operator! : 'policy-engine', email: '', role: isOp ? 'operator' : 'service' };
    try {
      await this.sink.appendRead({
        organization_id: this.organizationId, human_actor: actor, session: this.session,
        query_range: { policyEvent: e.type, actionId: e.actionId, tool: e.tool, operator: e.operator ?? null, policyVersion: e.policyVersion, recommendation: e.recommendation, policyBlocked: e.policyBlocked, hardViolations: e.hardViolations, reason: e.reason ?? null, atIso: e.atIso, environment: this.environment },
        rows_returned: 0,
      });
    } catch (err) {
      process.stderr.write(`[policy audit] failed to persist ${e.type} for ${e.actionId}: ${err instanceof Error ? err.message : String(err)}\n`);
    }
  }
}

// ── the decorator ────────────────────────────────────────────────────────────────────────────────────────
export class PolicyGatedSeat implements OperatorSeat {
  constructor(
    private readonly inner: OperatorSeat,
    private readonly engine: PolicyEvaluator, // PolicyEngine OR the versioned PolicyStore (evaluates the ACTIVE version)
    private readonly audit: PolicyAuditSink = new InMemoryPolicyAudit(),
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** The queue, each item enriched with its advisory policy read (for display). */
  listPending(): PolicyPendingItem[] {
    return this.inner.listPending().map((it) => ({ ...it, policy: this.engine.evaluate(factsFromPendingItem(it)) }));
  }

  approve(actionId: string, operator: Principal, reason: string): ConsoleDecisionOutcome {
    const item = this.inner.listPending().find((it) => it.actionId === actionId);
    if (!item) return this.inner.approve(actionId, operator, reason); // unknown item — let the seat/gate handle it
    const ev = this.engine.evaluate(factsFromPendingItem(item));
    void this.audit.append(this.event('evaluated', item, operator.user_id, ev, reason));

    if (ev.policyBlocked) {
      // HARD block — withheld at the Console, NON-OVERRIDABLE. The inner seat / gate is NEVER reached: no mint.
      void this.audit.append(this.event('policy-blocked-withheld', item, operator.user_id, ev, reason));
      return { status: 'rejected', reason: `policy-blocked (HARD, non-overridable): ${ev.hardViolations.map((r) => r.description).join('; ')}` };
    }
    if (ev.softViolations.length > 0 || ev.recommendation !== 'RECOMMEND-APPROVE') {
      // SOFT / escalation — advisory only. The operator's reason RECORDS the override; approval proceeds.
      void this.audit.append(this.event('soft-override-approved', item, operator.user_id, ev, reason));
    }
    return this.inner.approve(actionId, operator, reason); // unchanged seat → unchanged gate mints the token
  }

  refuse(actionId: string, operator: Principal, reason: string): ConsoleDecisionOutcome {
    const item = this.inner.listPending().find((it) => it.actionId === actionId);
    if (item) void this.audit.append(this.event('refused', item, operator.user_id, this.engine.evaluate(factsFromPendingItem(item)), reason));
    return this.inner.refuse(actionId, operator, reason);
  }

  private event(type: PolicyAuditEvent['type'], item: PendingItem, operator: string, ev: PolicyEvaluation, reason: string): PolicyAuditEvent {
    return { type, actionId: item.actionId, tool: item.tool, operator, policyVersion: ev.policyVersion, recommendation: ev.recommendation, policyBlocked: ev.policyBlocked, hardViolations: ev.hardViolations.map((r) => r.id), reason, atIso: new Date(this.now()).toISOString() };
  }
}
