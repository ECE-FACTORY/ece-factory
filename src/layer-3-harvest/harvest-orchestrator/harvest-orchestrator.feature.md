# Feature — Harvest Orchestrator

**Path:** `src/layer-3-harvest/harvest-orchestrator/` · **Layer:** 3 (Harvest / Sourcing) · **Status:** built & tested (unit; live skippable)
**Governs:** Layer 1 Source & Build Doctrine §4 (the harvest loop as ONE pass) and the Write-Asks-Read-First Doctrine (this is a READ chain that reaches no write path and stops at the human gate).

## Purpose
Run **one governed, read-only harvest pass** for a named domain and assemble a Harvest Report for human review. It **orchestrates existing proven pieces** — it reimplements none, wires to no write/external path, and takes no external action. It is the first time the full chain runs as a single pass.

## The chain (read-and-assemble only) — real entry points cited
1. **Decompose** — `decompose(domain)` → 4–6 sub-domains (inert domain knowledge, not fetched data). For "Legal & Contract Operations": CLM, e-signature, clause/template library, document assembly, obligation tracking.
2. **Scout** — the injected `ScoutPort` (the committed `repo-scout`, LIVE-proven). All network egress lives in repo-scout; independent raw-LICENSE verification; **fail-closed** on missing token/network.
3. **Grade** — through the REAL engines, by their real entry points:
   - `RepoIntelligenceEngine.evaluate` — `repo-intelligence.ts:109` (license classification + deny-by-default eligibility + maturity)
   - `classifyLicense` via the engine's `LicenseClassifier` port — `license-compliance.ts:92`
   - `candidateFromScoringInputs` + `scoreCandidate` — `scoring-engine.ts:51`, `:131`
   - `assessSovereignReadiness` — `sovereign-readiness.ts:77`
3b. **Enrich (optional, read-only)** — if a `SignalsScoutPort` is injected, `gatherSignals()` reads the four dimensions the base scout cannot source via **`repo-scout-signals`**, and `enrichScore()` re-grades the candidate **under the confidence contract** (below). No port injected, or signals fail closed for a candidate ⇒ that candidate is graded **exactly as before** (deny-by-default). The gather is per-candidate and tolerant: a throw ⇒ `null` ⇒ no enrichment (never crashes the chain, never fabricates).
4. **Decide** — `decideSourcing()` maps the (possibly enriched) score band to `FORK` (≥70) / `EXTEND` (55–69) / `BUILD` (genuine absence) / **`NEEDS-ASSESSMENT`** (see honest finding). When enrichment moved the band, the decision evidence attributes it to the exact measured/bounded signals.

## The confidence contract (the integrity mechanism — `enrichScore()` encodes it)
Each dimension emits `{ value, confidence, evidence[] }`. The orchestrator gates its influence on the score:
- **measured** → graded at **full weight** by the real scoring engine (**may raise** the band). Maintainability is measured whenever the signals scout succeeds; architecture is measured when a dependency manifest is readable.
- **partial** → **weak / bounded**: a partial architecture is capped at `'possible'` (≤6/15, still flagged); **air-gap is bounded to ZERO uplift** — absence of a cloud dependency is not proof of air-gap safety, and any uplift would erode the sovereign air-gap gate.
- **not-mechanizable** → **deny-by-default (0)**, byte-identical to an un-enriched grade (white-label is always here).

Because air-gap + white-label never raise a band, the **top reachable enriched score is `20+18+11+10 = 59` → band `risky`**. Enrichment can sharpen `NEEDS-ASSESSMENT → EXTEND` on real measured evidence but **can never manufacture a `FORK`** — that still requires the human air-gap + white-label judgment. Every point of movement is recorded in `GradedCandidate.enrichment` (`EnrichmentTrace`: before/after totals + bands + per-dimension deltas) and surfaced in the report's per-candidate "Signals (confidence-gated)" column. A verdict change that cannot be traced to a specific measured/bounded signal does not happen.
5. **Assemble** — sub-domain decomposition; spine + supporting repos; license evidence (≤1 line quoted from the real LICENSE file); sovereign/air-gap; custom-code boundary (reuse vs. ECE-builds = the moat); adversarial red-team; market position.
6. **Reviewer re-derivation** — `reviewLicense()` / `reviewAirGap()` independently re-derive license + air-gap from the RAW scouted evidence (not the assembler's summary) and record agreement/disagreement.
7. **Stop** — `status` is the single literal `'STOP-AWAITING-HUMAN-APPROVAL'`. The module returns a report string; writing to `docs/` and any approval are outside it (the human gate).

## Honest finding — why most decisions are NEEDS-ASSESSMENT, not BUILD
The scout sources only **license + maturity**. The scoring engine scores four further dimensions — air-gap, white-label, architecture-fit, maintainability — all **deny-by-default (0)** when unsupplied (`scoring-engine.ts:91-129`; `repo-intelligence.ts:119-120` defaults them to `unknown`). So even a perfect, popular, MIT-licensed repo bands as `reject` (≈38/100). Reading that raw band as **BUILD** would be dishonest — it would recommend rebuilding a great repo purely because we have not assessed it yet. The chain therefore returns **`NEEDS-ASSESSMENT`** for a permissive, maintained spine whose only shortfall is the unassessed dimensions (Write-Asks-Read-First / §3.9: reuse beats rebuild; no verdict without evidence). This is reported, not faked.

## Network isolation & fail-closed
No network in this module — it calls the injected `ScoutPort` only. If any sub-domain scout returns `FAILED_CLOSED` (no token / unreachable), the whole run fails closed with an honest reason and **writes no report** — never a fabricated one. The GitHub token is inbound-only to repo-scout via env; it is never handled, logged, or written into the report here.

## Read-only / standalone
Imports only the real Layer-3 read/grader engines; nothing from the action layer. Frozen read-only by `src/architecture/write-asks-read-first.test.ts` (Prohibition 3). The module performs no file writes — the live test writes the report artifact.

## Tests
- `harvest-orchestrator.test.ts` (unit, **no network, no token**): decomposition; the grade→decision mapping using REAL grader outputs on injected fake scout data (MIT-eligible ⇒ NEEDS-ASSESSMENT; BSL-only ⇒ BUILD); report-assembly shape + status literal; reviewer re-derivation **agreeing and disagreeing**; fail-closed (scout FAILED_CLOSED ⇒ no report).
- `harvest-orchestrator.live.test.ts` (**skippable**): with a real `GITHUB_TOKEN`, runs the full chain for "Legal & Contract Operations" against real GitHub, writes `docs/HARVEST_REPORT_LEGAL_CONTRACT_OPS.md`, and asserts the token is absent from the report. **Skips cleanly** without a token.

## Not wired
Build + test only. Not connected to the live MCP server or any write path. Feeding an approved report forward is a separate, human-gated step.

## Open items
- The base scout does not source air-gap / white-label / architecture-fit / maintainability; the optional `SignalsScoutPort` (`repo-scout-signals`) now supplies **measured** maintainability/architecture and a **partial** air-gap, but **air-gap + white-label remain machine-unassessable** — a human pass is still required before a decision hardens past NEEDS-ASSESSMENT (enrichment tops out at EXTEND).
- The orchestrator maps a candidate to `SignalsQuery{owner,name}`; the injected adapter resolves the default branch (the orchestrator never handles a token or a branch). The base `ScoutedCandidate` does not carry a default branch, so the live adapter resolves it read-only.
- Single-page, popularity-sorted discovery; hand-authored sub-domain queries.
