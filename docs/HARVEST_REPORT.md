# Harvest Report — ECE Factory · Module 23 (Audit Engine)

> Produced under Layer 1 + Layer 1.1. No build proceeds until this is complete AND human-approved.
> **Step:** Phase 2A harvest scouting · **Date:** 2026-06-29 · **Repo:** `ece-factory` · **Target:** `src/features/audit-engine/`
> **Factory memory checked first (§9.3):** `registry/FACTORY_REPO_INTELLIGENCE.md` was **empty** (no prior audit-logging intelligence) — scouted fresh; all candidates below are appended back to memory.
> **License method:** every SPDX below was read from the **actual LICENSE file** on the default branch via the GitHub API (decoded), never from the badge. The badge was wrong for the most important candidate (immudb).

---

## 0. The standing question (Layer 1 §1), answered

> *"Does a proven, permissively-licensed, air-gap-deployable foundation already exist for write-ahead, append-only, tamper-evident audit logging — or is this a BUILD?"*

**Answer: PARTIALLY. This is an EXTEND, not a wholesale BUILD and not a wholesale FORK.** The *storage substrate* is sourced and already adopted (PostgreSQL — the Phase 1 stack DB — gives append-only tables, Row-Level Security for per-org scoping, and fully offline/air-gap deployment). The *tamper-evidence* sub-capability is genuinely sourceable (Apache-2.0 verifiable-log foundations exist — Trillian, rekor). The *governance-specific sequence* mandated by MCP Hardening §23–24 — the write-ahead "log-before-execute" commit order, the audit-of-reads, and the exact §23.2 schema — has **no acceptable drop-in** and is a small, bounded **BUILD** (the proprietary glue per Doctrine §5/§6). We did **not** default the module to BUILD: we proved the storage and tamper-evidence foundations could be sourced. We did **not** default to FORK: we proved the §23–24 sequence has no acceptable foundation.

---

## 1. Domain decomposition

Module 23 (Audit Engine) decomposes into six sub-capabilities (from blueprint §23 + MCP Hardening §§23–24):

1. **Write-ahead commit sequence** — validate → authorize → commit audit *intent* → execute → commit *result* → return (§23.1). "Audit unavailable" must be detectable *before* the action fires.
2. **Append-only storage** — no edit, no delete, no purge via the app/MCP path (§23.4).
3. **Tamper-evidence / hash-chaining** — integrity that detects after-the-fact mutation (strengthens "append-only").
4. **Permissioned log read / audit-of-reads** — reading the log is itself permissioned and produces its own audit entry; the watchers are watched (§24).
5. **Per-org scoping** — multi-tenant isolation; a principal reads only their org's logs (§24).
6. **Sovereign / offline storage** — logs reside inside the air-gap boundary, no foreign egress (§23.5).

---

## 2. Per sub-capability verdict

| Sub-capability | Verdict | Spine? | Sourced from / Built | License (SPDX) | Air-gap | Verification load |
|---|---|---|---|---|---|---|
| Append-only storage | **FORK** | ✅ spine | PostgreSQL (adopted stack DB) — append-only tables, `REVOKE UPDATE/DELETE` | PostgreSQL License | y | Low |
| Per-org scoping | **FORK** | — | PostgreSQL Row-Level Security (native) | PostgreSQL License | y | Low |
| Sovereign/offline storage | **FORK** | — | PostgreSQL (self-hosted, offline) | PostgreSQL License | y | Low |
| DB-layer audit (defense-in-depth) | **EXTEND** *(optional)* | — | `pgaudit/pgaudit` | PostgreSQL License | y | Low |
| Tamper-evidence / hash-chaining | **EXTEND** | — | App-level hash-chain (recommended) **or** `google/trillian` pattern (Apache-2.0) for externally-verifiable logs | Apache-2.0 (Trillian) | y/p | Medium |
| Write-ahead "log-before-execute" sequence (§23.1) | **BUILD** | — | governance glue — no acceptable drop-in | n/a (ECE code) | y | Medium |
| Audit-of-reads + permissioned viewer (§24) | **BUILD** | — | governance glue | n/a (ECE code) | y | Medium |
| Audit schema enforcement (§23.2) | **BUILD** | — | governance glue (the §6 schema) | n/a (ECE code) | y | Low |

**Module-level verdict: EXTEND** — sourced storage spine (PostgreSQL) + optional sourced DB-layer audit (pgaudit) + sourced tamper-evidence pattern (Trillian/hash-chain), with a small bounded BUILD for the §23–24 governance sequence.

---

## 3. Candidate scores (per repo — with per-sub-score evidence, §3.8)

| Repo | License/20 | Maturity/20 | Air-gap/20 | White-label/15 | Arch fit/15 | Maintain/10 | Total/100 | Verdict |
|------|-----------|-------------|------------|----------------|-------------|-------------|-----------|---------|
| codenotary/immudb | **0** | (18) | (15) | (12) | (10) | (7) | **REJECT** | License 0 = auto-reject |
| google/trillian | 20 | 18 | 17 | 13 | 7 | 7 | **82** | EXTEND (tamper-evidence ref) |
| pgaudit/pgaudit | 12 | 18 | 20 | 14 | 11 | 8 | **83** | EXTEND (optional, license-pending) |
| sigstore/rekor | 20 | 16 | 15 | 12 | 6 | 6 | **75** | Reference only (purpose mismatch) |
| event-driven-io/emmett | **0** | (15) | (15) | (12) | (10) | (8) | **REJECT** | License unverifiable = reject (§3.4) |

**Per-sub-score evidence:**

- **immudb** — License **0**: actual LICENSE file is **Business Source License (BSL)** ("Business Source License is a trademark of MariaDB Corporation"; Additional Use Grant restricts competing hosted use). BSL is on the §10/§3 rejected list → **automatic rejection**, no further scoring needed. (Detected badge said `NOASSERTION` — the file read caught the real license. Other sub-scores shown parenthetically for the record only.)
- **trillian** — License **20**: actual LICENSE = Apache-2.0, verified from file. Maturity **18**: 3,735★, powers Certificate Transparency, Google-maintained, pushed 2026-06-08, not archived. Air-gap **17**: self-hosted on MySQL/Postgres, no mandatory SaaS, some operational setup. White-label **13**: infra library, negligible branding. Arch-fit **7**: Go + gRPC verifiable-log built for CT scale; heavyweight relative to an MCP action-audit log (impedance mismatch). Maintain **7**: clean but adds a Go service/runtime to operate.
- **pgaudit** — License **12**: actual LICENSE = **PostgreSQL License** (permissive, OSI-approved, BSD/MIT-equivalent) — but **not on the enumerated allowlist** (Apache/MIT/BSD-2-3/MPL only) → scored as "acceptable with unresolved ambiguity" pending human ratification, not 20. Maturity **18**: official PostgreSQL audit extension, 1,664★, pushed 2026-06-29, not archived. Air-gap **20**: a Postgres extension, fully offline. White-label **14**: backend extension, no branding. Arch-fit **11**: DB-layer audit of SQL statements — complements but does **not** implement the app-level §23.1 write-ahead or §24 audit-of-reads. Maintain **8**.
- **rekor** — License **20**: actual LICENSE = Apache-2.0, verified. Maturity **16**: sigstore/CNCF, 1,171★, active. Air-gap **15**: self-hostable. White-label **12**. Arch-fit **6**: purpose-built for software-supply-chain signing transparency; repurposing to general action-audit is a poor fit. Maintain **6**. → reference only, not selected (purpose mismatch, not a license blocker).
- **emmett** — License **0**: **unverifiable** — no LICENSE file at root, `/license` API returns 404, `package.json` `license` field is absent. Per §3.4 (verify live or reject), unverifiable license = **reject**. Also secondary (event-sourcing library, not an audit log).

_70+ candidates (trillian 82, pgaudit 83) are **not** rejected for BUILD — they are accepted into supporting/optional roles per §3.9. The BUILD portion is the governance glue only, for which no acceptable candidate exists._

---

## 4. Product spine (§4)

- **Spine:** **PostgreSQL** (the storage substrate; already the approved Phase 1 stack DB). The Audit Engine is a thin, integrity-critical governance layer of append-only tables over Postgres.
- **Why it is the spine:** it owns the durable, append-only, per-org-scoped, offline-resident storage that every audit guarantee depends on. It is already adopted, maximally portable, and air-gap native.
- **Capability it owns:** durable append-only event storage + RLS isolation + sovereign residency.
- **Supporting repos + roles:** `pgaudit` — optional DB-layer audit (defense-in-depth, logs SQL); `trillian` — optional/reference pattern for externally-verifiable tamper-evidence if a sovereign client demands cryptographic auditability.
- **ECE custom layer (the moat):** the §23.1 write-ahead sequencer, the §24 audit-of-reads + permissioned viewer, the §23.2 schema, and the app-level hash-chain. Small surface, high integrity value.
- **Risk if spine changes:** PostgreSQL is community-governed and effectively never relicenses; migration risk is minimal and the most portable in the SQL ecosystem.

---

## 5. License evidence pack (per candidate, §10)

| Repo | URL | Branch inspected | LICENSE path | SPDX (from file) | Obligations | Re-licensing history | CLA | Status |
|------|-----|------------------|--------------|------------------|-------------|----------------------|-----|--------|
| immudb | github.com/codenotary/immudb | master | `LICENSE` | **BSL 1.1** (not SPDX-permissive) | n/a | **Relicensed Apache→BSL** (historical) | — | **REJECTED** |
| trillian | github.com/google/trillian | master | `LICENSE` | **Apache-2.0** | NOTICE + attribution; patent grant | none known | Google CLA (contributors) | Accepted (supporting) |
| pgaudit | github.com/pgaudit/pgaudit | main | `LICENSE` | **PostgreSQL License** (permissive; off-allowlist) | attribution | none known | — | Conditionally accepted (human ratification) |
| rekor | github.com/sigstore/rekor | main | `LICENSE` | **Apache-2.0** | NOTICE + attribution; patent grant | none known | DCO | Reference only |
| emmett | github.com/event-driven-io/emmett | main | none found | **unverifiable** | — | — | — | **REJECTED** |

---

## 6. License-compatibility verdict (whole stack)

**Clean for the Apache-2.0 candidates** (trillian, rekor compose without conflict). **One unresolved item — the PostgreSQL License.** PostgreSQL itself (the chosen DB) and pgaudit both ship under the **PostgreSQL License**, which is permissive and non-copyleft but is **not in the factory's enumerated allowlist** (Apache/MIT/BSD-2-3/MPL). This is a **collision — resolvable**, by the human ratifying the addition of "PostgreSQL License" (and likely ISC) to the accepted set in `ORG_STANDARDS.md` / the License & Compliance Engine. **No copyleft/SSPL/BSL enters the distribution** (immudb rejected on exactly this).

---

## 7. Sovereign-readiness checklist (§8)

| Check | PostgreSQL (spine) | pgaudit | trillian |
|---|---|---|---|
| Fully offline | ✅ | ✅ | ✅ |
| No foreign SaaS | ✅ | ✅ | ✅ |
| No vendor telemetry | ✅ | ✅ | ✅ |
| Logs/identity/DB local | ✅ | ✅ | ✅ (on local DB) |
| Deps mirrorable / vendored | ✅ | ✅ | ⚠ Go module graph (large) |
| Deployment reproducible offline | ✅ | ✅ | ⚠ extra service |
| **Verdict** | **Acceptable** | **Acceptable** | **Acceptable after hardening** |

---

## 8. White-label hardening (§9)

Minimal — all candidates are backend infrastructure with negligible UI/branding. **Attribution that must remain:** Apache-2.0 NOTICE files (trillian/rekor); PostgreSQL/pgaudit copyright notices. **Branding to replace:** none material. **Telemetry/analytics/update-URLs:** none mandatory in any candidate (verify pinned versions at fork time). **No trademark exposure** for the chosen path (Postgres + ECE glue).

---

## 9. Custom-code boundary (§6)

**ECE writes (the BUILD glue):**
- `src/features/audit-engine/service.ts` — the §23.1 write-ahead sequencer (commit intent → execute → commit result; refuse if log unavailable *before* action).
- `schema.ts` — the §23.2 event schema (timestamp, org, human actor, session, connector, tool, authz decision, approval, endpoint, result, duration) + append-only DDL (`REVOKE UPDATE/DELETE`) + optional hash-chain column.
- `controller.ts` / `routes.ts` — the §24 permissioned log viewer + audit-of-reads (every read logged, per-org scoped via RLS).
- `tests/` — must prove: log-before-execute ordering; refusal when logging is down; append-only enforcement (UPDATE/DELETE rejected); read-of-read logging; per-org isolation; hash-chain continuity.

**Why it can't be sourced:** the write-ahead ordering and audit-of-reads are specific to MCP Hardening §23–24; no permissive repo implements this exact governance contract. **Security risk it creates:** the sequencer is the integrity linchpin — a bug = unattributed actions. **Maintenance burden:** low surface, stable spec.

---

## 10. Verification load + ceiling check (§7)

**Medium.** The BUILD surface is small and tightly specified by §23–24, but it is **security-/integrity-critical** (the substrate every later action depends on), so it warrants the deepest review and adversarial red-team in Wave 1. **Ceiling check:** not Extreme (no §7.1 hard stop). Not High-BUILD-with-FORK-available (the BUILD portion is the governance glue, for which *no* acceptable FORK exists; the sourceable portions are taken as FORK/EXTEND). So §7.2's "High BUILD + acceptable FORK exists → human approval" does not bite — **but the Harvest Report still requires human approval per §6/§15 regardless.**

---

## 11. Adversarial red-team (§13)

**Standard threats.** *Weakest link:* the PostgreSQL License allowlist gap (compliance, not technical). *Surprise license:* immudb — the headline "tamper-proof DB" everyone reaches for is **BSL**, caught only by reading the file; any agent trusting memory/badge would have poisoned the distribution. *Hardest to air-gap:* Trillian (extra Go service + module graph). *Over-complex integration:* Trillian as spine. *Avoidable BUILD:* none — the BUILD is the irreducible governance glue. *Over-optimistic FORK:* treating pgaudit as if it satisfies §23.1/§24 (it does not — it's DB-layer SQL audit only).

**Forced alternative (§13.1).** *Rejected alternative: FORK `google/trillian` as the audit spine.* It might genuinely be better: it delivers cryptographically **verifiable, externally-auditable** tamper-evidence out of the box (Merkle/CT-proven at Google scale), which is stronger than an app-level hash-chain and exactly what a sovereign government auditor might demand. **Why we still reject it as the spine:** per Anti-Frankenstein §5, integrating a Go/gRPC CT-scale verifiable-log into a comparatively low-volume TypeScript MCP action-audit log makes the integration larger than the module itself — operational weight, second runtime, impedance mismatch. **This is genuinely arguable:** if the human's sovereign client requires externally-verifiable cryptographic audit, **Trillian should be promoted from optional to spine.** Flagged as a human decision.

**Single point of failure (§13.1).** **PostgreSQL.** Its removal collapses the storage spine. Contingency: Postgres is community-governed (PostgreSQL License, no single corporate owner), making relicensing/abandonment effectively impossible; it is also the most portable SQL target, so substitution risk is the lowest available.

**Decision-threat (§13.2).** **The factory's accepted-license list does not include the PostgreSQL License, yet the chosen database (PostgreSQL) and the optional audit extension (pgaudit) both ship under it.** This is decision-relevant in two ways: (a) if the human declines to ratify the PostgreSQL License, pgaudit is out *and* the Phase 1 stack DB choice is itself non-compliant with the written allowlist — challenging the stack decision, not just this module; (b) it forces a one-time governance action (amend `ORG_STANDARDS.md` / License & Compliance Engine to add "PostgreSQL License" + likely ISC). This is not a generic "needs hardening" comment — it can change the stack. **Recommended resolution:** ratify the PostgreSQL License into the accepted set (it is permissive, OSI-approved, non-copyleft, and universally used), and record the decision in `ORG_DECISION_LOG.md`.

---

## 12. Market position

- **Incumbent displaced:** proprietary/SaaS audit-logging and SIEM ingestion (e.g. Datadog Audit Trail, Splunk) — subscription, cloud-hosted, non-sovereign. immudb (BSL) is the open incumbent for tamper-proof storage but its license bars white-labeled redistribution.
- **UAE sovereign gap:** an air-gapped, per-org-scoped, write-ahead, audit-of-reads log with no foreign egress — nothing off-the-shelf both does this *and* is permissively licensed for sovereign white-labeling.
- **Effort-to-productize:** **Low–Medium** (small BUILD glue over an adopted DB).
- **Biggest productization risk (one line):** a defect in the write-ahead sequencer silently producing unattributed actions — mitigated by making it the most-tested, most-reviewed module in Wave 1.

---

## 13. Human decisions required + explicit approval request

1. **Ratify the PostgreSQL License** (and likely ISC) into the factory's accepted-license set (`ORG_STANDARDS.md` + License & Compliance Engine), or direct an alternative — this gates both pgaudit and the Phase 1 DB choice. *(Decision-threat item.)*
2. **Confirm the spine choice:** PostgreSQL + ECE governance glue + app-level hash-chain (recommended), **or** promote **Trillian** to spine if externally-verifiable cryptographic audit is a sovereign requirement.
3. **Confirm pgaudit** as optional DB-layer defense-in-depth (pending #1).
4. **Confirm the rejections:** immudb (BSL) and emmett (license unverifiable).

> **Requesting approval to proceed to build for: Module 23 (Audit Engine) — EXTEND verdict — PostgreSQL storage spine + bounded BUILD of the §23.1 write-ahead sequence, §24 audit-of-reads/permissioned viewer, and §23.2 schema, with optional pgaudit (DB-layer) and an app-level hash-chain for tamper-evidence.** No Audit Engine code will be written until this report is approved by the reviewer and the human.

---

*This harvest does not self-approve. Per Layer 0 and Layer 1.1 §14–15, approval is the reviewer's and the human's. STOP.*
