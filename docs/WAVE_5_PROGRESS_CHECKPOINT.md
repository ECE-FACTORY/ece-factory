# Wave 5 Progress Checkpoint — Action-Layer Core (Phases 8.0–8.5)

> **Status:** Record-only progress checkpoint. **Wave 5 is NOT complete and NOT signed off** — modules remain (see §4).
> Assembled **machine-true** from the phase Step Evidence Packs and `organization-source-of-truth/review/AUTOPILOT_REVIEW_LOG.md` — it states only what those packs/tests show.
> **Repo:** `ece-factory` · **Date:** 2026-06-29 · **Full suite at checkpoint:** **342/342** green vs real PostgreSQL 16.14.

---

## 1. What the action layer now is

Through Waves 1–4 the factory **computed verdicts in isolation** — it could score a repo, compose a product plan, register a risk, all as pure analysis with no reach beyond its own library. Wave 5 (core) changes that: the factory can now **act on the world through a single governed door, with an autonomous driver bounded by construction**. It reads, drafts, and — only with a human key — writes internally and externally. The capability to act arrived together with the gates that bound it; the door was built before anything was allowed through it.

---

## 2. Modules complete in Wave 5 so far

### MCP Bridge — the four-tier governed door (Phases 8.0–8.4) · tested
The single gateway for all factory capability. **35 tools exposed across four tiers**, plus **6 FORBIDDEN** registered-and-refused. Per-tier guarantee (all tested — see the checkpoint doc):

| Tier | Count | Guarantee | Phase |
|------|-------|-----------|-------|
| READ_ONLY | 16 | structural read-only (surface + type + DB SELECT-only); governance reads themselves audited+redacted+permissioned (no internal exemption) | 8.0–8.1 |
| DRAFT_ONLY | 7 | structurally inert — no committed/executed variant; drafting a decision ≠ making it | 8.2 |
| APPROVAL_REQUIRED_WRITE (internal) | 6 | no write without a single-use, per-action, human-approved, unforgeable token; self-approval rejected; kill beats approval; append-only + audit-bracketed | 8.3 |
| APPROVAL_REQUIRED_WRITE (external) | 6 | all of internal **plus** specific-target binding, no-bulk, production gate, blast-radius in audit; the external port is never called on any failure path | 8.4 |
| **FORBIDDEN** | 6 | never callable (refused even with a would-be-valid token); kill switch + audit untargetable | 8.4 |

Full detail: [`MCP_BRIDGE_CHECKPOINT_8_0_TO_8_4.md`](MCP_BRIDGE_CHECKPOINT_8_0_TO_8_4.md).

### Autopilot Runner (Phase 8.5) · tested
The autonomous driver — automates the dual-Claude **messenger** role (read where the build is, draft the next step), never the authority role. **Authority ceiling is structural:**
- acts only through the bridge via a port exposing **only** read + draft — no write/external method to call;
- outcome bounded to propose/await/read/halt — **no executed/committed/approved variant** (type-proven);
- holds **no token machinery** — cannot mint, forge, or self-grant a `ConsumedApproval`;
- **cannot auto-advance a STOP gate** (surfaces it, never flips it);
- **kill switch halts it**; the run is **bounded** (finite, auditable record);
- its reads/drafts are **audited through the bridge** like any caller's — no bypass.

Full detail: [`autopilot.feature.md`](../src/features/autopilot/autopilot.feature.md).

---

## 3. The cross-cutting guarantee of the whole action layer

**Every consequential effect — by any caller, including the autonomous Autopilot — requires a human-minted, single-use, per-action, unforgeable token that no agent can forge or self-grant.** FORBIDDEN actions are closed to everyone. The kill switch and the audit log can never be the target of an action. The factory can act on the world, but **never on its own**: read and propose are autonomous; commit is always a human key.

---

## 4. What REMAINS in Wave 5 (explicitly NOT yet built)

| Module | Note |
|--------|------|
| **Field Creation** | a governed capability behind the proven door — not built |
| **Settings** | a governed capability behind the proven door — not built |
| **PR Engine** (on `open_pull_request`) | built on the Tier-4 external tool (human-approved) — not built |
| **Autopilot trigger / scheduler** | the cron/queue driver that *starts* an Autopilot run — not built; Autopilot stays READ_ONLY/DRAFT_ONLY regardless of trigger |

These are smaller capabilities **behind the proven door / behind the proven ceiling**. **Wave 5 is not signed off** until they are built, tested, and the human grants the wave-boundary sign-off.

---

## 5. What is built-but-NOT-live (the honest deployment boundary)

The bridge and Autopilot are built and proven **against the library** — injected ports, test fakes, and a throwaway test database. **They are not connected to anything live.** The **MCP server entrypoint + live wiring (real git/GitHub/CRM/email/deploy systems, live registries, credentials) + the Claude Code connection** is a **separate, scheduled phase** (`REQUIREMENT_MCP_SERVER_CONNECTION.md`).

The relay-ender (Autopilot) is **built and proven**, but **switching it on is that deployment phase** — not this one. Stated plainly so the build status is not misread as "live": at this checkpoint the governed path exists and is tested; no real external side effect has occurred and nothing is wired to a running system.

---

## 6. Test posture

- **342 / 342 passing** at checkpoint (full accumulated suite, real PostgreSQL 16.14, no mocks on any guard/audit path).
- Per-phase suite totals (from the review log):

| Phase | Built | Suite total |
|-------|-------|-------------|
| 8.0 | MCP Bridge (READ_ONLY proof tool) | 261 |
| 8.1 | 4-class taxonomy + READ_ONLY factory tools | 279 |
| 8.2 | DRAFT_ONLY | 297 |
| 8.3 | APPROVAL_REQUIRED_WRITE (internal) | 313 |
| 8.4 | APPROVAL_REQUIRED_WRITE (external) + FORBIDDEN | 332 |
| 8.5 | Autopilot Runner | 342 |

- Whole suite re-run on a **fresh PostgreSQL cluster** every step (fresh-DB-per-run standard, OPEN_ITEM #7); typecheck + lint exit 0 at every step.

## 7. Standalone-packaging posture

All seven MCP-Bridge files **and** `autopilot.ts` reference other engines **only via `import type`** (verified by `grep` each phase: cross-engine runtime imports = NONE). The guard engines, ports, stores, external systems, Approval Gate, and the bridge tool surface are all **injected**. Zero runtime coupling; each lifts cleanly into its packaging target.

## 8. Carried OPEN_ITEMS + deferred live-wiring

| # | Item | Status |
|---|------|--------|
| #3 | Kill-Switch audit-adapter wiring (concrete adapter at the composition root) | carried |
| #7 | Suite assumes fresh-DB-per-run (count-based tests) | carried → CI/deployment readiness |
| #8 | §5 doc set duplicated (`REQUIRED_DOCS` / `REPO_DOCS`) | carried |
| — | **Live wiring deferred (by design):** external systems + write stores + bridge tool surface are injected ports; real credentials / live registries / the MCP server entrypoint / the Claude Code connection are a deployment-time phase downstream of the human gate | deferred |

None weakens a guarantee; each is additive or a deployment concern.

---

**Action-layer core (8.0–8.5) is complete and documented: a four-tier governed door + an autonomous driver bounded to read-and-propose. Wave 5 is not yet signed off — Field Creation, Settings, the PR Engine, and the Autopilot trigger remain, and live wiring is a separate scheduled phase.**
