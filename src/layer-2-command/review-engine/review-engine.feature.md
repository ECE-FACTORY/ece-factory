# Feature — Dual-Claude Review Engine

**Path:** `src/features/review-engine/` · **Module:** 15 (Wave 2) · **Status:** **built & tested** (Phase 5.0)
**Governs:** blueprint §15; Layer 0 §§5, 18, 22; consumes the Evidence Pack Engine (§16).

## Purpose
Formalize the review decision (PASS / FAIL / REVISE / STOP) the dual-Claude loop produces on every phase, and make machine-true evidence **structurally enforceable** — the reviewer cannot approve unproven work.

## Decision model
`review(request) → ReviewDecision`. Each decision carries: `reason`, the `evidence` it relied on (validity + errors), the `reDerivation` declaration, and (for PASS/REVISE) a `nextPrompt`. PASS / FAIL / REVISE / STOP.

## Hard gates on PASS (deny-by-default)
A proposed PASS is downgraded unless **all** hold:
1. **Machine-true evidence** — the submitted Evidence Pack is **valid** under the Evidence Pack Engine. A load-bearing claim (test/lint/typecheck/build/license) without verbatim command output ⇒ pack invalid ⇒ **PASS impossible** (downgraded to FAIL). The reviewer literally cannot approve unproven work.
2. **Independent re-derivation (§22)** — the decision must declare `loadBearingClaimsReverified` + `stopConditionsChecked` (the reviewer re-derived the load-bearing facts and checked STOP conditions against the diff, not the builder's summary). A PASS that skipped this is malformed ⇒ REVISE.
3. **Next prompt + reason** — a PASS without a next prompt (L0 §18) or reason ⇒ REVISE.

Anything not positively meeting all PASS criteria is **not PASS**. An unrecognized/ambiguous proposal ⇒ REVISE (never a default PASS).

## FAIL / REVISE / STOP
Pass through (they are not approvals) but must carry required fields: all need a `reason`; REVISE needs a `nextPrompt`. Missing fields ⇒ flagged `wellFormed: false`.

## Standalone packaging
The Evidence Pack Engine is consumed through an injected `EvidenceValidator` port; the only cross-engine references are `import type` (EvidencePack/ValidationResult) — zero runtime coupling. Independently packageable.

## Tests
Unproven load-bearing claim ⇒ PASS impossible (FAIL); valid+re-derived+next-prompt PASS ⇒ PASS; missing re-derivation ⇒ cannot PASS (REVISE); FAIL/REVISE/STOP carry required fields; deny-by-default (incomplete PASS ⇒ not PASS; unrecognized ⇒ REVISE).

## Status
**Built & tested (Phase 5.0).** Pure-logic. Full suite green.

## Open Items
- Wiring this engine into the actual review/autopilot flow (so each step's pack is auto-reviewed) — later in Wave 2 (Autopilot / human-relay elimination).
