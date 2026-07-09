// Subscription Promotion Seam (Layer 2 — Command) — the SUBSCRIPTION-mode analog of the build-decision seam
// (build-decision-seam.ts, 5c8cc53). THE HUMAN'S BUTTON, NOT A BYPASS.
//
// WHAT IT IS: the governed command-layer path that turns an APPROVED SUBSCRIPTION harvest proposal into a real
// `ApprovedBuildDecision`. A human picks a spine, records a MEASURED MULTI-TENANCY assessment (the one
// subscription dimension the harvest machine never measures — the subscription analog of air-gap), and approves
// the promotion at the real Approval Gate. Only then — inside the dispatcher's write handler, where a genuine
// branded `ConsumedApproval` is the sole thing in scope — is the decision assembled.
//
// WHY IT CANNOT SELF-APPROVE (the invariant this file exists to hold — frozen by architecture law Prohibition 4k,
// a per-file mirror of the sovereign seam's 4i):
//   • It MINTS NOTHING. `mintConsumedApproval` / the `APPROVAL_BRAND` symbol are module-private to the bridge
//     and are neither imported nor named here. The token type arrives as a TYPE from the governed-adapter
//     CONTRACT — so no value of type ConsumedApproval can be constructed in this module.
//   • The ONLY producer of a real token is the REAL `ClassDispatcher.consume` (tool-classes.ts:204-211), which
//     mints only after `BridgeApprovalGate` confirms a still-held, human-APPROVED, per-action-bound, NON-self
//     approval. The gate reaches 'approved' only through the DecisionConsole seat under a named human operator.
//   • The ApprovedBuildDecision is constructed at EXACTLY ONE site — inside the `approvalWrite(approval)`
//     callback — which the dispatcher invokes only on the mint path. No token ⇒ STOP_FOR_APPROVAL ⇒ refused.
//
// SHARED, NOT DUPLICATED: the token path proper (mint/consume/brand/gate) lives once in Layer 5 — this seam
// reuses the SAME ClassDispatcher / BridgeApprovalGate / DecisionConsole / ApprovalGate the sovereign seam uses.
// What differs is only the folded dimension (multi-tenancy), the decideSourcing mode ('subscription'), the
// binding tool name, and the provenance field (multiTenancyAssessment). Layer 4 still "does not re-decide".

import { DecisionConsole } from '../decision-console/decision-console.js';
import type { ApprovalGate } from '../../layer-1-law/approval-gate/approval-gate.js';
import { decideSourcing } from '../../layer-3-harvest/harvest-orchestrator/harvest-orchestrator.js';
import type { HarvestReport, SubDomainResult } from '../../layer-3-harvest/harvest-orchestrator/harvest-orchestrator.js';
import { foldMultiTenancyMeasurement } from '../../layer-3-harvest/scoring-engine/scoring-engine.js';
import type { ApprovedBuildDecision } from '../../layer-4-build-harden/build-planner/build-planner.js';
// TOKEN TYPE + binding fingerprint come from the CONTRACT (never the transport) — the same discipline the build
// planner uses (Prohibition 4f). Only the runtime dispatcher/bridge come from tool-classes; NOT the token/mint.
import { canonicalPayload, type ConsumedApproval, type ApprovalBinding } from '../../layer-5-action/governed-adapter/governed-adapter.js';
import { ClassDispatcher, BridgeApprovalGate } from '../../layer-5-action/mcp-bridge/tool-classes.js';

/** The stable tool name the SUBSCRIPTION promotion approval is bound to — DISTINCT from the sovereign tool so a
 *  sovereign approval can never be replayed for a subscription build (per-action binding fails on tool mismatch). */
export const APPROVE_BUILD_DECISION_SUBSCRIPTION_TOOL = 'approve_build_decision_subscription';

/** A human's MEASURED multi-tenancy assessment. `value` is a measurement — never 'unknown'. */
export interface MultiTenancyAssessmentInput {
  readonly value: 'full' | 'partial' | 'none';
  readonly rationale: string;
}

/** Result of the pure promotion: a FORK SubDomainResult re-derived by decideSourcing, or a refusal. */
export type SubscriptionPromoteResult =
  | { readonly ok: true; readonly promoted: SubDomainResult }
  | { readonly ok: false; readonly stage: 'precondition' | 'promotion'; readonly reason: string };

/**
 * PURE. Turn a harvested SUBSCRIPTION `SubDomainResult` + a human multi-tenancy assessment into a PROMOTED FORK
 * decision — WITHOUT re-grading and WITHOUT mutating the input. Deep-copies the spine, folds ONLY the
 * multi-tenancy dimension into a fresh score (via the engine's own scale), then re-invokes Layer-3's
 * `decideSourcing` on the completed spine under 'subscription'. Legitimate ONLY if that function now returns
 * FORK; otherwise refuses (deny-by-default). The verdict is machine-computed, never hand-stamped.
 */
export function promoteToForkSubscription(decision: SubDomainResult, multiTenancy: MultiTenancyAssessmentInput): SubscriptionPromoteResult {
  const spine = decision.spine;
  if (!spine) return { ok: false, stage: 'precondition', reason: 'no spine — the harvest found no eligible permissive candidate to fork' };

  // Precondition guard (deny-by-default) — the harvest must already be FORK-eligible MODULO multi-tenancy. These
  // are multi-tenancy-INDEPENDENT facts the machine already established; refuse rather than promote a spine the
  // harvest never graded fork-worthy. This is a guard (refuse-if-not-met), NOT a re-decision.
  if (spine.record.eligibility !== 'eligible') return { ok: false, stage: 'precondition', reason: `spine not eligible (${spine.record.eligibility})` };
  if (spine.record.licenseDecision !== 'ACCEPT') return { ok: false, stage: 'precondition', reason: `spine license not ACCEPT (${spine.record.licenseDecision})` };
  if (spine.score.total < 70) return { ok: false, stage: 'precondition', reason: `spine normalized score ${spine.score.total} < 70 (not fork-eligible before multi-tenancy)` };
  if (spine.score.measuredCount < 3) return { ok: false, stage: 'precondition', reason: `spine measuredCount ${spine.score.measuredCount} < 3 (too little machine-measured to promote)` };

  // DEEP-COPY the spine; fold ONLY multi-tenancy into a fresh score (other dims byte-for-byte). Original untouched.
  const promotedScore = foldMultiTenancyMeasurement(spine.score, multiTenancy.value);
  const promotedSpine = {
    ...spine,
    record: { ...spine.record, multiTenancy: multiTenancy.value },
    score: promotedScore,
  };

  // Re-derive the verdict from Layer-3's OWN function on the tenancy-completed spine. FORK, or we refuse.
  // The seam is SUBSCRIPTION-only (it folds multi-tenancy); the mode is passed explicitly, never defaulted.
  const rederived = decideSourcing([promotedSpine], 'subscription');
  if (rederived.decision !== 'FORK') {
    return { ok: false, stage: 'promotion', reason: `re-derived verdict is ${rederived.decision}, not FORK, even with multi-tenancy=${multiTenancy.value} — this spine is not one measurement away from a FORK` };
  }

  const promotedCandidates = decision.candidates.map((c) => (c === spine ? promotedSpine : c));
  const promoted: SubDomainResult = {
    ...decision,
    candidates: promotedCandidates,
    spine: promotedSpine,
    decision: rederived.decision, // 'FORK' — from decideSourcing, never hand-set
    decisionEvidence: [
      ...rederived.evidence,
      `verdict promoted EXTEND→FORK by a human multi-tenancy assessment (value=${multiTenancy.value}); multi-tenancy folded into the score, all other dimensions carried byte-for-byte (no re-grade)`,
    ],
  };
  return { ok: true, promoted };
}

/** A prepared, still-PENDING promotion: the real gate action id (for the human to approve) plus what assemble needs. */
export interface PreparedSubscriptionDecision {
  readonly actionId: string;
  readonly binding: ApprovalBinding;
  readonly promoted: SubDomainResult;
  readonly multiTenancy: MultiTenancyAssessmentInput;
  readonly sourceReport: { readonly domain: string; readonly generatedAtIso: string };
}

export type SubscriptionPrepareOutcome =
  | { readonly status: 'PENDING-APPROVAL'; readonly prepared: PreparedSubscriptionDecision }
  | { readonly status: 'refused'; readonly stage: 'mode' | 'lookup' | 'precondition' | 'promotion'; readonly reason: string };

export type SubscriptionAssembleOutcome =
  | { readonly status: 'APPROVED-BUILD-DECISION'; readonly approved: ApprovedBuildDecision }
  | { readonly status: 'refused'; readonly stage: 'approval'; readonly reason: string };

export interface SubscriptionSeamDeps {
  /** The REAL Layer-1 Approval Gate (also satisfies the bridge reader port structurally). Read for the approver. */
  readonly gate: ApprovalGate;
  /** The DecisionConsole seat — built over the SAME gate. The seam enqueues here; the human approves here. */
  readonly console: DecisionConsole;
  /** The machine/agent that PROPOSES the promotion — NEVER allowed to be the approver (separation of duties). */
  readonly proposingCaller: string;
}

/**
 * The subscription seam. Two phases with the HUMAN in between (identical shape to the sovereign seam):
 *   1. `prepare(...)`  — guard + promote + enqueue a held Approval-Gate action (returns its real actionId).
 *   2. (a human APPROVES that actionId at the DecisionConsole — outside this seam.)
 *   3. `assemble(...)` — run the real dispatcher; on a consumed human approval, assemble the decision INSIDE the
 *                        write handler. No approval ⇒ refused, no decision.
 * The seam never approves on anyone's behalf; it holds no minting power.
 */
export class SubscriptionDecisionSeam {
  private readonly gate: ApprovalGate;
  private readonly proposingCaller: string;
  private readonly console: DecisionConsole;
  private readonly dispatcher: ClassDispatcher;

  constructor(deps: SubscriptionSeamDeps) {
    this.gate = deps.gate;
    this.proposingCaller = deps.proposingCaller;
    this.console = deps.console;
    // The REAL dispatcher over the REAL bridge gate. The bridge rejects a self/AI approver at consume too.
    this.dispatcher = new ClassDispatcher(new BridgeApprovalGate(deps.gate, deps.proposingCaller));
  }

  /** Phase 1 — guard, promote, and enqueue the promotion as a held Approval-Gate action for a human to approve. */
  prepare(input: { report: HarvestReport; subDomainKey: string; multiTenancy: MultiTenancyAssessmentInput }): SubscriptionPrepareOutcome {
    // SUBSCRIPTION-ONLY GUARD (fail-closed) — symmetric to the sovereign seam's productMode !== 'sovereign' guard.
    // This seam folds MULTI-TENANCY; it is meaningless for a sovereign report (multi-tenancy is not scored there).
    if (input.report.productMode !== 'subscription') {
      return { status: 'refused', stage: 'mode', reason: `subscription promotion seam is subscription-only; report productMode is "${input.report.productMode}"` };
    }
    const sub = input.report.subDomains.find((s) => s.subDomain.key === input.subDomainKey);
    if (!sub) return { status: 'refused', stage: 'lookup', reason: `no sub-domain "${input.subDomainKey}" in the harvest report for "${input.report.domain}"` };

    const promo = promoteToForkSubscription(sub, input.multiTenancy);
    if (!promo.ok) return { status: 'refused', stage: promo.stage, reason: promo.reason };
    const promoted = promo.promoted;
    const spine = promoted.spine!; // FORK ⇒ non-null (decideSourcing guarantees a spine for FORK)

    const target = `${input.report.domain}/${input.subDomainKey}`;
    // The exact promotion the human approves — the binding fingerprint the token is consumed against.
    const payloadObject = {
      decision: 'FORK' as const,
      spine: `${spine.identity.host}/${spine.identity.owner}/${spine.identity.name}`,
      scoreTotal: spine.score.total,
      multiTenancy: input.multiTenancy.value,
    };
    const payloadJson = canonicalPayload(payloadObject);
    const binding: ApprovalBinding = { tool: APPROVE_BUILD_DECISION_SUBSCRIPTION_TOOL, target, payloadJson };

    const actionId = this.console.enqueue(
      { tool: APPROVE_BUILD_DECISION_SUBSCRIPTION_TOOL, target, after: payloadObject, risk: 'high', reversible: 'no', requestedBy: { user_id: this.proposingCaller } },
      { tier: 'APPROVAL_REQUIRED_WRITE (build-decision-subscription)', blastRadius: 1, proposingCaller: this.proposingCaller },
    );

    return {
      status: 'PENDING-APPROVAL',
      prepared: { actionId, binding, promoted, multiTenancy: input.multiTenancy, sourceReport: { domain: input.report.domain, generatedAtIso: input.report.generatedAtIso } },
    };
  }

  /**
   * Phase 3 — run the real dispatcher against the (hopefully human-approved) gate action. The ApprovedBuildDecision
   * is assembled at EXACTLY ONE site: inside `approvalWrite`, whose only parameter is the genuine ConsumedApproval.
   * No approval ⇒ the dispatcher returns STOP_FOR_APPROVAL and this returns `refused` — no decision is ever built.
   */
  async assemble(prepared: PreparedSubscriptionDecision): Promise<SubscriptionAssembleOutcome> {
    const { actionId, binding, promoted, multiTenancy, sourceReport } = prepared;

    const outcome = await this.dispatcher.dispatch<never, never, ApprovedBuildDecision>(
      'APPROVAL_REQUIRED_WRITE',
      {
        approvalWrite: async (approval: ConsumedApproval): Promise<ApprovedBuildDecision> => {
          // Reached ONLY with a real token the dispatcher minted after consuming a human approval. Read the
          // approver from the REAL gate resolution (never a caller-supplied value) — this IS the approving human.
          const approver = this.gate.get(actionId)?.resolution?.approver.user_id ?? '';
          return {
            decision: promoted,
            approval,
            approvedBy: approver,
            sourceReport,
            multiTenancyAssessment: { value: multiTenancy.value, rationale: multiTenancy.rationale, measuredBy: approver, gateActionId: actionId },
          };
        },
      },
      { approvalActionId: actionId, approvalBinding: binding, tool: binding.tool },
    );

    if (outcome.status === 'executed') return { status: 'APPROVED-BUILD-DECISION', approved: outcome.result };
    const reason = outcome.status === 'STOP_FOR_APPROVAL' ? outcome.reason : `dispatch returned ${outcome.status}`;
    return { status: 'refused', stage: 'approval', reason };
  }
}
