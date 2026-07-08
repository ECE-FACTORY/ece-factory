# Harvest Report — Identity & Access Management

**Status:** STOP-AWAITING-HUMAN-APPROVAL · **Generated:** 2026-07-08T20:56:00.392Z

> READ-ONLY harvest pass. Scores come from the real graders on scout-sourced evidence. No build, fork, or external action was taken. Awaiting human approval.

## 1. Sub-domain decomposition & decisions

| Sub-domain | Decision | Spine (score/band) | Candidates |
|---|---|---|---|
| Authentication & SSO (OIDC/SAML) | **NEEDS-ASSESSMENT** | BabyJ723/blast-ON (47.7/100, reject) | 2 |
| Authorization & Policy (RBAC/ABAC) | **EXTEND** | abhishekayu/react-access-engine (78.5/100, acceptable) | 4 |
| Identity & User Management | **BUILD** | — | 0 |
| OAuth2 / OIDC Token Services | **EXTEND** | JohnBasrai/tokn (70.8/100, acceptable) | 5 |
| MFA & Identity Federation | **BUILD** | — | 0 |

### Authentication & SSO (OIDC/SAML)  —  decision: **NEEDS-ASSESSMENT**

_Query:_ `openid connect saml single sign-on identity provider`

- spine: BabyJ723/blast-ON — real score 47.7/100, band "reject" (4/6 dims measured, coverage 65%)
- enrichment refined score 62.5→47.7 (band risky→reject) — justified ONLY by: architecture=possible (partial, +6)
- normalized 47.7/100 is below 55 on 4 measured dimensions — genuinely weak on what was assessed
- unmeasured at decision: air-gap, white-label
- reuse-beats-rebuild: assess the unmeasured dimensions before any BUILD (Write-Asks-Read-First / §3.9) — unmeasured dims are excluded from the score, NOT assumed good or bad

| Repo | License (from real file) | Decision | Eligibility | Score | Band | Signals (confidence-gated) |
|---|---|---|---|---|---|---|
| [BabyJ723/blast-ON](https://github.com/BabyJ723/blast-ON) | MIT ⚠︎hint≠file · "Boost Software License - Version 1.0 - August 17th, 2003" | ACCEPT | eligible | 47.7/100 | reject | maintainability=unsafe(meas,+0) · architecture=possible(part,+6) · air-gap=unknown(n/m,+0) · white-label=unknown(n/m,+0) |
| [NanaPaulson/okta-sso-saml-oidc-lab](https://github.com/NanaPaulson/okta-sso-saml-oidc-lab) | unknown · "no LICENSE file read — unverified" | REJECT | not-eligible | 35.4/100 | reject | maintainability=hard(meas,+4) · architecture=possible(meas,+6) · air-gap=partial(part,+0) · white-label=unknown(n/m,+0) |

### Authorization & Policy (RBAC/ABAC)  —  decision: **EXTEND**

_Query:_ `authorization rbac abac policy engine access control`

- spine: abhishekayu/react-access-engine — real score 78.5/100, band "acceptable" (4/6 dims measured, coverage 65%)
- enrichment refined score 82.5→78.5 (band acceptable→acceptable) — justified ONLY by: maintainability=maintainable (measured, +7), architecture=good (measured, +11)
- normalized 78.5/100 ≥ 55 on 4/6 measured dims, but air-gap UNMEASURED — EXTEND (fork then build the gap); air-gap still needs a human before any FORK
- unmeasured at decision: air-gap, white-label
- HUMAN APPROVAL REQUIRED: air-gap is UNMEASURED — a human must assess the sovereign air-gap dimension before this becomes a FORK (a machine never auto-forks without measured air-gap)
- HUMAN APPROVAL REQUIRED: white-label is UNMEASURED — a human must assess rebrand/telemetry friction before adoption

| Repo | License (from real file) | Decision | Eligibility | Score | Band | Signals (confidence-gated) |
|---|---|---|---|---|---|---|
| [Keyrunes/keyrunes](https://github.com/Keyrunes/keyrunes) | NonCommercial ⚠︎hint≠file · "GNU AFFERO GENERAL PUBLIC LICENSE" | REJECT | not-eligible | 44.6/100 | reject | maintainability=clean(meas,+10) · architecture=possible(meas,+6) · air-gap=partial(part,+0) · white-label=unknown(n/m,+0) |
| [abhishekayu/react-access-engine](https://github.com/abhishekayu/react-access-engine) | MIT · "MIT License" | ACCEPT | eligible | 78.5/100 | acceptable | maintainability=maintainable(meas,+7) · architecture=good(meas,+11) · air-gap=partial(part,+0) · white-label=unknown(n/m,+0) |
| [raghul-r-0811/authorization-engine](https://github.com/raghul-r-0811/authorization-engine) | unknown · "no LICENSE file read — unverified" | REJECT | not-eligible | 35.4/100 | reject | maintainability=hard(meas,+4) · architecture=possible(part,+6) · air-gap=unknown(n/m,+0) · white-label=unknown(n/m,+0) |
| [mgourlis/stateful-abac-policy-engine](https://github.com/mgourlis/stateful-abac-policy-engine) | MIT · "MIT License" | ACCEPT | eligible | 70.8/100 | acceptable | maintainability=maintainable(meas,+7) · architecture=possible(part,+6) · air-gap=unknown(n/m,+0) · white-label=unknown(n/m,+0) |

### Identity & User Management  —  decision: **BUILD**

_Query:_ `identity management user directory self-service open source`

- no candidate repositories discovered for this sub-domain

| Repo | License (from real file) | Decision | Eligibility | Score | Band | Signals (confidence-gated) |
|---|---|---|---|---|---|---|

### OAuth2 / OIDC Token Services  —  decision: **EXTEND**

_Query:_ `oauth2 oidc token server authorization server`

- spine: JohnBasrai/tokn — real score 70.8/100, band "acceptable" (4/6 dims measured, coverage 65%)
- enrichment refined score 82.5→70.8 (band acceptable→acceptable) — justified ONLY by: maintainability=maintainable (measured, +7), architecture=possible (measured, +6)
- normalized 70.8/100 ≥ 55 on 4/6 measured dims, but air-gap UNMEASURED — EXTEND (fork then build the gap); air-gap still needs a human before any FORK
- unmeasured at decision: air-gap, white-label
- HUMAN APPROVAL REQUIRED: air-gap is UNMEASURED — a human must assess the sovereign air-gap dimension before this becomes a FORK (a machine never auto-forks without measured air-gap)
- HUMAN APPROVAL REQUIRED: white-label is UNMEASURED — a human must assess rebrand/telemetry friction before adoption

| Repo | License (from real file) | Decision | Eligibility | Score | Band | Signals (confidence-gated) |
|---|---|---|---|---|---|---|
| [BabyJ723/blast-ON](https://github.com/BabyJ723/blast-ON) | MIT ⚠︎hint≠file · "Boost Software License - Version 1.0 - August 17th, 2003" | ACCEPT | eligible | 47.7/100 | reject | maintainability=unsafe(meas,+0) · architecture=possible(part,+6) · air-gap=unknown(n/m,+0) · white-label=unknown(n/m,+0) |
| [nicolasdao/userin](https://github.com/nicolasdao/userin) | BSD-3-Clause · "BSD 3-Clause License" | ACCEPT | eligible | 53.8/100 | reject | maintainability=hard(meas,+4) · architecture=possible(meas,+6) · air-gap=partial(part,+0) · white-label=unknown(n/m,+0) |
| [wisskirchenj/authorization-server](https://github.com/wisskirchenj/authorization-server) | unknown · "no LICENSE file read — unverified" | REJECT | not-eligible | 23.1/100 | reject | maintainability=hard(meas,+4) · architecture=possible(part,+6) · air-gap=unknown(n/m,+0) · white-label=unknown(n/m,+0) |
| [Gerald1973/OIDCSimple](https://github.com/Gerald1973/OIDCSimple) | unknown · "no LICENSE file read — unverified" | REJECT | not-eligible | 35.4/100 | reject | maintainability=hard(meas,+4) · architecture=possible(part,+6) · air-gap=unknown(n/m,+0) · white-label=unknown(n/m,+0) |
| [JohnBasrai/tokn](https://github.com/JohnBasrai/tokn) | MIT · "MIT License" | ACCEPT | eligible | 70.8/100 | acceptable | maintainability=maintainable(meas,+7) · architecture=possible(meas,+6) · air-gap=partial(part,+0) · white-label=unknown(n/m,+0) |

### MFA & Identity Federation  —  decision: **BUILD**

_Query:_ `multi-factor authentication identity federation open source`

- no candidate repositories discovered for this sub-domain

| Repo | License (from real file) | Decision | Eligibility | Score | Band | Signals (confidence-gated) |
|---|---|---|---|---|---|---|

## 2. Sovereign readiness / air-gap

**Verdict (deny-by-default, empty descriptor):** Acceptable-after-hardening

_The scout sources no deployment artifacts, so every sovereign check is UNKNOWN (deny-by-default). This verdict confirms nothing was verified — it is not a positive air-gap claim for any repo._

## 3. Reviewer re-derivation (independent — not trusting the assembler)

| Repo | Assembler license | Reviewer (from raw file) | Agree? | Assembler air-gap | Reviewer | Agree? |
|---|---|---|---|---|---|---|
| https://github.com/BabyJ723/blast-ON | ACCEPT (MIT) | ACCEPT (MIT) | ✓ | unknown | unknown | ✓ |
| https://github.com/abhishekayu/react-access-engine | ACCEPT (MIT) | ACCEPT (MIT) | ✓ | unknown | unknown | ✓ |
| https://github.com/JohnBasrai/tokn | ACCEPT (MIT) | ACCEPT (MIT) | ✓ | unknown | unknown | ✓ |

## 4. Custom-code boundary (reuse vs. ECE builds — the moat)

- REUSE (harvest): permissively-licensed spines per sub-domain (authentication/SSO, authorization/policy, identity & user management, OAuth2/OIDC token services, MFA & federation) — proven IAM cores (e.g. Keycloak, Ory, Casbin, Casdoor, all Apache-2.0) do not get rebuilt.
- ECE BUILDS (the moat): the unified data model + integration glue across the sub-domains; sovereign/air-gap hardening; Arabic-first adaptation; the white-label brand layer; and any genuinely missing capability confirmed absent after assessment.
- The deeper assessment engines the scout does NOT yet provide (air-gap prober, white-label friction analyzer, architecture-fit + maintainability review) are themselves ECE-built factory capability.

## 5. Adversarial red-team (where this plan is weakest)

- Scores are structurally capped: the scout sources only license + maturity. Air-gap, white-label, architecture-fit and maintainability are deny-by-default (0), so even excellent repos band as "reject". Any BUILD read from the raw band would be an artifact of missing assessment, not proven absence — which is why such cases are reported as NEEDS-ASSESSMENT, not BUILD.
- Discovery is single-page, popularity-sorted GitHub search — it can miss the best repo if it is not stars-ranked for the exact query string.
- Sub-domain queries are hand-authored; a poorly chosen query yields weak candidates that are not representative of the field.
- License detection is signature-based over the raw file; an unusual or dual-license file lands as NEEDS_REVIEW rather than a confident decision (correctly conservative, but it defers work to a human).
- The sovereign verdict is deny-by-default over an empty descriptor — it says nothing positive about any repo; it only proves nothing was verified.
- Signal enrichment is CONFIDENCE-GATED: only MEASURED maintainability/architecture may raise a band at full weight; a PARTIAL architecture is bounded to "possible" (≤6/15); air-gap + white-label NEVER lift a band. An unreadable manifest/tree or a wrong default branch degrades a candidate to deny-by-default — it can only lose enrichment points, never gain fabricated ones.
- Because air-gap + white-label stay deny-by-default, enrichment can sharpen a candidate to EXTEND ("risky", ≥55) at most — it can NEVER produce a FORK. Reading a FORK from signals alone would be impossible by construction; a FORK still requires human air-gap + white-label assessment.

## 6. Market position

- Incumbents are proprietary cloud identity providers (foreign-cloud, subscription, non-sovereign) whose trust anchor and user directory live outside the jurisdiction.
- The sovereign/air-gap + Arabic-first composition — a fully self-hosted trust anchor and directory, Arabic-first admin/consent UX, under a white-label brand — is the differentiator nothing local offers off-the-shelf.

## 7. Limitations (honest scope)

- End-to-end scores reflect license + maturity, plus (where a signals scout ran) MEASURED maintainability/architecture. Air-gap + white-label remain deny-by-default (0) — machine-unassessable — so every decision is provisional until a human assesses them; enrichment can lift a candidate to EXTEND at most, never FORK.
- Where signals were gathered, each candidate row shows the confidence-gated per-dimension deltas; a band that moved is attributed in the decision evidence to the exact measured/bounded signals that justified it. A candidate with no signals (or fail-closed) is graded exactly as a license+maturity-only pass.
- This is a READ-ONLY report. No repo was forked, created, or modified; no external action was taken.

---

**STOP — AWAITING HUMAN APPROVAL. No build, fork, or external action taken.**
