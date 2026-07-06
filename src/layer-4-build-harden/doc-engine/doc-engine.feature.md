# Feature — Source-of-Truth Doc Engine

**Path:** `src/features/doc-engine/` · **Module:** 27 (Wave 4) · **Status:** **built & tested** (Phase 7.2)
**Governs:** Layer 2 §5–§7, §11 (source-of-truth discipline).

## Purpose
Verify that a project's required source-of-truth docs are present (not placeholder) and that code and docs are aligned **both ways**.

## Required docs (Layer 2 §5)
PROJECT_SOURCE_OF_TRUTH · PROJECT_MAP · ARCHITECTURE · IMPLEMENTATION_PLAN · FEATURE_REGISTRY · DECISION_LOG · REPO_AUDIT · OPEN_ITEMS · SECURITY_NOTES · DEPLOYMENT · TESTING · UPSTREAM_TRACKING.

## Completeness (no placeholders)
A required doc is compliant only when its state is **`present`** (exists AND full-text). `placeholder`/empty ⇒ **Fail** (same no-placeholders discipline as the Compliance Checker's governance check). `missing` ⇒ Fail. **Unverifiable (undefined) ⇒ Fail** (deny-by-default).

## Bidirectional alignment (the core)
- **Direction 1 — undocumented code:** a feature with code but **no feature file** ⇒ flagged (`undocumented-code`).
- **Direction 2 — overclaiming docs:** a feature file marked **complete/built with no code** ⇒ flagged (`overclaiming-docs`). Docs that assert a feature is done when it isn't are **arguably worse** than a missing doc — they mislead.
Both directions are caught. A feature file marked `planned` with no code is fine.

## Deny-by-default
An unverifiable doc state OR an unverifiable alignment side (code/feature-file presence unknown) ⇒ **drift** (`unknown-drift`), non-compliant — never "probably fine"/"probably aligned".

## Verdict
`Compliant` only when every required doc is `present` AND there are zero alignment findings; otherwise `Fail`.

## Standalone packaging
Imports nothing from any other engine. Pure function over a typed descriptor. Independently packageable. (A scanner that populates the descriptor from a real repo — reading files, detecting placeholders, mapping features↔files — is a later integration.)

## Tests
Complete aligned set ⇒ Compliant; missing required doc ⇒ Fail; placeholder doc ⇒ Fail; code-without-feature-file ⇒ flagged; feature-file-claims-complete-without-code ⇒ flagged; deny-by-default on unverifiable alignment ⇒ non-compliant.

## Status
**Built & tested (Phase 7.2).** Pure-logic. Full suite green.

## Open Items
- A repo scanner that derives the descriptor (file presence + placeholder detection + features↔feature-files mapping) is a later integration; this engine verifies the descriptor, deny-by-default.
