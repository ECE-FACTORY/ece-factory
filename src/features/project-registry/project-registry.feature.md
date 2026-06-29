# Feature — Project Registry

**Path:** `src/features/project-registry/` · **Module:** 5 (Wave 4) · **Status:** **built & tested** (Phase 7.1)
**Governs:** blueprint §5 / §5.4 (status vocabulary); `ORG_PROJECT_REGISTRY.md`.

## Purpose
The typed registry of every project repo in the org — and the place where the **harvest-before-build doctrine** is enforced.

## Model (§5)
project · repo · **domain** (must reference a registered domain) · purpose · owner · stack · deployment · status (§5.4) · maturity · open risks · last review decision · next gate · **harvestApprovalStatus** (`not-started | pending | approved | rejected`).

## §5.4 status vocabulary
`Phase 0 inspection · Phase 1 build · Harvest pending · Harvest approved · In build · In review · Live · Paused · Deprecated`. An invalid status ⇒ rejected.

## Validation / deny-by-default
Missing required field (project/repo/domain/purpose/owner/stack/deployment/harvestApprovalStatus) ⇒ rejected (`ProjectValidationError`), never stored half-formed. The `domain` must resolve to a **registered domain** via an injected `DomainLookup` (consuming the Domain Registry's `domainSummary`) — an unregistered domain ⇒ rejected.

## Harvest-before-build gate (the core)
A project may **not** enter status `In build` unless `harvestApprovalStatus === 'approved'` — enforced at registration *and* at `transitionStatus`. `gateView(record)` reports `{ currentPhase, harvestApprovalStatus, clearedToBuild, reason }`; `clearedToBuild` is true only when harvest is approved. This is "no build without an approved Harvest Report," enforced structurally at the registry.

## Persistence (append-only)
**PostgreSQL, append-only** (`PostgresProjectRegistryStore` + migration `0005`). Each registration / status transition / harvest-approval change is a **new snapshot row** (REVOKE UPDATE/DELETE/TRUNCATE + guard trigger); `getLatest` is current state, `history` the full trail. No RLS (factory-internal registry).

## Standalone packaging
Engine imports only `import type` (the Domain Registry summary); the domain lookup is injected; the store imports only `pg`. Independently packageable.

## Tests
Register/retrieve (real PostgreSQL, append-only); missing-field + unregistered-domain ⇒ rejected; §5.4 status enforced; gate-viewer **blocks "In build" without harvest approval**, allows it once approved; append-only UPDATE denied.

## Status
**Built & tested (Phase 7.1).** Full suite green vs real PostgreSQL 16.14.

## Open Items
- Project intake / detail UI surfaces (§5.2–§5.5) are Wave 6 (Command Center) — this engine is the typed registry they read/write through.
