# Design — The Sovereign / Subscription Product-Mode Switch

**Status:** APPROVED (design only — no implementation yet). Ratified decisions folded into §2/§4/§6/§9.
Implementation begins in a following session.
**Author attribution:** recorded to the real human who approved this design, never "claude".
**Date:** 2026-07-09 · **Baseline:** origin/main @ `de21d4c` (tree clean)

> ## Ratified decisions (binding at implementation)
> 1. **Subscription weights 15 / 10 / 10** (multi-tenancy / billing hooks / cloud-native) — accepted as the
>    **starting point**; will be retuned on real data.
> 2. **Multi-tenancy IS the subscription hard FORK gate**, symmetric to sovereign's air-gap — the human stays
>    in the loop for a FORK in **both** modes. (No auto-FORK without a human-assessed mode-critical dimension.)
> 3. **Prohibition number = 4j.**

---

## 0. One-line statement

Give the harvest/scoring path **two lenses**. `sovereign` is today's behaviour, unchanged and un-weakened
(air-gap is a hard FORK gate). `subscription` is a new lens that ignores air-gap entirely and rewards
multi-tenancy, billing hooks, and cloud-native architecture. **One mode per harvest run, chosen upfront,
threaded as a required parameter (never defaulted), and stamped into every report.** The switch is
**additive**: the deciding→building seam (`5c8cc53`) and Prohibition 4i stay intact, and a sovereign harvest
produces byte-identical scores and verdicts.

---

## 1. Where `productMode` lives and how it threads

**The type — one home, imported everywhere:**
```ts
// src/layer-3-harvest/scoring-engine/scoring-engine.ts
export type ProductMode = 'sovereign' | 'subscription';
```
Scoring owns the dimensions, so it owns the mode enum and the two profiles. Everything downstream imports it.

**Threading — a required argument at every decision boundary (no default, no `?`):**

| # | File | Change | Kind |
|---|---|---|---|
| 1 | `layer-3-harvest/scoring-engine/scoring-engine.ts` | `ProductMode`; two **profiles** (dimension sets + weights); `scoreCandidate(c, mode)` selects the profile; new sub-score fns (`multiTenancySubScore`, `billingHooksSubScore`, `cloudNativeSubScore`); `airGapSubScore`/`foldAirGapMeasurement` stay **sovereign-only** | **substantive** |
| 2 | `layer-3-harvest/harvest-orchestrator/harvest-orchestrator.ts` | `decideSourcing(candidates, mode)` — mode-selected FORK gate; `enrichScore` mode-aware; `HarvestReport.productMode` field; markdown header stamps the mode | **substantive** |
| 3 | `layer-3-harvest/repo-scout-signals/repo-scout-signals.ts` | new detectors for the subscription dims; `RepoSignals` gains them (see §3) | **substantive** |
| 4 | `layer-3-harvest/repo-intelligence/repo-intelligence.ts` | new record/input fields for the subscription dims (`multiTenancy`, `billingHooks`, `cloudNative`), mirroring `airGapSuitability`/`whiteLabelFit` | wiring |
| 5 | `layer-2-command/build-decision-seam/build-decision-seam.ts` | pass `'sovereign'` into its `decideSourcing(...)` call; **guard** `report.productMode === 'sovereign'` (fail-closed otherwise) | wiring (additive) |
| 6 | `src/architecture/write-asks-read-first.test.ts` | new **Prohibition 4j** (§6) | test |

Six touchpoints, three substantive (1–3) — matching the estimate.

---

## 2. The two profiles — the real design work

All dimensions keep their existing point scales; the profile decides **which dimensions exist** and **their
max weight**. Both profiles total **100**, so the normalized score and its bands mean the same thing in each
mode (normalization is Σmeasured-points / Σmeasured-max × 100, unchanged).

**Universal dimensions (both modes) — 65 pts:**

| Dimension | Max | Source |
|---|---|---|
| license eligibility | 20 | machine (LICENSE text) |
| maturity | 20 | machine (stars/commits/maintenance) |
| architecture-fit | 15 | machine (manifest→measured / tree→partial) |
| maintainability | 10 | machine (commits/contributors/CI) |

**Sovereign-only — 35 pts (UNCHANGED from today):**

| Dimension | Max | Source | Role |
|---|---|---|---|
| air-gap | 20 | **human** (scout only ever 'partial') | **hard FORK gate** |
| white-label | 15 | human | flagged if unmeasured |

**Subscription-only — 35 pts (NEW):**

| Dimension | Max | Source (see §3) | Role |
|---|---|---|---|
| multi-tenancy | 15 | **human** (scout at most a bounded 'partial' hint) | **hard FORK gate** (subscription's air-gap analog) |
| billing / subscription hooks | 10 | machine→'partial' (billing-SDK dep), human-confirmable | rewarded |
| cloud-native / scalable | 10 | machine (Dockerfile/k8s/helm/cloud-SDK) | rewarded |

**Proposed rating scales (new dims), following the existing pessimistic pattern:**
- **multi-tenancy** `full | partial | none | unknown` → `15 / 9 / 3 / unmeasured`. "The product isolates tenants
  by design" (schema/row-level/tenant-scoped) = full; a single-tenant app with a bolt-on = partial; explicitly
  single-tenant = none(3); no evidence = unmeasured (excluded).
- **billing hooks** `native | integratable | none | unknown` → `10 / 6 / 2 / unmeasured`.
- **cloud-native** `strong | partial | poor | unknown` → `10 / 6 / 2 / unmeasured`.

**Why multi-tenancy carries the most weight and is the human gate:** in a subscription product, tenant
isolation is the property whose absence is fatal and whose presence a machine cannot honestly certify — exactly
the position air-gap holds for sovereign. Making it the subscription FORK gate preserves the system's core
safety property in **both** modes: *the machine never auto-FORKs without a human sign-off on the one
mode-critical dimension it cannot measure.* (Weights are the design's proposal — the one thing most worth your
ratification. The dimension **set** is fixed by your inputs; the numbers are tunable.)

---

## 3. Are the new dimensions machine-measured or human-assessed? (the honest answer, per dimension)

The governing rule from the scout (`repo-scout-signals.ts:15-21`): a signal may be `'measured'` only from real
fetched evidence; **absence of evidence is never proof** (this is *why* air-gap is human-assessed — a missing
cloud dep does not prove air-gap safety). Applying that rule honestly:

- **cloud-native / scalable → MACHINE-MEASURED (partial→measured).** This is directly detectable from the tree
  and manifest the scout already reads: a `Dockerfile`, `docker-compose.yml`, `k8s/`/`helm/` manifests, or a
  cloud SDK dependency are *positive present evidence*, not an absence. Reuses the exact mechanism of
  `detectCloudBlockers` (`repo-scout-signals.ts:206`) — **inverted in sign**: the very dependencies that *lower*
  the sovereign air-gap score are *positive* cloud-native evidence. Honest and mechanizable.
- **billing / subscription hooks → MACHINE-DETECTABLE to 'partial', human-confirmable to 'measured'.** A known
  billing/subscription SDK in the manifest (`stripe`, `@stripe/*`, `braintree`, `chargebee`, `recurly`,
  `paddle`, `lemonsqueezy`, …) is real present evidence of a billing integration — a new dependency-pattern
  scan alongside the cloud one. But a dep proves *a* billing hook exists, not that it is subscription-grade, so
  the scout caps at `'partial'` (like partial-architecture) and a human confirms `'measured'`. Absence ⇒
  `not-mechanizable`/deny-by-default (no evidence = no score, never a fabricated 0-as-bad).
- **multi-tenancy → HUMAN-ASSESSED (the air-gap of subscription).** Tenant isolation is a *design/data-model*
  property (schema-per-tenant, row-level security, tenant-scoped queries). No dependency signature or file
  presence honestly proves correct isolation — a `tenant` keyword in the tree is not proof, and its absence is
  not disproof. Exactly air-gap's situation. So the scout emits **at most a bounded `'partial'` hint** (never
  `'measured'`/`full`), and a human assesses it at the gate — the same discipline, and the same
  `foldMultiTenancyMeasurement` shape as the seam's `foldAirGapMeasurement`.

**Net:** subscription mode is not "all machine" — it keeps one honest human gate (multi-tenancy), just as
sovereign keeps air-gap. Nothing is faked to look measured.

---

## 4. The conditional air-gap gate — hard in sovereign, no-op in subscription, sovereign un-weakened

Today `decideSourcing` (harvest-orchestrator.ts:403,421) hard-codes:
```
airGapMeasured = subScores.some(air-gap && measured)
FORK  ⇔  enoughMeasured(≥3) && airGapMeasured && scorePassesFork(≥70)
```
The switch makes the **gate dimension a function of mode**, without touching the sovereign arithmetic:
```
gateDim   = mode === 'sovereign' ? 'air-gap' : 'multi-tenancy'
gateMeasured = subScores.some(d => d.dimension === gateDim && d.measured)
FORK  ⇔  enoughMeasured(≥3) && gateMeasured && scorePassesFork(≥70)
```
- **Sovereign path is byte-identical.** With `mode='sovereign'`, `gateDim='air-gap'` → the exact expression
  that runs today. No sovereign threshold, weight, or flag changes.
- **Subscription "ignores air-gap entirely."** In subscription mode, `scoreCandidate` never emits an `air-gap`
  sub-score at all — it is *not scored and not present*. `decideSourcing` gates on `multi-tenancy`. Air-gap is
  neither in the numerator, the denominator, nor any gate. Truly ignored, not zeroed.
- **The gate can only get STRICTER under confusion, never bypassed.** The gate asks "is the mode-critical
  dimension *present and measured*?" A subscription-scored candidate has **no air-gap sub-score**, so if it were
  ever run through a *sovereign* `decideSourcing`, `airGapMeasured` is `false` ⇒ **cannot FORK** (fails closed).
  Mode confusion degrades to deny-by-default; it can never manufacture a FORK. Prohibition 4j asserts this.

**The seam and Prohibition 4i stay intact.** The deciding→building seam is sovereign-only: `promoteToFork`
folds air-gap and re-derives via `decideSourcing`. Two additive changes only: (a) its `decideSourcing(...)` call
passes `'sovereign'` explicitly; (b) `prepare` **guards** `report.productMode === 'sovereign'` and refuses a
non-sovereign report (a subscription promotion seam is future work, explicitly out of scope). No token
discipline changes — 4i is untouched, and a sovereign FORK still requires measured air-gap.

---

## 5. Mode stamped into every report

```ts
// harvest-orchestrator.ts — HarvestReport gains a REQUIRED field (not optional)
export interface HarvestReport {
  domain: string;
  productMode: ProductMode;   // ← every report declares its lens; no default
  generatedAtIso: string;
  /* …unchanged… */
}
```
- The orchestrator's run entry takes `mode: ProductMode` **upfront** and threads it into every `scoreCandidate`
  and `decideSourcing` call, then sets `report.productMode = mode`.
- The markdown renderer stamps a header line — e.g. `**Product mode: SOVEREIGN**` — so a rendered report always
  declares its lens on its face. Existing sovereign reports (`docs/HARVEST_REPORT_*.md`) would regenerate
  identically except for this new, honest header line.

---

## 6. Law test — **Prohibition 4j** (next in sequence; rename to 4k if you prefer)

Added to `src/architecture/write-asks-read-first.test.ts`, additive, same class as 4f–4i. Plain-terms claim:

> *Mode is never silently defaulted. Every scored candidate and every harvest report carries an explicit
> `ProductMode`, and no mode — nor any mode confusion — can bypass the sovereign air-gap FORK gate. Sovereign
> FORK still requires a measured air-gap; subscription simply asks its own human gate (multi-tenancy) instead.*

**Source-inspection assertions:**
1. `ProductMode` is exactly `'sovereign' | 'subscription'`.
2. `scoreCandidate` and `decideSourcing` take `mode` as a **required positional param** — the signatures contain
   `mode: ProductMode` and **not** `mode?:` and **not** `mode: ProductMode =` (no default). This is the
   "cannot be silently defaulted" guarantee at the type level.
3. `HarvestReport.productMode` is a **required** field (no `?`).
4. The air-gap gate remains present and sovereign-bound: `decideSourcing` still references an
   `air-gap && measured` gate under `mode === 'sovereign'`.

**Behavioral assertions (real engine):**
5. **Sovereign unchanged / seam intact:** a sovereign spine with air-gap UNMEASURED ⇒ not FORK (re-asserts the
   seam's core property); with air-gap measured + score ≥ 70 + ≥3 dims ⇒ FORK. Identical to today.
6. **Subscription ignores air-gap:** a subscription-scored candidate has **no** `air-gap` sub-score; its FORK
   depends on `multi-tenancy` measured, never air-gap.
7. **Mode confusion fails closed:** feed a subscription-scored candidate (no air-gap sub-score) into a
   *sovereign* `decideSourcing` ⇒ `airGapMeasured=false` ⇒ **cannot FORK**. The gate only tightens.
8. **Every report declares a mode:** an orchestrator run asserts `report.productMode` is set to the mode it was
   invoked with; there is no code path that emits a report without one.

---

## 7. Additive — the seam and existing sovereign harvests are unaffected

- **Seam (`5c8cc53`) & Prohibition 4i:** unchanged token discipline; the seam gains only an explicit
  `'sovereign'` argument to `decideSourcing` and a `productMode==='sovereign'` guard. A sovereign FORK still
  requires measured air-gap. 4i inspects token/brand/handler discipline — none of that moves.
- **Existing sovereign harvests:** `mode='sovereign'` reproduces today's dimensions, weights, gate, and bands
  exactly. The only visible difference is the new `productMode: 'sovereign'` field + header line. IAM/HR/Legal
  reports regenerate with identical scores and verdicts.
- **Breaking-by-design, caught by the compiler:** making `mode` required (not defaulted) means every existing
  caller must pass it — that is the point (§6.2). The migration is a mechanical thread-through of `'sovereign'`
  at each current call site; the law test then forbids re-introducing a default.

---

## 8. Test plan summary

| Test | File | Kind | Proves |
|---|---|---|---|
| Prohibition **4j** | `architecture/write-asks-read-first.test.ts` | source + behavioral | mode required/undefaulted; report carries mode; air-gap gate sovereign-bound; confusion fails closed |
| profile dimensions | `scoring-engine.test.ts` | unit | sovereign = 6 dims incl. air-gap/white-label; subscription = universal-4 + tenancy/billing/cloud, **no air-gap sub-score**; both total 100 |
| sovereign parity | `scoring-engine.test.ts` | unit | `scoreCandidate(c,'sovereign')` == today's `scoreCandidate(c)` on the existing fixtures (byte-identical) |
| new sub-score scales | `scoring-engine.test.ts` | unit | tenancy/billing/cloud rating→points + measured/unmeasured branches (deny-by-default on unknown) |
| conditional gate | `harvest-orchestrator.test.ts` | unit | sovereign FORK needs air-gap measured; subscription FORK needs multi-tenancy measured; air-gap irrelevant in subscription |
| mode confusion | `harvest-orchestrator.test.ts` | unit | subscription candidate through sovereign `decideSourcing` ⇒ no FORK (fail-closed) |
| report stamp | `harvest-orchestrator.test.ts` | unit | `report.productMode` equals the invoked mode; markdown header shows it |
| scout signals | `repo-scout-signals.test.ts` | unit | cloud-native measured from files/deps; billing 'partial' from SDK dep; multi-tenancy bounded to 'partial' (never measured) |
| seam still sovereign | `build-decision-seam.test.ts` | behavioral | seam passes 'sovereign'; refuses a non-sovereign report; sovereign promotion unchanged |

---

## 9. Ratified (was: open choices) — all three settled

1. **Subscription weights = multi-tenancy 15 / billing 10 / cloud-native 10** (= 35, total 100). **Accepted as
   the starting point; retune on real data.** The dimension set was fixed by the human; these numbers are now
   the ratified defaults.
2. **Multi-tenancy IS the subscription hard FORK gate** (symmetric to air-gap). A subscription FORK requires a
   human-assessed measured multi-tenancy, exactly as a sovereign FORK requires measured air-gap — the human
   stays in the loop for a FORK in **both** modes.
3. **Prohibition number = 4j.**

On implementation, the first prompt writes the failing Prohibition 4j + the `ProductMode` type and profile
skeleton, then threads it through, per the dual-Claude loop.
