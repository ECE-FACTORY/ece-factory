# Feature — Repo Scout Signals

**Path:** `src/layer-3-harvest/repo-scout-signals/` · **Layer:** 3 (Harvest / Sourcing) · **Status:** built & tested (unit; live skippable)
**Governs:** Layer 1 Source & Build Doctrine §3 (repo acceptance dimensions) and the Write-Asks-Read-First Doctrine (read-only companion; reaches no write path). Companion to `repo-scout` and `harvest-orchestrator`.

## Purpose
The base `repo-scout` sources only 2 of 6 scoring dimensions (license, maturity), so every harvest decision caps at `NEEDS-ASSESSMENT`. This module reads **additional public, read-only** signals for the OTHER FOUR dimensions — **as far as each can honestly go** — and, crucially, **flags per dimension what cannot be mechanically judged**. It sources signals; it does not grade or decide.

## The confidence contract (the honesty mechanism — this IS the deliverable)
Every dimension emits `{ value, confidence, evidence[] }` with `confidence ∈ { 'measured' | 'partial' | 'not-mechanizable' }`:
- **measured** — from real fetched data; a grader may raise confidence from this.
- **partial** — some real evidence, incomplete; contributes only weakly.
- **not-mechanizable** — cannot be honestly judged from read-only data; leaves the dimension **deny-by-default exactly as today**. Never a fabricated value.

Enrichment can only **sharpen** a decision where real evidence exists — it can never manufacture confidence. A repo moving `NEEDS-ASSESSMENT → FORK` must be traceable to real fetched evidence.

## The four dimensions — how far each honestly reaches
| Dimension | Target | Reached | Source (read-only) |
|---|---|---|---|
| **Maintainability** | measured | **measured** | commit recency (`pushed_at`), contributor count (contributors Link header), open issues, release count, tests + CI files in the tree |
| **Architecture** | measured/partial | **measured** if a dependency manifest is readable, else **partial** from the tree | `/languages`, tree layout (modular vs monolith), dependency count from the manifest. **Structural proxy only — `strong` FIT is NEVER emitted mechanically** (fit needs human review; capped at `good`). |
| **Air-gap fit** | partial | **partial** always (or **not-mechanizable**) | manifest scanned for hard cloud/SaaS/phone-home deps. **Never `yes`/`measured`** — absence of a cloud dep is not proof of air-gap safety. |
| **White-label fit** | not-mechanizable | **not-mechanizable** | rebrandability is an architectural/legal judgment. Weak signals (trademark/branding files) are noted but **never scored**. |

The emitted `value`s use the real grader vocabularies so they can feed scoring later: `MaintainabilityRating` (`scoring-engine.ts:18`), `ArchFitRating` (`scoring-engine.ts:17`), `AirGapSuitability` (`repo-intelligence.ts:30`), `WhiteLabelFit` (`repo-intelligence.ts:31`).

## Derivation logic (real, deterministic)
- `deriveMaintainability` — `unsafe` (archived / long-stale + no tests/CI) → `hard` (stale or solo + no CI) → `clean` (recent + ≥5 contributors + CI + tests) → else `maintainable`. Confidence `measured`.
- `deriveArchitecture` — `possible` for very heavy dep surface (>150) or monolith; `good` for modular + reasonable deps; capped at `good`. Confidence `measured` (manifest) / `partial` (tree only) / `not-mechanizable` (neither).
- `deriveAirGap` — `no` if a cloud blocker is found (confidence `partial`); else `partial`/`partial`; `not-mechanizable` if no manifest.
- `deriveWhiteLabel` — always `unknown` / `not-mechanizable` with reason.
- Parsers: `parseManifestDeps` (package.json/go.mod/requirements.txt/pom.xml/Cargo.toml), `detectCloudBlockers` (pattern set), `analyzeTree` (tests/CI/modular). All pure, unit-tested with no network.

## Network isolation, token & fail-closed
All network egress lives in this module (injectable `fetchImpl`). Token discipline mirrors `repo-scout`: private `#token`, used only in the `Authorization` header, scrubbed by `redact()`, never logged/emitted. **No token / unreachable / repo not readable ⇒ fail closed:** every dimension `not-mechanizable` with an honest reason — never invented data. Secondary reads (tree, contributors, releases, manifest) are tolerant: a miss **degrades confidence**, it does not fabricate.

## Read-only / standalone
Imports only the grader rating **types** (`import type`); reaches no write/external path. Frozen read-only by `src/architecture/write-asks-read-first.test.ts` (Prohibition 3, must stay 7/7).

## Tests
- `repo-scout-signals.test.ts` (unit, **no network, no token**): each dimension's derivation; the confidence contract (measured/partial/not-mechanizable); white-label = not-mechanizable; manifest parsing + cloud-blocker detection; tree analysis; redaction; fail-closed with no fabrication.
- `repo-scout-signals.live.test.ts` (**skippable**): one real repo, all four dimensions emitted with confidences, token asserted absent from output. Skips cleanly without `GITHUB_TOKEN`.

## Not wired
This module is **not** wired into `harvest-orchestrator`. Wiring (feeding `measured`/`partial` signals into `candidateFromScoringInputs` so a decision can sharpen past `NEEDS-ASSESSMENT`) is proposed as a **separate, human-approved follow-up** after the signals are seen working live.
