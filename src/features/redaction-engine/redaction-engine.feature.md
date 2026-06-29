# Feature — Redaction Engine

**Path:** `src/features/redaction-engine/` · **Module:** 24 (Wave 1 ROOT) · **Status:** **built & tested** (Phase 4.0)
**Governs:** blueprint §24; Action-Layer §E (server-side, deny-by-default). See the Audit Engine's `RedactionPolicy` seam.

## Purpose
Prevent sensitive data from ever entering the audit store (or any consumer) in the clear. Server-side, **deny-by-default, allowlist-based** field redaction: a field is redacted unless explicitly allowlisted.

## Business Logic
Given a free-form payload summary, only keys present on the configured allowlist survive; every other key (and its subtree) is dropped. Nested objects are filtered with the same allowlist — a nested key must also be allowlisted to survive. Redaction runs **before** hashing/writing, so the hash is computed over redacted content.

## Allowlist model
- **Deny-by-default:** unknown/new fields are sensitive by default. Exposure is the deliberate exception (add the key to the allowlist), never the reverse.
- `DEFAULT_AUDIT_ALLOWLIST` provides a conservative default for audit request summaries; deployments inject their own allowlist per tool/context.
- Case-insensitive key match.

## Technical Flow
`RedactionEngine.redactSummary(summary)` → recursive filter keeping only allowlisted keys → returns the redacted object. Injected into `PostgresHashChainSink` through the `RedactionPolicy` seam (the sink depends on the interface; the engine is injected).

## Files
`redaction-engine.ts` (engine + `DEFAULT_AUDIT_ALLOWLIST`), `redaction-engine.feature.md`, tests in the audit-engine suite (`db-redaction*.test.ts`).

## Data Model
Operates on `Record<string, unknown>` payload summaries. Holds no storage of its own.

## Permissions
Pure transformation; no DB access, no permissions. The decision of *what* to allowlist is a deployment/permission concern.

## Standalone packaging (REQUIREMENT_PRODUCT_APP_PACKAGING.md)
The engine imports **nothing** from the audit engine or any other engine — it satisfies the `RedactionPolicy` seam structurally (TypeScript structural typing). A test asserts assignability to the seam. The engine is therefore independently packageable.

## Tests
Deny-by-default (an un-allowlisted/unknown field is stripped — the critical test); allowlist survival (allowlisted non-sensitive fields pass intact); sensitive-never-persists (through the real engine, into real PostgreSQL); hash-chain still verifies after redaction; structural seam assignability.

## Status
**Built & tested (Phase 4.0).** Full suite green vs real PostgreSQL 16.14.

## Open Items
- The `RedactionPolicy` seam type currently lives in the audit engine; for fully symmetric standalone packaging it could move to `src/shared` later (the engine already imports nothing from audit-engine, so this is cosmetic).
