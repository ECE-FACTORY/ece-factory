# Wave 5 Completion Report — The Action Layer

> **Status:** Wave 5 (all modules) built and tested. **Presented for human wave-boundary sign-off.** Per `BUILD_SEQUENCE_OVERLAY.md`, Wave 6 will not begin until the sign-off is recorded in `organization-source-of-truth/review/AUTOPILOT_REVIEW_LOG.md`.
> Assembled **machine-true** from the per-phase Step Evidence Packs, the review log, and `MCP_INVENTORY_AND_CONNECTION_REPORT.md` — it states only what those artifacts show.
> **Repo:** `ece-factory` · **Date:** 2026-06-30 · **Full suite at wave end:** **432/432** green vs real PostgreSQL 16.14.

---

## 1. What Wave 5 delivered

The factory moved from **"computes verdicts in isolation"** (Waves 1–4) to **"acts on the world through a single governed door, with an autonomous driver bounded by construction"** — and the **read + internal-write halves are live-wired** (real append-only stores, scoped DB roles), while the draft + external halves are fake-backed pending separately-gated live wiring. The capability to act arrived together with the gates that bound it.

## 2. Modules complete

| Module / phase | Proven guarantee(s) | Tested | Standalone packaging |
|---|---|---|---|
| **MCP Bridge — four-tier door + FORBIDDEN (8.0–8.4)** | one guarded door; 4-class taxonomy + dispatch-by-class; READ_ONLY structural; DRAFT_ONLY inert; internal write needs single-use per-action human token; external adds specific-target/no-bulk/production-gate/blast-radius + port-never-called-on-failure; FORBIDDEN never callable; kill/audit untargetable | yes (pure + real PG) | `import type` only; ports injected |
| **Autopilot Runner (8.5)** | autonomous read+propose; authority ceiling structural (port = read+draft; no executed/approved outcome; no token machinery; can't auto-advance a gate); kill halts; bounded; reads/drafts audited | yes (pure + real PG) | bridge injected as a port |
| **MCP server entrypoint + READ_ONLY live wiring (9.0)** | runnable dependency-free stdio JSON-RPC server; pure transport adapter (no new guard logic); exposes exactly the classified surface; READ_ONLY tier live through the full guard stack; SELECT-only DB role | yes (pure + real PG; real stdio proof) | composition root |
| **Internal-write live wiring (9.1)** | the 6 internal-write tools land in real append-only stores; Phase 8.3 token gate unchanged + re-proven against the live store; `ece_writer` INSERT-only on the 3 target tables (no UPDATE/DELETE/TRUNCATE) | yes (real PG) | thin adapters behind `WriteStores` |
| **Settings (8.6)** | read=READ_ONLY, change=APPROVAL_REQUIRED_WRITE (token); the hard floor — no setting can disable/weaken a guard; SECURITY_CRITICAL floored; append-only; deny-by-default | yes (pure + real PG) | gate + store injected |
| **Field Creation (8.7)** | read=READ_ONLY, create/change=APPROVAL_REQUIRED_WRITE; a field definition is INERT (closed declarative constraint vocabulary; no executable content); cannot opt out of redaction; deny-by-default incl. unregistered target; append-only | yes (pure + real PG) | gate + store + lookup injected |
| **PR Engine (8.8) + structural sole-authority (8.8b)** | draft opens nothing (no opened variant, type-proven); open routes through the full 8.4 gauntlet; **sole authority by construction** — unforgeable `OpenPrCapability`, generic external path refuses `open_pull_request`, exactly one assembler module; external on fakes | yes (pure + real PG; boundary grep) | bridge ports injected |
| **Autopilot Scheduler (8.9)** | a clock over Autopilot — grants no new authority (fired outcome is Autopilot's bounded type); consequential ⇒ STOP, port never called; bounded cadence; bounded per run; kill halts; every trigger audited; governed enable/disable; deny-by-default | yes (pure + real PG) | runner/clock/audit/kill/authorizer injected |

## 3. Cross-cutting guarantees of the action layer

- **One guarded door — caller-agnostic, no bypass** (confirmed by the MCP inventory audit: every tool path goes through `McpServerCore → McpBridge`; no direct DB/external bypass).
- **Four-tier risk ladder + FORBIDDEN floor:** READ_ONLY → DRAFT_ONLY → APPROVAL_REQUIRED_WRITE (internal, then external); FORBIDDEN never callable.
- **Every consequential effect requires a single-use, per-action, human-approved, unforgeable token** that no agent can forge or self-grant.
- **Kill switch + audit are untargetable;** kill beats approval.
- **Autopilot + scheduler bounded by construction:** no executed/approved outcome, can't self-approve, can't advance a gate; bounded cadence; kill-stoppable.
- **Settings cannot disable guards;** **field definitions are inert + cannot opt out of redaction;** **PR-Engine sole authority is structural.**

## 4. Live status — the honest deployment boundary

- **READ_ONLY + internal-write: live-wired** (real append-only stores; `ece_app` SELECT-only on the system of record; `ece_writer` INSERT-only on the write tables) — **but not live-running**: there is no persistent DB (only throwaway test clusters), and the MCP server is **not registered in Claude Code**.
- **Draft + external tiers: fake-backed** (canned drafts; `fakeExternalSystems` — zero real external side effects).
- **MCP server: built-not-registered.**
- Full detail: [`MCP_INVENTORY_AND_CONNECTION_REPORT.md`](MCP_INVENTORY_AND_CONNECTION_REPORT.md).

## 5. Test posture

- **432 / 432 passing** at wave end (real PostgreSQL 16.14, no mocks on any guard/audit path). Wave 5 added **+184** tests (Wave 4 ended at 248).
- Per-phase suite totals (build order, from the review log):

| Phase | Built | Suite total |
|-------|-------|-------------|
| 8.0 | MCP Bridge (READ_ONLY proof tool) | 261 |
| 8.1 | 4-class taxonomy + READ_ONLY factory tools | 279 |
| 8.2 | DRAFT_ONLY | 297 |
| 8.3 | APPROVAL_REQUIRED_WRITE (internal) | 313 |
| 8.4 | APPROVAL_REQUIRED_WRITE (external) + FORBIDDEN | 332 |
| 8.5 | Autopilot Runner | 342 |
| 9.0 | MCP server entrypoint + READ_ONLY live wiring | 356 |
| 9.1 | Internal-write live wiring | 365 |
| 8.6 | Settings | 383 |
| 8.7 | Field Creation | 404 |
| 8.8 | PR Engine | 419 |
| 8.8b | PR-Engine sole-authority (structural) | 423 |
| 8.9 | Autopilot Scheduler | 432 |

- Whole suite re-run on a **fresh PostgreSQL cluster** every step (OPEN_ITEM #7); typecheck + lint exit 0 each step.

## 6. Standalone-packaging posture

Every Wave-5 engine references other engines **only via `import type`** (verified by `grep` each phase). The MCP server (`src/mcp-server/`) is the composition root where concrete wiring is allowed; the engines stay standalone. The runnable server uses Node 26's built-in TS support + the bundled `typescript` devDependency — **no new runtime dependency** across the entire wave.

## 7. Carried roadmap / OPEN_ITEMS (deferred work, recorded not lost)

| # | Item | Closes in |
|---|------|-----------|
| #3 | Kill-Switch audit-adapter wiring | composition root |
| #7 | Fresh-DB-per-run test isolation | CI / deployment readiness |
| #8 | §5 doc set duplication | later shared-constant refactor |
| **#9** | **External-tier sole-authority parity** (per-action capability owners, parity with PR Engine) | **external-tier live-wiring phase** |
| **#10** | **Tier-status health check (`/healthz`)** (live vs fake never mistaken) | **deployment-readiness / before-live-external** |
| — | Persistent infra + Claude Code registration + live verification | deployment phase |
| — | External-tier sole-authority + live adapters (GitHub/CRM/email/deploy) | external-tier live-wiring phase (separately gated) |
| — | `ConfigChangeAuthorizer` → Settings token path (scheduler enable/disable) | before-scheduler-live |
| — | Expose Settings + Field-Creation as bridge tools | next |
| — | Operator runbook + backup/recovery for the persistent audit/append-only DB | deployment readiness |

None weakens a delivered guarantee; each is additive, a deployment concern, or a deliberate documented deferral.

---

**The action layer is complete: a four-tier governed door + an autonomous driver bounded by construction, with read + internal-write live-wired and draft + external fake-backed pending separately-gated live wiring. Wave 5 is presented for the human wave-boundary sign-off; Wave 6 will not begin until that decision is recorded.**
