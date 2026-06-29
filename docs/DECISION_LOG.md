# Decision Log — ECE Factory (ece-factory)

> Project-level decisions. Org-level decisions live in `organization-source-of-truth/registry/ORG_DECISION_LOG.md`.

## [2026-06-29] Testing model: fresh-PostgreSQL-per-run is the deliberate standard
Decision: The integration suite is run against a freshly-provisioned throwaway PostgreSQL cluster on every run (each phase provisions one). This is the deliberate current standard, not an accident — many tests assert exact row counts and are intentionally written against a clean DB. Shared-DB / always-on CI isolation (per-test truncation, transactional rollback, or unique-key fixtures) is deferred to CI/deployment-readiness (~Wave 6). See OPEN_ITEMS #7. Discovered: Phase 7.0.

## [2026-06-29] Audit Engine spine: PostgreSQL + ECE write-ahead glue + app hash-chain (Module 23)
Decision: Build the Audit Engine as the approved EXTEND — PostgreSQL as operational append-only audit storage (RLS for per-org scoping, privileges + trigger for append-only), ECE-built write-ahead sequencer (§23.1), app-level hash-chain for tamper evidence (§5), §24 audit-of-reads + permissioned viewer, with optional pgaudit for DB-layer defense-in-depth.
Reason: Storage was sourceable and is sourced (PostgreSQL, already the stack DB); only the §23–24 governance sequence is genuinely custom. Lowest verification load consistent with the integrity requirements (Layer 1.1 §7). immudb (BSL) and emmett (unverifiable) rejected from live LICENSE reads.
Alternatives Considered: Trillian as spine for cryptographic external-verifiability — deferred (Anti-Frankenstein integration weight) to a reserved seam; see next entry.
Impact: Defines the Phase 3 build surface and the custom-code boundary (IMPLEMENTATION_PLAN §5).
Files Affected: `docs/ARCHITECTURE.md`, `docs/IMPLEMENTATION_PLAN.md`, `src/features/audit-engine/audit-engine.feature.md`, `docs/UPSTREAM_TRACKING.md`.

## [2026-06-29] Refusal-audit path deferred to Phase 3.5 (denied attempts must be auditable)
Decision: In the Phase 3.3 sequencer and the Phase 3.4 viewer, authorization runs BEFORE intent/read-log commit, so a REFUSE currently writes no audit record. This is an accepted, temporary gap: a dedicated **refusal-audit path** will be added in **Phase 3.5** so denied attempts are recorded ("who tried what they weren't allowed to, and when") — separately from successful-action audit, to keep intent↔result pairing clean.
Reason: Auditing refusals is security-relevant (attempted-but-denied access), but folding it into the success path would create result-less "orphan" intents. A distinct refusal record is the correct model.
Alternatives Considered: Record a refusal as an intent with an immediate error result — rejected (muddies orphan detection and the authz-before-commit ordering).
Impact: Until Phase 3.5, refused reads/actions return safely and read/do nothing, but are not themselves logged. Tracked in OPEN_ITEMS.md and is the locked next step after 3.4.
Files Affected: `src/features/audit-engine/sequencer.ts`, `read-audit.ts`; OPEN_ITEMS.md.

## [2026-06-29] Trillian/Rekor/Tessera reserved behind a defined seam (the `AuditSink` boundary)
Decision: The high-assurance external-verifiability layer is NOT built now but MUST be additive later. The engine writes only through the `AuditSink` interface (ARCHITECTURE §8); the default is `PostgresHashChainSink`; a future `VerifiableLogSink` (Trillian/Rekor/Tessera, Apache-2.0) attaches as a composed second sink consuming the same canonical entry bytes, returning external proofs via `proof()`.
Reason: Honor the approval condition that adding external verifiability is additive, not a rewrite. Avoids premature integration weight while preserving the upgrade path for a sovereign client that mandates verifiable audit.
Alternatives Considered: Build Trillian integration now (premature; over-engineered for current volume); or omit the seam (would force a future rewrite — rejected).
Impact: Four boundary guarantees (ARCHITECTURE §8) become design constraints tested from Phase 3 (test T10). Sequencer and callers must never depend on a concrete store.
Files Affected: `docs/ARCHITECTURE.md` §8, `docs/IMPLEMENTATION_PLAN.md`, `docs/UPSTREAM_TRACKING.md`.
