# Feature — Approval Gate Engine

**Path:** `src/features/approval-gate/` · **Module:** 17 (Wave 2) · **Status:** **built & tested** (Phase 5.1)
**Governs:** blueprint §17; consumes Permission Engine STOP_FOR_APPROVAL (§22) and Review Engine STOP (§15).

## Purpose
Route approval-required / high-risk actions to a human. An action is **held** until a captured human approval resolves it — it does not proceed otherwise.

## Core guarantee — per-action, never generalized
One captured approval resolves **exactly one** specific queued action, bound to that action's **unique id**. The id is generated per `request()` (never derived from the action's shape), so two identical-shape actions get **distinct** ids — **approving A can never authorize B**. There is no standing permission, blanket grant, or reusable token: an approval input carries the `actionId` it is for, and only that action is affected. (Otherwise it would be allow-all in approval clothing.)

## Single-use + deny-by-default
- `isApproved(actionId)` is true **only** when that specific action is in state `approved`. No captured APPROVE ⇒ held ⇒ not approved.
- An approval is **single-use**: only a still-`held` action can be resolved; a second attempt on an already-resolved action is denied.
- A **missing / mismatched** approval (actionId not in the queue), an **expired** action (past `expiresAtMs`), or an **already-consumed** one ⇒ not approved.

## Approver is a real human
The `approver` is a required human principal; `"claude"` is refused as an approver (the §T11 posture) — at `resolve` and at audit-emit.

## Auditability
`request` / `approve` / `reject` / `expired` emit an `ApprovalAuditEvent` (who/what/when/why) through an injected `ApprovalAuditHook`, routed to the Audit Engine at composition. The approval *record* (approvalId, actionId, approver, decision, reason, timestamp) binds the decision to the specific action.

## Consuming the STOP signals
A Permission Engine `STOP_FOR_APPROVAL` or a Review Engine `STOP` is mapped into `request(action)` (the descriptor carries tool/scope/target/before-after/risk/reversibility/principal). The mapping is shown in tests; the engine imports nothing from those modules (standalone).

## Standalone packaging
Imports nothing from any other engine. Own types; injectable clock/id-generator/audit-hook. Independently packageable.

## Tests
Held-until-approved; explicit matching single-use approval resolves exactly that action; blanket/generalized approval does NOT resolve a specific action (approving A doesn't authorize B — the core test); missing/expired/already-consumed ⇒ not approved; `"claude"` approver refused; capture/resolve emits an audit event; consumption of a Permission Engine STOP_FOR_APPROVAL.

## Status
**Built & tested (Phase 5.1).** Pure-logic. Full suite green.

## Open Items
- Wiring the real Audit Engine adapter into `ApprovalAuditHook` at the composition root.
- Linking approvals to Autopilot scoped tokens (Module 18) — later wave, behind this interface.
