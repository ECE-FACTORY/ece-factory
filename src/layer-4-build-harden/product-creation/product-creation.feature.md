# Feature — Product Creation Engine

**Path:** `src/features/product-creation/` · **Module:** 6 (Wave 4 — capstone) · **Status:** **built & tested** (Phase 7.6)
**Governs:** blueprint §6.

## Purpose
The Wave-4 capstone **orchestrator**. Given a domain + harvest result + project gate state (and the Wave 1–4 engine outputs for a product), it **composes one governed product-creation plan** — and then stops for a human. It plans/recommends; it never creates and never approves.

## Composition (what the plan ties together)
- **domain reference** — Domain Registry (`DomainReference`, must be registered, not `idea`)
- **sourcing verdict** — Harvest Engine (`FORK` / `EXTEND` / `BUILD`)
- **repo build plan** — Repo Builder (invoked via injected `RepoBuilderPort`; plans only)
- **doc compliance** — Doc Engine verdict
- **feature compliance** — Feature Registry verdict
- **registered risks** — Risk Register snapshot (blocking ones surfaced via the injected surfacer)

## Inherited gates (composed, never re-implemented or weakened — ALL hold simultaneously)
- **never-self-executes** — `ProductCreationOutcome['status']` is only `'PLAN-AWAITING-APPROVAL' | 'REFUSED'`. No `CREATED`/`EXECUTED`/`APPROVED`/`PROCEED` variant exists (type-level proof in tests).
- **never-self-approves** — emits a *recommendation*; a human authorizes downstream. No approved/proceed state.
- **harvest-before-build** — `gate.clearedToBuild !== true` **or** `harvest.approved !== true` ⇒ **REFUSED**, no plan. Repo Builder's own refusal also propagates.
- **deny-by-default** — any unverifiable/missing input (unregistered domain, missing harvest/gate/doc/feature/risk input) ⇒ **REFUSED**, never "probably fine".
- **blocking-risks-surfaced** — an unmitigated high/critical OPEN risk is surfaced as `blockingRisks` + `blockingItems` + reflected in the recommendation. The plan is still produced (so the human sees it), but the danger is **never buried**. Doc/Feature `Fail` are surfaced the same way.

## Standalone packaging
Every cross-engine reference is `import type` (zero runtime coupling). The two engines it actually invokes — Repo Builder and the Risk Register surfacer — are **injected as ports**, so the engine imports no concrete cross-engine code and is independently packageable.

## Tests
Pure-logic with the **real** `RepoBuilder` and **real** `surfaceBlockingRisks` injected as ports (no DB — this engine is a pure composer): a fully-cleared product ⇒ complete plan ending `PLAN-AWAITING-APPROVAL` composing all parts; uncleared gate / unapproved harvest ⇒ REFUSED; type-level proof there is no created/executed/approved/proceed state; an unmitigated high/critical risk ⇒ surfaced as blocking; deny-by-default (unregistered domain / `idea` domain / missing harvest / missing risk snapshot / missing doc-feature input) ⇒ REFUSED.

## Status
**Built & tested (Phase 7.6).** Composed into the full accumulated suite, green vs real PostgreSQL 16.14.

## Open Items
- Product Creation UI / Command-Center surfacing of the composed plan + blocking items is Wave 6.
- This engine consumes already-gathered Wave 1–4 outputs; the upstream wiring that *gathers* them (a product pipeline) is a later integration step, downstream of the human-approval gate.
