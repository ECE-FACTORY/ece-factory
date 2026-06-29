# Implementation Plan — ECE Factory · Module 23 (Audit Engine)

> **Status:** Phase 2B (plan only). **No implementation code, dependencies, or migrations exist.** Build begins only after this plan and the architecture pass review (Phase 3), under the dual-Claude loop.

---

## 1. Current state

- Repo `ece-factory` scaffolded (Phase 1): `CLAUDE.md`, doc skeletons, empty `src/ tests/ scripts/ infra/`.
- Module 23 Harvest Report **APPROVED** (Phase 2A): verdict EXTEND.
- Architecture authored (Phase 2B, this step): `docs/ARCHITECTURE.md`.
- No `package.json`, no TypeScript config, no DB, no code.

## 2. Target state (end of Wave 1 Module 23)

A reviewed, tested Audit Engine in `src/features/audit-engine/` that provides a service interface for: write-ahead intent/result logging (§23.1), append-only per-org chained storage (§§3–5), audit-of-reads + permissioned viewer (§24), chain verification, and the `AuditSink` seam (§8) with the Postgres implementation only. Every governance invariant (I1–I4, §2 of ARCHITECTURE) proven by tests with verbatim runner output.

## 3. Work phases (each its own dual-Claude step, each gated)

| Phase | Scope | Gate before |
|-------|-------|-------------|
| **3.0** | Toolchain bootstrap: `package.json`, `tsconfig`, test runner, lint/typecheck — **infra only, still no engine logic.** Pin and record dependency licenses (Layer 1.1 §10 applies to deps too). | starts Phase 3 |
| **3.1** | DB schema + migrations: the three append-only tables (§3), `REVOKE UPDATE/DELETE/TRUNCATE`, the `BEFORE UPDATE OR DELETE` guard trigger, RLS policies (§6). | review of 3.0 |
| **3.2** | `AuditSink` interface (§8) + `PostgresHashChainSink`: canonical serialization, hash-chain (§5), `appendIntent/appendResult/appendRead/verifyChain/proof`. | review of 3.1 |
| **3.3** | The write-ahead **sequencer** (§2): validate → authorize → commit intent → execute → commit result; fail-closed; no-skip; orphan reconciler. | review of 3.2 |
| **3.4** | Audit-of-reads + permissioned viewer service (§24); read entries chained. | review of 3.3 |
| **3.5** | Verification & hardening: full invariant test suite, chain-tamper detection tests, RLS isolation tests; verbatim test/lint/typecheck/build output in the evidence pack. | review of 3.4 |
| **3.6 (optional)** | pgaudit enablement docs + config per environment (DB-layer defense-in-depth). | review of 3.5 |

## 4. Files to create when build begins (not now)

```
ece-factory/
  package.json, tsconfig.json            (Phase 3.0)
  src/features/audit-engine/
    audit-engine.feature.md              (exists — Phase 2B)
    schema.ts          §3 record shapes + canonical serialization (§5)
    sink.ts            AuditSink interface (§8)
    postgres-sink.ts   PostgresHashChainSink (§§3–6)
    sequencer.ts       §23.1 write-ahead control flow (§2)
    read-audit.ts      §24 audit-of-reads + viewer service
    verifier.ts        §5 chain verification + orphan reconciler
    types.ts
    tests/             invariant + tamper + RLS tests
  infra/migrations/    append-only DDL, RLS, triggers (Phase 3.1)
```

## 5. Custom-code boundary (§6 — exactly what is BUILD vs sourced)

**ECE BUILDS (the proprietary glue, the moat):**
- Write-ahead sequencer (§2) — the log-before-execute control flow, fail-closed, no-skip.
- Schema + append-only DDL (§3, §4) — the §23.2 record shapes and the privilege/trigger enforcement.
- Hash-chain + verifier (§5) — canonical serialization, chaining, tamper detection, orphan reconciler.
- Audit-of-reads + permissioned viewer (§24, §6).
- The `AuditSink` seam (§8) and its Postgres implementation.

**SOURCED (not built):**
- **PostgreSQL** — storage engine, RLS, privilege model, triggers (PostgreSQL License, ratified).
- **pgaudit** (optional) — DB-layer SQL audit (PostgreSQL License, ratified).
- Platform crypto for hashing (standard library).

**Reserved behind the seam (built only if mandated):** Trillian / Rekor / Tessera `VerifiableLogSink` (Apache-2.0).

**Boundary rule:** the BUILD set above is fixed. If it grows during Phase 3, STOP and request approval (Layer 1.1 §6 — custom code must not expand quietly).

## 6. Test list — each governance guarantee must be proven (Layer 0 §23, verbatim output)

| # | Guarantee | Test proves |
|---|-----------|-------------|
| T1 | I1 log-before-execute | execute is unreachable unless intent committed (structural + behavioral) |
| T2 | I2 fail-closed | when intent write fails, action is refused, no side effect occurs |
| T3 | I3 intent↔result pairing | every intent gets one terminal result; induced orphan is flagged |
| T4 | I4 no-skip | no code path / flag bypasses the sink (audited by test + review) |
| T5 | append-only | UPDATE/DELETE/TRUNCATE on audit tables are rejected (privilege + trigger) |
| T6 | hash-chain integrity | recompute matches; an out-of-band row edit is detected at the right `seq` |
| T7 | audit-of-reads | every viewer read writes a chained `audit_read_log` entry |
| T8 | per-org RLS isolation | a principal cannot read another org's audit rows |
| T9 | redaction-before-write | sensitive fields never appear in stored rows |
| T10 | seam additivity | sequencer/callers depend only on `AuditSink`; `proof()=null` is non-breaking |
| T11 | human attribution | no row records the actor as "claude"; human_actor always populated |

## 7. Risks & human decisions

- The sequencer is the integrity linchpin — most-reviewed, most-tested module in Wave 1.
- External-redistribution legal caveat on PostgreSQL-licensed foundations applies at the white-label release gate (not at internal build).
- Dependency licenses introduced at Phase 3.0 must each be verified (Layer 1.1 §10) — no copyleft transitive deps.
