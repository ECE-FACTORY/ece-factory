# Architecture — ECE Factory · Module 23 (Audit Engine)

> **Status:** Phase 2B architecture mapping. **No implementation code, migrations, MCP tools, or UI exist yet.** This document is the design the Phase 3 build will implement and be reviewed against.
> **Verdict (approved Phase 2A):** EXTEND. **Spine:** PostgreSQL append-only storage + ECE write-ahead glue + app-level hash-chain + optional pgaudit. **Reserved:** Trillian/Rekor/Tessera external-verifiability layer behind a defined seam (§8 below).
> **Binding sources:** blueprint §23; MCP Hardening §§5–6, 18–19, 23–24; Action-Layer base §B/§E.

---

## 1. Purpose & position

The Audit Engine is the **integrity substrate** of the entire factory. It is a Wave 1 ROOT and is built first because **write-ahead logging is the precondition for any auditable action** — including the building of everything after it. Every consequential action (every MCP tool call, every dashboard write, every approval) routes through this engine, which guarantees: a tamper-evident, append-only, per-org-scoped, sovereign-resident record, written **before** the action fires, attributed to a **real human**, and never silently skippable.

**One rule it enforces:** *a tool call that cannot be attributed and logged is a tool call that does not happen.*

---

## 2. The §23.1 write-ahead sequence (the core control flow)

Every audited action passes through this exact order. The audit **intent** is durably committed **before** the action executes; the **result** is committed after. There is no execution path that skips the log.

```
  ┌─ caller (MCP bridge / dashboard action / approval gate)
  │
  1. VALIDATE        input schema, identity present, session/connector valid
  2. AUTHORIZE       Permission Engine decision: ALLOW | REFUSE | STOP_FOR_APPROVAL
  3. COMMIT INTENT   ── write-ahead ── append AUDIT_INTENT row (status=intent)
  │                     ↳ if this write fails → REFUSE the action (§18), surface to human.
  │                       "audit unavailable" is detected HERE, before any effect.
  4. EXECUTE         perform the dashboard/tool action  (only reached if step 3 durably committed)
  5. COMMIT RESULT   append AUDIT_RESULT row (status=success|error) linked to the intent
  6. RETURN          result to caller
```

**Invariants (must be proven by tests, see IMPLEMENTATION_PLAN):**
- **I1 — Log-before-execute:** step 4 is unreachable unless step 3 committed. Enforced in code (sequencer) *and* structurally (the execute call takes the committed intent id as a required argument).
- **I2 — Fail-closed:** if step 3 cannot commit, the action is refused; no execution, no partial effect.
- **I3 — Intent↔result pairing:** every intent has exactly one terminal result, or is flagged `orphaned_intent` for human review (a possible partial action). A periodic reconciler surfaces orphans.
- **I4 — No suppression:** the sequencer has no "skip audit" branch, flag, or config. Absence of that path is a security feature.

---

## 3. Data model (§23.2 schema)

Three append-only tables in PostgreSQL. Two logical record shapes — **intent** and **result** — plus a materialized **event** view that joins them. (DDL is authored at Phase 3; shapes are fixed here.)

### 3.1 `audit_intent` (committed at step 3, write-ahead)
| Field | Notes |
|-------|-------|
| `intent_id` (uuid, pk) | stable id; passed into EXECUTE |
| `seq` (bigint, monotonic) | per-org monotonic sequence (hash-chain order) |
| `timestamp` | ISO, server clock |
| `organization_id` | tenant scope (RLS key) |
| `human_actor` | `{user_id, email, role}` — the authenticated human, **never "claude"** |
| `via` | interface, e.g. `"claude"` (the model is the conduit, not the actor) |
| `session` | `{session_id, connector_id, connector_type, source_application}` |
| `tool` | `{name, classification, permission_level, version}` |
| `request_summary` | redacted input summary (no secrets/sensitive payloads) |
| `authorization` | `{permission_checked, decision, reason}` |
| `approval` | `{required, captured, approved_by, approval_timestamp}` |
| `dashboard` | `{endpoint, method, direct_database_access:false}` |
| `environment` | `local | staging | production` |
| `prev_hash` | hash of the previous entry in this org's chain (§5) |
| `entry_hash` | hash of this entry's canonical content + `prev_hash` (§5) |
| `status` | `intent` |

### 3.2 `audit_result` (committed at step 5)
| Field | Notes |
|-------|-------|
| `result_id` (uuid, pk) | |
| `intent_id` (fk → audit_intent) | pairs result to intent (I3) |
| `seq`, `timestamp`, `organization_id` | chain + scope |
| `result` | `{status: success|error, error_code?, duration_ms}` |
| `prev_hash`, `entry_hash` | continues the chain (§5) |
| `status` | `success | error` |

### 3.3 `audit_read_log` (§24 audit-of-reads — the watchers are watched)
Reading the audit log is itself an audited event. Same chained, append-only shape: `{read_id, timestamp, organization_id, human_actor, session, query_range, rows_returned, prev_hash, entry_hash}`.

**Redaction (Action-Layer §E, deny-by-default):** all `request_summary` / payload fields pass through the Redaction Engine **server-side before write** — secrets, credentials, national-ID/passport, financials, private notes, contracts never enter a row. Logs themselves are sensitive; see §6 access control.

---

## 4. Append-only storage model

- Tables are **insert-only**. The application role is granted `INSERT, SELECT` and explicitly **`REVOKE UPDATE, DELETE, TRUNCATE`** at the database level — append-only is enforced by Postgres privileges, not by application convention alone.
- **No purge/edit path through the app or MCP.** Retention, export, and purge are **human-only, dashboard-native** operations (blueprint §23.4) — never exposed as MCP tools and never reachable by the Autopilot.
- A `BEFORE UPDATE OR DELETE` trigger raises an exception as defense-in-depth, so even a privilege misconfiguration fails closed.

---

## 5. App-level hash-chain (tamper evidence)

Each org's entries form a linear hash chain, giving tamper-**evidence** without the operational weight of an external verifiable-log service (the approved default; the stronger option lives behind the §8 seam).

- **Chain rule:** `entry_hash = H( canonical_serialize(entry_fields_excluding_hashes) || prev_hash )`, where `H` is a strong cryptographic hash (e.g. SHA-256) and `prev_hash` is the `entry_hash` of the immediately preceding entry in the same `organization_id` chain (ordered by `seq`). The genesis entry uses a fixed, documented `prev_hash` seed.
- **Per-org chains:** each tenant has an independent chain keyed by `organization_id` (aligns with RLS scoping; no cross-tenant linkage).
- **Detection:** any retroactive edit/delete of a historical row breaks the chain from that point forward; a **verifier** routine recomputes the chain and reports the first broken link. (Edits are already barred by §4; the chain detects out-of-band tampering, e.g. direct DB access that bypassed the app — itself a STOP-gated action.)
- **What it is / isn't:** this is *tamper-evidence* (detect after the fact), not *tamper-proofing* (prevent). Cryptographic external verifiability (third-party-auditable proofs) is the reserved §8 layer.

---

## 6. Per-org scoping & §24 access control (the logs are sensitive too)

- **Per-org isolation via PostgreSQL Row-Level Security:** every audit table has an RLS policy keyed on `organization_id = current_setting('app.current_org')`. A principal can read only their own organization's logs; cross-tenant reads are structurally impossible at the DB layer.
- **Reading the log is a permissioned, audited event (§24):** the audit-viewer requires explicit read permission (checked by the Permission Engine), and **every read writes an `audit_read_log` entry** (scope, range, actor). The watchers are watched.
- **Append-only on reads too:** `audit_read_log` is itself insert-only and chained.
- **Sovereign residency (§23.5, blueprint):** all audit storage stays inside the air-gap boundary — same residency rules as the data it describes. No egress to foreign cloud, analytics, or telemetry. Backups are local.

---

## 7. Optional pgaudit role (DB-layer defense-in-depth)

`pgaudit` (PostgreSQL License — ratified into the allowlist 2026-06-29) is an **optional, additive** layer that logs raw SQL statement activity at the database engine, beneath the application. It is **not** the engine and does **not** implement §23.1/§24 — it is a corroborating second record (catches activity that bypasses the app, e.g. approved direct DB access). Enabled per-environment; its output stays inside the sovereign boundary. The Audit Engine does not depend on it.

---

## 8. External-verifiability SEAM (reserved Trillian / Rekor / Tessera attach point)

> **This is the interface boundary that makes the high-assurance layer additive, not a rewrite.** Define it now; implement it never (until a sovereign client mandates externally-verifiable cryptographic audit).

The engine writes through a single internal interface, the **`AuditSink`**. The default implementation is `PostgresHashChainSink` (§§3–6). A future `VerifiableLogSink` (backed by Trillian/Rekor/Tessera) can be added **without touching the sequencer (§2), the schema (§3), or callers.**

**Seam contract (`AuditSink`):**
- `appendIntent(entry) -> { seq, entry_hash }` — durably commit an intent; returns the chain position. (Step 3.)
- `appendResult(intent_ref, result) -> { entry_hash }` — commit the paired result. (Step 5.)
- `appendRead(read_entry) -> { entry_hash }` — record an audit-of-read. (§6.)
- `verifyChain(organization_id, range) -> { ok, first_broken_seq? }` — integrity check. (§5.)
- `proof(entry_ref) -> InclusionProof | null` — **the extension point.** `PostgresHashChainSink` returns `null` (no external proof). A `VerifiableLogSink` returns a real inclusion/consistency proof (Merkle path) from the verifiable log.

**Attach rule:** the high-assurance layer is added as a **second sink composed alongside** the Postgres sink (dual-write: Postgres remains the operational store; the verifiable log receives the same canonical entry bytes and returns external proofs via `proof()`). Because callers and the sequencer depend only on `AuditSink` — never on Postgres or Trillian directly — adding `VerifiableLogSink` is a configuration + composition change, **additive by construction**. The canonical entry serialization (§5) is the stable contract both sinks consume, so chain hashes and external proofs are computed over identical bytes.

**Boundary guarantees that must hold for the seam to stay additive (treated as design constraints and tested now):**
1. The sequencer (§2) references only `AuditSink`, never a concrete store.
2. Canonical entry serialization is defined once and shared by all sinks.
3. No caller reads Postgres audit tables directly; all reads go through the viewer / `AuditSink`.
4. `proof()` returning `null` is a valid, non-breaking default.

---

## 9. Dependencies & non-goals

- **Sourced (not built):** PostgreSQL (storage, RLS, privileges, triggers); optional pgaudit (DB-layer audit). Hashing via the platform crypto library (standard, not a third-party dependency to vet now).
- **Built by ECE (the moat):** the §2 sequencer, the §3 schema + append-only DDL, the §5 hash-chain + verifier, the §6 audit-of-reads + permissioned viewer, the §8 `AuditSink` seam.
- **Non-goals (this module):** the MCP bridge tools (separate repo, Wave 5), the Permission Engine internals (Module 22, consumed here as a dependency), the dashboard UI (Wave 6). The Audit Engine exposes a service interface those consume.
