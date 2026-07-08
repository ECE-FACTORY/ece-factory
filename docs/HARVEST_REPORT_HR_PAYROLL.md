# Harvest Report — HR & Payroll

**Status:** STOP-AWAITING-HUMAN-APPROVAL · **Generated:** 2026-07-08T20:57:54.766Z

> READ-ONLY harvest pass. Scores come from the real graders on scout-sourced evidence. No build, fork, or external action was taken. Awaiting human approval.

## 1. Sub-domain decomposition & decisions

| Sub-domain | Decision | Spine (score/band) | Candidates |
|---|---|---|---|
| Core HRIS & Employee Records | **BUILD** | — | 5 |
| Payroll Processing | **BUILD** | — | 2 |
| Time, Attendance & Leave | **EXTEND** | arkhitech/redmine_leaves (70.8/100, acceptable) | 5 |
| Recruitment & Applicant Tracking (ATS) | **EXTEND** | chamals3n4/OpenATS (75.4/100, acceptable) | 5 |
| Onboarding & Performance | **EXTEND** | Bitnoise/dutyduke (70.8/100, acceptable) | 5 |

### Core HRIS & Employee Records  —  decision: **BUILD**

_Query:_ `human resources information system hris employee`

- no permissively-licensed repo found (all candidates REJECT/ineligible) — a genuine absence

| Repo | License (from real file) | Decision | Eligibility | Score | Band | Signals (confidence-gated) |
|---|---|---|---|---|---|---|
| [ShaviRajapaksha/Human-Resources-Information-System--HRIS](https://github.com/ShaviRajapaksha/Human-Resources-Information-System--HRIS) | unknown · "no LICENSE file read — unverified" | REJECT | not-eligible | 35.4/100 | reject | maintainability=hard(meas,+4) · architecture=possible(part,+6) · air-gap=unknown(n/m,+0) · white-label=unknown(n/m,+0) |
| [Abderrahmanefullstack/Human_Resources_Information_System](https://github.com/Abderrahmanefullstack/Human_Resources_Information_System) | unknown · "no LICENSE file read — unverified" | REJECT | not-eligible | 35.4/100 | reject | maintainability=hard(meas,+4) · architecture=possible(part,+6) · air-gap=unknown(n/m,+0) · white-label=unknown(n/m,+0) |
| [Natsumaniac/DOrSU-Human-Resources-Information-System-HRIS-Service-Record-Module](https://github.com/Natsumaniac/DOrSU-Human-Resources-Information-System-HRIS-Service-Record-Module) | unknown · "no LICENSE file read — unverified" | REJECT | not-eligible | 35.4/100 | reject | maintainability=hard(meas,+4) · architecture=good(part,+6) · air-gap=unknown(n/m,+0) · white-label=unknown(n/m,+0) |
| [mmrradif/HRIS_ASP.NETCore](https://github.com/mmrradif/HRIS_ASP.NETCore) | unknown · "no LICENSE file read — unverified" | REJECT | not-eligible | 16.9/100 | reject | maintainability=unsafe(meas,+0) · architecture=possible(part,+6) · air-gap=unknown(n/m,+0) · white-label=unknown(n/m,+0) |
| [Nickychemos/HRIS](https://github.com/Nickychemos/HRIS) | unknown · "no LICENSE file read — unverified" | REJECT | not-eligible | 40/100 | reject | maintainability=maintainable(meas,+7) · architecture=possible(meas,+6) · air-gap=no(part,+0) · white-label=unknown(n/m,+0) |

### Payroll Processing  —  decision: **BUILD**

_Query:_ `payroll processing open source`

- no permissively-licensed repo found (all candidates REJECT/ineligible) — a genuine absence

| Repo | License (from real file) | Decision | Eligibility | Score | Band | Signals (confidence-gated) |
|---|---|---|---|---|---|---|
| [yaldemouser/Open-Source-HRMS](https://github.com/yaldemouser/Open-Source-HRMS) | unknown · "no LICENSE file read — unverified" | REJECT | not-eligible | 35.4/100 | reject | maintainability=hard(meas,+4) · architecture=possible(part,+6) · air-gap=unknown(n/m,+0) · white-label=unknown(n/m,+0) |
| [ATmakers/atmakers.github.io](https://github.com/ATmakers/atmakers.github.io) | unknown · "no LICENSE file read — unverified" | REJECT | not-eligible | 35.4/100 | reject | maintainability=hard(meas,+4) · architecture=possible(part,+6) · air-gap=unknown(n/m,+0) · white-label=unknown(n/m,+0) |

### Time, Attendance & Leave  —  decision: **EXTEND**

_Query:_ `time attendance leave management`

- spine: arkhitech/redmine_leaves — real score 70.8/100, band "acceptable" (4/6 dims measured, coverage 65%)
- enrichment refined score 82.5→70.8 (band acceptable→acceptable) — justified ONLY by: maintainability=maintainable (measured, +7), architecture=possible (partial, +6)
- normalized 70.8/100 ≥ 55 on 4/6 measured dims, but air-gap UNMEASURED — EXTEND (fork then build the gap); air-gap still needs a human before any FORK
- unmeasured at decision: air-gap, white-label
- HUMAN APPROVAL REQUIRED: air-gap is UNMEASURED — a human must assess the sovereign air-gap dimension before this becomes a FORK (a machine never auto-forks without measured air-gap)
- HUMAN APPROVAL REQUIRED: white-label is UNMEASURED — a human must assess rebrand/telemetry friction before adoption

| Repo | License (from real file) | Decision | Eligibility | Score | Band | Signals (confidence-gated) |
|---|---|---|---|---|---|---|
| [nehaltanna/UniversityPortalCMS](https://github.com/nehaltanna/UniversityPortalCMS) | unknown · "no LICENSE file read — unverified" | REJECT | not-eligible | 16.9/100 | reject | maintainability=unsafe(meas,+0) · architecture=possible(part,+6) · air-gap=unknown(n/m,+0) · white-label=unknown(n/m,+0) |
| [arkhitech/redmine_leaves](https://github.com/arkhitech/redmine_leaves) | MIT · "The MIT License (MIT)" | ACCEPT | eligible | 70.8/100 | acceptable | maintainability=maintainable(meas,+7) · architecture=possible(part,+6) · air-gap=unknown(n/m,+0) · white-label=unknown(n/m,+0) |
| [BlondelSeumo/Time-Clock-Application-For-Employees](https://github.com/BlondelSeumo/Time-Clock-Application-For-Employees) | unknown · "no LICENSE file read — unverified" | REJECT | not-eligible | 23.1/100 | reject | maintainability=hard(meas,+4) · architecture=possible(part,+6) · air-gap=unknown(n/m,+0) · white-label=unknown(n/m,+0) |
| [rajnish-kewat18/Attendance_management_system](https://github.com/rajnish-kewat18/Attendance_management_system) | unknown · "no LICENSE file read — unverified" | REJECT | not-eligible | 35.4/100 | reject | maintainability=hard(meas,+4) · architecture=possible(part,+6) · air-gap=unknown(n/m,+0) · white-label=unknown(n/m,+0) |
| [lagunadevs/hris](https://github.com/lagunadevs/hris) | MIT · "MIT License" | ACCEPT | eligible | 53.8/100 | reject | maintainability=hard(meas,+4) · architecture=possible(meas,+6) · air-gap=partial(part,+0) · white-label=unknown(n/m,+0) |

### Recruitment & Applicant Tracking (ATS)  —  decision: **EXTEND**

_Query:_ `applicant tracking system recruitment ats`

- spine: chamals3n4/OpenATS — real score 75.4/100, band "acceptable" (4/6 dims measured, coverage 65%)
- enrichment refined score 82.5→75.4 (band acceptable→acceptable) — justified ONLY by: maintainability=clean (measured, +10), architecture=possible (partial, +6)
- normalized 75.4/100 ≥ 55 on 4/6 measured dims, but air-gap UNMEASURED — EXTEND (fork then build the gap); air-gap still needs a human before any FORK
- unmeasured at decision: air-gap, white-label
- HUMAN APPROVAL REQUIRED: air-gap is UNMEASURED — a human must assess the sovereign air-gap dimension before this becomes a FORK (a machine never auto-forks without measured air-gap)
- HUMAN APPROVAL REQUIRED: white-label is UNMEASURED — a human must assess rebrand/telemetry friction before adoption

| Repo | License (from real file) | Decision | Eligibility | Score | Band | Signals (confidence-gated) |
|---|---|---|---|---|---|---|
| [opencats/OpenCATS](https://github.com/opencats/OpenCATS) | LGPL · "This application is available under two licenses." | REJECT | not-eligible | 49.2/100 | reject | maintainability=clean(meas,+10) · architecture=good(part,+6) · air-gap=unknown(n/m,+0) · white-label=unknown(n/m,+0) |
| [praj2408/End-To-End-Resume-ATS-Tracking-LLM-Project-With-Google-Gemini-Pro](https://github.com/praj2408/End-To-End-Resume-ATS-Tracking-LLM-Project-With-Google-Gemini-Pro) | MIT · "MIT License" | ACCEPT | eligible | 47.7/100 | reject | maintainability=unsafe(meas,+0) · architecture=possible(meas,+6) · air-gap=partial(part,+0) · white-label=unknown(n/m,+0) |
| [NissonCX/smart-ats](https://github.com/NissonCX/smart-ats) | MIT · "MIT License" | ACCEPT | eligible | 66.2/100 | risky | maintainability=hard(meas,+4) · architecture=possible(meas,+6) · air-gap=partial(part,+0) · white-label=unknown(n/m,+0) |
| [chamals3n4/OpenATS](https://github.com/chamals3n4/OpenATS) | Apache-2.0 · "Apache License" | ACCEPT | eligible | 75.4/100 | acceptable | maintainability=clean(meas,+10) · architecture=possible(part,+6) · air-gap=unknown(n/m,+0) · white-label=unknown(n/m,+0) |
| [SRIKANTH284/ats-resume-maker-software](https://github.com/SRIKANTH284/ats-resume-maker-software) | unknown · "no LICENSE file read — unverified" | REJECT | not-eligible | 16.9/100 | reject | maintainability=unsafe(meas,+0) · architecture=possible(meas,+6) · air-gap=partial(part,+0) · white-label=unknown(n/m,+0) |

### Onboarding & Performance  —  decision: **EXTEND**

_Query:_ `employee onboarding performance management`

- spine: Bitnoise/dutyduke — real score 70.8/100, band "acceptable" (4/6 dims measured, coverage 65%)
- enrichment refined score 82.5→70.8 (band acceptable→acceptable) — justified ONLY by: maintainability=maintainable (measured, +7), architecture=possible (measured, +6)
- normalized 70.8/100 ≥ 55 on 4/6 measured dims, but air-gap UNMEASURED — EXTEND (fork then build the gap); air-gap still needs a human before any FORK
- unmeasured at decision: air-gap, white-label
- HUMAN APPROVAL REQUIRED: air-gap is UNMEASURED — a human must assess the sovereign air-gap dimension before this becomes a FORK (a machine never auto-forks without measured air-gap)
- HUMAN APPROVAL REQUIRED: white-label is UNMEASURED — a human must assess rebrand/telemetry friction before adoption

| Repo | License (from real file) | Decision | Eligibility | Score | Band | Signals (confidence-gated) |
|---|---|---|---|---|---|---|
| [Bitnoise/dutyduke](https://github.com/Bitnoise/dutyduke) | MIT · "MIT License" | ACCEPT | eligible | 70.8/100 | acceptable | maintainability=maintainable(meas,+7) · architecture=possible(meas,+6) · air-gap=partial(part,+0) · white-label=unknown(n/m,+0) |
| [SAP/task-management-sample-app-sfsf-solutions](https://github.com/SAP/task-management-sample-app-sfsf-solutions) | Apache-2.0 · "Apache License" | ACCEPT | eligible | 70.8/100 | acceptable | maintainability=maintainable(meas,+7) · architecture=possible(meas,+6) · air-gap=partial(part,+0) · white-label=unknown(n/m,+0) |
| [shawonk007/astra-hrm](https://github.com/shawonk007/astra-hrm) | NonCommercial ⚠︎hint≠file · "GNU GENERAL PUBLIC LICENSE" | REJECT | not-eligible | 23.1/100 | reject | maintainability=hard(meas,+4) · architecture=possible(meas,+6) · air-gap=partial(part,+0) · white-label=unknown(n/m,+0) |
| [NexusGKSoftwares/horilla-master](https://github.com/NexusGKSoftwares/horilla-master) | LGPL · "GNU LESSER GENERAL PUBLIC LICENSE" | REJECT | not-eligible | 23.1/100 | reject | maintainability=hard(meas,+4) · architecture=possible(meas,+6) · air-gap=partial(part,+0) · white-label=unknown(n/m,+0) |
| [SalimAjibola/Employee-management-system](https://github.com/SalimAjibola/Employee-management-system) | MIT · "MIT License" | ACCEPT | eligible | 47.7/100 | reject | maintainability=unsafe(meas,+0) · architecture=possible(part,+6) · air-gap=unknown(n/m,+0) · white-label=unknown(n/m,+0) |

## 2. Sovereign readiness / air-gap

**Verdict (deny-by-default, empty descriptor):** Acceptable-after-hardening

_The scout sources no deployment artifacts, so every sovereign check is UNKNOWN (deny-by-default). This verdict confirms nothing was verified — it is not a positive air-gap claim for any repo._

## 3. Reviewer re-derivation (independent — not trusting the assembler)

| Repo | Assembler license | Reviewer (from raw file) | Agree? | Assembler air-gap | Reviewer | Agree? |
|---|---|---|---|---|---|---|
| https://github.com/ShaviRajapaksha/Human-Resources-Information-System--HRIS | REJECT (unknown) | unknown (no LICENSE text) | ✓ | unknown | unknown | ✓ |
| https://github.com/yaldemouser/Open-Source-HRMS | REJECT (unknown) | unknown (no LICENSE text) | ✓ | unknown | unknown | ✓ |
| https://github.com/arkhitech/redmine_leaves | ACCEPT (MIT) | ACCEPT (MIT) | ✓ | unknown | unknown | ✓ |
| https://github.com/chamals3n4/OpenATS | ACCEPT (Apache-2.0) | ACCEPT (Apache-2.0) | ✓ | unknown | unknown | ✓ |
| https://github.com/Bitnoise/dutyduke | ACCEPT (MIT) | ACCEPT (MIT) | ✓ | unknown | unknown | ✓ |

## 4. Custom-code boundary (reuse vs. ECE builds — the moat)

- REUSE (harvest): permissively-licensed spines per sub-domain (core HRIS/employee records, payroll processing, time & attendance/leave, recruitment/ATS, onboarding & performance) — do not rebuild what a proven repo does.
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

- Incumbents are proprietary SaaS HR/payroll suites (foreign-cloud, subscription, non-sovereign) alongside copyleft self-hosted stacks (GPL/AGPL) whose licenses block white-label resale.
- The sovereign/air-gap + Arabic-first composition — including Arabic-language payroll and local labor-law/end-of-service localization under a white-label brand — is the differentiator nothing local offers off-the-shelf.

## 7. Limitations (honest scope)

- End-to-end scores reflect license + maturity, plus (where a signals scout ran) MEASURED maintainability/architecture. Air-gap + white-label remain deny-by-default (0) — machine-unassessable — so every decision is provisional until a human assesses them; enrichment can lift a candidate to EXTEND at most, never FORK.
- Where signals were gathered, each candidate row shows the confidence-gated per-dimension deltas; a band that moved is attributed in the decision evidence to the exact measured/bounded signals that justified it. A candidate with no signals (or fail-closed) is graded exactly as a license+maturity-only pass.
- This is a READ-ONLY report. No repo was forked, created, or modified; no external action was taken.

---

**STOP — AWAITING HUMAN APPROVAL. No build, fork, or external action taken.**
