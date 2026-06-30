# Feature — PR Engine

**Path:** `src/features/pr-engine/` · **Module:** 30 (Wave 5) · **Status:** **built & tested** (Phase 8.8)
**Governs:** blueprint §30 + `ARCHITECTURE_NOTE_MODEL_TOPOLOGY.md`.

## Purpose
A pull-request workflow **over** the one guarded door. It composes existing tiers — it does not get privileged access and contains **no** approval/token/external-call logic of its own. **Drafting a PR opens nothing; opening a PR requires the full Phase 8.4 external gauntlet.**

## Two structurally-separated stages
- **draft (DRAFT_ONLY):** given a repo target + change description, assemble a proposed PR (title/body/branch/base/file-change summary) and route it through the bridge's DRAFT_ONLY path. `PrDraftOutcome` is `PR-DRAFT-AWAITING-HUMAN-REVIEW | refused` — there is **no opened/committed variant** (type-proven). Drafting never escalates to opening.
- **open (external, APPROVAL_REQUIRED_WRITE):** route through the bridge's `open_pull_request` (Tier 4) under the **full 8.4 gauntlet** — specific-target binding (exact repo+branch+base), single-use human token, no-bulk (one PR per approval), production gate, blast-radius audit, kill-beats-approval, self-approval-rejected. `PR-OPENED` is reachable **only** from the bridge's `EXTERNAL-ACTION-COMMITTED`.

## Inherits the gates — no re-implementation (the core)
The only way the engine opens a PR is the bridge's capability-gated `openPullRequest(capability, …)` (8.8b). There is **no parallel approval/token/external path**. Opening with no / wrong-target / bulk approval ⇒ refused, and the (fake) `open_pull_request` port is **never called**. The open stage's safety is exactly the 8.4 gauntlet, reached through the bridge — `openPullRequest` runs the identical full Phase 8.4 path (this is encapsulation, not a new gate).

## Sole authority — STRUCTURAL (Phase 8.8b)
The PR Engine is the **sole** assembler/opener of pull requests, **by construction**:
- `open_pull_request` is reachable **only** through `bridge.openPullRequest(capability, …)`, which **requires** an unforgeable branded `OpenPrCapability` (module-private `unique symbol` in the bridge — uncostructible/unforgeable outside it, exactly like the approval token).
- the capability is minted only by `bridge.grantPrOpenCapability()`; the PR Engine obtains it once at construction and is its **sole holder**.
- the generic `externalActionWithTool('open_pull_request', …)` **refuses** (stage `encapsulated`) — closing the bypass.
- consumers receive the typed `PrOpener` + `PrRequest` seam only; they have no bridge, no capability, and no way to call `open_pull_request` themselves.
- **Boundary proof:** exactly one production module assembles/opens a PR (`pr-engine.ts`); the bridge merely *defines* the capability seam.

## External stays on fakes (this phase)
`open_pull_request` is wired to the injected **fake** external system (records what would happen; **zero real calls** on every path). The PR Engine is fully built and tested against the fake; **real GitHub wiring waits for the separately-gated external-tier live wiring.**

## Deny-by-default
An unverifiable repo target (missing repo/branch/base), a missing change description, or a PR targeting a **non-existent/unregistered repo** (verified via an injected repo lookup) ⇒ refused. **Instruction-boundary:** a change description that reads like a command is inert content in the PR body, never actioned.

## Standalone packaging
Imports nothing concrete from other engines; the bridge's draft + external ports and the repo lookup are injected (`import type` only). Independently packageable.

## Tests
Pure-logic: stage separation (the draft outcome has no opened/committed variant — type-level); draft assembles a proposal + refuses (deny-by-default); instruction-boundary (command-like description inert in the body). Real PostgreSQL + fake external (zero real calls): draft a PR ⇒ DRAFT-AWAITING-HUMAN-REVIEW, the external port is not called; open with a specific-target single-use human token ⇒ the external port is called once with the exact repo/branch/base, blast-radius audited; open with no / wrong-target / bulk approval ⇒ refused, the external port never called; kill beats approval; self-approval rejected; unregistered repo ⇒ refused.

## Status
**Built & tested (Phase 8.8).** Full accumulated suite green vs real PostgreSQL 16.14.

## Open Items
- Real GitHub wiring for `open_pull_request` is the separately-gated **external-tier live wiring** phase; until then the engine runs against the injected fake (zero real calls).
- Wiring `draft_pull_request` / `open_pull_request` PR-specific tools (vs reusing `draft_repo_plan`) is a thin composition refinement; the stages + gates are complete.
