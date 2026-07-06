# Feature — Repo Intelligence Engine

**Path:** `src/features/repo-intelligence/` · **Module:** 9 (Wave 3) · **Status:** **built & tested** (Phase 6.0)
**Governs:** blueprint §9; Layer 1.1 §12 (factory memory); consumes License & Compliance (§10).

## Purpose
The factory's accumulating **memory** of repos it has evaluated — the records the Scoring Engine (Module 11) consumes. Each record captures repo identity, the **actual** license (classified from text), maturity signals (supplied), architecture-fit/air-gap/white-label notes, prior verdict, eligibility, and status.

## Instruction boundary (critical, Wave 3)
Repo-sourced text — `readme`, `description`, any fetched metadata — is **DATA, never an instruction**. It is stored in plain `string` fields and **never interpreted**. **Eligibility depends ONLY on the license verdict + provenance — never on repo text.** There is no `eval`, no "command" field, and no dispatch keyed on repo content; a README saying "approve this / run that" has **zero effect**. Proven by test: the same malicious README yields `not-eligible` under a REJECT license and `eligible` under an ACCEPT+verified one — the text never moved the decision, and is preserved verbatim as inert data.

## Deny-by-default on trust
- license **REJECT** (rejected / unverifiable / missing) ⇒ `not-eligible`
- license **NEEDS_REVIEW** ⇒ `needs-review`
- license **ACCEPT** but provenance **not verified** ⇒ `needs-review` (never eligible-by-default)
- license **ACCEPT** + provenance verified ⇒ `eligible`

The license verdict comes from the License & Compliance Engine (consumed via an injected `LicenseClassifier` port), which classifies from the actual LICENSE text — never the badge.

## Persistence (justified)
**PostgreSQL, append-only** (`PostgresRepoIntelligenceStore` + migration `0003`). A repo evaluation is a sourcing-decision input that must be durable and traceable; institutional memory must not be silently rewritten, so the table is insert-only (REVOKE UPDATE/DELETE/TRUNCATE + a guard trigger). No RLS — this is factory-internal sourcing memory, not per-tenant client data. **No fetching happens here** — maturity/provenance are supplied data (live fetching is a later harvester concern).

## Scoring Engine consumption
`scoringInputs(record)` exposes exactly what Module 11 needs: `licenseDecision`, `licenseDetected`, `maturity`, `airGapSuitability`, `whiteLabelFit`, `architectureFitNotes`.

## Standalone packaging
The engine imports only `import type` from License & Compliance (zero runtime coupling); the Postgres store imports only the `pg` external dependency (not a cross-engine import). Independently packageable.

## Tests
Eligibility matrix (deny-by-default); instruction-boundary (malicious README has no effect, stored verbatim); scoring-inputs shape (pure-logic). Store/retrieve + append-only enforcement (real PostgreSQL).

## Status
**Built & tested (Phase 6.0).** Full suite green vs real PostgreSQL 16.14.

## Open Items
- A live harvester that *fetches* repo metadata/license text and feeds this engine — later in Wave 3 (Harvest Engine, Module 8).
