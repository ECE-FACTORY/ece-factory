# Feature — Harvest Engine

**Path:** `src/features/harvest-engine/` · **Module:** 8 (Wave 3) · **Status:** **built & tested** (Phase 6.5)
**Governs:** Layer 1 §4 (harvest loop), §6 (Harvest Report + stop-gate), Layer 1.1 §3.8/§3.9. Orchestrates Modules 9/11/12/13/14.

## Purpose
Run the full harvest loop over a candidate set and assemble a structured Harvest Report — then **STOP for human approval**. It produces a recommendation, never an authorization.

## Orchestration flow
For each candidate: **License** classification → **Repo-Intelligence** eligibility → **Scoring** run **twice** (§3.8 second independent pass; disagreement > 15 ⇒ escalate, use the pessimistic pass) → then **Product-Spine** selection over the scored set → **Sovereign-Readiness** → **White-Label**. The five engines are **injected ports** (no concrete cross-engine import).

## The core guarantee — always STOP, never self-approves
The `HarvestReport.status` is the single literal `'STOP-AWAITING-HUMAN-APPROVAL'`. There is **no code path and no type variant** that emits "approved"/"proceed", regardless of how clean the candidates are. The engine recommends; the human authorizes.

## Report structure
`{ status, candidates[ {license, eligibility, scorePassA, scorePassB, scoreUsed, scoreDisagreement, escalated, evidence} ], spine, sovereign, whiteLabel, spof, recommendation{ verdict, evidence, reuseOverBuildFlag }, blockingItems[], reviewItems[] }`.

## No verdict without evidence
`recommendation.evidence` is always populated. A **BUILD** recommendation while an **acceptable FORK/EXTEND** candidate exists (eligible, score ≥ 70) ⇒ `reuseOverBuildFlag` + a §3.9 review item (reuse beats rebuild).

## Deny-by-default surfacing
Any engine result of Rejected / Non-sovereign-only / Blocked-by-legal-obligation / not-eligible ⇒ **blockingItems**; needs-review / Acceptable-after-hardening / Ready-after-stripping / §3.8 escalation / spine downgrade ⇒ **reviewItems**. Never buried under a positive recommendation.

## Standalone packaging
Only cross-engine references are `import type`. The engines are injected. Independently packageable.

## Tests
Clean set ⇒ complete report ending STOP (spine/sovereign/white-label/SPOF present); §3.8 disagreement > 15 ⇒ escalation; BUILD-with-acceptable-FORK ⇒ flagged; the engine NEVER self-approves (status always STOP); a rejected-license / non-sovereign / blocked candidate ⇒ surfaced as blocking.

## Status
**Built & tested (Phase 6.5).** Pure-logic (with the real engines injected). Full suite green. **Completes Wave 3 (Sourcing & Build CORE).**

## Open Items
- A live harvester front-end that *fetches* candidates (GitHub search + live LICENSE reads) and feeds this orchestrator is a deployment/runtime concern — this engine orchestrates over a supplied, verified candidate set.
