# MCP Bridge Checkpoint — The Four-Tier Governed Door (Phases 8.0–8.4)

> **Status:** Record-only checkpoint. The MCP Bridge (Module 1, Wave 5) is the single governed gateway for all factory capabilities. Phases 8.0→8.4 built it out one risk tier at a time, starting read-only and ending with hardened external actions + an active FORBIDDEN tier.
> Assembled **machine-true** from the five phase Step Evidence Packs and `organization-source-of-truth/review/AUTOPILOT_REVIEW_LOG.md` — it states only what those packs/tests show.
> **Repo:** `ece-factory` · **Path:** `src/features/mcp-bridge/` · **Packaging target:** `ece-mcp-bridge` · **Date:** 2026-06-29 · **Full suite at checkpoint:** **332/332** green vs real PostgreSQL 16.14.

---

## 1. The complete capability surface — 35 exposed tools by tier (+ 6 FORBIDDEN, never exposed)

### Tier 1 — READ_ONLY (16) · phases 8.0–8.1
*Can do:* read the system of record and factory/governance state. *Bounded by:* structural read-only — no write/mutation path; outcome type has no write variant; the system-of-record DB role is **SELECT-only**.

| Tool | Source |
|------|--------|
| `search_clients` | system of record (8.0) |
| `read_factory_status` · `read_wave_status` · `read_module_status` · `read_open_gates` | factory state (8.1) |
| `read_review_log` · `read_evidence_pack` · `read_open_items` | governance logs (8.1) |
| `read_domain_registry` · `read_project_registry` · `read_feature_registry` · `read_risk_register` | registries (8.1) |
| `read_product_creation_plan` · `read_repo_build_plan` | plans (8.1) |
| `read_tool_registry` · `read_audit_summary` | **permissioned** capabilities — operator-only (8.1) |

### Tier 2 — DRAFT_ONLY (7) · phase 8.2
*Can do:* read inputs and return a **proposed artifact**. *Bounded by:* structural inertness — success is the literal `DRAFT-AWAITING-HUMAN-REVIEW`; no committed/executed/recorded variant; nothing is mutated.

| Tool |
|------|
| `draft_next_prompt` · `draft_review_decision` · `draft_wave_report` · `draft_product_plan` · `draft_risk_summary` · `draft_open_items_summary` · `draft_repo_plan` |

(`draft_review_decision`, `draft_wave_report` are operator-only.)

### Tier 3 — APPROVAL_REQUIRED_WRITE, internal (6) · phase 8.3
*Can do:* mutate internal factory state (append-only stores). *Bounded by:* a single-use, per-action-bound, human-approved, unforgeable `ConsumedApproval` token; outcome `WRITE-COMMITTED` only via that token.

| Tool |
|------|
| `record_review_decision` · `create_open_item` · `record_approval_gate` · `update_risk_status` (operator-only) |
| `record_human_signoff` · `record_wave_signoff` (**admin-only**) |

### Tier 4 — APPROVAL_REQUIRED_WRITE, external (6) · phase 8.4
*Can do:* act on systems outside the factory (via **injected ports** — no real side effects in this build). *Bounded by:* all of Tier 3 **plus** specific-target+effect binding, no-bulk, production gate, blast-radius in the audit record; outcome `EXTERNAL-ACTION-COMMITTED` only via the token + full hardening.

| Tool |
|------|
| `open_pull_request` · `create_ticket` · `update_crm_record` · `send_email` (operator-only) |
| `create_github_repo` · `deploy_package` (**admin-only**) |

### FORBIDDEN (6) · phase 8.4 — registered & classified, **never exposed, never callable**
*Refused before any approval is considered (refused even with a would-be-valid token).*

| Tool |
|------|
| `force_delete_repo` · `rewrite_git_history` · `mass_delete` · `disable_audit` · `disable_kill_switch` · `bulk_export_pii` |

---

## 2. The guarantee ladder, per tier (proving phase · tested)

| Tier | Structural guarantee | Proving phase | Tested |
|------|----------------------|---------------|--------|
| **READ_ONLY** | Read-only at surface **+** type **+** DB SELECT-only privilege; full guard stack on every call; **no-internal-exemption** — governance-state reads (`read_audit_summary`/`read_review_log`) are themselves audited + redacted + permissioned | 8.0–8.1 | yes — real PostgreSQL (audited+redacted read; SELECT-only role denies writes) + pure-logic |
| **DRAFT_ONLY** | Structurally inert — no `committed`/`executed`/`recorded` outcome variant (type-level); stores **and** DB unchanged after drafting; **drafting a decision ≠ making it** (proposing PASS still yields `DRAFT-AWAITING-HUMAN-REVIEW`); draft production itself audited + redacted | 8.2 | yes — pure-logic inertness (observable stores) + real PostgreSQL (audited+redacted; client count unchanged) |
| **APPROVAL_REQUIRED_WRITE (internal)** | No write without a **single-use, per-action-bound, human-approved, unforgeable** `ConsumedApproval`; self-approval rejected (adapter **and** engine); **kill beats approval** (token preserved); append-only + audit-bracketed (intent before, result after); token consumed only on commit | 8.3 | yes — pure-logic (single-use/per-action/self-approval/unforgeable) + real PostgreSQL (commit audit-bracketed; no-approval store+audit untouched; replay refused; kill beats approval) |
| **APPROVAL_REQUIRED_WRITE (external)** | All of Tier 3 **plus** specific-target+effect binding (vague/target-less refused), **no-bulk**, **production gate**, **blast-radius in the audit intent**; the external port is **never called on any failure path** (fails closed before the side effect) | 8.4 | yes — pure-logic (fakes record zero calls on every refusal path) + real PostgreSQL (blast-radius in audit; no-approval port-never-called + no audit; kill beats approval) |
| **FORBIDDEN** | Never callable even with a would-be-valid token; the **kill switch and audit can never be the target** of an external action | 8.4 | yes — pure-logic (refused even with token; protected-subsystem target refused) |

---

## 3. Cross-cutting invariants (hold across all tiers)

- **One guarded door — caller-agnostic.** Every caller (operator, Pulse Layer, autonomous backend) reaches every capability through the same entrypoints; there is no privileged internal shortcut or backend bypass.
- **Dispatch-by-class.** A tool's registered class selects the only execution path available to it; a lower-privilege class can never reach a higher-privilege path (the entrypoint offers only its class's handler slot).
- **Instruction-boundary.** Data returned from the system of record, registries, or logs — and inputs read for drafting — are inert. A record/field that reads like a command is never actioned.
- **Deny-by-default.** Unknown/unverifiable/unregistered/unapproved ⇒ refused or withheld, never "probably fine."
- **Per-tool permissioning.** Sensitive capabilities require a higher role (the tool-map and audit trail; sign-offs; deploy/repo-creation) — not every caller gets every tool.
- **Full guard stack on every call (no exemption):** Tool Registry (fail-closed) → dispatch-by-class → Permission Engine (deny-by-default) → Kill Switch (beats all) → write-ahead Audit (intent before / result after) → Redaction (deny-by-default allowlist) → refusal-audit on REFUSE.

---

## 4. What this means for the autonomous callers to come (Pulse, Autopilot)

The Pulse Layer and any autonomous runner are **READ_ONLY/DRAFT_ONLY by authority limit**: they may read state and **propose** (draft) actions, but a Tier-3 internal write or a Tier-4 external action requires a single-use, human-minted `ConsumedApproval` token that they **cannot forge** (module-private brand) and **cannot self-grant** (self-approval rejected). The door is precisely what makes an autonomous runner safe to build next: it can drive — read, analyze, propose — but **every consequential effect still needs a human key**, and FORBIDDEN actions are closed to everyone. An autonomous caller that goes rogue can, at most, produce drafts a human must approve.

---

## 5. Test posture

- **332 / 332 passing** at checkpoint (full accumulated suite, real PostgreSQL 16.14, no mocks on any guard or audit path).
- Bridge-tier additions, from the recorded suite totals:

| Phase | Tier built | Suite total | Δ tests |
|-------|-----------|-------------|---------|
| 8.0 | READ_ONLY (the proof tool) | 261 | +13 |
| 8.1 | 4-class taxonomy + READ_ONLY factory tools | 279 | +18 |
| 8.2 | DRAFT_ONLY | 297 | +18 |
| 8.3 | APPROVAL_REQUIRED_WRITE (internal) | 313 | +16 |
| 8.4 | APPROVAL_REQUIRED_WRITE (external) + FORBIDDEN | 332 | +19 |

- The **whole** suite is re-run on a **fresh PostgreSQL cluster** every step (the fresh-DB-per-run standard, OPEN_ITEM #7); typecheck + lint exit 0 at every step.

## 6. Standalone-packaging posture

All seven bridge files — `mcp-bridge.ts`, `tool-classes.ts`, `factory-read-tools.ts`, `draft-tools.ts`, `write-tools.ts`, `external-tools.ts`, `postgres-client-readmodel.ts` — reference other engines **only via `import type`** (verified by `grep` each phase: cross-engine runtime imports = NONE). The guard engines, the read model, the read/draft/write/external ports, and the Approval Gate are all **injected**. The bridge therefore has zero runtime coupling and lifts cleanly into the `ece-mcp-bridge` packaging repo per `REQUIREMENT_PRODUCT_APP_PACKAGING.md`.

## 7. Carried OPEN_ITEMS + deferred live-wiring

| # | Item | Status |
|---|------|--------|
| #3 | Kill-Switch audit-adapter wiring (concrete Audit Engine adapter at the composition root) | carried |
| #7 | Suite assumes fresh-DB-per-run (count-based tests) | carried → CI/deployment readiness |
| #8 | §5 doc set duplicated (`REQUIRED_DOCS` / `REPO_DOCS`) | carried |
| — | **Live wiring deferred:** external systems (git/GitHub/CRM/email/deploy) and the internal write stores are **injected ports**. Real credentials / live registries are a **deployment-time composition downstream of the human gate** — this checkpoint proves the governed path, not live side effects. | deferred (by design) |

None weakens a tier guarantee; each is additive or a deployment concern.

---

**The four-tier governed door is complete:** read → propose → internal write (token) → external action (token + hardening), with FORBIDDEN closed to all. Every consequential effect routes through one door and ends at a human key.
