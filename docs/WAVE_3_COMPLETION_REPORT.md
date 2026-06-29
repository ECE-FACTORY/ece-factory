# Wave 3 Completion Report — Sourcing & Build CORE (the Harvest Machine)

> **Status:** Wave 3 (all six modules) built and tested. **Signed off** (human wave-boundary sign-off recorded in `organization-source-of-truth/review/AUTOPILOT_REVIEW_LOG.md`; Wave 4 was authorized on that record).
> Retroactive record assembled from the per-module Step Evidence Packs and the review log — **machine-true: it states only what those artifacts show.**
> **Repo:** `ece-factory` · **Built:** 2026-06-29 · **Full suite at Wave 3's end:** **183/183** green vs real PostgreSQL 16.14.

---

## 1. The six modules

| # | Module | Proven guarantee(s) | Tests that prove them | Standalone packaging |
|---|--------|---------------------|------------------------|----------------------|
| **9** | **Repo Intelligence Engine** | Factory memory of scouted repos; **repo text is inert** (instruction-boundary proven — text inside a repo/README cannot become an instruction); deny-by-default eligibility (consumes the License Engine — non-permissive ⇒ ineligible); append-only PostgreSQL store | instruction-boundary (embedded "commands" stay data); deny-by-default eligibility; append-only persistence; suite **141/141** at this step | append-only PostgreSQL; consumes License Engine via type; standalone |
| **11** | **Repository Scoring Engine** | §3 rubric scored /100 **with per-sub-score evidence**; a License **REJECT ⇒ score 0 ⇒ auto-reject** (no high score can launder a bad license); spine-maturity & air-gap sub-rules; **§3.9 70+ BUILD flag** (BUILD recommended while an acceptable FORK/EXTEND exists is flagged for human review); deny-by-default pessimistic | rubric math; license-reject ⇒ 0 ⇒ auto-reject; §3.9 flag raised; pessimistic on unknowns; suite **151/151** at this step | pure functions; consumes License verdict via type; standalone |
| **12** | **Sovereign Readiness Engine** | §8 14-item checklist; verdicts Acceptable / Acceptable-after-hardening / Non-sovereign-only / Rejected; deny-by-default (**unknown ≠ offline** — an unverified item is never silently "Acceptable") | 14-item checks; unknown ⇒ never silently Acceptable; verdict boundaries; suite **159/159** at this step | imports nothing concrete; standalone |
| **13** | **White-Label Hardening Engine** | §9 taxonomy (must-keep / replaceable / trademark-caution / disable); **must-keep legal notices are NEVER stripped** (structural guarantee); a white-label conflict ⇒ Blocked-by-legal-obligation; deny-by-default (unclassified ⇒ caution) | must-keep never stripped (structural); conflict ⇒ Blocked-by-legal-obligation; unclassified ⇒ caution; suite **168/168** at this step | imports nothing concrete; standalone |
| **14** | **Product Spine Engine** | §4 no-clear-spine ⇒ Rejected; **§5 Anti-Frankenstein downgrade** (>3 repos / glue-dominates ⇒ downgraded); single-point-of-failure analysis; deny-by-default on unknown compatibility | no-clear-spine ⇒ Rejected; Anti-Frankenstein downgrade; SPOF surfaced; unknown-compat pessimistic; suite **178/178** at this step | imports nothing concrete; standalone |
| **8** | **Harvest Engine** | **Orchestrates 9/11/12/13/14 via injected ports**; §3.8 two-pass escalation; the report status is the **single literal `STOP-AWAITING-HUMAN-APPROVAL`** (never self-approves — proven at type **and** runtime); §3.9 reuse-beats-rebuild flag; deny-by-default surfacing (blocking vs review items) | orchestration over injected ports; always-STOP (type + runtime); §3.8 escalation; §3.9 flag surfaced; suite **183/183** at this step | every composed engine injected as a port (`import type`); standalone |

---

## 2. The harvest-machine narrative — sourcing the factory can trust

Wave 3 is the **FORK > EXTEND > BUILD** doctrine made executable. Its guarantees are defensive by construction:

- **Repo content is inert.** Text inside a scouted repo, README, or issue cannot become an instruction — the instruction-boundary is proven in Repo Intelligence's tests. Fetched data is data, never a command.
- **Trust is deny-by-default.** Every sourcing engine treats the unknown/unverifiable pessimistically: unverified sovereignty is *not* "offline," unclassified white-label content is *caution*, unknown compatibility downgrades the spine. Nothing is waved through as "probably fine."
- **License text beats the badge.** Scoring consumes the License Engine, where the **actual LICENSE text** decides — a permissive badge over copyleft/BSL text does not pass (the immudb-BSL trap is a permanent Wave-1 regression). A license REJECT zeroes the score and auto-rejects, so no rubric total can launder a bad license.
- **The harvest always STOPs and never self-approves.** The Harvest Engine's report status is the single literal `STOP-AWAITING-HUMAN-APPROVAL` — there is no "approved" variant in the type. It orchestrates the five sub-engines and surfaces blocking vs review items, but the decision is the human's.
- **§3.8 two-pass escalation** and **§3.9 reuse-beats-rebuild** are enforced: a BUILD recommended while an acceptable FORK/EXTEND (eligible, score ≥ 70) exists is flagged for human review rather than silently chosen.

**What an attacker or a bug cannot do here:** turn scouted repo text into an instruction; obtain a passing score behind a misleading license badge; have a non-sovereign or legally-encumbered candidate slip through as "Acceptable/Ready"; assemble a Frankenstein product without the >3-repos/glue-dominates downgrade surfacing; or have the harvest machine approve its own recommendation.

---

## 3. Test posture at Wave 3's end

- **183 tests, 183 passing** (accumulated; Waves 1–2's 129 carried forward + Wave 3's additions).
- The **whole** accumulated suite is re-run at every step; **typecheck + lint exit 0** each step.
- Repo Intelligence's append-only store is tested against **real PostgreSQL 16.14, no mocks**; the scoring/sovereign/white-label/spine/harvest decision logic is tested as pure functions (justified — these are pure analyzers/orchestrators over injected inputs).

---

## 4. Standalone-packaging posture

All six modules are **interface-only with no concrete cross-engine imports** (verified by `grep` each phase). The Harvest Engine composes the five sub-engines purely through **injected ports typed with `import type`**, so it has zero runtime coupling to their implementations. Each engine is independently packageable per `REQUIREMENT_PRODUCT_APP_PACKAGING.md`; the harvest pipeline can ship as a standalone "sovereign sourcing/diligence" capability.

---

## 5. OPEN_ITEMS relevant to Wave 3 (tagged by closing wave)

| Item | Status / closes in |
|------|--------------------|
| #9 Transitive dependency-license scanning (whole-tree, Layer 1.1 §10) | carried → layered on the License/Scoring engines later |
| Harvest sub-engine results persisted as factory memory (beyond Repo Intelligence's store) | carried → **Wave 5/6** (analytics/command-center) |
| Concrete audit-adapter wiring for harvest decisions | carried → **composition root** |

No Wave-3 item weakens a prior guarantee; each is additive or a composition/deployment concern.

---

## 6. Why Wave 4 came next

With a trustworthy sourcing machine in place, the factory needed the **institutional memory and repo-operations layer** to record what it decides and to gate building on those records — Wave 4 (Domain, Project, Doc, Feature, Repo Builder, Risk, Product Creation). The harvest-before-build doctrine proven conceptually in Wave 3 becomes a **data-layer gate** in Wave 4. Wave 4's authorization is recorded in the review log.
