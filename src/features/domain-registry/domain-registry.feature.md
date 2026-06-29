# Feature — Domain Registry

**Path:** `src/features/domain-registry/` · **Module:** 4 (Wave 4) · **Status:** **built & tested** (Phase 7.0)
**Governs:** blueprint §4.1.

## Purpose
The typed registry of the domains the factory processes — durable institutional memory the Project Registry and Product Creation engines build on.

## Model (§4.1)
name · business objective · sovereignty (`sovereign | non-sovereign`) · air-gap (`required | optional | not-required`) · Arabic-first (`required | optional | not-required`) · sub-domains · target clients · owner · risk level (`low | medium | high`) · status (`idea | registered | harvesting | in-build | productized | live | deprecated`) · linked harvest/project refs.

## Validation / deny-by-default
A domain missing a required field is **rejected** (`DomainValidationError`), never stored half-formed. Required: name, businessObjective, sovereignty, airGap, arabicFirst, owner, riskLevel. **Sovereignty/air-gap/Arabic-first must be explicitly set** — "unknown" is not a valid state for a sovereign-market domain; the registry refuses to store an under-classified domain.

## Persistence (append-only)
**PostgreSQL, append-only** (`PostgresDomainRegistryStore` + migration `0004`). A domain registration / status transition is an institutional decision — each is a **new snapshot row**, so the history of what was registered when cannot be silently rewritten (REVOKE UPDATE/DELETE/TRUNCATE + guard trigger). `getLatest` returns the current state; `history` returns the full append-only trail. No RLS (factory-internal registry, not per-tenant client data).

## Status transitions
`transitionStatus(name, newStatus)` reads the latest snapshot and **inserts a new one** with the new status — history preserved, never overwritten.

## Consumption
`domainSummary(record)` exposes what the Project Registry / Product Creation engines consume: name, sovereignty, airGap, arabicFirst, status, subDomains.

## Standalone packaging
The engine imports nothing from any other engine; the store imports only the external `pg`. Independently packageable.

## Tests
Valid domain registers + retrievable (real PostgreSQL, append-only write); missing required field ⇒ rejected, not stored; status transition recorded append-only (history preserved); the consumable summary shape; append-only — UPDATE denied at the DB layer.

## Status
**Built & tested (Phase 7.0).** Full suite green vs real PostgreSQL 16.14. **Wave 4 begins.**

## Open Items
- Domain intake UI / the §4.2–§4.4 detail/sub-domain manager surfaces are Wave 6 (Command Center) — this engine is the typed registry they read/write through.
