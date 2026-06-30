# Feature Registry — ECE Factory

> Per Layer 2 §8. Every feature: name, path, status, guarantees, tests, related components. Kept aligned with code.

| Feature | Path | Module | Status | Feature file |
|---------|------|--------|--------|--------------|
| Audit Engine | `src/features/audit-engine/` | 23 (Wave 1 ROOT) | **Core complete (built & tested)** | [audit-engine.feature.md](../src/features/audit-engine/audit-engine.feature.md) |
| Redaction Engine | `src/features/redaction-engine/` | 24 (Wave 1 ROOT) | **Built & tested** (deny-by-default, standalone) | [redaction-engine.feature.md](../src/features/redaction-engine/redaction-engine.feature.md) |
| Tool Registry | `src/features/tool-registry/` | 21 (Wave 1 ROOT) | **Built & tested** (no hidden tools, standalone) | [tool-registry.feature.md](../src/features/tool-registry/tool-registry.feature.md) |
| Permission Engine | `src/features/permission-engine/` | 22 (Wave 1 ROOT) | **Built & tested** (deny-by-default; ALLOW/REFUSE/STOP_FOR_APPROVAL; replaced allow-all stub) | [permission-engine.feature.md](../src/features/permission-engine/permission-engine.feature.md) |
| Kill Switch | `src/features/kill-switch/` | 33 (Wave 1 ROOT) | **Built & tested** (6 scopes; immediate runtime effect; kill-beats-all; standalone) | [kill-switch.feature.md](../src/features/kill-switch/kill-switch.feature.md) |
| Evidence Pack Engine | `src/features/evidence-pack/` | 16 (Wave 1 ROOT) | **Built & tested** (machine-true-evidence; required-section completeness; standalone) | [evidence-pack.feature.md](../src/features/evidence-pack/evidence-pack.feature.md) |
| License & Compliance Engine | `src/features/license-compliance/` | 10 (Wave 1 ROOT) | **Built & tested** (text-over-badge SPDX classify; off-allowlist⇒needs-review; stack verdict; standalone) | [license-compliance.feature.md](../src/features/license-compliance/license-compliance.feature.md) |

**Wave 1 ROOTs complete:** 23 Audit · 24 Redaction · 21 Tool Registry · 22 Permission · 33 Kill Switch · 16 Evidence Pack · 10 License & Compliance.

## Wave 2 — Review Spine

| Feature | Path | Module | Status | Feature file |
|---------|------|--------|--------|--------------|
| Dual-Claude Review Engine | `src/features/review-engine/` | 15 (Wave 2) | **Built & tested** (PASS requires valid machine-true evidence + §22 re-derivation; deny-by-default; standalone) | [review-engine.feature.md](../src/features/review-engine/review-engine.feature.md) |
| Approval Gate Engine | `src/features/approval-gate/` | 17 (Wave 2) | **Built & tested** (per-action single-use approval; deny-by-default; approver-is-human; standalone) | [approval-gate.feature.md](../src/features/approval-gate/approval-gate.feature.md) |
| Compliance Checker | `src/features/compliance-checker/` | 26 (Wave 2) | **Built & tested** (11 governance invariants; deny-by-default; Compliant/Warning/Fail/STOP; standalone) | [compliance-checker.feature.md](../src/features/compliance-checker/compliance-checker.feature.md) |

**Wave 2 Review Spine complete:** 15 Dual-Claude Review · 17 Approval Gate · 26 Compliance Checker.

## Wave 3 — Sourcing & Build CORE

| Feature | Path | Module | Status | Feature file |
|---------|------|--------|--------|--------------|
| Repo Intelligence Engine | `src/features/repo-intelligence/` | 9 (Wave 3) | **Built & tested** (factory memory; repo text inert; deny-by-default eligibility; append-only PostgreSQL) | [repo-intelligence.feature.md](../src/features/repo-intelligence/repo-intelligence.feature.md) |
| Repository Scoring Engine | `src/features/scoring-engine/` | 11 (Wave 3) | **Built & tested** (§3 rubric /100; License-0 auto-reject; §3.9 70+ flag; deny-by-default pessimistic; standalone) | [scoring-engine.feature.md](../src/features/scoring-engine/scoring-engine.feature.md) |
| Sovereign Readiness Engine | `src/features/sovereign-readiness/` | 12 (Wave 3) | **Built & tested** (§8 checklist; deny-by-default unknown≠offline; Acceptable/after-hardening/Non-sovereign/Rejected; standalone) | [sovereign-readiness.feature.md](../src/features/sovereign-readiness/sovereign-readiness.feature.md) |
| White-Label Hardening Engine | `src/features/white-label/` | 13 (Wave 3) | **Built & tested** (§9 taxonomy; must-keep never stripped; deny-by-default unclassified=caution; Ready/after-stripping/Blocked-by-legal) | [white-label.feature.md](../src/features/white-label/white-label.feature.md) |
| Product Spine Engine | `src/features/product-spine/` | 14 (Wave 3) | **Built & tested** (§4 no-clear-spine⇒Rejected; §5 Anti-Frankenstein downgrade; SPOF; deny-by-default compatibility; standalone) | [product-spine.feature.md](../src/features/product-spine/product-spine.feature.md) |
| Harvest Engine | `src/features/harvest-engine/` | 8 (Wave 3) | **Built & tested** (orchestrates 9/11/12/13/14; §3.8 two-pass escalation; always ends STOP, never self-approves; deny-by-default surfacing; standalone) | [harvest-engine.feature.md](../src/features/harvest-engine/harvest-engine.feature.md) |

**Wave 3 Sourcing & Build CORE complete:** 9 Repo Intelligence · 11 Scoring · 12 Sovereign Readiness · 13 White-Label · 14 Product Spine · 8 Harvest.

## Wave 4 — Registries & Repo Operations CORE

| Feature | Path | Module | Status | Feature file |
|---------|------|--------|--------|--------------|
| Domain Registry | `src/features/domain-registry/` | 4 (Wave 4) | **Built & tested** (§4.1 model; deny-by-default validation; append-only PostgreSQL history; standalone) | [domain-registry.feature.md](../src/features/domain-registry/domain-registry.feature.md) |
| Project Registry | `src/features/project-registry/` | 5 (Wave 4) | **Built & tested** (§5.4 status vocab; deny-by-default + domain-registered check; harvest-before-build gate; append-only PostgreSQL; standalone) | [project-registry.feature.md](../src/features/project-registry/project-registry.feature.md) |
| Source-of-Truth Doc Engine | `src/features/doc-engine/` | 27 (Wave 4) | **Built & tested** (§5 required docs; no-placeholders; bidirectional code↔docs alignment; deny-by-default; standalone) | [doc-engine.feature.md](../src/features/doc-engine/doc-engine.feature.md) |
| Feature Registry Engine | `src/features/feature-registry/` | 28 (Wave 4) | **Built & tested** (§8 no-feature-only-in-code; built-without-tests/permissions flagged; deny-by-default; standalone) | [feature-registry.feature.md](../src/features/feature-registry/feature-registry.feature.md) |
| Repo Builder / Operator | `src/features/repo-builder/` | 29 (Wave 4) | **Built & tested** (§5 governed-repo plan; plans-only/never-executes; harvest-before-build gate inherited; deny-by-default; standalone) | [repo-builder.feature.md](../src/features/repo-builder/repo-builder.feature.md) |
| Risk Register | `src/features/risk-register/` | 31 (Wave 4) | **Built & tested** (§31 typed register; deny-by-default validation; open-risk surfacer (unmitigated high/critical surfaced as blocking); append-only PostgreSQL; standalone) | [risk-register.feature.md](../src/features/risk-register/risk-register.feature.md) |
| Product Creation Engine | `src/features/product-creation/` | 6 (Wave 4 — capstone) | **Built & tested** (composes Wave 1–4 via injected ports/types; plans only — single literal PLAN-AWAITING-APPROVAL, type-proven no created/executed/approved state; harvest-before-build + deny-by-default inherited; blocking risks surfaced not buried; standalone) | [product-creation.feature.md](../src/features/product-creation/product-creation.feature.md) |

**Wave 4 Registries & Repo Operations CORE complete:** 4 Domain · 5 Project · 27 Doc · 28 Feature · 29 Repo Builder · 31 Risk Register · 6 Product Creation.

## Wave 5 — Bridge & Action Layer

| Feature | Path | Module | Status | Feature file |
|---------|------|--------|--------|--------------|
| MCP Server Entrypoint | `src/mcp-server/` | — (Phase 9.0→9.1) | **Built & tested** — runnable dependency-free MCP server over stdio (JSON-RPC 2.0); pure transport adapter over McpBridge (no new guard logic); exposes exactly the 35-tool classified surface (FORBIDDEN registered-and-refused); READ_ONLY tier LIVE (SELECT-only role) + **internal-write tier LIVE** (append-only stores via LiveWriteStores; Phase 8.3 token gate unchanged — single-use/per-action/human-approved/unforgeable; no token ⇒ STOP, nothing written; append-only DB-enforced; `ece_writer` role INSERT-only on 3 target tables, no UPDATE/DELETE/TRUNCATE, no system-of-record/external access); external+FORBIDDEN still on fakes; no committed credentials. Claude Code connection = human's manual step | [mcp-server.feature.md](../src/mcp-server/mcp-server.feature.md) |
| PR Engine | `src/features/pr-engine/` | 30 (Wave 5) | **Built & tested** (Phase 8.8) — PR workflow over the one guarded door (no new guard logic, no privileged access); DRAFT stage (DRAFT_ONLY) assembles a proposed PR via the bridge draft path — outcome has no opened/committed variant (type-proven), drafting opens nothing; OPEN stage routes through `open_pull_request` (Tier 4) under the full Phase 8.4 external gauntlet (specific-target binding exact repo+branch+base, single-use human token, no-bulk, blast-radius audit, kill-beats-approval, self-approval-rejected); open with no/wrong-target/bulk approval ⇒ refused, fake port never called; external on FAKES (zero real calls); deny-by-default (unverifiable/unregistered repo target); instruction-boundary; **8.8b SOLE AUTHORITY structural** — `open_pull_request` reachable only via the bridge's capability-gated `openPullRequest(cap,…)` (unforgeable branded OpenPrCapability; generic external path refuses; exactly one module assembles/opens a PR); standalone | [pr-engine.feature.md](../src/features/pr-engine/pr-engine.feature.md) |
| Field Creation | `src/features/field-creation/` | 20 (Wave 5) | **Built & tested** (Phase 8.7) — typed custom-field registry on a target (domain/project/product); read=READ_ONLY, create/change=APPROVAL_REQUIRED_WRITE (Phase 8.3 token gate inherited — no token ⇒ STOP, store unchanged); **a field definition is INERT** — constraints are a closed declarative vocabulary (executable/SQL/script/opt-out keys rejected; default must be scalar); **cannot opt out of redaction** (SENSITIVE ⇒ redaction-eligible; no never-redact key); deny-by-default (unknown type/malformed constraint/duplicate key/unregistered target via injected lookup); append-only PostgreSQL (migration 0010; UPDATE/DELETE denied; changed_by≠claude); standalone | [field-creation.feature.md](../src/features/field-creation/field-creation.feature.md) |
| Settings | `src/features/settings/` | 25 (Wave 5) | **Built & tested** (Phase 8.6) — typed governed config registry (key/value/type/scope/classification OPERATIONAL\|SECURITY_CRITICAL/default/provenance); read=READ_ONLY, change=APPROVAL_REQUIRED_WRITE (Phase 8.3 token gate inherited — no token ⇒ STOP, store unchanged); **hard floor** — no setting can disable/weaken audit/redaction/kill-switch/permission/approval or make a FORBIDDEN tool callable (unrepresentable + crossesGuardFloor); SECURITY_CRITICAL floored within the guarantee; append-only PostgreSQL (migration 0009; UPDATE/DELETE denied; changed_by≠claude); deny-by-default; standalone | [settings.feature.md](../src/features/settings/settings.feature.md) |
| Autopilot Scheduler | `src/features/autopilot-scheduler/` | 18b (Wave 5) | **Built & tested** (Phase 8.9) — a clock over Autopilot; decides WHEN a run fires, grants NO new authority; a fired run returns Autopilot's bounded outcome unchanged (no executed/approved variant); a consequential step ⇒ STOP, write/external never called; bounded cadence (hard min interval — no runaway); bounded per run (Autopilot step budget); kill halts it; every trigger audited (real PG); enable/disable is governed (permissioned + audited, never free); deny-by-default (invalid schedule rejected); standalone (runner/clock/audit/kill/authorizer injected) | [autopilot-scheduler.feature.md](../src/features/autopilot-scheduler/autopilot-scheduler.feature.md) |
| Autopilot Runner | `src/features/autopilot/` | 18 (Wave 5) | **Built & tested** (Phase 8.5) — autonomous driver that automates the dual-Claude messenger role; reads state via READ_ONLY + drafts the next step via DRAFT_ONLY through the bridge; authority ceiling = DRAFT_ONLY (outcome bounded to propose/await/read/halt — no executed/committed/approved variant, type-proven); cannot execute a write/external (port has no such method — write/external never called), cannot self-approve/mint a token, cannot auto-advance a STOP gate; acts only through the bridge (reads/drafts audited, no bypass); kill halts it; bounded run; standalone (bridge injected as a port) | [autopilot.feature.md](../src/features/autopilot/autopilot.feature.md) |
| MCP Bridge | `src/features/mcp-bridge/` | 1 (Wave 5) | **Built & tested** (Phase 8.0→8.4) — single governed gateway; 4-class taxonomy structural + dispatch-by-class; surface = 4 tiers (16 READ_ONLY + 7 DRAFT_ONLY + 6 APPROVAL_REQUIRED_WRITE-internal + 6 APPROVAL_REQUIRED_WRITE-external) with FORBIDDEN (6) registered-and-refused. External tools behind the hardest gates: specific-target+effect human approval, no bulk, production gate, blast-radius audited, kill/audit untargetable, EXTERNAL-ACTION-COMMITTED only via consumed token + hardening; FORBIDDEN never callable (refused even with a token); no real side effects (injected ports). Every tool full guard stack; per-tool permissioning; standalone | [mcp-bridge.feature.md](../src/features/mcp-bridge/mcp-bridge.feature.md) |

## Audit Engine — proven guarantees (9)

Each is proven by a test running against **real PostgreSQL 16.14** (no mocks); the full suite is 25/25 green.

| # | Guarantee | Where | Test |
|---|-----------|-------|------|
| 1 | Append-only storage (DB privilege + guard trigger, not app convention) | `infra/migrations/0001_audit_schema.sql` | T5 |
| 2 | Per-org Row-Level Security isolation (FORCE RLS) | `0001` | T8 |
| 3 | SHA-256 hash-chain tamper-evidence (detects out-of-band edits at the right seq) | `postgres-sink.ts`, `schema.ts` | T6 |
| 4 | Redaction-before-write (sensitive fields never persisted) | `sink.ts` (RedactionPolicy), `postgres-sink.ts` | T9 |
| 5 | Write-ahead sequencer — fail-closed (no execute without durable intent) | `sequencer.ts` | T1, T2 |
| 6 | No-skip (type-enforced: execute requires a branded CommittedIntent) | `sequencer.ts` | T4 |
| 7 | Human attribution (actor is the real human; never "claude") | `sequencer.ts` + DB CHECK | T11 |
| 8 | Orphan reconciliation (committed-intent-with-no-result flagged) | `sequencer.ts`, `postgres-sink.ts` | T3 |
| 9 | Audit-of-reads + permissioned viewer (every read logged & chained) | `read-audit.ts` | T7 |
| + | Refusal-audit (denied attempts recorded, distinct from orphans) | `0002_audit_refusal.sql`, `sequencer.ts`, `read-audit.ts` | refusal suite |
| + | External-verifiability seam (`AuditSink.proof()` → null; Trillian/Rekor/Tessera reserved) | `sink.ts` (§8) | structural |

## Components
- **Storage adapter:** `PostgresHashChainSink` implements the `AuditSink` interface (the §8 seam).
- **Control flow:** `WriteAheadSequencer` depends ONLY on `AuditSink` + the `Authorizer` seam (Permission Engine is Module 22, a later wave — currently stubbed).
- **Viewer:** `AuditViewer` (audit-of-reads).
- **App-packaging readiness:** the engine depends on interfaces, not concrete implementations of other engines — compliant with `REQUIREMENT_PRODUCT_APP_PACKAGING.md` (standalone-deployable boundary).

## Open items
See `docs/OPEN_ITEMS.md` — notably: Permission Engine (Module 22) stubbed; `ts`/pk outside hashed content; orphan grace window; air-gap install mirror; external-verifiability layer reserved.
