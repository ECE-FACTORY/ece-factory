# Build Chain Orchestrator (Layer-4 Build-Harden)

The **first end-to-end build chain**: it composes three already-proven, already-committed modules into a
single flow, **without modifying any of them**.

| Piece (unchanged) | Layer | Role in the chain |
| --- | --- | --- |
| `build-planner` | 4 | `ApprovedBuildDecision` → inert `BuildPlan` → (gated) dry-run `PlannedFilesystemWrite` |
| `filesystem-adapter-dryrun` | 5 | shapes the inert `PlannedFilesystemWrite` — imports no `node:fs` |
| `filesystem-executor` | 5 | the **sole real writer** — jailed to `/tmp/ece-dryrun-`, approval-gated, mints nothing |

The orchestrator imports each as a black box. It **reimplements nothing, re-binds nothing, and modifies
nothing**. It holds no capability of its own: **no `node:fs`, mints nothing, cannot self-confirm.**

---

## Two phases, with a plan-then-confirm gate between them

### Phase A — `planOnly(input)` — automatic, safe to run freely
Drives the full chain **up to (never into)** the real write:

```
ApprovedBuildDecision → build-planner → BuildPlan → filesystem-adapter-dryrun → PlannedFilesystemWrite
```

Returns `{ buildPlan, plannedWrite, targetPaths, scaffold }` — the inert plan plus **the exact directory/file
paths** Phase B would create, for a human to inspect. **No real write happens**: `planOnly` never calls the
executor, and this file imports no `node:fs`.

`planOnly` takes the full `BuildPlannerInput` (approved decision **and** the scaffold-planning grant) because
the dry-run adapter is itself gated — absent the scaffold approval it **fail-closes** and `plannedWrite` is
`null` (so Phase B cannot run at all).

### Phase B — `execute(plannedWrite, approval, confirm, ctx)` — doubly gated
Performs a **real write only when BOTH** are present:

1. **A genuine `ConsumedApproval`** — the branded, unforgeable token whose mint is module-private to the
   bridge. The orchestrator **mints nothing**; it can only *receive* one.
2. **An explicit `HumanExecuteConfirm`** — a human-supplied go-ahead (`token === EXECUTE_CONFIRM_TOKEN`,
   `confirmedBy` a real human, never `"claude"`). The orchestrator **cannot supply this itself** — same
   discipline as no-self-mint.

Missing/invalid confirm ⇒ **REFUSE, write nothing**. Missing approval ⇒ **REFUSE, write nothing**. Only with
**both** does it delegate to the `filesystem-executor`, which then applies its *own* hard guarantees: the
`/tmp/ece-dryrun-` jail, `approval.approvalId === plan.boundToApprovalId` binding, all-or-nothing validation,
and an `O_EXCL | O_NOFOLLOW` create. The orchestrator adds a gate **in front of** the executor; it never
loosens the executor.

---

## Why the two-phase split is the safety property

The chain runs everything expensive/complex **automatically** (Phase A) so a human sees the fully-planned
scaffold and its exact paths, then the **irreversible step is isolated behind a second, explicit, out-of-band
confirmation** the machine cannot fabricate. Plan freely; write only on a deliberate, separate human act.

- **No self-confirm** — `execute` requires `confirm` as a mandatory argument; `planOnly` never calls the
  executor; the sole executor call site sits **after** the confirm gate.
- **No self-mint** — the orchestrator constructs no `ConsumedApproval` and no passing `HumanExecuteConfirm`;
  there is no `mint…(` call and no `{ token: EXECUTE_CONFIRM_TOKEN }` construction anywhere in it.
- **No disk access of its own** — no `node:fs`/`fs` import; only the (black-box) executor touches disk.

---

## Composition finding (reported, not worked around)

The executor binds a plan to the **scaffold-planning approval's id** (`approval.approvalId ===
plan.boundToApprovalId`). So the genuine `ConsumedApproval` Phase B presents is the **same human APPROVE**
(re-materialized as a token) that authorized the scaffold at that exact path/payload — and the **genuinely
separate** second gate is the explicit `HumanExecuteConfirm`. This composes cleanly with no changes to any of
the three modules; it is documented here rather than "fixed" by re-binding the plan (which the orchestrator
must not do).

---

## Governance

- **Law 4h** (additive, in `src/architecture/write-asks-read-first.test.ts`) freezes: the orchestrator imports
  no `node:fs`, mints nothing, the executor call is confirm-gated, and `execute` requires both approval and
  confirm. It does **not** weaken laws 4e/4f/4g.
- Attribution is to the **real human** (`confirmedBy` / the executor's `human` actor), never `"claude"`.
- Real writes remain confined to the executor's `/tmp/ece-dryrun-` sandbox jail. No GitHub, no network, no
  MCP, no real repo creation.
