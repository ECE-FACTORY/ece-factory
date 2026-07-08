# Feature — Build-Decision Seam (the deciding→building seam)

**Layer:** 2 (Command) · **Module:** `build-decision-seam` · **Design:** [`docs/DESIGN_DECIDING_BUILDING_SEAM.md`](../../../docs/DESIGN_DECIDING_BUILDING_SEAM.md)

## What it is

The governed command-layer path — the **human's button** — that turns an approved harvest proposal
(`SubDomainResult`, status `STOP-AWAITING-HUMAN-APPROVAL`) into a real `ApprovedBuildDecision` the Layer-4 Build
Planner can consume. It is **not a bypass**: the machine still cannot mint a `ConsumedApproval`, so the machine
still cannot self-approve a build.

## Flow (two phases, with the human in between)

1. **`prepare({ report, subDomainKey, airGap })`** — locate the chosen sub-domain, run `promoteToFork`, and
   enqueue the promotion as a **held Approval-Gate action** through the `DecisionConsole` seat. Returns the real
   `actionId` for a human to approve.
2. **(human)** approves that `actionId` at the `DecisionConsole` — a real, named operator (never `claude`, never
   the proposing caller). This drives the untouched gate to `approved`.
3. **`assemble(prepared)`** — run the real `ClassDispatcher` for class `APPROVAL_REQUIRED_WRITE`. On a consumed
   human approval the dispatcher mints the branded `ConsumedApproval` and invokes `approvalWrite(approval)`;
   **inside that callback only** the `ApprovedBuildDecision` is assembled. No approval ⇒ `STOP_FOR_APPROVAL` ⇒
   `refused`, no decision.

## `promoteToFork` — the typed mapping (resolves the three harvest→build gaps)

Real harvested spines come back **EXTEND**, not FORK, because `air-gap` is UNMEASURED (the one sovereign
dimension the machine never measures). `promoteToFork`:

- **Deep-copies** the spine and folds **only** the human air-gap value into a fresh score via the engine's own
  `foldAirGapMeasurement` (Layer 3). Every other sub-score is carried **byte-for-byte** — no re-grade, and the
  **input is never mutated** (Build-phase requirement 1).
- **Re-derives the verdict from Layer-3's own `decideSourcing`** on the air-gap-completed spine — never
  hand-stamps `FORK`. Legitimate only if it now returns FORK; otherwise **refused** (deny-by-default). A bad
  air-gap (`no` ⇒ 4/20) can drag the normalized score below the FORK floor, which correctly blocks promotion.
- Precondition guard (air-gap-independent, refuse-if-not-met): spine ≠ null, `eligible`, license `ACCEPT`,
  normalized score ≥ 70, `measuredCount` ≥ 3.

## The invariant (frozen by architecture law **Prohibition 4i**)

No `ApprovedBuildDecision` exists without a real, human-consumed Approval-Gate approval:

- **Mints nothing** — `APPROVAL_BRAND` / `mintConsumedApproval` are module-private to the bridge and are neither
  imported nor named here; the token type arrives as a **type** from the governed-adapter **contract**.
- **One construction site** — the decision is built only inside `approvalWrite(approval)`, which the dispatcher
  invokes only after `BridgeApprovalGate` confirms a still-held, human-APPROVED, per-action-bound, non-self
  approval.
- `airGapAssessment.gateActionId` and `approvedBy` are read from the **real gate resolution**, never a
  placeholder or caller-supplied value (Build-phase requirement 2). `approvedBy` is always the real human.

## What it does not do

Does not touch Layer 4's decision logic (the planner reads the decision verbatim), does not loosen any gate,
does not mint, and never lets fetched harvest data act as an instruction. `ApprovedBuildDecision.airGapAssessment`
is an **optional, additive** provenance field on the Layer-4 type; the planner does not read it.

## Tests

`build-decision-seam.test.ts` (real gate/console/dispatcher — no fakes on the token path): promotion purity +
non-mutation, bad-air-gap refusal, precondition guards, happy path (decision tied to the real approvalId +
approver), no-approval / refused / self-approval / `claude` / per-action-binding ⇒ no decision.
Architecture law `write-asks-read-first.test.ts` → **Prohibition 4i**.
