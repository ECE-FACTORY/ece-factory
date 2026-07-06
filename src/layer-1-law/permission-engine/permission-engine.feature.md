# Feature — Permission Engine

**Path:** `src/features/permission-engine/` · **Module:** 22 (Wave 1 ROOT) · **Status:** **built & tested** (Phase 4.2)
**Governs:** blueprint §22; consumes the Tool Registry (§21) and the Audit Engine `Authorizer` seam.

## Purpose
Authorize every tool call: return **ALLOW / REFUSE / STOP_FOR_APPROVAL**, deny-by-default. Replaces the `AllowAllAuthorizer` stub used during Audit Engine construction.

## Business Logic — decision matrix
Evaluated in order; the first matching rule wins; anything not explicitly resolved to ALLOW is REFUSE.

| Condition | Decision |
|-----------|----------|
| missing tool name | REFUSE |
| tool not registered (`registry.require` throws) | **REFUSE (fail-closed)** |
| tool `status = disabled` | REFUSE |
| tool not available in the request's environment | REFUSE |
| principal role rank < tool `requiredRole` rank (unknown roles rank 0; unknown required role ⇒ ∞) | REFUSE |
| tool `approvalRequired = true` | STOP_FOR_APPROVAL |
| classification ∈ {WRITE_HIGH_RISK, BULK_ACTION, DESTRUCTIVE_ACTION, SECURITY_CRITICAL, FINANCIAL_CRITICAL, LEGAL_CRITICAL, EXTERNAL_COMMUNICATION} | STOP_FOR_APPROVAL |
| else (registered, enabled, in-env, sufficient role, non-critical, no approval) | ALLOW |

## Inputs
`AuthorizationRequest { human_actor (role), organization_id, tool (name), environment }` + the tool's registry entry. Role hierarchy is configurable (default `user/auditor=1, operator=2, admin=3`).

## Technical Flow
`authorize(req)` → `registry.require(req.tool.name)` (fail-closed) → status/environment/role/approval/classification checks → decision. Wired into the sequencer and viewer through the existing `Authorizer` seam; a REFUSE/STOP_FOR_APPROVAL is recorded by the Phase-3.5 refusal-audit path.

## Permissions / Data Model
Pure decision function; no storage. Reads tool metadata via `ToolRegistryReader`.

## Standalone packaging
Only cross-engine references are `import type` (Authorizer seam + ToolRegistryReader) — type-only, zero runtime coupling. Independently packageable.

## Tests
Decision matrix (pure-logic): unknown ⇒ REFUSE, insufficient role ⇒ REFUSE, disabled ⇒ REFUSE, wrong env ⇒ REFUSE, approval/critical ⇒ STOP_FOR_APPROVAL, allowed read ⇒ ALLOW. Integration (real PostgreSQL): ALLOW proceeds + logs; REFUSE writes one refusal record, no intent, no orphan; STOP_FOR_APPROVAL does not execute, writes a refusal record, no orphan.

## Status
**Built & tested (Phase 4.2).** Full suite green vs real PostgreSQL 16.14. `AllowAllAuthorizer` remains only as an explicit permissive test fixture for the audit-mechanics tests.

## Open Items
- Per-org / per-client role scoping and approval-token integration (Module 17/18) — later waves, behind this engine.
