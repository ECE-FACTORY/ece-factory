# Design — The Subscription Promotion Seam

**Status:** DESIGN ONLY (no implementation). Read and approve before any code.
**Author attribution:** to be recorded to the real human who approves this design, never "claude".
**Date:** 2026-07-09 · **Baseline:** origin/main @ `115fc86` (tree clean)

---

## 0. One-line statement

The **subscription-mode analog of the sovereign build-decision seam** (`5c8cc53`). Same shape, same token
discipline, one dimension swapped: a human measures **multi-tenancy** (not air-gap) via the already-built
`foldMultiTenancyMeasurement`, the verdict is re-derived by `decideSourcing(_, 'subscription')`, and the
`ApprovedBuildDecision` is constructed at **exactly one site, inside `approvalWrite(approval: ConsumedApproval)`**.
The machine still cannot self-approve. **Purely additive**: the sovereign seam and Prohibition 4i stay
byte-identical.

---

## 1. Where it lives — a new sibling module (recommended)

**Recommendation: a new Layer-2 sibling module, `src/layer-2-command/subscription-decision-seam/`**
(`subscription-decision-seam.ts` + `.feature.md` + `.test.ts`), reusing all shared runtime machinery. **Do not
parameterize the existing seam by mode.**

```
src/layer-2-command/
  build-decision-seam/            # SOVEREIGN — untouched (5c8cc53), frozen by Prohibition 4i
  subscription-decision-seam/     # NEW — subscription analog, frozen by NEW Prohibition 4k
```

**Why a sibling, not a parameterized single seam:**

- **The hard constraint is "sovereign seam byte-identical."** Parameterizing the existing seam by mode edits
  `build-decision-seam.ts`, which forces re-verifying the token-discipline freeze (4i) and breaks the
  byte-identical guarantee. A sibling leaves it literally untouched.
- **The construction site is frozen by *source inspection, per file*.** Prohibition 4i asserts "exactly one
  `approvedBy:`, inside the single `approvalWrite(approval: ConsumedApproval)`" over `build-decision-seam.ts`.
  Each seam's construction must be **directly auditable in its own file** — a per-file law test is the strongest
  freeze. A sibling gets its own file-scoped Prohibition 4k, mirroring 4i exactly.
- **The two seams genuinely diverge at the decision layer** (which dimension folds, which `decideSourcing` mode,
  which provenance field). A single function branching on mode would interleave two security-critical
  constructions in one place — harder to freeze, not easier.

**"Don't duplicate the token path" — already satisfied.** The *token path proper* — mint / consume / brand /
gate — lives **once**, in Layer 5 (`ClassDispatcher.consume` + module-private `mintConsumedApproval` +
`APPROVAL_BRAND` at `tool-classes.ts:124,136`) and Layer 1 (`ApprovalGate`). **Neither seam reimplements any of
it.** Both are thin clients that call the *same* `ClassDispatcher` / `BridgeApprovalGate` / `DecisionConsole`
singletons (see §5). What the sibling "mirrors" is only the ~8-line **dispatch-client glue**
(`dispatcher.dispatch('APPROVAL_REQUIRED_WRITE', { approvalWrite }, ctx)` + outcome mapping) — and that is kept
inline **on purpose**, so each construction site is independently frozen by its own law test.

**Alternative considered — a shared `runGatedAssembly(dispatcher, actionId, binding, build)` helper** that both
seams call. Rejected for now: it would either (a) require refactoring the sovereign seam to adopt it (violating
byte-identical), or (b) split the single construction across a helper (the `approvalWrite` wiring) and a callback
(the object literal), so the "one site inside `approvalWrite`" property spans two files and is harder to freeze.
If you prefer glue-DRY over inline-auditability, this is the lever — but I recommend against adding indirection
to a law-frozen security path.

---

## 2. The flow, step by step (with exact integration points)

Mirrors the sovereign seam's two-phases-with-a-human-in-between. Integration points named per step.

```
 (A) Subscription harvest      HarvestReport{ productMode:'subscription', status:'STOP-AWAITING-HUMAN-APPROVAL' }
       EXTEND proposal              │  produced by the orchestrator run(domain,'subscription'); a chosen
                                     │  SubDomainResult whose spine gates at EXTEND because multi-tenancy is
                                     │  UNMEASURED (the scout never mechanizes it — Stage 3).
                                     ▼
 (B) SUBSCRIPTION-ONLY GUARD   subscription-decision-seam.prepare refuses report.productMode !== 'subscription'
     (fail-closed, §4)             │  → symmetric to the sovereign seam's productMode !== 'sovereign' guard.
                                     ▼
 (C) Human measures            input: { report, subDomainKey, multiTenancy:{ value:'full'|'partial'|'none',
     MULTI-TENANCY                 │        rationale } }  — the one dimension the machine leaves deny-by-default.
                                     ▼
 (D) promoteToForkSubscription PURE. Precondition guard (spine≠null, eligible, license ACCEPT, score.total≥70,
     (mirrors promoteToFork)      │  measuredCount≥3) → deep-copy spine → foldMultiTenancyMeasurement(spine.score,
                                     │  value) [scoring-engine.ts:313, already built] → set record.multiTenancy →
                                     │  decideSourcing([promotedSpine], 'subscription') [harvest-orchestrator.ts].
                                     │  FORK, or refuse (deny-by-default). Verdict machine-computed, never stamped.
                                     ▼
 (E) Build the bound action    ApprovalBinding{ tool:'approve_build_decision_subscription',
                                     │            target:`${domain}/${subDomainKey}`,
                                     │            payloadJson: canonical({decision:'FORK', spine, scoreTotal,
                                     │                                     multiTenancy: value}) }
                                     │  DISTINCT tool name ⇒ a sovereign approval can never be replayed for a
                                     │  subscription build (per-action binding crosses neither mode nor tool).
                                     ▼
 (F) Enqueue (held)            DecisionConsole.enqueue(descriptor, meta)  [Layer 2 seat, unchanged] → actionId.
                                     │  requestedBy = proposingCaller (NEVER the approver).
                                     ▼
 (G) Human APPROVES            DecisionConsole.approve(actionId, operator)  [unchanged] → gate 'approved',
                                     │  approver = real human (≠ 'claude', ≠ caller). — OUTSIDE the seam.
                                     ▼
 (H) assemble → dispatch       ClassDispatcher.dispatch('APPROVAL_REQUIRED_WRITE', { approvalWrite }, ctx)
     MINTS the token               │  [tool-classes.ts:204-211, SHARED] → BridgeApprovalGate consume passes →
                                     │  mintConsumedApproval (module-private) → approvalWrite(approval) invoked.
                                     ▼
 (I) CONSTRUCT (one site)      inside approvalWrite(approval: ConsumedApproval):
                                     │    return { decision: promoted, approval, approvedBy: <from gate resolution>,
                                     │             sourceReport, multiTenancyAssessment:{ value, rationale,
                                     │                               measuredBy:<approver>, gateActionId:actionId } }
                                     │  No approval ⇒ STOP_FOR_APPROVAL ⇒ refused, NO decision.
                                     ▼
 (J) Hand to the Build Planner planBuild({ approved, scaffoldGrant, credential })  [Layer 4, unchanged]
                                     │  Layer 4 reads the decision verbatim; the SCAFFOLD write is its own gate.
```

Returns the same discriminated-union shape as the sovereign seam: `PENDING-APPROVAL` (with the real `actionId`)
or `refused`; and `APPROVED-BUILD-DECISION` or `refused` from assemble. No third branch yields a decision without
the token.

---

## 3. The invariant, preserved identically — new **Prohibition 4k**

> **Invariant (I):** No subscription `ApprovedBuildDecision` can come into existence except from a real,
> human-consumed Approval-Gate approval. The machine cannot self-approve a subscription build.

Guaranteed by the **same three stacked mechanisms** as the sovereign seam (§3 of the sovereign design), because
the subscription seam reuses the same Layer-5 machinery:

1. **Mint unreachable** — `APPROVAL_BRAND` / `mintConsumedApproval` are module-private and never imported/named
   here; `ConsumedApproval` arrives as a **type** from the governed-adapter contract. No token is constructible.
2. **Only a human produces a token** — the sole producer is `ClassDispatcher.consume`, which mints only after
   `BridgeApprovalGate` confirms a still-held, human-APPROVED, per-action-bound, non-self approval.
3. **One construction site** — the `ApprovedBuildDecision` is built only inside `approvalWrite(approval)`, which
   the dispatcher invokes only on the mint path; no token ⇒ `STOP_FOR_APPROVAL` ⇒ `refused`.

**New Prohibition 4k** (added to `write-asks-read-first.test.ts`, additive, keyed to
`subscription-decision-seam.ts`) — a **verbatim mirror of 4i**, retargeted to the new file:

- imports `ConsumedApproval` as a **type** from the governed-adapter contract; tool-classes import brings
  `ClassDispatcher`/`BridgeApprovalGate` **only** (never the token/mint/brand);
- **mints nothing** (no `mintConsumedApproval`, no `mint…(`, no `APPROVAL_BRAND`);
- **no forgery by cast** (no `as ConsumedApproval`, no `as ApprovedBuildDecision`);
- **exactly one** construction — one `approvedBy:`, appearing after the single `approvalWrite:`, and
  `approvalWrite: async (approval: ConsumedApproval)` is present;
- **routes through the real `ClassDispatcher`** for `'APPROVAL_REQUIRED_WRITE'`;
- no `node:fs` / real-write.

Plain terms: *there is no path — no function, no cast, no default — by which a subscription
`ApprovedBuildDecision` is created without the branded `ConsumedApproval` the dispatcher mints only after a real
human's APPROVE.* (4i continues to prove the identical property for the sovereign seam; the two are independent
file-scoped freezes.)

**Why not "reuse 4i"?** 4i reads `build-decision-seam.ts` by path and asserts *exactly one* `approvedBy:` in
*that* file. It cannot see a second file. A separate seam therefore needs its own file-scoped freeze — 4k — which
is the honest way to prove the new construction site is gated. (A shared-helper design would instead need 4k to
cover the helper **and** each caller's callback — more surface, not less.)

---

## 4. Mode fail-closed — both ways, symmetric

| Seam | Guard (in `prepare`, fail-closed first) | Behaviour on wrong-mode report |
|---|---|---|
| sovereign `build-decision-seam` | `report.productMode !== 'sovereign'` ⇒ refuse `stage:'mode'` | **already implemented** (`build-decision-seam.ts:148`) — unchanged |
| subscription `subscription-decision-seam` | `report.productMode !== 'subscription'` ⇒ refuse `stage:'mode'` | **new**, symmetric |

Neither seam can be fed the wrong-mode report: a subscription report hitting the sovereign seam is refused, and a
sovereign report hitting the subscription seam is refused — **before any promotion or gate action**. Defence in
depth beyond the guard: the two use **distinct tool names** in their `ApprovalBinding`
(`approve_build_decision` vs `approve_build_decision_subscription`), so even a leaked/misrouted approval can't be
consumed across seams (per-action binding fails on tool mismatch at `BridgeApprovalGate`). And structurally, a
sovereign spine has no `multi-tenancy` sub-score, so `decideSourcing(_, 'subscription')` on it fails the
multi-tenancy gate → never FORK (mode confusion tightens, never bypasses — already frozen by Prohibition 4j).

---

## 5. Reuse vs. divergence

**Shared (reused as-is — no duplication):**

| Machinery | Source | How the subscription seam uses it |
|---|---|---|
| `ClassDispatcher` + `BridgeApprovalGate` | `tool-classes.ts` (Layer 5) | `new ClassDispatcher(new BridgeApprovalGate(gate, caller))` — same construction |
| module-private mint + brand | `tool-classes.ts:124,136` | never touched — the token path proper |
| `ConsumedApproval` **type** | governed-adapter contract | imported as a type; the `approvalWrite` param |
| `ApprovalGate` | Layer 1 | injected via `SeamDeps.gate` |
| `DecisionConsole` | Layer 2 | injected via `SeamDeps.console` — enqueue + human approves |
| `canonicalPayload` / `ApprovalBinding` | contract | binding fingerprint (per-action) |
| `decideSourcing` | harvest-orchestrator | re-derive the verdict (mode `'subscription'`) |
| construction **discipline** | (pattern) | one site inside `approvalWrite`, no mint/brand/cast |

**Genuinely different (the whole reason it's a sibling):**

| Aspect | Sovereign seam | Subscription seam |
|---|---|---|
| Folded dimension | air-gap (`foldAirGapMeasurement`) | multi-tenancy (`foldMultiTenancyMeasurement`) |
| Measurement values | `'yes' \| 'partial' \| 'no'` | `'full' \| 'partial' \| 'none'` |
| `decideSourcing` mode | `'sovereign'` | `'subscription'` |
| FORK gate dimension | air-gap measured | multi-tenancy measured |
| FORK **threshold** | score ≥ 70, ≥3 measured | **same** — score ≥ 70, ≥3 measured (only the gate dim differs) |
| Binding tool name | `approve_build_decision` | `approve_build_decision_subscription` |
| Provenance field | `airGapAssessment` | `multiTenancyAssessment` (new, §6) |
| `prepare` mode guard | `!== 'sovereign'` | `!== 'subscription'` |

The precondition guard (eligible / ACCEPT / score ≥ 70 / measuredCount ≥ 3) is *identical* logic; it is a pure,
non-security guard and is simply written inline in each seam (sharing it would require importing into the
sovereign seam, violating byte-identical). No token-path code is copied.

---

## 6. Additive — sovereign seam + 4i byte-identical; one new Layer-4 type field

- **Sovereign seam (`build-decision-seam.ts`) is not opened.** Prohibition 4i is unchanged and continues to pass.
- **One additive, optional field on `ApprovedBuildDecision`** (Layer 4, `build-planner.ts`), parallel to the
  existing `airGapAssessment?`:
  ```ts
  readonly multiTenancyAssessment?: {
    readonly value: 'full' | 'partial' | 'none';   // a measurement — never 'unknown'
    readonly rationale: string;
    readonly measuredBy: string;                   // the operator; equals approvedBy
    readonly gateActionId: string;                 // the REAL approved gate action id — never a placeholder
  };
  ```
  Additive: no existing field changes; the planner does not read it (Layer 4 still consumes the decision
  verbatim); Prohibition 4f (build planner) is unaffected. A given decision carries **exactly one** of
  `airGapAssessment` / `multiTenancyAssessment`, identifying which lens promoted it.
- **No gate is loosened**; the mint/brand stay private; `decideSourcing` and the scoring engine are used as-is
  (no new scoring behaviour).

---

## 7. Test plan

| Test | File | Kind | Proves |
|---|---|---|---|
| Prohibition **4k** | `architecture/write-asks-read-first.test.ts` | source-inspection | subscription seam mints nothing, no brand/cast, single construction inside `approvalWrite(approval: ConsumedApproval)`, routes through the real dispatcher |
| 4i unchanged | same file | source-inspection | sovereign seam still frozen (byte-identical) |
| `promoteToForkSubscription` — promote | `subscription-decision-seam.test.ts` | unit | multi-tenancy `'full'` on a ≥70/≥3 EXTEND spine ⇒ FORK; verdict from `decideSourcing('subscription')`, never hand-stamped |
| non-mutation | `subscription-decision-seam.test.ts` | unit | original `SubDomainResult` byte-for-byte unchanged (structuredClone snapshot); only multi-tenancy on the copy moves |
| deny-by-default | `subscription-decision-seam.test.ts` | unit | multi-tenancy `'none'`/`'partial'` that keeps score < 70 ⇒ refused; under-assessed spine ⇒ refused before any gate action |
| happy path | `subscription-decision-seam.test.ts` | behavioral (real gate) | one decision; `approval.approvalId` = the gate approval; `approvedBy` = operator (≠ 'claude'); `multiTenancyAssessment.gateActionId` = the real actionId |
| no-approval / refused / self-approval / 'claude' | `subscription-decision-seam.test.ts` | behavioral | each ⇒ refused, no decision (mirrors the sovereign seam suite) |
| **mode fail-closed both ways** | `subscription-decision-seam.test.ts` + `build-decision-seam.test.ts` | behavioral | subscription seam refuses a sovereign report (`stage:'mode'`); sovereign seam refuses a subscription report (already covered) |
| cross-mode binding | `subscription-decision-seam.test.ts` | behavioral | a sovereign-tool approval cannot assemble a subscription decision (distinct tool name ⇒ consume returns null) |

---

## 8. Out-of-scope, flagged honestly

- **Build Planner notes are sovereign-flavoured.** `buildPlanFor` echoes `record.airGapSuitability` /
  `whiteLabelFit` into its fork-integration notes (`build-planner.ts:211`). A subscription-promoted spine has
  those as `'unknown'` (never measured under subscription), so the plan won't surface the multi-tenancy
  rationale. This is honest (those weren't the criteria) and harmless, but a future planner tweak could surface
  `multiTenancyAssessment`. **Not touched here** — Layer 4 stays untouched.
- **A shared assembly helper** (the §1 alternative) remains available as a later refactor that would unify both
  seams' dispatch glue — but only under a fresh re-verification of 4i, so it is deliberately out of scope.

---

**Approval requested:** review §1 (sibling vs parameterize), §3 (Prohibition 4k mirroring 4i), §4 (symmetric
fail-closed), §5 (reuse vs divergence), and §6 (the additive `multiTenancyAssessment` field). On PASS, the first
implementation prompt writes the failing Prohibition 4k + the seam skeleton, then the seam, per the dual-Claude
loop. **No code until you approve.**
