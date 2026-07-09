# ECE FACTORY — TIER-0 FRONTLINER UI MASTERBUILD PLAN

**Status:** PLAN — awaiting review. No UI code exists. No phase may begin until its entry criteria are verified on disk.
**Companion doc:** `docs/UI_SPEC_TIER0_FRONTLINER.md` (the design spec). This document is the build order, phases, milestones, and data-truth audit.
**Governing rule (Rule 0):** The UI must not display factory state, verdicts, commits, approvals, write status, law status, product status, or test status unless that state is read from actual factory evidence. Hardcoded operational claims are forbidden. **This plan extends Rule 0 to the build itself: no phase milestone is "done" on a claim — every milestone has a verification command, and the milestone is done when the command's output says so.**

---

## PART A — DATA-TRUTH AUDIT

Before any build order makes sense, every page in the spec must be mapped to its real data source, and each source classified honestly. This is the audit the plan is built on.

### A.1 Source classification

| Class | Meaning |
|---|---|
| **EXISTS** | Persisted artifact on disk/origin today. UI can read it now. |
| **RUNNABLE** | Not persisted, but producible on demand by running something real (tests, git). UI can trigger/read fresh output. |
| **EPHEMERAL** | Produced by the factory but not persisted anywhere durable. UI cannot show history until a store exists. |
| **NOT-YET** | The producing machinery itself is unbuilt (blocked on seam / first scaffold / GitHub executor). |

### A.2 Page-by-page data map

| Page / element | Data needed | Source today | Class | Gap to close |
|---|---|---|---|---|
| Command Center: HEAD, branch, sync | git state | `git log`, `git status` | **RUNNABLE** | Read-layer git adapter |
| Command Center: test status | latest suite result | vitest run output | **RUNNABLE** | Persist test-run records (JSON) or show "not recently run" with timestamp |
| Command Center: law status | law-test results (4e–4h, later 4i) | `write-asks-read-first.test.ts` run | **RUNNABLE** | Same as tests; law runs must record HEAD they ran against |
| Command Center: write boundary | executor constants | source code (`/tmp/ece-dryrun-` hard constant, adapter modes) | **EXISTS** (in code) | Read-layer must parse/import real constants, never restate them |
| Command Center: pending decisions | approval queue | — | **NOT-YET** (seam unbuilt) | Seam + approval record store |
| Command Center: recent milestones | commit history | `git log` | **RUNNABLE** | Git adapter; capability annotations from commit messages only |
| Harvest Runs table | all harvest reports + run metadata | `docs/HARVEST_REPORT*.md` (4 committed reports: generic, Legal Ops, IAM, HR/Payroll) + `products/ece-trust-layer/HARVEST_REPORT.md` | **EXISTS** | Typed parser for the report format; run registry for future runs |
| Repo Scout page | scout evidence per candidate | inside reports (tables) | **EXISTS** (embedded) | Parser extracts candidate rows; live-scout evidence not separately persisted → registry going forward |
| Signal Enrichment page | per-dimension values/confidence | inside reports (signals columns) | **EXISTS** (embedded) | Same parser |
| Candidate Comparison | cross-candidate table | inside reports | **EXISTS** (embedded) | Same parser |
| Harvest Report viewer | full dossier | the .md files | **EXISTS** | Render + section-typed parse |
| Approved Decisions page | ApprovedBuildDecision records | — | **NOT-YET** | Seam (designed, `05479fb`) + persistence of decisions |
| Approvals page (all tabs) | Approval Gate records: requested/approved/rejected/consumed, bound hashes | gate exists in code; records not persisted | **EPHEMERAL → NOT-YET for history** | **Approval record store** — factory-side work, prerequisite |
| Build Plans page | BuildPlan objects | planner exists (`8aa5f12`); plans not persisted from real verdicts | **EPHEMERAL / NOT-YET** | Persist plans; first real plan arrives with first scaffold |
| Scaffold Plans page | PlannedFilesystemWrite + plan hash + binding | orchestrator emits; not persisted | **EPHEMERAL** | Persist plan artifacts per run |
| Product Skeletons page | ExecutionResult + written files + hash verify | sandbox under `/tmp/ece-dryrun-*` is wiped; results not persisted | **EPHEMERAL** | **Execution record store** + optional artifact snapshot |
| Actions: adapters table | adapter modes/capabilities | source code truths | **EXISTS** (in code) | Read from module metadata, not a hand-typed table |
| Actions: GitHub Live | lock status | code (dry-run only) | **EXISTS** | Render locked from real capability flags |
| Products page | product lifecycle records | `products/ece-trust-layer/` only; no lifecycle registry | **PARTIAL** | Product registry keyed to harvest/approval/scaffold records |
| Evidence page + lineage graph | evidence refs + hashes crossing stages | fragments in reports/commits; no unified evidence index | **NOT-YET** (as a graph) | **Evidence index** — emitted going forward; back-filled from committed reports where parseable |
| Audit page | immutable event timeline | git history is the only durable event log today | **PARTIAL** | **Audit event log** (append-only JSONL/DB) — factory emits events from seam/planner/executor onward |
| Law page | law cards + test provenance | law tests in repo | **RUNNABLE** | Live Law-Test Runner (spec addition) |
| Venture Intel page | L6 advisory outputs | `src/layer-6-venture-intel` exists; contents unaudited this session | **UNKNOWN** | Audit L6 before designing its read model |
| Settings: credentials | token presence/scope (never values) | env/keychain at runtime | **RUNNABLE** | Presence-check endpoint; never reads values into UI |

### A.3 The audit's verdict — three truths that shape the whole plan

1. **The Harvest section can be 100% real on day one.** Four committed reports with five EXTEND verdicts (IAM: RBAC/ABAC 78.5 react-access-engine, OAuth2/OIDC 70.8 tokn; HR/Payroll: ATS 75.4 OpenATS, Time/Attendance 70.8 redmine_leaves, Onboarding 70.8 dutyduke) are real, parsed-able artifacts. This is where the UI first proves Rule 0.
2. **Approvals, Audit, Skeletons, and Approved Decisions cannot be real yet** — not because the UI is early, but because the factory does not persist those records. The plan therefore contains **factory-side persistence work (Phase 2) as a hard prerequisite**, and those pages ship only after the stores exist and the seam emits into them. Any earlier version of those pages would be a mock — forbidden.
3. **Ghost purge is a standing obligation.** The spec draft in circulation still references a PDF harvest, pdf-lib, EXTEND-PENDING-REVIEW for PDF, and HEAD `61ac47c` — none of which exist in the repo. The committed spec must carry only verified examples (IAM / HR-Payroll / real HEAD) or clearly-labeled generic placeholders. The Discrepancy Detector (Phase 7) exists to make this class of error impossible to ship silently.

---

## PART B — ARCHITECTURE (maximum-frontier, no mocks anywhere)

### B.1 System shape

```
┌──────────────────────────────────────────────────────────────┐
│  CONSOLE (React 19 + TypeScript strict + Vite)               │
│  dark sovereign shell · three-zone layout · right inspector  │
└───────────────▲──────────────────────────────────────────────┘
                │ typed contracts (zod schemas, single package)
┌───────────────┴──────────────────────────────────────────────┐
│  FACTORY STATE API (local Node service, read-plane)          │
│  · GitAdapter        → real git log/status/show              │
│  · ReportAdapter     → parses HARVEST_REPORT_*.md to types   │
│  · LawAdapter        → runs/reads law tests, records HEAD    │
│  · TestAdapter       → runs/reads vitest, persists runs      │
│  · CapabilityAdapter → imports real executor/adapter consts  │
│  · StoreAdapter      → approval/audit/execution/evidence     │
│  Every response carries PROVENANCE: {source, path|cmd,       │
│  hash|commit, readAt}. No field without provenance.          │
└───────────────▲──────────────────────────────────────────────┘
                │ append-only stores (Phase 2, factory-side)
┌───────────────┴──────────────────────────────────────────────┐
│  FACTORY (existing repo)                                     │
│  L1 law · L2 command(+seam) · L3 harvest · L4 build          │
│  L5 action · L6 venture-intel                                │
└──────────────────────────────────────────────────────────────┘
```

**Non-negotiables:**
- **Read-plane separation.** The State API is read-only against the factory. It never mints, never approves, never writes to the sandbox. The one UI-initiated *action* class — approving at the gate — goes through the seam's real `approve_build_decision` tool path, never a parallel UI route.
- **Provenance on every field.** A status without `{source, readAt}` is a type error, not a style issue. This is Rule 0 made structural: the UI is *incapable* of rendering unprovenanced state.
- **Unknown is a first-class value.** Every read model has an `unknown` variant rendered per Rule 1 (never green, red only if blocking).
- **Local-first, sovereign.** No cloud, no telemetry, no external calls except the factory's own governed adapters. Runs on the operator's machine against the repo.
- **Live truth via watchers.** chokidar on `docs/`, stores, and `.git` → SSE/WebSocket push. The console reflects the repo within seconds of a commit, without polling lies.

### B.2 The typed contract package

One shared package `@ece/factory-contracts` (zod): `Run`, `Candidate`, `HarvestReport`, `ApprovalRecord`, `ApprovedBuildDecision`, `BuildPlan`, `PlannedFilesystemWrite`, `ExecutionResult`, `AuditEvent`, `LawTestRun`, `TestSuiteRun`, `EvidenceRef`, `Provenance`, `Badge` unions (decision/evidence/law/capability exactly as §21 of the spec). The parser, the stores, the API, and the console all import the same schemas — one truth, no drift.

### B.3 Persistence stores (factory-side, Phase 2)

Append-only, hash-chained JSONL under `factory-state/` (git-tracked so origin is the durability layer), upgradeable to PostgreSQL later without contract change:
- `approvals.jsonl` — every gate request/approve/reject/consume with bound hashes, approver, timestamps
- `audit.jsonl` — every factory event (scout start, report written, decision approved, plan created, confirm issued, files written, law run, push)
- `executions.jsonl` — ExecutionResult per sandbox run + file hash manifest
- `test-runs.jsonl` / `law-runs.jsonl` — suite results pinned to HEAD
- `evidence-index.jsonl` — evidence refs with hashes and used-by links (feeds the lineage graph)

Emitters are added at the seam, planner, orchestrator, and executor — additive instrumentation, no gate logic touched, each emitter guarded by its own test.

---

## PART C — BUILD PHASES & MILESTONES

Every phase has **entry criteria** (verified on disk before starting) and **exit milestones**, each with a **verification command**. A milestone without passing verification is not done — the session discipline, productized.

### PHASE 0 — Foundations & evidence inventory *(no UI code)*
**Entry:** UI spec committed clean (ghosts purged).
**Work:** commit this plan; create `@ece/factory-contracts` with zod schemas + provenance type; write the ReportAdapter **parser** for the real harvest report format with golden tests against all four committed reports; L6 contents audit.
**Milestones:**
- **M0.1** Contracts package builds, 100% schema coverage of §20 objects. → `npx vitest run packages/contracts`
- **M0.2** Parser round-trips all committed reports; extracts the five real EXTEND verdicts with scores/bands/repos exactly. → golden test asserting `RBAC/ABAC 78.5 react-access-engine` et al. parsed, not hardcoded
- **M0.3** L6 audited; findings committed. → `git log --oneline -- docs/L6_AUDIT.md`

### PHASE 1 — Factory State API (the read plane)
**Entry:** M0.1–M0.2 green.
**Work:** Node service with GitAdapter, ReportAdapter (from Phase 0), LawAdapter, TestAdapter, CapabilityAdapter (imports the real `/tmp/ece-dryrun-` constant and adapter mode flags from source — never restates them); provenance envelope on every response; file watchers + SSE; StoreAdapter stubs that return honest `unknown/empty` until Phase 2 stores exist (an empty store is truth; a mocked record is a lie).
**Milestones:**
- **M1.1** `GET /state/git` returns real HEAD matching `git log --oneline -1`, with provenance. → diff API output vs git output in a test
- **M1.2** `GET /state/harvests` lists exactly the committed reports; verdict fields match grep of the files. → contract test
- **M1.3** `GET /state/capabilities` sandbox root equals the executor's source constant (imported, asserted). → test fails if the constant moves
- **M1.4** Law/Test adapters run suites and persist `*-runs.jsonl` pinned to HEAD. → run, then `tail -1 factory-state/law-runs.jsonl` shows current HEAD
- **M1.5** Watcher: touching a report file pushes an SSE event within 2s. → integration test

### PHASE 2 — Factory persistence (approvals, audit, executions, evidence) *(factory-side; prerequisite for the console's core pages)*
**Entry:** Seam implementation underway or complete (design `05479fb`); Phase 1 green.
**Work:** the five stores (B.3); emitters at seam (approval lifecycle + audit), planner (BuildPlan persisted with plan hash), orchestrator (PlannedFilesystemWrite persisted), executor (ExecutionResult + manifest); hash-chain integrity check; **Prohibition 4j (proposed law):** every consumed approval MUST have a corresponding approval record and audit event — an unrecorded consumption is a law failure.
**Milestones:**
- **M2.1** Seam happy-path run writes approval + audit records with real gate `approvalId`/bound hash. → `grep <approvalId> factory-state/approvals.jsonl`
- **M2.2** First real scaffold's ExecutionResult persisted; file hashes in manifest match `shasum` of written files. → verification script
- **M2.3** Hash-chain verifier passes over all stores. → `npx vitest run src/**/store-integrity*`
- **M2.4** 4j green alongside 4e–4i. → law suite run
**Hard dependency note:** M2.1/M2.2 require the seam built and the first scaffold executed — the already-agreed factory sequence. The UI plan does not jump this queue; it instruments it.

### PHASE 3 — Console shell + Command Center + Approvals *(first pixels — only now)*
**Entry:** Phase 1 green; Phase 2 stores exist (even if approvals store holds only the first real records).
**Work:** three-zone shell (sidebar with six layers, center workspace, right inspector as a universal provenance-aware component — build it once, every page reuses it); visual system per spec §3 (near-black, cyan/gold/red/amber/green semantics, monospace for hashes, calm motion); Command Center rendering only RUNNABLE/EXISTS truths (HEAD, tests+timestamp, law+HEAD-pinned, write boundary from CapabilityAdapter, milestones from git, factory flow with real stage statuses — stages whose machinery is unbuilt show **locked**, honestly); Approvals page over the real store with the critical display (`Transferable: No · Bound to exact plan hash: Yes · Consumed: Y/N`) and the approve action wired through the seam's real tool path — the console becomes the DecisionConsole seat's window, minting nothing itself.
**Milestones:**
- **M3.1** Cold open renders real HEAD/test/law state; kill the API → every field flips to explicit `unavailable`, zero cached-as-current values. → manual + automated "unplug test"
- **M3.2** Commit to the repo → Command Center updates via SSE without reload. → scripted
- **M3.3** Approvals shows the first real seam approval; inspector shows gate-sourced bound hash. → cross-check vs `approvals.jsonl`
- **M3.4** An approval performed through the console produces a real ConsumedApproval via the gate, recorded in stores; 4i/4j stay green. → law suite + store grep
- **M3.5** Right inspector shows provenance (source/path/hash/readAt) for every field on both pages. → component contract test

### PHASE 4 — Harvest section (the richest real data)
**Entry:** M3.x green.
**Work:** Harvest Runs table (all committed reports), Report viewer (facts/measured/judgments/unknowns/human-required visually separated per §7.5), Candidate Comparison with expandable evidence, Signal Enrichment honoring "unknown is trustworthy," Repo Scout read-only with token *presence* only.
**Milestones:**
- **M4.1** Runs table shows exactly the on-disk reports — no more, no fewer. → count vs `find docs -name 'HARVEST_REPORT*'`
- **M4.2** IAM report page shows RBAC/ABAC 78.5 / EXTEND / air-gap-gated sourced from the parsed file. → e2e assertion against file content
- **M4.3** Every verdict badge click reveals evidence rows with hashes (Rule 2 enforced by test).

### PHASE 5 — Build section (real once the first scaffold exists)
**Entry:** first real scaffold complete (factory milestone); M2.2 green.
**Work:** Approved Decisions registry (only gate-passed, with `airGapAssessment {value, rationale, measuredBy, gateActionId}` displayed — the seam's provenance made visible); Build Plans tri-pane; Scaffold Plans with the serious confirm panel exactly per §8.3; Product Skeletons with **plan-vs-written hash diff** (the "factory built something real" proof screen); Hardening & Packaging shipped **locked** with real prerequisites listed.
**Milestones:**
- **M5.1** The real ApprovedBuildDecision renders with gate-sourced `gateActionId`. → vs approvals store
- **M5.2** Skeleton page hash-diff: every planned-vs-written hash match computed live from manifest + `shasum`. → e2e
- **M5.3** Confirm panel appears before any execution trigger; execution only via the real doubly-gated path; boundary text sourced from CapabilityAdapter. → law suite unchanged + UI test

### PHASE 6 — Actions, Law, Audit
**Work:** Governed Adapters table from real capability flags; Filesystem Executor page with execution history from `executions.jsonl`; GitHub Dry-run/Live-Locked/MCP pages rendering honest lock states; **Live Law-Test Runner** (trigger 4e–4j, render fresh results with HEAD + timestamp — never stale-green-as-current); Audit timeline over `audit.jsonl` with write events visually loud, filters per §13.
**Milestones:**
- **M6.1** Law runner executes real suite; UI shows run's HEAD == current HEAD or flags drift. → e2e
- **M6.2** Audit timeline count == store line count; each event links to its evidence. → contract test
- **M6.3** Adapter modes on screen == source-code flags. → the CapabilityAdapter test extended to UI snapshot

### PHASE 7 — Trust instruments (the Tier-0 differentiators)
**Work:** **Evidence lineage graph** (LICENSE → classification → score → verdict → approval → plan → write → audit, walkable, every node hash-addressed from the evidence index); **Discrepancy Detector** on Command Center — continuously diffs displayed state vs git/filesystem (report referenced but file missing; commit shown but absent from `git log`; scaffold claimed but no execution record) and renders mismatches red; commit-to-capability timeline; risk heatmap; scoring before/after comparison (recalibration data is real: `d4243fb`).
**Milestones:**
- **M7.1** Lineage graph for the first product walks end-to-end with every hop hash-verified. → graph integrity test
- **M7.2** Detector catch test: temporarily rename a report file → red flag within one watch cycle; restore → clears. → scripted chaos test
- **M7.3** Detector finds zero discrepancies on clean state (and that's asserted, not assumed).

### PHASE 8 — Products, Venture Intel, Settings, hardening
**Work:** Product portfolio bound to the product registry (first entry: the first scaffolded product; `ece-trust-layer` back-filled with whatever evidence exists, gaps shown as unknown); L6 advisory pages per its audit — **no execute buttons, ever** (enforced by a UI law test greping for action handlers in L6 routes); Settings with token *presence/scope/last-validated* only; a11y, keyboard-first operator ergonomics, performance passes; **UI law suite** — automated tests for Rules 0–6 (no unprovenanced render, unknown-never-green, every write screen shows boundary, pending-review ≠ build-ready styling, L6 inert, MCP framed optional).
**Milestones:**
- **M8.1** UI law suite green in CI alongside factory laws. → single command runs both
- **M8.2** Full operator walkthrough: domain idea → harvest report → console approval → plan → confirm → sandbox write → skeleton hash-verified → lineage graph — every step on real data, recorded as the acceptance run. → the run's audit trail is the proof artifact

---

## PART D — DEPENDENCY GRAPH & SEQUENCING TRUTH

```
Seam implementation (factory) ──► Phase 2 stores ──► Phase 3 Approvals
        │                                                │
        └──► First real scaffold ──► Phase 5 Build ◄─────┘
Phase 0 ──► Phase 1 ──► Phase 3 Command Center ──► Phase 4 Harvest ──► 6 ──► 7 ──► 8
```

- Phases 0–1 can start **immediately** — they touch no gate and mock nothing.
- Phase 3's Approvals page and everything in Phase 5 are **hard-blocked** on the seam and first scaffold. That is correct and by design: the console's most important pages render machinery that must exist first. Building them earlier would violate Rule 0 by construction.
- The Harvest section (Phase 4) is the proof-of-concept of the whole philosophy and needs nothing but committed files — if pressure demands visible progress early, Phase 4 can swap ahead of Phase 3's Approvals half without breaking any dependency.

## PART E — STANDING RULES FOR THE BUILD ITSELF

1. **No mock data, no fixtures posing as state, no `TODO: wire later` renders.** A page whose store is empty shows an honest empty state with provenance.
2. **Every milestone closes with its verification command output pasted into the commit message or a `MILESTONES.md` ledger** — trust git log, not claims, for the UI too.
3. **Diff-read discipline applies doubly to Phase 2 emitters and the Phase 3 approve action** — they sit adjacent to the gate.
4. **The console never gains a second write path.** If a future feature needs an action, it routes through a governed factory tool or it doesn't ship.
5. **Ghost regression check:** before every phase closes, grep the UI codebase for `pdf-lib`, `61ac47c`, and any hardcoded verdict strings. Zero hits or the phase stays open.
