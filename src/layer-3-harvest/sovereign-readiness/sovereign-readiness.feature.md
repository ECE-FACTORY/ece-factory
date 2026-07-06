# Feature — Sovereign Readiness Engine

**Path:** `src/features/sovereign-readiness/` · **Module:** 12 (Wave 3) · **Status:** **built & tested** (Phase 6.2)
**Governs:** Layer 1.1 §8 (sovereign-readiness checklist).

## Purpose
Determine whether a candidate can run in a sealed, air-gapped, sovereign deployment, and emit a verdict with per-check reasons.

## Checklist (Layer 1.1 §8)
fully offline-capable · no foreign SaaS · no mandatory vendor telemetry/phone-home · logs local · identity local · database local · object storage local · AI inference local (or n/a) · updates installable manually (no forced foreign auto-update) · dependencies mirrorable · containers from a private registry · secrets local · audit local · deployment reproducible offline.

## Per-check states
`local` (confirmed) · `not-applicable` · `removable-gap` (can be hardened away) · `connected-only` (works only online) · `mandatory-blocker` (foreign dependency that cannot be removed). **Undefined ⇒ unknown.**

## Verdict semantics
Precedence: **Rejected > Non-sovereign-only > Acceptable-after-hardening > Acceptable.**
- any **mandatory-blocker** ⇒ **Rejected** (foreign SaaS/phone-home/forced-auto-update that can't be removed)
- else any **connected-only** ⇒ **Non-sovereign-only** (functional online, not air-gap)
- else any **removable-gap** or **unknown** ⇒ **Acceptable-after-hardening** (names the hardening / "must verify")
- else (all local / n-a) ⇒ **Acceptable**

## Deny-by-default (existential)
An unverifiable/unknown check is **non-compliant**, never "probably offline". Unknown ⇒ at best **Acceptable-after-hardening** (must verify) — never silently Acceptable. Assuming-safe is exactly how a phone-home slips into a sealed deployment, so a check you cannot positively confirm counts against readiness.

## Standalone packaging
Imports nothing from any other engine. Pure function over a typed descriptor. Independently packageable.

## Tests
Fully-local ⇒ Acceptable; removable-dependency/disable-able-telemetry ⇒ Acceptable-after-hardening (names hardening); mandatory foreign-SaaS/phone-home ⇒ Rejected; connected-only ⇒ Non-sovereign-only; unknown/unverifiable ⇒ NOT Acceptable (deny-by-default); per-check reasons present.

## Status
**Built & tested (Phase 6.2).** Pure-logic. Full suite green.

## Open Items
- A scanner that *populates* the descriptor from a real candidate (deployment artifacts, dependency graph, telemetry endpoints) is a later integration — this engine verifies the descriptor, deny-by-default.
