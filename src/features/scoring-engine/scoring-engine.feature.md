# Feature — Repository Scoring Engine

**Path:** `src/features/scoring-engine/` · **Module:** 11 (Wave 3) · **Status:** **built & tested** (Phase 6.1)
**Governs:** Layer 1.1 §3 (scoring), §3.8 (anti-gaming / evidence), §3.9 (70+ override). Consumes Repo Intelligence `scoringInputs`.

## Purpose
Score a sourced candidate so the factory prefers proven, license-clean, mature repos and refuses unsafe ones — pessimistically, with evidence on every sub-score.

## Rubric (as implemented)
| Dimension | Max | Mapping (examples) |
|-----------|-----|--------------------|
| License | 20 | ACCEPT→20 · NEEDS_REVIEW→10 (flag) · **REJECT→0 (auto-reject)** · missing→0 (flag) |
| Maturity | 20 | archived→0 · not-maintained→5 · maintenance-unconfirmed→8 (flag) · maintained+★≥1000→18 · ★ unknown→12 (flag) |
| Air-gap | 20 | yes→20 · partial→12 · no→4 (flag) · unknown→0 (flag) |
| White-label | 15 | easy→15 · moderate→10 · hard→5 (flag) · unknown→0 (flag) |
| Arch-fit | 15 | strong→15 · good→11 · possible→6 (flag) · poor→0 · **no evidence→0 (flag)** |
| Maintainability | 10 | clean→10 · maintainable→7 · hard→4 (flag) · unsafe→0 · **no evidence→0 (flag)** |
| **Total** | **100** | bands: ≥85 strong · ≥70 acceptable · ≥55 risky · else reject |

Every sub-score carries a one-line `evidence` string (§3.8 — a sub-score with no evidence is not a real score).

## Hard gates (override the total)
- **License REJECT ⇒ License 0 ⇒ automatic rejection.** A bad license cannot be outweighed by high marks elsewhere (`rejected: true`, band `reject`).
- **Spine ⇒ Maturity ≥ 15.** A spine candidate scoring < 15 maturity is flagged.
- **Air-gap < 10 ⇒ human-approval flag** (sovereign requirement).
- **§3.9 70+ override:** a candidate scoring 70+ steered to `BUILD` is flagged for human review — reuse beats rebuild; the factory must not rationalize an unnecessary BUILD over a good harvest candidate.

## Deny-by-default (the core guarantee)
Missing/unverifiable evidence scores **low** and is **flagged**, never optimistic. Unknown air-gap/white-label ⇒ 0; absent maturity/arch-fit/maintainability evidence ⇒ 0; unconfirmed maintenance ⇒ capped + flagged. A scorer that defaults generous is gamed by omitting evidence.

## Standalone packaging
Only cross-engine references are `import type` (Repo Intelligence + License decision types). Pure functions. Independently packageable.

## Tests
Clean Apache repo ⇒ high with evidence per sub-score; BSL ⇒ License 0 ⇒ auto-reject regardless of other scores; 70+ steered to BUILD ⇒ §3.9 flag; missing-evidence sub-score ⇒ low/flagged (not optimistic); spine < 15 maturity ⇒ flag; air-gap < 10 ⇒ human-approval flag.

## Status
**Built & tested (Phase 6.1).** Pure-logic. Full suite green.

## Open Items
- §3.8 second independent scoring pass (for a FORK-eligible candidate downgraded toward BUILD) — orchestrated by the Harvest Engine (Module 8) which runs two passes and compares; this engine provides the single-pass score it consumes.
