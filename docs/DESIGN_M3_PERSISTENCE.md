# Design — M3: Factory Persistence Stores + Emitters

**Status:** APPROVED (design only — no implementation yet). Ratifications folded into §2/§3/§5/§8.
**Author attribution:** recorded to the real human who approved this design, never "claude".
**Date:** 2026-07-09 · **Baseline:** origin/main @ `273a0d3` (tree clean) · **Plan:** `docs/UI_MASTERBUILD_PLAN_TIER0.md` Phase 2

> ## Ratified decisions (binding at implementation)
> 1. **Wrappers + injected total sinks, ZERO gated-file edits** — the whole safety argument. The gated files
>    (both seams, planner, executor, gate, console) are not edited; persistence attaches via existing audit hooks
>    + instrumented wrappers.
> 2. **`factory-state/` is git-tracked** (durability via origin; a live run leaves the tree dirty until committed,
>    which the read plane already surfaces in provenance).
> 3. **Widen `PresentProvenance.source` to include `'store-file'`** — the one small additive M2 contract change.
> 4. **Persistence law = Prohibition 4l** (the plan's "4j" is superseded — 4j = product-mode, 4k = subscription seam).
> 5. **evidence-index via an additive `/state/evidence` endpoint + `EvidenceIndex` contract** — not a `StoreState` change.
>
> Confirmed emphasis: the **total-emitter** requirement is driven by the executor's **awaited** audit hook
> (filesystem-executor.ts:341,346) — the one real hazard, neutralized by making every emitter never-throw.

> **Plan reconciliation.** The masterbuild plan's Phase 2 proposes the persistence law as "Prohibition 4j" — that
> number is now **stale**: `4j` is the product-mode no-silent-default law (`a0b5801`) and `4k` is the subscription
> seam freeze (`834a7b6`), both committed since the plan was written. This design uses **Prohibition 4l** (§5).

---

## 0. One-line statement + the central constraint

Durable, **append-only, hash-chained** JSONL stores under a git-tracked `factory-state/`, plus **emitters** that
record the real factory events — so the M2 `StoreAdapter`'s honest `absent` flips to `present` with real records.

**The central constraint — emitters observe, they never gate.** The safest realization, and the one this design
recommends, is that **no gated source file is edited at all**. Persistence attaches only through (a) the
**already-injected audit hooks** the gate / console / executor expose, wired at composition with **total**
store-backed sinks, and (b) thin **instrumented wrappers** around the seams and the build-chain orchestrator that
observe the *returned result* and persist it. The gated code paths stay **byte-identical** (untouched), so their
behavior is provably unchanged — this is a stronger guarantee than in-file emit calls, and it keeps the seam
freezes 4i/4k trivially intact.

---

## 1. The stores

Append-only, hash-chained JSONL under **`factory-state/`** (git-tracked, so origin is the durability layer;
upgradeable to PostgreSQL later without a contract change). Home for the writer: a **new** `src/factory-persistence/`
subsystem (NOT layer-3/6, NOT the read plane — the read plane stays read-only, Rule 0.2).

| Store | Records |
|---|---|
| `approvals.jsonl` | every gate `request` / `approve` / `reject` / `consume` — actionId, approvalId, bound intent hash, approver, tool, timestamps |
| `audit.jsonl` | every factory event — enqueued, approved, decision-assembled, plan-created, planned-write, confirm-issued, files-written, (law/test run, push) |
| `executions.jsonl` | one `ExecutionResult` per sandbox run + a **file-hash manifest** (sha256 of each written file, computed post-write) |
| `evidence-index.jsonl` | evidence refs (report files, plans, execution manifests) with content hashes + `usedBy` links (feeds the future lineage graph) |

(The plan also lists `test-runs.jsonl` / `law-runs.jsonl` — same append-hash-chain mechanism; M2's Law/Test
adapters already *run* the suites, so persisting them is a trivial same-mechanism follow-up. Out of the M3
StoreAdapter-flip scope, noted for continuity.)

### 1.1 The hash-chained record envelope

Every record is wrapped so any tampered/missing record breaks the chain:

```ts
interface ChainedRecord<P> {
  seq: number;            // 0-based, contiguous
  ts: string;             // ISO — when persisted
  prevHash: string;       // sha256 of the prior record's `hash` ('0'×64 for the genesis record)
  payload: P;             // the typed event (schemas via the M2 zod contracts where they align)
  hash: string;           // sha256(`${seq}\n${prevHash}\n${canonicalJson(payload)}`)
}
```

- **Append-only writer:** opens the file with `O_APPEND` (or `appendFile`), never rewrites or deletes a prior
  line. It first reads the last line to get `prevHash`/`seq`, then appends. An empty/absent file is a valid
  genesis state.
- **Payload schemas** reuse the M2 contracts where they align (e.g. the approval's `boundIntentHash`,
  `approvalId`; the execution's `created` manifest) and add M3-specific event schemas in
  `src/factory-persistence/contracts/` (additive — no change to the M2 `read-plane/contracts`).

---

## 2. The emitters — and the per-emitter proof that recording can't gate

**The triad every emitter satisfies (this IS the proof):**
1. **Downstream of the decision** — the emit runs only *after* the gate/mint/write outcome is already computed and
   (for wrappers) already captured as the value to return.
2. **Total** — the emitter is wrapped so it **never throws or rejects**: a persistence failure (disk, permission,
   chain error) is caught and recorded to a fallback (an in-memory failure log + `audit.jsonl` `persist-failure`
   event *best-effort*), then it returns normally. This matters because the **executor `await`s** its audit hook
   (filesystem-executor.ts:341,346) — a throwing sink there *would* break the write; a total sink cannot.
3. **Return-ignored** — the host discards the emitter's return (`void this.audit?.record(…)` at
   approval-gate.ts:167; `void this.audit.append(…)` at decision-console.ts:99/151/154), and the wrappers return
   the *host's own result* regardless of the emit. So even a (hypothetical) non-total emitter's value cannot enter
   the gate.

Together: a decision is computed, then observed. **No emitter's success/failure/latency/return can alter a gate,
mint, or write outcome.** Recording is a pure side-channel.

| Emitter | Attach point | Why it's observational + failure-isolated |
|---|---|---|
| **Approvals sink** | the **existing** `ApprovalGate` audit hook (`opts.audit`, approval-gate.ts:167) + `DecisionConsole` sink (decision-console.ts) — wired at composition with a total store sink | The gate/console FILES are unchanged. They already `void` the sink call — the return is ignored. The total sink never throws. Records `request/approve/reject` (gate) + `enqueued/approved/refused` (console). |
| **Consume + Decision** | a **wrapper** `InstrumentedDecisionSeam` around `BuildDecisionSeam` / `SubscriptionDecisionSeam` — calls the real `assemble(...)`, captures the `AssembleOutcome`, then persists | The seam FILES are **untouched** (4i/4k byte-identical). On `status:'executed'` the wrapper reads the returned `ApprovedBuildDecision` (approvalId, `airGap`/`multiTenancyAssessment.gateActionId`, approvedBy) and writes an approvals `consume` + audit `decision-assembled` + evidence ref — then returns the **same** outcome. The mint already happened inside the real seam; the wrapper cannot un-mint or block it. |
| **BuildPlan + PlannedWrite** | a **wrapper** around `BuildChainOrchestrator.planOnly(...)` | `planOnly` returns inert data (`BuildPlan`, `PlannedFilesystemWrite`). The wrapper persists an audit `plan-created` + evidence ref from the returned value; it never re-plans and holds no write. |
| **ExecutionResult + manifest** | a **wrapper** around `executeFilesystemPlan(...)` (or `BuildChainOrchestrator.execute`) | Runs the real executor, captures the `ExecuteOutcome`; on `ok:true` reads each `created` file **post-write**, computes sha256, writes an `executions` record + audit `files-written`. The write already completed; the manifest read is downstream and total. (This wrapper is preferred over injecting a store sink into the executor's **awaited** audit hook — a wrapper cannot affect the executor even in principle.) |

**Composition, not edits.** All of the above is wired in a **new** composition helper (e.g.
`src/factory-persistence/instrument.ts`) that constructs the total sinks and the wrappers. **Zero lines change in
build-decision-seam.ts, subscription-decision-seam.ts, build-planner.ts, filesystem-executor.ts, approval-gate.ts,
or decision-console.ts.** (Alternative, if you prefer in-file emits: an additive post-decision `void emit(...)` at
the end of each method — rejected here because it edits the 4i/4k-frozen seam files and offers no safety the
wrapper doesn't already give.)

---

## 3. The StoreAdapter flip (M2 → present, read-only, no contract change)

M2's `read-plane/adapters/store-adapter.ts` currently returns `absent` for approvals/audit/executions. M3 makes
it **read** `factory-state/*.jsonl` (via `readFileSync` — allowed under Rule 0.2; the read plane still performs no
write) and flip each to `present`:

- **Provenance** `source:'store-file'` (a new `PresentProvenance.source` value — an additive enum widening, the one
  small M2 contract addition), `locator:{kind:'path', path}`, `pin:{kind:'hash', sha256:<last record hash>}` — so
  the store snapshot is pinned to the tip of the hash chain.
- **`StoreSnapshot`** (already in the M2 contract) is populated: `count` = chain length, `latest` = the last
  record. **No change** to `StoreState`'s shape or to the `Provenanced` union — an empty store flips to
  `present` with `count:0` (present-and-empty is truth), a store with records flips to `present` with the tip.
- **Evidence-index** is exposed via an **additive** new endpoint `/state/evidence` + a new `EvidenceIndex`
  contract (not a change to `StoreState`).

The read path stays **read-only**: the StoreAdapter and the verifier only `readFileSync`; the writer lives in
`src/factory-persistence/`, never in the read plane. (Rule 0.2 continues to forbid any write symbol under
`src/read-plane/`.)

---

## 4. Hash-chain integrity verifier

`src/factory-persistence/verify.ts` — `verifyChain(path): { ok, length, brokenAt? , reason? }`:

- Walks the JSONL line-by-line, recomputing each record's `hash` and checking `record.prevHash === prior.hash`
  and `record.seq === prior.seq + 1`. Any recomputed-hash mismatch (tampered payload), broken `prevHash` link
  (deleted/reordered record), or `seq` gap ⇒ `ok:false` with `brokenAt`.
- **Empty/absent store is VALID** (`ok:true, length:0`) — a fresh factory has remembered nothing yet; that is
  truth, not an error. (Mirrors "an empty store is truth; a mocked record is a lie.")
- Exposed for the law test (§5) and as a read-only check; performs no repair (a broken chain is reported, never
  silently rewritten).

---

## 5. New law — **Prohibition 4l**: the factory can't act without remembering it acted

> **Invariant (4l):** every **consumed** approval has a corresponding **persisted** approval `consume` record AND
> an audit event, pinned to the same `approvalId`. An unrecorded consumption is a law failure.

Added to `write-asks-read-first.test.ts`, additive. Two halves:

1. **Behavioral (the guarantee).** Drive the **instrumented** seam end-to-end against the real gate → on a
   genuine human approval + assemble, assert `approvals.jsonl` contains a `consume` record whose `approvalId`
   equals the gate's, and `audit.jsonl` contains the matching `decision-assembled` event; and
   `verifyChain(approvals) / verifyChain(audit)` pass. (Run against a temp `factory-state/` dir, cleaned up.)
2. **Failure-isolation (the safety).** Inject a **failing writer** into the instrumentation and re-drive: assert
   the seam **still returns the ApprovedBuildDecision** (the gate outcome is unchanged — recording failed, acting
   did not), and that the failure was itself recorded to the fallback. This is the "remembering-failure never
   changes acting" proof.

**4l does not weaken 4i / 4k.** Those freeze the seam FILES by path (mint/brand/cast/one-construction-site). M3
does **not edit** the seam files (wrapper approach), so 4i/4k remain **byte-identical** and continue to pass. 4l
tests the wrapper + composition — purely additive. A source-inspection clause in 4l asserts the seam files are
unchanged-in-spirit: they still import no persistence writer and hold no `appendFile`/store call (persistence
lives only in the wrapper/composition).

---

## 6. Scope + safety boundary

- **Emitters are observational** — the §2 triad (downstream / total / return-ignored) proves no emit can alter a
  gate, mint, or write. The executor's `await`ed audit hook is specifically handled by the **total** rule (and
  avoided via a wrapper for the execution record).
- **The read path stays read-only** — StoreAdapter + verifier only `readFileSync`; the writer is a separate
  subsystem; Rule 0.2 still forbids writes in the read plane.
- **No scoring / decision logic changed** — `scoreCandidate`, `decideSourcing`, `foldAirGap/MultiTenancy`,
  `promoteToFork*`, the planner, the executor's jail/O_EXCL/O_NOFOLLOW — all untouched. Sovereign/subscription
  verdicts (78.5 / 70.8 / 75.4, and the 74.1 subscription reconstruction) unchanged.
- **The seams' token discipline (4i/4k) + construction sites stay byte-identical** — the seam files are not
  edited (wrapper approach).
- **The only new writes** are **append-only** to `factory-state/*.jsonl` — a new, non-jailed durability writer.
  It does not touch the `/tmp/ece-dryrun-` executor jail and does not make the executor non-sole for *that* jail
  (Prohibition 4g/4h are about the sandbox writer among a specific file set; the persistence writer is a distinct
  file writing a distinct tree). The persistence writer has its own discipline: **append-only, hash-chained,
  never overwrites/deletes a prior record** — frozen by a store-integrity test.

---

## 7. Test plan

| Test | File | Kind | Proves |
|---|---|---|---|
| Prohibition **4l** — record-or-fail | `architecture/write-asks-read-first.test.ts` | behavioral + source | consumed ⇒ persisted approval+audit; persistence failure ⇒ decision unchanged; seam files unedited |
| chain integrity | `factory-persistence/verify.test.ts` | unit | tamper/delete/reorder ⇒ chain breaks; empty ⇒ valid |
| append-only writer | `factory-persistence/store.test.ts` | unit | never overwrites; prevHash/seq link correct; concurrent-append safe(-ish) |
| emitter totality | `factory-persistence/emitters.test.ts` | unit | every emitter with a failing writer still returns normally (never throws) |
| approvals/console sink | `factory-persistence/emitters.test.ts` | behavioral | gate/console lifecycle events land as records with real ids |
| seam wrapper | `factory-persistence/instrument.test.ts` | behavioral | consume+decision persisted; the wrapped result equals the raw seam's result (observational) |
| executor wrapper + manifest | `factory-persistence/instrument.test.ts` | behavioral | ExecutionResult persisted; manifest sha256 == `shasum` of the written sandbox files |
| StoreAdapter flip | `read-plane/adapters/adapters.test.ts` | unit | present with `source:'store-file'`, pinned by tip hash; empty store ⇒ present-and-empty |
| 4i/4k byte-identical | `architecture/write-asks-read-first.test.ts` | source | unchanged (regression guard) |
| verdicts unchanged | existing suites | regression | sovereign/subscription scores + verdicts identical |

---

## 8. Ratified (was: open items) — all five settled

1. **Emitter architecture = wrappers + injected total sinks, ZERO gated-file edits.** The gated code paths stay
   byte-identical; recording is a pure side-channel. (This is the whole safety argument.)
2. **`factory-state/` git-tracked** — durability via origin; a live run leaves the tree dirty until committed
   (surfaced in provenance).
3. **`PresentProvenance.source` widened to include `'store-file'`** — additive; no shape change.
4. **Persistence law = Prohibition 4l.**
5. **evidence-index via an additive `/state/evidence` endpoint + `EvidenceIndex` contract** — not a `StoreState`
   change.

On implementation, the first prompt writes the failing Prohibition 4l + the store/verifier skeleton, then the
emitters (wrappers + total sinks), then the StoreAdapter flip — per the dual-Claude loop.
