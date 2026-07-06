# Feature — Risk Register

**Path:** `src/features/risk-register/` · **Module:** 31 (Wave 4) · **Status:** **built & tested** (Phase 7.5)
**Governs:** blueprint §31.

## Purpose
Track risks across the factory and its products — and **actively surface** the dangerous open ones so they can't be forgotten.

## Model (§31)
`{ key, title, type, owner, severity, mitigation, status, linkedProject, linkedRepo, linkedDecision, linkedEvidence }`.
- **type** ∈ license · air-gap · white-label · security · MCP · audit · verification · dependency · upstream-abandonment · human-approval · production · sensitive-data · architecture · integration.
- **severity** ∈ low | medium | high | critical · **status** ∈ open | mitigating | accepted | closed.

## Validation / deny-by-default
A risk missing `key`/`type`/`owner`/`severity`/`status` ⇒ rejected (`RiskValidationError`); an invalid `type`/`severity`/`status` ⇒ rejected. Never stored half-formed.

## Open-risk surfacer (the core)
`surfaceBlockingRisks(risks)` / `hasBlockingRisks(risks)` return the **unmitigated high/critical OPEN** risks (severity ∈ {high, critical} AND status === `open`). These are surfaced as **blocking** — the register exposes its dangerous open risks rather than burying them in a list. A risk that is `mitigating`/`accepted`/`closed` is not blocking.

## Persistence (append-only)
**PostgreSQL, append-only** (`PostgresRiskRegisterStore` + migration `0006`). Each registration / status transition is a **new snapshot row** (REVOKE UPDATE/DELETE/TRUNCATE + guard trigger) — a high/critical risk cannot be quietly closed off the books; the trail is preserved. `getLatest` is current state, `history` the full trail, `list` the latest per risk. No RLS.

## Standalone packaging
Engine imports nothing from any other engine; the store imports only `pg`. Independently packageable.

## Tests
Register/retrieve (real PostgreSQL, append-only); missing-field / invalid type / invalid severity ⇒ rejected; **an unmitigated high/critical open risk is surfaced as blocking**, a mitigated/closed one is not; status transitions append-only (history preserved); append-only UPDATE denied.

## Status
**Built & tested (Phase 7.5).** Full suite green vs real PostgreSQL 16.14.

## Open Items
- Risk-register UI / dashboard surfacing is Wave 6 (Command Center / Analytics) — this engine is the typed register + surfacer they read through.
