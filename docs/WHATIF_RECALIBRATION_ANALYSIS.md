# WHAT-IF Analysis — Normalize-Over-Measured + Confidence-Floor Recalibration

**Type:** READ-ONLY impact analysis. **No code changed, no scoring changed.** This document
computes, by hand, what each committed Legal-Ops candidate's score and verdict *would* become
under a proposed recalibration — so a human can decide whether to implement it.

**Date:** 2026-07-08 · **Analyst:** BUILDER agent · **Status:** AWAITING HUMAN DECISION

---

## 1. The real current formula (cited)

Source: `src/layer-3-harvest/scoring-engine/scoring-engine.ts`.

**Total = plain unweighted sum of six sub-scores** (`scoring-engine.ts:132-133`):

```ts
const subScores = [scoreLicense(c), scoreMaturity(c), scoreAirGap(c),
                   scoreWhiteLabel(c), scoreArchFit(c), scoreMaintainability(c)];
const total = subScores.reduce((s, x) => s + x.score, 0);
```

The six dimensions and their max points (the max **is** the weight — points sum to 100):

| Dimension | Max (weight) | Scorer | "Unmeasured" branch → score |
|---|---|---|---|
| license | 20 | `scoreLicense` :68 | evidence missing → **0** (:73); REJECT → **0** (:70, hard gate) |
| maturity | 20 | `scoreMaturity` :76 | `!m` → **0** (:78) |
| air-gap | 20 | `scoreAirGap` :91 | `default` (undefined) → **0** (:96) |
| white-label | 15 | `scoreWhiteLabel` :100 | `default` → **0** (:105) |
| arch-fit | 15 | `scoreArchFit` :109 | `!c.archFit` → **0** (:110) |
| maintainability | 10 | `scoreMaintainability` :120 | `!c.maintainability` → **0** (:121) |
| **Total** | **100** | | |

**Confirmed: an unmeasured dimension enters the sum as `0` — arithmetically identical to a
dimension measured as the worst possible.** (`:78, :96, :105, :110, :121`.) This is the exact
calibration bug the mission describes: "couldn't measure" == "terrible."

Band thresholds (`scoring-engine.ts:153-158`): `≥85 strong · ≥70 acceptable · ≥55 risky · else
reject`. The FORK bar of 70 = the `acceptable` threshold. (The engine emits *bands*; FORK/EXTEND/
BUILD is a separate verdict layer, but the report maps score→band→decision, so "≥70 → forkable.")

---

## 2. What the committed report actually contains

`docs/HARVEST_REPORT_LEGAL_CONTRACT_OPS.md` gives **totals and bands only — no per-dimension
table.** No JSON/fixture in the repo holds the raw sub-scores (the candidate names appear *only*
in the `.md` reports). So per-dimension inputs must be **derived**, not read.

The derivation is *forced* for the three ACCEPT candidates, because:
- ACCEPT license = exactly **20** (`scoreLicense :71`), and
- the report states three times, verbatim, that the low score is "driven ENTIRELY by dimensions
  the scout does not source (air-gap, white-label, arch-fit, maintainability) — deny-by-default"
  (report lines 22, 59, 71) → those four are **0**, and
- maturity is the *only* remaining measured dimension, so `maturity = total − 20`, and the result
  must land on a valid maturity bucket (`scoreMaturity` buckets: 0/5/8/12/13/16/18).

Every eligible candidate's derived maturity lands exactly on a bucket → derivation is unique.
**The REJECT candidates are license-hard-rejected regardless of the other dims, so their exact
sub-scores are moot** (see §5).

---

## 3. Proposed math (as specified in the mission)

```
normalized = Σ(weight_i · dimFraction_i  over MEASURED dims)
             ─────────────────────────────────────────────── × 100
                    Σ(weight_i  over MEASURED dims)

           = (Σ raw points of measured dims) / (Σ max of measured dims) × 100
```

Carry confidence: `measuredCount`, `measuredWeightFraction = Σmeasured weight / 100`.

- **FORK** ⇔ normalized ≥ 70 **AND** measuredCount ≥ 3
- **EXTEND** ⇔ 55 ≤ normalized ≤ 69 **AND** measuredCount ≥ 3
- else (below floor, or normalized < 55) ⇒ **NEEDS-ASSESSMENT**
- **License REJECT hard-gate is retained** (an unlicensed / non-permissive repo can never FORK).

Unmeasured dims are **excluded from the denominator** and never assumed good.

---

## 4. Per-candidate arithmetic (the three eligible / ACCEPT candidates)

Measured dims for **all three**: license (20/20) + maturity. Everything else deny-by-default (0).
`measuredCount = 2`; measured weight = 20+20 = 40 ⇒ `measuredWeightFraction = 0.40`.

### CLM spine — OneSavieLabs/Bastet (Apache-2.0, ACCEPT)
- Current total 36 ⇒ maturity = 36 − 20 = **16** (`:87` actively maintained, 100–999★).
- Normalized = (20 + 16) / (20 + 20) × 100 = 36/40 × 100 = **90.0**
- measuredCount = 2 → **below floor (3)** → **NEEDS-ASSESSMENT**

### Doc-Assembly spine — ykSubha/intelligent-property-doc-generation (MIT, ACCEPT)
- Current total 33 ⇒ maturity = 33 − 20 = **13** (`:88` actively maintained, <100★).
- Normalized = (20 + 13) / 40 × 100 = 33/40 × 100 = **82.5**
- measuredCount = 2 → below floor → **NEEDS-ASSESSMENT**

### Obligation spine — noamrazbuilds/obligation-tracker (MIT, ACCEPT)
- Current total 33 ⇒ maturity = **13** (`:88`).
- Normalized = 33/40 × 100 = **82.5**
- measuredCount = 2 → below floor → **NEEDS-ASSESSMENT**

---

## 5. BEFORE → AFTER (every candidate)

| Repo | Sub-domain | License | Cur. score/band | Norm. score | measuredCount | New verdict | Changed? |
|---|---|---|---|---|---|---|---|
| OneSavieLabs/Bastet | CLM | ACCEPT | 36 / reject | **90.0** | 2 | NEEDS-ASSESSMENT | band reject→N-A (no FORK) |
| ykSubha/intelligent-property-doc-generation | Doc Assembly | ACCEPT | 33 / reject | **82.5** | 2 | NEEDS-ASSESSMENT | band reject→N-A (no FORK) |
| noamrazbuilds/obligation-tracker | Obligation | ACCEPT | 33 / reject | **82.5** | 2 | NEEDS-ASSESSMENT | band reject→N-A (no FORK) |
| andrewmogbolu2/blockchain-technology | CLM | REJECT | 5 / reject | — (hard gate) | — | REJECT | no |
| ProgrammingNotJustCoding/marai | CLM | REJECT | 13 / reject | — | — | REJECT | no |
| 01amine/Contract-Lifecycle-Management | CLM | REJECT | 13 / reject | — | — | REJECT | no |
| AniketTati/draft-legal | CLM | REJECT (NonCommercial) | 13 / reject | — | — | REJECT | no |
| penpact/penpact | E-Sign | REJECT (AGPL) | 13 / reject | — | — | REJECT | no |
| ashuprakash-cyber/contract-drafting-ai | Clause | REJECT | 13 / reject | — | — | REJECT | no |
| VipulMore11/Legal-Contract-Builder | Clause | REJECT | 13 / reject | — | — | REJECT | no |
| AasthaSanghi91/contract-obligation-tracker | Obligation | REJECT | 13 / reject | — | — | REJECT | no |
| gracyosun/obligation-chrono-anchor-protocol | Obligation | REJECT | 13 / reject | — | — | REJECT | no |
| victoriaolupon/stellar-accountability-matrix | Obligation | REJECT | 13 / reject | — | — | REJECT | no |
| elizakaw/dobligation-chain | Obligation | REJECT | 13 / reject | — | — | REJECT | no |

**Sub-domain decisions:** CLM (N-A→N-A), E-Sign (BUILD→BUILD), Clause (BUILD→BUILD),
Doc-Assembly (N-A→N-A), Obligation (N-A→N-A). **Zero sub-domain decisions change.**

**FORK/EXTEND promotions: ZERO.** Candidate-band reclassifications (reject → NEEDS-ASSESSMENT): 3.

---

## 6. Honest assessment

**Does the recalibration promote genuinely-strong repos, or fork thin ones?** Neither — it
**promotes nothing to FORK or EXTEND.** All three eligible repos are strong on what *was* measured
(90 and 82.5 normalized), but only **2 dimensions** were ever measured (license + maturity), and
the confidence floor of 3 correctly refuses to fork on that. So the fix does **not** fork thin
repos — the floor is doing its job.

**Would any Legal-Ops candidate become a real FORK?** **No.** Not one. The scout sources only
license + maturity (`ORIENTATION_HARVEST...md:36-64`; `repo-intelligence.ts:14, 40`), so
`measuredCount` is structurally pinned at 2 for every eligible candidate. **No normalization can
produce a FORK on this dataset** until the missing assessment engines (air-gap prober, white-label
analyzer, arch-fit + maintainability reviewers) are built and raise `measuredCount` to ≥3.

**So what does the fix actually do here?** It stops the *arithmetic* from branding a repo that
scores 90% of everything-it-could-measure as "reject." That's the correct direction — but it only
changes the **band label** (reject → NEEDS-ASSESSMENT), which is *exactly the conclusion the report
authors already reached by hand* at the sub-domain level (report lines 22-23, 59-60, 71-72). The
recalibration **bakes that manual override into the math**; it does not unlock any new sourcing
decision for Legal-Ops.

**Is the confidence floor of 3 right?**
- **Floor 2 would be dangerous.** It would FORK Bastet (90), ykSubha (82.5), noamraz (82.5) on
  license + maturity **alone** — with air-gap, arch-fit, maintainability, and white-label *never
  checked*. For a sovereign/air-gap-first factory where air-gap is itself a hard gate
  (`scoring-engine.ts:146`), forking without ever measuring air-gap is clearly wrong.
- **Floor 3 gives the correct result here** (blocks all, because only 2 are measured).
- **But a bare count is a weak floor:** *which* 3 matters, not just how many. `measuredCount ≥ 3`
  can be satisfied by three easy dims while the sovereign-critical one (air-gap) is still unknown.
  **Recommendation:** keep 3 as a floor, but consider *requiring specific dimensions* — at minimum
  air-gap — to be measured before FORK, since air-gap already carries a sovereign hard-gate flag.

**A verdict the new math would get wrong?** With floor 3, none — it correctly refuses to promote.
The one real risk is **display**: the normalized 90 must *always* be shown with `measuredCount = 2`
/ `measuredWeightFraction = 0.40`. "90" alone reads as "basically a FORK"; it actually means "90%
of the 40% of the rubric we could measure." The confidence carry is not optional cosmetics — it is
what stops a human from over-reading the headline number.

---

## 7. Bottom line for the human decision

1. The bug is real and the **normalize-over-measured** direction is correct — deny-by-default in
   the *summed total* does conflate "unmeasured" with "bad."
2. **But recalibration alone unlocks zero forks for this harvest.** The binding constraint is not
   the formula — it is that the scout measures only 2 of 6 dimensions. Implementing the recalibration
   expecting FORKs to appear would be a mistake.
3. The real unlock is **building the four missing assessment engines** so `measuredCount` can reach
   ≥3 honestly. Recalibration is a prerequisite/enabler, not the deliverable.
4. If recalibration ships, ship the **confidence carry with it** (never a bare normalized score),
   and consider a **dimension-specific floor** (require air-gap) rather than a bare count of 3.

---

*Read-only. No scoring code was changed. Per-dimension inputs for eligible candidates are derived
(forced) from committed totals + the report's own deny-by-default statements, not read from raw
data — the repo stores no per-dimension harvest data. REJECT candidates' non-license sub-scores are
not derived because the license hard gate makes them moot.*
