# Feature — Audit Engine

**Path:** `src/features/audit-engine/` · **Module:** 23 (Wave 1 ROOT) · **Status:** **planned** (no code yet — Phase 2B design)
**Governs:** blueprint §23; MCP Hardening §§5–6, 23–24. See `docs/ARCHITECTURE.md` and `docs/IMPLEMENTATION_PLAN.md`.

> No feature exists only in code, and this file describes something not yet built — it is explicitly marked **planned** per Layer 2 §9.

## Purpose
Provide the factory's integrity substrate: a tamper-evident, append-only, per-org-scoped, sovereign-resident audit record, written **before** any consequential action fires and attributed to a real human. A call that cannot be attributed and logged does not execute.

## Business Logic
Every audited action commits an **intent** (write-ahead) before executing and a **result** after. Storage is append-only (no edit/delete/purge via app or MCP). Each org's entries form a hash chain for tamper evidence. Reading the log is itself permissioned and audited. An external-verifiability layer (Trillian/Rekor/Tessera) can attach later behind a defined seam without re-architecture.

## User Flow
Indirect — consumed by the MCP bridge, Dashboard Action Layer, and Approval Gate. A human with audit-read permission uses the (future) permissioned viewer to read their organization's log; each read is itself recorded.

## Technical Flow
`validate → authorize → commit audit intent (write-ahead) → execute → commit audit result → return` (ARCHITECTURE §2). On intent-write failure: refuse (fail-closed). Reads go through the viewer → write an `audit_read_log` entry → return rows scoped by RLS.

## Files (planned — created in Phase 3)
`schema.ts` · `sink.ts` (`AuditSink`) · `postgres-sink.ts` · `sequencer.ts` · `read-audit.ts` · `verifier.ts` · `types.ts` · `tests/` · `infra/migrations/` (DDL/RLS/triggers).

## Data Model
`audit_intent`, `audit_result`, `audit_read_log` — append-only, chained (`prev_hash`/`entry_hash`), per-org `seq`. Full field list in ARCHITECTURE §3. `direct_database_access` recorded; redacted summaries only.

## Permissions
Writing audit rows: internal engine only (no external write tool). Reading: explicit audit-read permission via the Permission Engine; per-org RLS; every read audited (§24). Retention/export/purge: human-only, dashboard-native — never MCP tools.

## Validation Rules
Schema-validate every entry; `human_actor` mandatory and never "claude"; environment ∈ {local,staging,production}; sensitive fields stripped server-side before write (deny-by-default).

## Error Handling
Audit-unavailable at intent-commit → refuse the action before any effect (fail-closed, §18). Missing terminal result → `orphaned_intent` flagged for human review. Broken hash chain → verifier reports first broken `seq`. UPDATE/DELETE attempts → rejected by privilege + trigger.

## Tests
T1–T11 in IMPLEMENTATION_PLAN §6 (log-before-execute, fail-closed, intent↔result pairing, no-skip, append-only, chain integrity, audit-of-reads, RLS isolation, redaction-before-write, seam additivity, human attribution). Verbatim runner output required at each phase (Layer 0 §23).

## Status
**planned.** Architecture + plan approved-pending-review (Phase 2B). Build starts at Phase 3.0 (toolchain) only after review.

## Open Items
- Confirm hash function + canonical serialization format at Phase 3.2.
- Decide pgaudit enablement per environment (optional, Phase 3.6).
- External-redistribution legal confirmation deferred to the white-label release gate.
