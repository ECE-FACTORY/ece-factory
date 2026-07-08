# Filesystem Adapter — DRY-RUN (second implementation of the Governed Adapter contract)

`FilesystemAdapterDryRun` **implements** `GovernedAdapter` — it does **not** re-implement the gating. It
inherits the `ConsumedApproval` requirement, write-ahead audit, human attribution, intent-binding, and
fail-closed behavior from the contract (`../governed-adapter/governed-adapter.ts`), and adds **only**
filesystem-specific plan shaping.

## Contract conformance (nothing re-implemented)

- Extends `GovernedAdapter<FilesystemScaffoldIntentDryRun, PlannedFilesystemWrite>`.
- Supplies the two adapter hooks only:
  - **`intentBinding(intent)`** — the `(tool, target, payload)` a scaffold approval is bound to:
    `tool = plan_filesystem_scaffold_dryrun`, `target = intent.basePath` (the sandbox path itself),
    `payload = scaffoldPayload(intent)` (the exact tree).
  - **`shapePlan(intent, approval, boundIntentHash)`** — the inert `PlannedFilesystemWrite`.
- The shared write-governance — dispatch through the REAL `ClassDispatcher`/`BridgeApprovalGate`, fail-closed
  on a missing/replayed/mis-bound approval, **write-ahead audit before the plan**, human attribution, and the
  intent-binding fingerprint — is **inherited**, not duplicated here.

## The dry-run guarantee (incapable by construction)

- The adapter imports **no `node:fs`** (nor `fs`, nor `node:fs/promises`) — **none at all**.
- There is **no** `writeFile` / `mkdir` / `rm` / `cp` / `rename` / `appendFile` (nor `unlink` /
  `createWriteStream`) call **anywhere**. No executor exists.
- `shapePlan` **copies the requested tree into an inert descriptor** and returns it. The plan is data:
  `{ api:'filesystem', basePath, entries:[{ path, kind:'dir'|'file', contents? }], dryRun:true,
  plannedOnly:true, boundIntentHash, boundToApprovalId, note }`.
- The write-capable call requires a real `ConsumedApproval` (mint is module-private to the bridge —
  `mcp-bridge/tool-classes.ts:100-105`); no token ⇒ fail closed. This adapter **mints nothing**.

## The single future-real-executor seam (typed, gated, ABSENT)

- Documented as the **type** `FutureFilesystemExecutor = (plan: PlannedFilesystemWrite, approval:
  ConsumedApproval) => Promise<never>`.
- It is the **one** place a later, separate, human-approved build could attach a real executor — the only
  place `node:fs` would be imported and the only place `mkdir`/`writeFile` would run.
- It stays **type-gated** (requires a `ConsumedApproval`) and would refuse any `basePath` not under
  `SANDBOX_PATH_PREFIX = /tmp/ece-dryrun-` — **sandbox paths only**.
- It exists here as a **type only** — there is no value, no import, no call site. Ready by architecture,
  incapable by construction.

## Known cosmetic wart — the generic plan field name (deliberately NOT renamed)

The contract's plan carrier is generically named — the plan is returned under the contract's generic
`planned` field (base type `PlannedWrite`), a transport-agnostic naming that reads a little oddly for a
filesystem tree (a "write" framing borrowed from the first, HTTP-shaped adapter). It is **reused verbatim and
deliberately not renamed**: renaming the shared contract field would churn the already-committed GitHub
adapter and the Layer-1 law test (Prohibition 4e) for a purely cosmetic gain. The wart is intentional.

## Hard limits (inherited + adapter-specific)

- **No real filesystem mutation exists anywhere** — the tree is a descriptor (data), not a call. No executor.
- The write-capable call requires a real `ConsumedApproval`; no token ⇒ fail closed (enforced by the contract).
- Examples target a **throwaway sandbox** path only (`/tmp/ece-dryrun-…`) — never a real ECE/product tree.
- Secrets are never logged; the adapter holds only an abstract scoped-credential reference (unused in dry-run).
