# Feature — Product Spine Engine

**Path:** `src/features/product-spine/` · **Module:** 14 (Wave 3) · **Status:** **built & tested** (Phase 6.4)
**Governs:** Layer 1.1 §4 (spine doctrine), §5 (Anti-Frankenstein). Consumes the Scoring Engine result.

## Purpose
Determine a product's spine from scored candidates + compatibility signals, and emit a verdict with reasons and a single-point-of-failure analysis.

## Spine taxonomy
- **single-spine** — one clearly strongest, mature candidate is the foundation.
- **composed-spine** — 2–3 tightly-compatible repos, integration not dominating.
- **justified-BUILD-spine** — no acceptable sourced spine; a written BUILD justification is supplied.

## §4 spine doctrine
The spine must be **license-clean + ≥15 maturity** (eligibility, tying back to the Scoring gate) and a **clear** strongest (leads the next candidate by ≥ `CLEAR_SPINE_MARGIN`=10 pts). **No clear strongest ⇒ Rejected** — a product is built on a strong foundation, not assembled from equal fragments. No eligible candidate (and no BUILD justification) ⇒ Rejected.

## §5 Anti-Frankenstein (the core)
A proposed composition is **downgraded** ("find a stronger spine") when integration glue **dominates/is high**, or when it needs **> 3 repos**. Composition is accepted only when the pieces are **tightly compatible** with low/moderate integration. Many-repos-much-glue is exactly the failure this catches. On downgrade, the engine falls back to a clear single spine if one exists, else Rejected.

## Deny-by-default
Unknown/loose compatibility is treated as **INCOMPATIBLE until proven** — never "probably fine". A composition with `compatibility: 'unknown'` is not silently accepted.

## Single-point-of-failure analysis
Names the repo whose removal collapses the product (`spof.repoId`), whether the product is **fatally dependent** (`collapsesProduct` = no alternative), and the contingency (an alternative spine-eligible candidate, or fatal single-upstream dependence).

## Verdict
`accepted` (single/composed/justified-BUILD) · `downgraded` (Anti-Frankenstein fallback to single-spine) · `rejected` (§4 no clear spine).

## Standalone packaging
Only cross-engine reference is `import type` (the Scoring result). Pure function. Independently packageable.

## Tests
Strong single ⇒ single-spine accepted; equal-but-mediocre ⇒ Rejected (§4); over-complex integration / >3 repos ⇒ Anti-Frankenstein downgrade with "find a stronger spine"; SPOF identified (fatal-dependence vs alternative); unknown compatibility ⇒ not accepted (deny-by-default); tight 2–3 ⇒ composed-spine accepted; no eligible candidate ⇒ Rejected (or justified-BUILD if justified).

## Status
**Built & tested (Phase 6.4).** Pure-logic. Full suite green. Wave 3 sourcing engines (9/11/12/13/14) complete; Harvest (8) orchestrates them next.

## Open Items
- The Harvest Engine (Module 8) drives this engine over a real candidate set and runs the §3.8 second scoring pass — this engine provides the single spine verdict it consumes.
