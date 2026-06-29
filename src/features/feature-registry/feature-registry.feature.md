# Feature — Feature Registry Engine

**Path:** `src/features/feature-registry/` · **Module:** 28 (Wave 4) · **Status:** **built & tested** (Phase 7.3)
**Governs:** Layer 2 §8 (feature registry), §9 (feature files).

## Purpose
Enforce **"no feature exists only in code"** at the per-feature level — and catch the subtler "built but incompletely accounted for" cases the project-level Doc Engine doesn't reach.

## Feature model (§8)
Each feature: `{ name, path, status (planned | built), hasCode, hasFeatureFile, components, services, apis, dbTables, permissions, hasTests, risks, openItems }`.

## Consistency rules
- **code with no feature file** ⇒ `undocumented-code` (a feature exists only in code).
- **feature file marked built with no code** ⇒ `overclaim` (a feature that doesn't exist).
- **a BUILT feature with no tests** ⇒ `no-tests` — unverified code wearing a "done" label (a **dangerous omission**).
- **a BUILT feature with no permissions noted** ⇒ `no-permissions` — an access-control gap hiding in plain sight (a **dangerous omission**).
- a **PLANNED** feature with no code ⇒ fine (not flagged).

## Deny-by-default
A feature whose `status`/`hasCode`/`hasFeatureFile` cannot be verified ⇒ `unknown-drift` (non-compliant) — never "probably fine". For a built feature, `hasTests !== true` (false **or** unknown) and empty/absent permissions both flag, because unconfirmed safety is non-compliance.

## Verdict
`Compliant` iff zero findings; otherwise `Fail` (with one finding per violation; a single under-accounted feature can carry several).

## Standalone packaging
Imports nothing from any other engine. Pure function over a typed feature list. Independently packageable. (It composes with the Doc Engine's project-level alignment; kept separate by concern.)

## Tests
Fully-documented built feature (file + tests + permissions + code) ⇒ Compliant; code-only ⇒ flagged; built-without-tests ⇒ flagged; built-without-permissions ⇒ flagged; built-without-code (overclaim) ⇒ flagged; planned-without-code ⇒ not flagged; deny-by-default (unverifiable) ⇒ non-compliant.

## Status
**Built & tested (Phase 7.3).** Pure-logic. Full suite green.

## Open Items
- A scanner that derives the feature list from a real repo (code presence, feature-file presence + status, test detection, permission extraction) is a later integration; this engine verifies the supplied list, deny-by-default.
