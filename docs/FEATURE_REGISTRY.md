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
| MCP Bridge (read-only) | `src/features/mcp-bridge/` | 1 (Wave 5) | **Built & tested** (read-only doorway; one tool `search_clients`; full Wave 1–2 guard stack via injected ports — Tool Registry fail-closed → READ-ONLY gate → Permission deny-by-default → Kill Switch beats-all → write-ahead audit intent+result → Redaction; READ-ONLY structural incl. SELECT-only DB role; instruction-boundary; standalone) | [mcp-bridge.feature.md](../src/features/mcp-bridge/mcp-bridge.feature.md) |

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
