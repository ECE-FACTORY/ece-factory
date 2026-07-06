# Feature — Compliance Checker

**Path:** `src/features/compliance-checker/` · **Module:** 26 (Wave 2) · **Status:** **built & tested** (Phase 5.2)
**Governs:** blueprint §26.

## Purpose
Continuously verify that a repo/step satisfies the governance invariants. Takes a structured descriptor and emits **Compliant / Warning / Fail / STOP** with per-check reasons.

## Core guarantee — deny-by-default
An invariant that cannot be **positively** verified is non-compliant — **Fail**, or **STOP** for security-critical ones — never a silent pass. Unknown/unverifiable ≠ "probably fine". Missing evidence of compliance **is** non-compliance. (Every descriptor field is optional; `undefined` ⇒ the check fails closed.)

## Invariants (as implemented)
| # | Invariant | Fail / STOP |
|---|-----------|-------------|
| 1 | governance files present, full-text, **no placeholders** | Fail (missing/placeholder/unverifiable) |
| 2 | CLAUDE.md present | Fail |
| 3 | required docs + feature files exist | Fail (lists missing) |
| 4 | Harvest-Report-before-build (build code ⇒ approved harvest) | Fail |
| 5 | Feature Registry exists and is populated | Fail |
| 6 | tools used are registered (no hidden tools) | Fail (lists unregistered) |
| 7 | sensitive-field / redaction policy present | Fail |
| 8 | audit schema present + append-only | **STOP** (security-critical) |
| 9 | write tools disabled if controls missing (audit+permission+redaction) | **STOP** if write tools present without full controls |
| 10 | no Claude-only actor (human attribution) | **STOP** |
| 11 | no dashboard-data-as-instruction path | **STOP** |

## Verdict
STOP dominates → then Fail → then Warning → else Compliant.

## Standalone packaging
Imports nothing from any other engine. Pure function over a typed descriptor. Independently packageable. (It can be composed with the Evidence Pack + Review engines to form a self-checking spine; it does not depend on them concretely.)

## Tests
Each invariant pass/fail; placeholder governance ⇒ Fail; missing artifact (CLAUDE.md / feature file / harvest-before-build) ⇒ Fail; write tool present but a control missing ⇒ STOP; deny-by-default on an unknown/unverifiable invariant ⇒ not Compliant; fully-compliant descriptor ⇒ Compliant.

## Status
**Built & tested (Phase 5.2).** Pure-logic. Full suite green. **Completes Wave 2 (Review Spine).**

## Open Items
- A repo-scanner that *populates* the descriptor from a real repo (reading files, the Audit schema, the Tool Registry) is a later integration; this engine verifies the descriptor, deny-by-default.
