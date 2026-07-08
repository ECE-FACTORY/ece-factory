# Feature — Filesystem Executor (the factory's FIRST and ONLY real-write module)

## What this is

`filesystem-executor.ts` is the **first module in the ECE Factory that performs a real filesystem write.**
Every prior write-capable module was incapable *by construction*:

- `../filesystem-adapter-dryrun/` — imports **no** `node:fs`; emits an inert `PlannedFilesystemWrite` (data only).
- `../github-adapter-dryrun/` — imports no real-write client; emits an inert plan.
- `../../layer-4-build-harden/build-planner/` — returns a `BuildPlan` (data) and **delegates**; touches no store.

Law **4e/4f** (`src/architecture/write-asks-read-first.test.ts`) freeze that those three cannot write and cannot
mint. This executor is the deliberate, guarded carve-out proven by the new Law **4g**: it imports `node:fs` — the
**one sanctioned place** — and it materializes an *already-approved, already-planned* scaffold onto disk.

It does **not** decide, plan, scout, or mint. It **executes** a plan someone already approved.

## The five fences (the entire point)

1. **Sandbox jail — hard, non-configurable.** The executor writes **only** under `/tmp/ece-dryrun-…`.
   `JAIL_PREFIX = '/tmp/ece-dryrun-'` is a **module constant** — not a parameter, not a field, not overridable.
   For every base and every entry:
   - The resolved *logical* path must pass a literal `startsWith('/tmp/ece-dryrun-')` check, must stay within the
     base, and must not be absolute or contain `..`.
   - The **real canonical** path (via `realpath`, following symlinks) must live inside the *canonicalized* sandbox
     base — which itself must sit under the *canonical* jail prefix. `/tmp` is canonicalized from the real `/tmp`
     (handling macOS `/tmp → /private/tmp`), so a symlinked base or a symlink planted in an existing ancestor is
     caught: its real path falls outside the base and is **refused**. There is no code path that writes elsewhere.

2. **Approval-gated — mints nothing.** The executor requires a genuine branded `ConsumedApproval`
   (`../mcp-bridge/tool-classes.ts:100-104`, re-exported by the governed-adapter contract). That token's mint
   `mintConsumedApproval` (`tool-classes.ts:105`) is **module-private to the bridge**, so this executor is
   unreachable without a real, dispatcher-minted approval, and it **constructs no token itself**. The presented
   token must be **bound to this plan**: `approval.approvalId === plan.boundToApprovalId`. A missing or mismatched
   approval ⇒ **refuse, write nothing.**

3. **All-or-nothing.** The **entire** plan is validated (approval bound, every path in-jail, nothing pre-exists)
   **before a single byte is written.** If any check fails, it aborts and writes **nothing** — no partial scaffold.

4. **Audit before write.** The intent (which plan, which approval, which paths) is recorded and **awaited before**
   the first real `fs` call; the outcome is recorded after; a refusal is recorded when denied.

5. **No destructive ops.** It only `mkdir`s directories and writes **new** files with the `wx` exclusive flag
   (fails rather than overwrites). It never deletes, renames, truncates, or overwrites. **Refuse-on-exist** is the
   default: if any target already exists, refuse. The **sole** relaxation is an explicitly opted-in
   `createFreshInEmptySandbox` — and even then the base must be an **empty** directory and individual targets must
   still not exist.

## Inputs / outputs

- **In:** a `PlannedFilesystemWrite` (from the dry-run adapter/planner — untouched, still incapable), a genuine
  `ConsumedApproval`, and an `ExecuteContext` (audit sink, human actor, org id, environment).
- **Out:** `{ ok: true, status: 'written', created: [...] }` with the real paths created, or
  `{ ok: false, status: 'refused' | 'error', reason }` with **nothing** written on any refusal.

## What it deliberately does NOT do

- No network, no GitHub, no MCP, no deploy, no repo creation.
- No minting of approvals or capabilities.
- No writing outside `/tmp/ece-dryrun-…`. No deletes, no overwrites, no renames.
- It does not modify or weaken the dry-run adapter or the build planner — those stay incapable, and Law 4e/4f
  still prove it. Law 4g proves the **sole** real writer is gated + jailed.
