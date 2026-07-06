# Feature — Tool Registry

**Path:** `src/features/tool-registry/` · **Module:** 21 (Wave 1 ROOT) · **Status:** **built & tested** (Phase 4.1)
**Governs:** blueprint §21 (no hidden tools) + §13 (risk classifications).

## Purpose
The authoritative catalog of every tool the factory/bridge may expose. **No hidden tools:** a tool that is not registered cannot be looked up or used. Unknown-tool lookup fails closed.

## Business Logic
Each tool is registered with its full §21 metadata and a valid §13 risk classification. Registration is validated (name required; classification must be one of the 12; write tools must declare `blastRadius=1`; no duplicates). Lookups: `has(name)` is a boolean; `require(name)` returns the definition or **throws** `ToolNotRegisteredError` — never a permissive default.

## Risk classifications (§13)
READ_ONLY · READ_SENSITIVE · WRITE_LOW_RISK · WRITE_MEDIUM_RISK · WRITE_HIGH_RISK · BULK_ACTION · DESTRUCTIVE_ACTION · EXTERNAL_COMMUNICATION · SECURITY_CRITICAL · FINANCIAL_CRITICAL · LEGAL_CRITICAL · REVIEW_ONLY.

## Data Model (per tool, §21)
name, purpose, input/output schema, read/write, classification, permission level, required role, approval requirement, dashboard route, sensitive-data rules, server-side redaction flag, audit behavior, instruction-boundary notes, blast radius, reversibility, idempotency, environments, owner, status.

## Persistence decision
**In-memory / config-driven for this phase**, behind the `ToolRegistry` interface. The set of tools is declared by the codebase/deployment, not mutated by users at runtime — so a config-loaded registry is deterministic, air-gap-friendly, and lets the Permission Engine authorize synchronously without a DB round-trip. A future `PersistentToolRegistry` (PostgreSQL, append-only **audited** registration via the Audit Engine — tool changes are security-relevant) implements the same interface and plugs in for runtime admin registration (Wave 5/6). No code outside the registry changes when persistence is added.

## Consumer interface (for Module 22 Permission Engine)
`ToolRegistryReader { has(name); require(name) /* fail-closed */; list() }`. The Permission Engine calls `require(toolName)` to read classification/permission level/required role/approval requirement; because `require` throws on an unregistered tool, an authorizer is structurally forced to deny unknown tools.

## Standalone packaging
Imports nothing from any other engine (defines its own types, incl. `ToolEnvironment`). Independently packageable.

## Tests
Registration + lookup; classification integrity (invalid/missing classification → rejected); duplicate rejected; write-tool blast-radius rule; unknown-tool `require` fails closed (no hidden tools); the consumer `ToolRegistryReader` interface exercised as the Permission Engine will use it.

## Status
**Built & tested (Phase 4.1).** Full suite green.

## Open Items
- Persisted, audited runtime registration (`PersistentToolRegistry`) — Wave 5/6, behind this interface.
- `ToolEnvironment` duplicates the audit engine's `Environment` by design (decoupling); a shared type could unify them later (cosmetic).
