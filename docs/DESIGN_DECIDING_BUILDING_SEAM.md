# Design — The Deciding → Building Seam

**Status:** APPROVED (design only — no implementation yet). Variant selected: **re-derive the verdict via
`decideSourcing` (§5), NOT hand-stamp `'FORK'`.** Implementation begins in a following session.
**Author attribution:** recorded to the real human who approved this design, never "claude".
**Date:** 2026-07-09

> ## Build-phase requirements (binding at implementation — do not lose)
> These were attached to the design approval and MUST be honored when the seam is built:
>
> 1. **`promoteToFork` must deep-copy the sub-scores and mutate only the air-gap field.** It must never
>    re-grade, and must never mutate the original `SubDomainResult` (or its `spine`, `record`, `score`, or
>    `subScores`). The input is read-only; the promoted decision is a fresh object graph. A test must assert the
>    original object is unchanged after `promoteToFork` runs (referential + deep-equality check on the input).
> 2. **`airGapAssessment.gateActionId` must come from the real gate resolution** — the `actionId` of the
>    approved Approval-Gate action consumed at step (G) — never a placeholder, constant, or caller-supplied
>    string. It ties the human air-gap judgment to the exact approval that authorized it.

---

## 0. One-line statement

Build the **human's button**: a governed **Layer-2 command path** that lets an identified human turn an
approved harvest proposal into a real `ApprovedBuildDecision` — by recording a *measured* air-gap assessment,
passing it through the **real Approval Gate**, and assembling the decision **inside** the dispatcher's write
handler where the branded `ConsumedApproval` is the only thing that exists. The machine still cannot mint that
token, so the machine still cannot self-approve a build. This path adds a legitimate *source* for the approval
the `ApprovedBuildDecision` already requires; it loosens no gate.

---

## 1. Which layer/module owns the seam

**Layer 2 (Command).** New module:

```
src/layer-2-command/build-decision-seam/
  build-decision-seam.ts          # the seam (the human's button)
  build-decision-seam.feature.md  # feature doc (convention: every module has one)
  build-decision-seam.test.ts     # behavioral + invariant tests
```

Why Layer 2 and **not** Layer 4:

- **Layer 4 must keep its "does not re-decide" property.** `build-planner.ts` *consumes* an
  `ApprovedBuildDecision` and reads its fields as given (build-planner.ts:5-19, 134-142). If the seam lived in
  Layer 4, Layer 4 would be *producing* the approved decision — i.e. deciding — which the whole file is
  structured to forbid. The seam is command-layer orchestration: it runs the gate, records the human judgment,
  and *hands* the result down to Layer 4.
- Layer 2 already owns the human-approval seat (`DecisionConsole`, decision-console.ts) and the review/autopilot
  command paths. The seam is the same shape of thing: a human-driven command that drives the gate.

### Where it sits relative to the existing pieces (nothing below is modified)

| Piece | Layer | File | Role in the seam | Change |
|---|---|---|---|---|
| Approval Gate | 1 | `layer-1-law/approval-gate/approval-gate.ts` | request/resolve → an `approved` action with a real human approver | **untouched** |
| Decision Console (seat) | 2 | `layer-2-command/decision-console/decision-console.ts` | the human APPROVE/REFUSE seat that resolves the gate action | **untouched (reused)** |
| BridgeApprovalGate | 5 | `layer-5-action/mcp-bridge/tool-classes.ts:92-118` | single-use + per-action-bound + self-approval-reject adapter over the gate | **untouched (reused)** |
| `ClassDispatcher.consume` | 5 | `tool-classes.ts:204-211` | mints the branded `ConsumedApproval` after consume passes | **untouched (reused)** |
| brand + mint | 5 | `tool-classes.ts:124`, `:136` | `APPROVAL_BRAND` (unexported), `mintConsumedApproval` (module-private) | **untouched — stays private** |
| governed-adapter contract | 5 | `layer-5-action/governed-adapter/governed-adapter.ts:42` | re-exports the `ConsumedApproval` **type** the seam imports | **untouched (reused)** |
| Build Planner | 4 | `layer-4-build-harden/build-planner/build-planner.ts` | *receives* the `ApprovedBuildDecision` the seam produces | **untouched** |
| `ApprovedBuildDecision` type | 4 | `build-planner.ts:46-55` | the seam's output type | **minimal additive field** (§6) |

The seam is a **client** of `ClassDispatcher.dispatch` — it registers one `APPROVAL_REQUIRED_WRITE` tool named
`approve_build_decision` and lets the *existing* dispatcher consume the *existing* gate. It re-implements none of
consume, mint, or the gate.

---

## 2. The full flow, step by step

Each transition names **where the piece comes from** and **who/what authorizes it**.

```
 (A) Harvest report            HarvestReport{ status:'STOP-AWAITING-HUMAN-APPROVAL', subDomains[...] }
       PROPOSAL, not approved       │  produced by Layer 3; a chosen SubDomainResult is the target
       (harvest-orchestrator.ts:146)│
                                     ▼
 (B) Human picks a spine +     seam input: { report, subDomainKey, airGap:{ value, rationale, measuredBy } }
     records a MEASURED            │  authorized by: the HUMAN. Air-gap is the one dimension the machine
     air-gap assessment           │  by law never measures (harvest-orchestrator.ts:394-395, 415).
                                     ▼
 (C) PRECONDITION GUARD        seam refuses unless the harvest already established FORK-eligibility-
     (deny-by-default)             │  MODULO-air-gap: spine≠null, eligible, license ACCEPT, score.total≥70,
                                     │  measuredCount≥3. Guard = refuse-if-not-met; NOT a re-decision.
                                     ▼
 (D) Build the bound action    ApprovalBinding{ tool:'approve_build_decision',
                                     │            target:`${domain}/${subDomainKey}`,
                                     │            payloadJson: canonical(promotion fingerprint incl. airGap) }
                                     │  authorized by: nobody yet — this is just the descriptor of what
                                     │  the human is about to approve.
                                     ▼
 (E) Approval Gate request     gate.request(descriptor) → actionId          [Layer 1, unchanged]
                                     │  proposingCaller = the seam's caller (NEVER the approver).
                                     ▼
 (F) Human APPROVES at the     DecisionConsole.approve(actionId, operator)  [Layer 2, unchanged]
     seat                          │  → gate.resolve(APPROVE, approver=operator)
                                     │  authorized by: the real human operator. State → 'approved',
                                     │  resolution.approver.user_id = operator (≠ 'claude', ≠ caller).
                                     ▼
 (G) ClassDispatcher.consume   dispatcher.dispatch('APPROVAL_REQUIRED_WRITE', { approvalWrite }, ctx)
     MINTS the token               │  → BridgeApprovalGate.consumeApproval passes (approved + bound +
     (tool-classes.ts:204-211)     │    not self-approved + single-use) → mintConsumedApproval(...)
                                     │  authorized by: the gate state from (F). No approval ⇒ no token ⇒
                                     │  STOP_FOR_APPROVAL, and the seam produces NOTHING.
                                     ▼
 (H) THE SEAM assembles        inside approvalWrite(approval: ConsumedApproval):
     ApprovedBuildDecision         │    const promoted = promoteToFork(subDomainResult, airGap)  // §5
                                     │    return { decision: promoted, approval, approvedBy: operator,
                                     │             sourceReport:{domain,generatedAtIso}, airGapAssessment }
                                     │  authorized by: possession of `approval` — which only (G) can produce.
                                     ▼
 (I) Hand to the Build Planner planBuild({ approved, scaffoldGrant, credential })  [Layer 4, unchanged]
                                     │  Layer 4 reads the decision as given; the SCAFFOLD write is a SECOND,
                                     │  independent human gate (build-planner.ts:16-19). Layer 4 re-decides
                                     │  nothing.
```

The seam function returns a **discriminated union**: either
`{ status: 'APPROVED-BUILD-DECISION', approved: ApprovedBuildDecision }` or
`{ status: 'refused', stage, reason }` (guard failed, or no human approval → no token). There is **no third
branch** that yields a decision without the token.

---

## 3. The invariant, stated and proven

> **Invariant (I):** No `ApprovedBuildDecision` can come into existence except from a real, human-consumed
> Approval-Gate approval. The machine cannot self-approve a build.

The design guarantees (I) by three independent, stacked mechanisms — any **one** of which already blocks a forged
decision; all three hold at once.

**(1) The mint is unreachable — the token cannot be fabricated.**
`APPROVAL_BRAND` (tool-classes.ts:124) is a module-private `unique symbol`; it is **not exported**.
`mintConsumedApproval` (tool-classes.ts:136) is **not exported**. `ConsumedApproval` (tool-classes.ts:125-135)
carries `readonly [APPROVAL_BRAND]: true`, a property whose key no other module can name. The seam imports
`ConsumedApproval` **as a type only**, from the governed-adapter *contract* re-export (governed-adapter.ts:42) —
never the brand, never the mint. Therefore no code in the seam can construct a value of type `ConsumedApproval`,
and no cast can conjure the brand key. (This is the exact property already frozen for the build planner by
Prohibition 4f.)

**(2) The only producer of a genuine token is a real human approval.**
The single runtime source of a `ConsumedApproval` is `ClassDispatcher.consume` (tool-classes.ts:204-211), which
mints **only** after `BridgeApprovalGate.consumeApproval` returns non-null — and that requires (tool-classes.ts:107-117):
state `approved`, a captured `resolution`, approver ≠ `'claude'` and ≠ the caller (no self-approval), and an
exact per-action binding match. The gate reaches `approved` only through `resolve(APPROVE)` driven by the
DecisionConsole seat under a named human operator. So a token existing at all **is** the proof of a real human
approval.

**(3) The decision is constructed only where the token already exists.**
The seam's **one and only** construction site for `ApprovedBuildDecision` is lexically **inside** the
`approvalWrite(approval)` callback handed to `dispatch`. That callback's sole parameter is the
`ConsumedApproval`. The dispatcher invokes it **only** on the mint path (tool-classes.ts:195) — never on the
`STOP_FOR_APPROVAL` path (tool-classes.ts:191-193). Hence the object is literally unconstructable before the
token exists, and the `approval:` field is populated by that same token, so a forged/plain-object approval
cannot typecheck into the slot either.

**Why the seam cannot cheat around its own handler:** the law test (§4) asserts by source inspection that there
is *exactly one* place that assigns `approval:` / constructs the decision, that it is inside the callback, that
the module mints nothing, references no brand, and contains no `as ConsumedApproval` / `as ApprovedBuildDecision`
cast. So there is no second, un-gated constructor and no cast-based forgery.

**Net:** to obtain an `ApprovedBuildDecision` you must pass through (F)→(G); (F) is a real human at the seat and
(G) rejects self-approval. The machine, running the seam by itself, reaches only `STOP_FOR_APPROVAL` and returns
`refused`. It cannot self-approve.

---

## 4. The law-level test (new Prohibition 4i)

Added to `src/architecture/write-asks-read-first.test.ts`, **purely additive**, same class and style as
Prohibitions 4f/4g/4h (source-inspection + a behavioral companion). Nothing in 4e–4h changes.

**Plain-terms assertion (the one sentence it proves):**

> *There is no path — no function, no cast, no default value — by which an `ApprovedBuildDecision` is created
> without the branded `ConsumedApproval` that only the dispatcher mints after a real human's Approval-Gate
> APPROVE. If the machine tries to approve its own build, the gate yields no token, and with no token the
> `ApprovedBuildDecision` is unconstructable.*

**Source-inspection assertions over `build-decision-seam.ts` (mirrors 4f):**
1. Imports `ConsumedApproval` **as a type** from the governed-adapter contract; never imports from
   `tool-classes.js` directly; never names `APPROVAL_BRAND`.
2. **Mints nothing:** no `mintConsumedApproval`, no `mint*(` call of any kind.
3. **No forgery by cast:** no `as ConsumedApproval`, no `as ApprovedBuildDecision`.
4. **Exactly one** construction of the decision (one `approval:` assignment), and its index lies **between** the
   `approvalWrite(` callback opening and its close — i.e. the decision is assembled *inside* the write handler,
   unreachable without the token.
5. **Routes through the real dispatcher:** imports `ClassDispatcher` and dispatches class
   `'APPROVAL_REQUIRED_WRITE'`; re-implements no consume/mint.
6. Imports no `node:fs`; holds no real-write call (it is a decision assembler, not a writer).

**Behavioral assertions (companion `it(...)` in the seam test, run against the real gate/dispatcher):**
- **Self-approval blocked:** operator == proposingCaller ⇒ consume returns null ⇒ seam returns `refused`,
  **no** `ApprovedBuildDecision`.
- **No approval ⇒ nothing:** gate action unresolved or REFUSED ⇒ seam returns `refused`; the build planner is
  never reached.
- **`'claude'` approver blocked:** approver `'claude'` ⇒ `refused`.
- **Happy path:** a genuine human APPROVE ⇒ exactly one `ApprovedBuildDecision`, with
  `approval.approvalId === gate resolution approvalId`, `approvedBy === operator` (≠ 'claude'), and
  `decision.decision === 'FORK'`.
- **Guard (deny-by-default):** an under-assessed spine (score < 70, or measuredCount < 3, or no permissive
  spine — a BUILD/NEEDS-ASSESSMENT harvest) ⇒ `refused` *before* any gate request; a human air-gap measurement
  cannot rescue a spine the harvest never graded FORK-eligible.

---

## 5. Open question — does `SubDomainResult` carry every field `ApprovedBuildDecision` needs?

**Answer: No. There are three gaps, and the seam is exactly where they are filled — with a typed mapping, not a
silent guess.** Resolved as follows.

`ApprovedBuildDecision` (build-planner.ts:46-55) needs: `decision: SubDomainResult` (must be **FORK**, non-null
spine — build-planner.ts:134-142), `approval: ConsumedApproval`, `approvedBy: string`,
`sourceReport: { domain, generatedAtIso }`.

**Gap 1 — the verdict (EXTEND → FORK).**
Real harvested spines in these domains come back as **`decision: 'EXTEND'`**, *not* FORK, precisely because
`air-gap` is UNMEASURED and the sovereign gate withholds FORK (harvest-orchestrator.ts:393-395, 420-423). The
harvest even emits the explicit hand-off line *"HUMAN APPROVAL REQUIRED: air-gap is UNMEASURED — a human must
assess the sovereign air-gap dimension before this becomes a FORK"* (harvest-orchestrator.ts:415). But
`ApprovedBuildDecision.decision` must be FORK. So `SubDomainResult.decision` **cannot be passed through unchanged**.

**Gap 2 — the air-gap measurement.**
`spine.record.airGapSuitability` is `'unknown'` on every harvested spine (deny-by-default; the signals scout
never sources it). The flow's "human records a *measured* air-gap assessment" has **no typed home** today — and
the build planner blindly echoes `rec.airGapSuitability` into its fork-integration notes (build-planner.ts:211),
so leaving it `'unknown'` would carry a *false* provenance downstream.

**Gap 3 — envelope fields.**
`approvedBy` and `sourceReport.{domain,generatedAtIso}` are **not** on `SubDomainResult`. `approvedBy` comes from
the **gate resolution** (`resolution.approver.user_id`); `sourceReport` comes from the **HarvestReport envelope**
(`report.domain`, `report.generatedAtIso`). The seam already has both in hand (it holds the report and drives the
gate), so this gap is closed by the seam's *inputs*, not a type change.

### The typed mapping at the seam — `promoteToFork(...)`

A small **pure** helper in the seam turns the harvested (EXTEND) `SubDomainResult` + the human's air-gap
assessment into a **promoted FORK** `SubDomainResult`, **without re-scoring**:

- **Fold the human air-gap value into a DEEP COPY** of the spine's `score.subScores` (mark the `air-gap`
  dimension `measured: true` with the human-supplied rating) and set `record.airGapSuitability` to the human's
  value. **Only the air-gap field is mutated, and only on the copy** — the original `SubDomainResult`
  (spine/record/score/subScores) is never touched (Build-phase requirement 1). The machine's other measured
  sub-scores are carried through **byte-for-byte** — no re-grading.
- **Derive the verdict from Layer 3's own audited function, not by hand.** Re-invoke the pure
  `decideSourcing(...)` (harvest-orchestrator.ts:365) on the air-gap-completed candidate. If — and only if — it
  now returns **FORK**, the promotion is legitimate; the seam records
  `decisionEvidence += "verdict promoted EXTEND→FORK by human air-gap assessment (value=…, by=<operator>, gate
  action=<id>)"`. If `decideSourcing` still returns EXTEND/NEEDS-ASSESSMENT even with air-gap measured (score
  too low, too few dims), the seam **refuses** — the harvest was never one air-gap measurement away from FORK.

**Why re-invoke `decideSourcing` rather than hand-stamp `'FORK'`?** It keeps the verdict **machine-computed and
audited** by the *same* Layer-3 logic, with the human supplying *only* the one input the machine is barred from
measuring. The seam never forges a verdict; it completes the evidence and lets the existing decision function
speak. This is command-layer orchestration (Layer 2 calling a pure Layer-3 function with now-complete evidence),
**not** Layer 4 re-deciding — Layer 4 still receives the decision as given and reads it verbatim.

### Minimal additive type change

Add one optional, first-class provenance block to `ApprovedBuildDecision` so the human judgment is auditable and
downstream (planner, audit) can surface *who* measured air-gap and *why*:

```ts
readonly airGapAssessment: {
  readonly value: AirGapSuitability;   // 'yes' | 'partial' | 'no' — the human's measured rating
  readonly rationale: string;          // the human's stated basis
  readonly measuredBy: string;         // the operator; equals approvedBy
  readonly gateActionId: string;       // the REAL approved gate action id from the resolution (Build-phase
                                       // requirement 2) — never a placeholder/constant/caller-supplied value
};
```

This is additive (no existing field changes, no gate loosened). It does **not** alter Layer 4's logic; the
planner may later echo the real value instead of the record's `'unknown'`, but that is out of scope here.

---

## 6. What this design explicitly does NOT do

- Does **not** touch Layer 4's decision logic — `build-planner.ts` and its "does not re-decide" property are
  unchanged; the seam only *supplies* its input.
- Does **not** loosen any gate — the Approval Gate, `BridgeApprovalGate` (single-use / per-action /
  no-self-approval), and `ClassDispatcher` are used **as-is**. The mint and brand stay private.
- Does **not** let fetched data become instruction — the harvest report is read as **data**; the only fields
  that move a verdict are the machine's own measured sub-scores plus the human's typed air-gap input.
- Does **not** scaffold or implement — this document is the deliverable; code follows only after approval.
- Attribution is to the **real human** operator throughout (`approvedBy`, `airGapAssessment.measuredBy`), never
  "claude".

---

## 7. Test plan summary

| Test | File | Kind | Proves |
|---|---|---|---|
| Prohibition **4i** | `architecture/write-asks-read-first.test.ts` | source-inspection | seam mints nothing, no brand, no cast, single in-handler construction, routes through real dispatcher |
| self-approval blocked | `build-decision-seam.test.ts` | behavioral (real gate) | operator==caller ⇒ refused, no decision |
| no-approval ⇒ nothing | `build-decision-seam.test.ts` | behavioral | unresolved/REFUSED ⇒ refused, planner unreached |
| 'claude' approver blocked | `build-decision-seam.test.ts` | behavioral | approver 'claude' ⇒ refused |
| happy path | `build-decision-seam.test.ts` | behavioral | one decision; approvalId matches gate; approvedBy=operator; decision=FORK |
| promotion guard | `build-decision-seam.test.ts` | behavioral | under-assessed spine ⇒ refused before gate request |
| `promoteToFork` purity | `build-decision-seam.test.ts` | unit | carries measured sub-scores unchanged; verdict via `decideSourcing`; refuses if not FORK |
| `promoteToFork` non-mutation | `build-decision-seam.test.ts` | unit | **Build-phase req 1** — original `SubDomainResult` unchanged (referential + deep-equal); only air-gap on the copy moves |
| gateActionId provenance | `build-decision-seam.test.ts` | behavioral | **Build-phase req 2** — `airGapAssessment.gateActionId` equals the real approved gate action id, not a placeholder |

---

**Approval requested:** review §1 (placement), §3 (invariant proof), §4 (law test), and §5 (the resolved open
question / the additive `airGapAssessment` field). On PASS, the first implementation prompt writes the failing
Prohibition 4i + the seam skeleton, then the seam, per the dual-Claude loop.
