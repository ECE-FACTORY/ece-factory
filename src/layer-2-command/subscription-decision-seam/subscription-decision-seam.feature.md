# Feature — Subscription Promotion Seam

**Layer:** 2 (Command) · **Module:** `subscription-decision-seam` · **Design:** [`docs/DESIGN_SUBSCRIPTION_PROMOTION_SEAM.md`](../../../docs/DESIGN_SUBSCRIPTION_PROMOTION_SEAM.md)

## What it is

The subscription-mode analog of the sovereign [`build-decision-seam`](../build-decision-seam/build-decision-seam.feature.md)
(`5c8cc53`). Same shape, one dimension swapped: a human measures **multi-tenancy** (not air-gap), the verdict is
re-derived by `decideSourcing(_, 'subscription')`, and the `ApprovedBuildDecision` is assembled at **exactly one
site inside `approvalWrite(approval: ConsumedApproval)`**. The machine cannot self-approve.

## Flow (two phases, human in between)

1. **`prepare({ report, subDomainKey, multiTenancy })`** — subscription-only mode guard, locate the sub-domain,
   `promoteToForkSubscription`, enqueue a held Approval-Gate action (tool `approve_build_decision_subscription`).
2. **(human)** approves that `actionId` at the `DecisionConsole` (a real operator, never `claude`/the caller).
3. **`assemble(prepared)`** — the real `ClassDispatcher` mints the token on a consumed approval; the decision is
   built inside `approvalWrite`. No approval ⇒ `STOP_FOR_APPROVAL` ⇒ `refused`.

## `promoteToForkSubscription` (pure)

Precondition guard (spine≠null, eligible, license ACCEPT, score ≥ 70, measuredCount ≥ 3) → deep-copy → fold only
multi-tenancy via `foldMultiTenancyMeasurement` (no re-grade, input never mutated) → re-derive via
`decideSourcing(_, 'subscription')`; legitimate only if it now returns FORK, else refused (deny-by-default). The
verdict is machine-computed, never hand-stamped.

## Invariant — frozen by architecture law **Prohibition 4k**

Mints nothing; token type from the governed-adapter **contract**; one construction site inside
`approvalWrite(approval: ConsumedApproval)`; routes through the real dispatcher; no cast, no brand. `approvedBy`
and `multiTenancyAssessment.gateActionId` are read from the **real gate resolution**.

## Mode fail-closed — both ways

Refuses `productMode !== 'subscription'` (symmetric to the sovereign seam's `!== 'sovereign'`). Defence in depth:
a **distinct binding tool name** so a sovereign approval can't be consumed here, and structurally a sovereign
spine has no multi-tenancy sub-score, so `decideSourcing('subscription')` can't FORK it.

## Shared vs. different

Shared (reused, not duplicated): `ClassDispatcher`/`BridgeApprovalGate`/mint/brand (Layer 5), `ApprovalGate`,
`DecisionConsole`, `ConsumedApproval` type, `canonicalPayload`, `decideSourcing`, construction discipline.
Different: multi-tenancy (not air-gap), `'subscription'` mode, the binding tool name, and the
`multiTenancyAssessment` provenance field. The sovereign seam (`build-decision-seam.ts`) is **untouched**;
Prohibition 4i stays byte-identical.

## Not done here

`ApprovedBuildDecision.multiTenancyAssessment` is an optional, additive Layer-4 field; the planner does not read
it, and `buildPlanFor`'s fork notes remain sovereign-flavoured (air-gap/white-label) — noted as acceptable
out-of-scope. A decision carries **exactly one** of `airGapAssessment` / `multiTenancyAssessment`.
