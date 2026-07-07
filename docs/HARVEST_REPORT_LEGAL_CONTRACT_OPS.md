# Harvest Report — Legal & Contract Operations

**Status:** STOP-AWAITING-HUMAN-APPROVAL · **Generated:** 2026-07-07T11:36:17.348Z

> READ-ONLY harvest pass. Scores come from the real graders on scout-sourced evidence. No build, fork, or external action was taken. Awaiting human approval.

## 1. Sub-domain decomposition & decisions

| Sub-domain | Decision | Spine (score/band) | Candidates |
|---|---|---|---|
| Contract Lifecycle Management (CLM) | **NEEDS-ASSESSMENT** | OneSavieLabs/Bastet (36/100, reject) | 5 |
| E-Signature & Approvals | **BUILD** | — | 1 |
| Clause & Template Library | **BUILD** | — | 2 |
| Document Assembly & Generation | **NEEDS-ASSESSMENT** | ykSubha/intelligent-property-doc-generation (33/100, reject) | 1 |
| Obligation & Deadline Tracking | **NEEDS-ASSESSMENT** | noamrazbuilds/obligation-tracker (33/100, reject) | 5 |

### Contract Lifecycle Management (CLM)  —  decision: **NEEDS-ASSESSMENT**

_Query:_ `contract lifecycle management`

- spine: OneSavieLabs/Bastet — real score 36/100, band "reject"
- low score is driven ENTIRELY by dimensions the scout does not source (air-gap, white-label, arch-fit, maintainability) — deny-by-default, NOT a proven weakness
- reuse-beats-rebuild: a permissive, maintained repo must be assessed on those dimensions before any BUILD (Write-Asks-Read-First / §3.9)

| Repo | License (from real file) | Decision | Eligibility | Score | Band |
|---|---|---|---|---|---|
| [OneSavieLabs/Bastet](https://github.com/OneSavieLabs/Bastet) | Apache-2.0 · "Apache License" | ACCEPT | eligible | 36/100 | reject |
| [andrewmogbolu2/blockchain-technology](https://github.com/andrewmogbolu2/blockchain-technology) | unknown · "no LICENSE file read — unverified" | REJECT | not-eligible | 5/100 | reject |
| [ProgrammingNotJustCoding/marai](https://github.com/ProgrammingNotJustCoding/marai) | unknown · "no LICENSE file read — unverified" | REJECT | not-eligible | 13/100 | reject |
| [01amine/Contract-Lifecycle-Management](https://github.com/01amine/Contract-Lifecycle-Management) | unknown · "no LICENSE file read — unverified" | REJECT | not-eligible | 13/100 | reject |
| [AniketTati/draft-legal](https://github.com/AniketTati/draft-legal) | NonCommercial · "draftLegal — agent-first contract lifecycle management" | REJECT | not-eligible | 13/100 | reject |

### E-Signature & Approvals  —  decision: **BUILD**

_Query:_ `electronic signature esignature open source`

- no permissively-licensed repo found (all candidates REJECT/ineligible) — a genuine absence

| Repo | License (from real file) | Decision | Eligibility | Score | Band |
|---|---|---|---|---|---|
| [penpact/penpact](https://github.com/penpact/penpact) | NonCommercial ⚠︎hint≠file · "GNU AFFERO GENERAL PUBLIC LICENSE" | REJECT | not-eligible | 13/100 | reject |

### Clause & Template Library  —  decision: **BUILD**

_Query:_ `contract clause template library`

- no permissively-licensed repo found (all candidates REJECT/ineligible) — a genuine absence

| Repo | License (from real file) | Decision | Eligibility | Score | Band |
|---|---|---|---|---|---|
| [ashuprakash-cyber/contract-drafting-ai](https://github.com/ashuprakash-cyber/contract-drafting-ai) | unknown · "no LICENSE file read — unverified" | REJECT | not-eligible | 13/100 | reject |
| [VipulMore11/Legal-Contract-Builder](https://github.com/VipulMore11/Legal-Contract-Builder) | unknown · "no LICENSE file read — unverified" | REJECT | not-eligible | 13/100 | reject |

### Document Assembly & Generation  —  decision: **NEEDS-ASSESSMENT**

_Query:_ `document assembly generation legal`

- spine: ykSubha/intelligent-property-doc-generation — real score 33/100, band "reject"
- low score is driven ENTIRELY by dimensions the scout does not source (air-gap, white-label, arch-fit, maintainability) — deny-by-default, NOT a proven weakness
- reuse-beats-rebuild: a permissive, maintained repo must be assessed on those dimensions before any BUILD (Write-Asks-Read-First / §3.9)

| Repo | License (from real file) | Decision | Eligibility | Score | Band |
|---|---|---|---|---|---|
| [ykSubha/intelligent-property-doc-generation](https://github.com/ykSubha/intelligent-property-doc-generation) | MIT · "MIT License" | ACCEPT | eligible | 33/100 | reject |

### Obligation & Deadline Tracking  —  decision: **NEEDS-ASSESSMENT**

_Query:_ `contract obligation deadline tracking`

- spine: noamrazbuilds/obligation-tracker — real score 33/100, band "reject"
- low score is driven ENTIRELY by dimensions the scout does not source (air-gap, white-label, arch-fit, maintainability) — deny-by-default, NOT a proven weakness
- reuse-beats-rebuild: a permissive, maintained repo must be assessed on those dimensions before any BUILD (Write-Asks-Read-First / §3.9)

| Repo | License (from real file) | Decision | Eligibility | Score | Band |
|---|---|---|---|---|---|
| [AasthaSanghi91/contract-obligation-tracker](https://github.com/AasthaSanghi91/contract-obligation-tracker) | unknown · "no LICENSE file read — unverified" | REJECT | not-eligible | 13/100 | reject |
| [gracyosun/obligation-chrono-anchor-protocol](https://github.com/gracyosun/obligation-chrono-anchor-protocol) | unknown · "no LICENSE file read — unverified" | REJECT | not-eligible | 13/100 | reject |
| [noamrazbuilds/obligation-tracker](https://github.com/noamrazbuilds/obligation-tracker) | MIT · "MIT License" | ACCEPT | eligible | 33/100 | reject |
| [victoriaolupon/stellar-accountability-matrix](https://github.com/victoriaolupon/stellar-accountability-matrix) | unknown · "no LICENSE file read — unverified" | REJECT | not-eligible | 13/100 | reject |
| [elizakaw/dobligation-chain](https://github.com/elizakaw/dobligation-chain) | unknown · "no LICENSE file read — unverified" | REJECT | not-eligible | 13/100 | reject |

## 2. Sovereign readiness / air-gap

**Verdict (deny-by-default, empty descriptor):** Acceptable-after-hardening

_The scout sources no deployment artifacts, so every sovereign check is UNKNOWN (deny-by-default). This verdict confirms nothing was verified — it is not a positive air-gap claim for any repo._

## 3. Reviewer re-derivation (independent — not trusting the assembler)

| Repo | Assembler license | Reviewer (from raw file) | Agree? | Assembler air-gap | Reviewer | Agree? |
|---|---|---|---|---|---|---|
| https://github.com/OneSavieLabs/Bastet | ACCEPT (Apache-2.0) | ACCEPT (Apache-2.0) | ✓ | unknown | unknown | ✓ |
| https://github.com/penpact/penpact | REJECT (NonCommercial) | REJECT (NonCommercial) | ✓ | unknown | unknown | ✓ |
| https://github.com/ashuprakash-cyber/contract-drafting-ai | REJECT (unknown) | unknown (no LICENSE text) | ✓ | unknown | unknown | ✓ |
| https://github.com/ykSubha/intelligent-property-doc-generation | ACCEPT (MIT) | ACCEPT (MIT) | ✓ | unknown | unknown | ✓ |
| https://github.com/noamrazbuilds/obligation-tracker | ACCEPT (MIT) | ACCEPT (MIT) | ✓ | unknown | unknown | ✓ |

## 4. Custom-code boundary (reuse vs. ECE builds — the moat)

- REUSE (harvest): permissively-licensed spines per sub-domain (CLM, e-sign, clause libraries, document assembly, obligation tracking) — do not rebuild what a proven repo does.
- ECE BUILDS (the moat): the unified data model + integration glue across the sub-domains; sovereign/air-gap hardening; Arabic-first adaptation; the white-label brand layer; and any genuinely missing capability confirmed absent after assessment.
- The deeper assessment engines the scout does NOT yet provide (air-gap prober, white-label friction analyzer, architecture-fit + maintainability review) are themselves ECE-built factory capability.

## 5. Adversarial red-team (where this plan is weakest)

- Scores are structurally capped: the scout sources only license + maturity. Air-gap, white-label, architecture-fit and maintainability are deny-by-default (0), so even excellent repos band as "reject". Any BUILD read from the raw band would be an artifact of missing assessment, not proven absence — which is why such cases are reported as NEEDS-ASSESSMENT, not BUILD.
- Discovery is single-page, popularity-sorted GitHub search — it can miss the best repo if it is not stars-ranked for the exact query string.
- Sub-domain queries are hand-authored; a poorly chosen query yields weak candidates that are not representative of the field.
- License detection is signature-based over the raw file; an unusual or dual-license file lands as NEEDS_REVIEW rather than a confident decision (correctly conservative, but it defers work to a human).
- The sovereign verdict is deny-by-default over an empty descriptor — it says nothing positive about any repo; it only proves nothing was verified.

## 6. Market position

- Incumbents are proprietary SaaS CLM suites (foreign-cloud, subscription, non-sovereign).
- The sovereign/air-gap + Arabic-first white-label composition is the differentiator nothing local offers off-the-shelf.

## 7. Limitations (honest scope)

- End-to-end scores reflect ONLY license + maturity evidence. Fork/Extend/Build decisions are provisional until air-gap, white-label, architecture-fit and maintainability are assessed.
- This is a READ-ONLY report. No repo was forked, created, or modified; no external action was taken.

---

**STOP — AWAITING HUMAN APPROVAL. No build, fork, or external action taken.**
