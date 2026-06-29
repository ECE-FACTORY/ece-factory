# Feature Registry — ECE Factory

> Per Layer 2 §8. Every feature: name, path, status, guarantees, tests, related components. Kept aligned with code.

| Feature | Path | Module | Status | Feature file |
|---------|------|--------|--------|--------------|
| Audit Engine | `src/features/audit-engine/` | 23 (Wave 1 ROOT) | **Core complete (built & tested)** | [audit-engine.feature.md](../src/features/audit-engine/audit-engine.feature.md) |
| Redaction Engine | `src/features/redaction-engine/` | 24 (Wave 1 ROOT) | **Built & tested** (deny-by-default, standalone) | [redaction-engine.feature.md](../src/features/redaction-engine/redaction-engine.feature.md) |
| Tool Registry | `src/features/tool-registry/` | 21 (Wave 1 ROOT) | **Built & tested** (no hidden tools, standalone) | [tool-registry.feature.md](../src/features/tool-registry/tool-registry.feature.md) |
| Permission Engine | `src/features/permission-engine/` | 22 (Wave 1 ROOT) | **Built & tested** (deny-by-default; ALLOW/REFUSE/STOP_FOR_APPROVAL; replaced allow-all stub) | [permission-engine.feature.md](../src/features/permission-engine/permission-engine.feature.md) |

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
