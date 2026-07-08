# Build Planner — Layer-4 Slice 1 (decision → inert BuildPlan → gated scaffold dry-run)

## What it is

The first Layer-4 slice. It turns an **already-approved** harvest decision into a complete **inert
`BuildPlan`** (pure data describing the product that *would* be built by forking the approved repo),
then feeds that plan to the Layer-5 **filesystem dry-run adapter** to obtain an inert
`PlannedFilesystemWrite`. **No real files. Plan-only. Gated.**

Target case: the **docassemble FORK** decision for *Document Assembly & Generation* from the Legal &
Contract Ops harvest.

## The consume-not-re-decide boundary

Harvest decides **WHAT** to build (`repo-scout → grade → decideSourcing`). Layer 4 plans **HOW**.

- The planner **consumes** the real `SubDomainResult`
  (`harvest-orchestrator.ts:118-124`) exactly as given — it reads `subDomain`, `decision`, `spine`
  (identity/record/score), `licenseOneLine`. It **does not** re-scout, re-grade, or re-decide, and
  it contains no scoring/licensing logic.
- It handles **FORK** decisions with a non-null spine. A non-FORK or null-spine decision is refused
  (`requireForkSpine`) — the planner never manufactures a decision.

## The ApprovedBuildDecision seam — why Layer 4 cannot self-approve

Harvest emits a `SubDomainResult` inside a `HarvestReport` whose terminal status is
`'STOP-AWAITING-HUMAN-APPROVAL'` (`harvest-orchestrator.ts:146`) — a **proposal**, never an approved
artifact. There is no harvest type that says "a human approved *this* fork." `ApprovedBuildDecision`
is that seam, and it is **unforgeable inside Layer 4**:

- Its `approval` field is a real branded **`ConsumedApproval`**
  (`layer-5-action/mcp-bridge/tool-classes.ts:100-104`).
- That token can only be produced by `mintConsumedApproval` (`tool-classes.ts:105`), which is
  **module-private** to the bridge, and its brand symbol (`tool-classes.ts:99`) is **unexported**.
  The only mint site is `ClassDispatcher.consume` (`tool-classes.ts:178`), reached only after
  `BridgeApprovalGate.consumeApproval` validates a still-held, human-**APPROVED**, per-action
  Approval Gate action (no self-approval, never "claude").
- The build-planner imports only the **type**, re-exported by the governed-adapter **contract**
  (`governed-adapter.ts:37`) — never the transport, never any mint. It **exports no mint and calls
  no mint**. So an `ApprovedBuildDecision` cannot be constructed in Layer 4; the planner can only
  **receive** one already assembled by the upstream command layer that ran the gate.

This is the *same* mechanism the write adapters use to make plan-shaping unreachable without a
genuine approval — reused, not re-implemented.

## The scaffold write is a second, independent gate

Emitting the `BuildPlan` is a pure transform. Reaching the filesystem adapter is separately gated:
`planBuild` derives a `FilesystemScaffoldIntentDryRun` (sandbox `/tmp/ece-dryrun-…` path only) and
calls the adapter's `planWrite`, which consumes **its own** real Approval Gate action bound to the
exact scaffold `(tool, target, tree)`. **No scaffold approval ⇒ fail closed ⇒ `planned:null`.** The
planner reaches no write itself.

## What is real plan vs placeholder (the plan is honest about itself)

Every `BuildPlan` section carries `fidelity: 'real-plan' | 'placeholder'`, and `honesty` enumerates both:

- **Real plan:** product structure / scaffold skeleton; fork-integration notes; source-of-truth doc
  list (paths + purpose); packaging manifest identity (name/type/license/forkOf).
- **Placeholder (later slice):** feature-registry entries (stub only); Arabic-first i18n layer
  (planned step, not generated); ECE branding assets (planned step, not generated); fork mechanics
  (notes only — no repo fork performed); source-of-truth doc bodies (paths listed, not authored).

## Safety by construction

- **No `node:fs`** import anywhere in `build-planner.ts`; no `writeFile`/`mkdir`/`rm`. The planner
  returns data and delegates all scaffold planning to the adapter (itself incapable — no `node:fs`).
- **No mint**: build-planner neither exports nor calls `mintConsumedApproval`; it depends on the
  contract's re-exported type, not the transport module.
- **Deterministic**: the same `ApprovedBuildDecision` always yields the same `BuildPlan` (no clock,
  no randomness; the sandbox path is derived purely from the fork identity).
- **Sandbox only**: `sandboxBasePathFor` always returns a throwaway `/tmp/ece-dryrun-…` path.

## Direction of dependency (Layer 4 → Layer 5, gated)

The planner READS Layer-3 decision types and CALLS the Layer-5 filesystem adapter through the
governed-adapter contract — the sanctioned downward, gated direction. It never imports `node:fs`,
performs any write, or reaches any real external/write path. The write-asks-read-first law stays green.
