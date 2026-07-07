# Orientation Report — First Live Harvest Attempt: "Legal & Contract Operations"

**Run type:** BUILDER agent, first live exercise of the harvest machine (previously run only against test fixtures).
**Mission:** Perform the first LIVE harvest for the "Legal & Contract Operations" domain and stop at a Harvest Report.
**Outcome:** **STOP AT STEP 0 (ORIENTATION).** The harvest engines are **not wired for live scouting.** Reporting the wiring gap is the mission outcome, exactly as the mission's Step 0.4 instructs ("Do not proceed past it if it reveals the engines cannot actually scout live — in that case STOP and report the wiring gap as the mission outcome").
**Date:** 2026-07-07

---

## Summary (one line)

The six-layer structure and all eight harvest-layer engines exist and their **logic passes tests**, but **no code in this repository fetches GitHub or reads a live LICENSE file for harvesting.** Every harvest engine is a pure function over a **pre-supplied, human-verified candidate set.** The live scouting front-end is an explicitly unbuilt Open Item. A real live harvest cannot be run by the machine as it stands. No decomposition, scouting, scoring, or Harvest Report was produced, because doing so would require me to hand-build the missing front-end and would misrepresent the machine as working end-to-end — a FAILURE under the law, not a success.

---

## Step 0.1 — Six-layer structure: CONFIRMED

`src/` contains the six layers plus shared:

```
src/layer-1-law  src/layer-2-command  src/layer-3-harvest  src/layer-4-build-harden
src/layer-5-action  src/layer-6-venture-intel  src/factory-shared  src/mcp-server  src/architecture
```

`src/layer-3-harvest/` contains all eight named modules:

```
harvest-engine  scoring-engine  license-compliance  sovereign-readiness
repo-intelligence  compliance-checker  external-harvest-composer  internal-reuse-engine
```

Evidence: directory listing of `src/` and `src/layer-3-harvest/`.

---

## Step 0.2 — Harvest engine entry point & inputs: OPERATES ON SUPPLIED DATA, DOES NOT SCOUT

**Real entry point:** `HarvestEngine.harvest(input: HarvestInput)` — `src/layer-3-harvest/harvest-engine/harvest-engine.ts:88`.

**Its inputs are already-collected candidates, not a domain to search.** `HarvestInput.candidates: HarvestCandidateInput[]` (`harvest-engine.ts:42-43`). Each candidate already carries its `identity`, its `license` (with the LICENSE **text** already in hand), its `provenanceVerified` boolean, and two pre-built scoring passes (`harvest-engine.ts:32-40`). There is no `domain` parameter and no search step.

**The engines it calls are injected ports, not live services.** `HarvestEngines` is an interface of six pure methods (`classifyLicense`, `evaluateRepo`, `score`, `assessSpine`, `assessSovereign`, `assessWhiteLabel`) — `harvest-engine.ts:22-30`. The engine `import type`-only references the others (`harvest-engine.ts:13, 15-20`). Nothing in `harvest()` opens a socket, calls `fetch`, or touches GitHub.

**The "scout" in the code is a supplied opinion, not scouting code.** The only occurrences of "scout" are the field `proposedVerdict` — *"The scout's proposed sourcing verdict for the product"* (`harvest-engine.ts:48`) — and its echo in evidence (`harvest-engine.ts:156`). A scout (human or external) hands in a verdict; there is no scouting mechanism.

**The engine's own feature file names the missing piece as an unbuilt Open Item:**
> "A live harvester front-end that *fetches* candidates (GitHub search + live LICENSE reads) and feeds this orchestrator is a deployment/runtime concern — this engine orchestrates over a supplied, verified candidate set."
> — `harvest-engine.feature.md:34`

**Verdict for 0.2:** The harvest engine **only operates on data passed in by a caller that does not yet exist.** It cannot be invoked to scout GitHub for a domain.

---

## Step 0.3 — License verification: CLASSIFIES SUPPLIED TEXT, DOES NOT READ A REPO'S LICENSE FILE

**Entry point:** `classifyLicense(input: LicenseInput)` — `src/layer-3-harvest/license-compliance/license-compliance.ts:92`.

**It classifies text handed to it; it does not fetch or read a file.** `LicenseInput.text` is *"The actual LICENSE file content — authoritative"* — a string the caller supplies (`license-compliance.ts:28-30`). The classifier `detectFromText(text)` runs regexes over that supplied string (`license-compliance.ts:45-67`). There is **no** `fs.readFile`, no path, no URL, no `fetch` anywhere in the module — confirmed by grep across `src/layer-3-harvest` (`0` non-test matches for `readFile|fetch|http|github`).

The engine's guarantee is *classification integrity* (text beats badge; off-allowlist-permissive ⇒ `NEEDS_REVIEW`; empty ⇒ `REJECT`) — `license-compliance.ts:1-6, 96-132`. That guarantee is real and valuable, but it presupposes **someone already retrieved the LICENSE text.** Retrieval is not in this module.

Repo Intelligence says the same in its own header: *"No live network fetching here (data is supplied)"* and *"Was existence/activity verified live? (Supplied data — no fetching happens in this engine.)"* — `repo-intelligence.ts:14, 40`.

**Verdict for 0.3:** License verification **classifies a license string/text handed to it.** It does not read a repo's LICENSE file live.

---

## Is live-fetch capability wired anywhere else? — NO (for harvesting)

- **No HTTP/GitHub-read runtime dependency.** `package.json` has no `octokit`, no `node-fetch`, no HTTP client; runtime deps are `pg` only. The package self-describes as *"Phase 3.0 toolchain bootstrap — no engine logic yet"* at the toolchain level. (`package.json`)
- **The only live-network code is in `src/mcp-server/live-github-*` and is WRITE, not read/search.** Those adapters do `create_github_repo`, create issues, labels, milestones — gated Action-Layer external **writes** (`live-github-adapter.ts:1-20`). None reads or searches repositories for candidates. They are also forbidden to this run (any GitHub write is a STOP condition), and are `dryRun`/mock-guarded regardless.
- **No scout/search-of-GitHub path exists in layer-3.** The word "search" in `internal-reuse-engine.ts` is an in-memory query over the **internal capability graph** (`internal-reuse-engine.ts:31, 99`), not GitHub.

---

## What DOES work (verified live, this run)

The orchestrator/classifier logic is real and green on fixtures — I ran it:

```
npx vitest run src/layer-3-harvest/harvest-engine \
  src/layer-3-harvest/license-compliance src/layer-3-harvest/repo-intelligence
→ Test Files 4 passed (4);  Tests 37 passed (37)
```

So the machine's **decision logic** works when fed a verified candidate set: license classification, eligibility, two-pass scoring with disagreement escalation, spine selection, sovereign/white-label surfacing, deny-by-default, and the always-STOP guarantee (`HarvestReport.status` is the single literal `'STOP-AWAITING-HUMAN-APPROVAL'`, `harvest-engine.ts:72, 163`). What is missing is the layer *upstream* of all of it: the thing that turns a domain name into verified candidates.

---

## The wiring gap, precisely

To run a real live harvest, the machine needs a front-end that:
1. Takes a domain ("Legal & Contract Operations"), decomposes it, and **searches GitHub** for real repos;
2. **Reads each candidate's actual LICENSE file** (and README/metadata) over the network;
3. Assembles `HarvestCandidateInput[]` (identity + license **text** + provenance + two scoring inputs);
4. Calls `HarvestEngine.harvest(...)`.

Steps 1–3 **do not exist in this repository.** Only step 4 (and the pure logic it drives) exists. `harvest-engine.feature.md:34` acknowledges this as an unbuilt "deployment/runtime concern."

---

## Why I did not proceed to hand-run the harvest myself

The mission permits me to read public GitHub. I could manually browse repos and licenses and feed a candidate set into `harvest()`. I deliberately did **not**, for three law-grounded reasons:

1. **It would be building the missing front-end** — writing the fetch/scout product code the run explicitly forbids ("No product code… READ-ONLY except for writing the Harvest Report artifact and factory-memory records").
2. **It would misrepresent the machine as working end-to-end.** The mission exists to test whether the *harvest machine* runs live. A Harvest Report produced by me manually stitching data would look complete while the machine still cannot scout — "a plausible-looking but unverified Harvest Report is a FAILURE, not a success."
3. **Reaching a hard-stop honestly is the defined SUCCESSFUL outcome** for this run when a step cannot truly be performed by the machine.

---

## Steps: live vs. blocked

| Step | Status |
|---|---|
| 0 — Orient (structure, entry points, license path) | **Ran live.** Structure confirmed; engine code read; logic tests executed (37 passed). |
| 1 — Decompose domain | **Not started.** Blocked: gated on Step 0 showing live scouting is possible; it is not. |
| 2 — Scout GitHub (real, read-only) | **Blocked.** No engine/front-end in this repo can scout; doing it by hand would be building the missing component and would misrepresent the machine. |
| 3 — Score & decide | **Not reached.** (Logic exists and passes on fixtures, but has no live candidate set to consume.) |
| 4 — Harvest Report | **Not reached.** No `docs/HARVEST_REPORT_LEGAL_CONTRACT_OPS.md` was written — that would be a fabricated completion. |

---

## Mission outcome

**HARVEST BLOCKED AT ORIENTATION — WIRING GAP REPORTED. No build, fork, scout, or external action taken.**

The harvest machine's decision logic is built and green, but it has **no live scouting/LICENSE-fetching front-end**, so the "first live harvest" cannot be performed by the machine. This is reported honestly as the run's result. The decision to build that front-end (or to authorize a bounded manual scout as a separate, explicitly-approved task) is the human's (Rashed's) to make.

---

### Evidence index (file:line)
- Structure: `src/`, `src/layer-3-harvest/` listings
- Harvest entry & supplied-candidate inputs: `harvest-engine.ts:42-43, 88`; injected ports `:22-30`; `import type` only `:13,15-20`
- "scout" = supplied verdict, not scouting code: `harvest-engine.ts:48, 156`
- Missing front-end acknowledged: `harvest-engine.feature.md:34`
- Always-STOP guarantee: `harvest-engine.ts:72, 163`
- License classifies supplied text, no fetch: `license-compliance.ts:28-30, 45-67, 92-132`
- "No live network fetching here (data is supplied)": `repo-intelligence.ts:14, 40`
- Live GitHub code is write-only, not scouting: `live-github-adapter.ts:1-20`
- No HTTP/read dependency: `package.json`
- Logic verified green: `vitest run` → 37 passed
