# Design — M2: UI Read-Plane Foundations (Contracts + Report Parser + Factory State API)

**Status:** APPROVED (design only — no implementation yet). Ratifications folded into §1/§6/§8.
**Author attribution:** recorded to the real human who approved this design, never "claude".
**Date:** 2026-07-09 · **Baseline:** origin/main @ `22314c9` (tree clean)

> ## Ratified decisions (binding at implementation)
> 1. **This M2 spec is authoritative** — proceed from it. (`docs/UI_MASTERBUILD_PLAN_TIER0.md` is not yet in the
>    repo; the human will commit the masterbuild plan separately — do NOT block on it.)
> 2. **Location: `src/read-plane/`** — no workspace/monorepo.
> 3. **`zod`** approved as the one new dependency.
> 4. **HEAD-keyed test/law caching** — yes, with the dirty-tree state surfaced in provenance.

> **Provenance note on the referenced plan.** `docs/UI_MASTERBUILD_PLAN_TIER0.md` is **not present in the repo**
> (verified at `22314c9`). This design is written from the self-contained M2 spec in the approval request, not
> from that file. Per ratification #1 it is authoritative; the masterbuild plan will be committed separately.

---

## 0. One-line statement + scope

Build the **truthful data layer** the UI will sit on: a typed **contracts** package, a **harvest-report parser**
that round-trips the committed reports, and a local **read-only Factory State API** whose every operational field
carries **provenance** — `{ source, path|cmd, hash|commit, readAt }` — such that *a value without provenance is a
type error, not a runtime check*. **Read-only and additive**: it reads git, reads the report files, runs the
existing suites, and imports existing source constants. It touches **no** scoring, seam, token, mint, or gate,
and writes nothing to the factory. **No UI rendering in M2.**

---

## 1. Where it lives

**Recommendation: a new top-level subsystem `src/read-plane/`**, not a workspace package (yet).

```
src/read-plane/
  contracts/        # zod schemas + inferred types (the "@ece/factory-contracts" surface)
  report-parser/    # markdown → typed HarvestReport
  adapters/         # GitAdapter, ReportAdapter, LawAdapter, TestAdapter, CapabilityAdapter, StoreAdapter(absent)
  state-api/        # the read-only HTTP handlers + provenance wrapping
```

Why not a real `@ece/factory-contracts` workspace package now: the repo is a **single package** (no `workspaces`),
so introducing a monorepo/workspace is a build-tooling change that M2 doesn't need. `src/read-plane/contracts/` is
the importable contracts surface; promoting it to a published package is a later, separate step. **New dependency:
`zod`** (additive, runtime — the one new dep M2 introduces). The future UI app imports the compiled contracts.

**Layer position:** the read plane sits *above* the six layers as a **read-only consumer** — it imports **types
and constants** from the layers (never their write/mint paths) and never re-exports capability. It is outside the
`layer-3`/`layer-6` write-scan and the `layer-boundaries` law (which govern the layers themselves); Rule 0 (§5)
adds its own freeze that the read plane imports no mint/gate/write symbol.

---

## 2. The contracts package — Provenance is load-bearing

### 2.1 The crux: `Provenanced<T>` makes Rule 0 structural

Every operational value the API returns is wrapped so that **you cannot express a present value without present
provenance**, and **absence is explicit and reasoned** (never a fabricated record):

```ts
// Provenance — WHERE a value came from. `source: 'absent'` is the ONLY provenance a null value may carry.
const PresentProvenance = z.object({
  source: z.enum(['git', 'report-file', 'test-run', 'source-constant', 'derived']),
  locator: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('path'), path: z.string() }),          // report-file
    z.object({ kind: z.literal('cmd'),  cmd: z.string() }),           // git / test-run
    z.object({ kind: z.literal('module'), module: z.string(), export: z.string() }), // source-constant
  ]),
  pin: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('commit'), commit: z.string() }),      // git HEAD the value is pinned to
    z.object({ kind: z.literal('hash'),   sha256: z.string() }),      // content hash (report files)
    z.object({ kind: z.literal('none') }),                            // source-constant read at import
  ]),
  readAt: z.string().datetime(),
});
const AbsentProvenance = z.object({
  source: z.literal('absent'),
  reason: z.string(),                 // WHY there is no value — e.g. "approvals store lands in M3"
  readAt: z.string().datetime(),
});

// Provenanced<T>: present ⇒ real value + present provenance; absent ⇒ null + absent provenance + reason.
const provenanced = <T extends z.ZodTypeAny>(inner: T) => z.discriminatedUnion('status', [
  z.object({ status: z.literal('present'), value: inner,        provenance: PresentProvenance }),
  z.object({ status: z.literal('absent'),  value: z.null(),     provenance: AbsentProvenance }),
]);
```

- **Type-error, not runtime check.** A read object's operational fields are declared `provenanced(z.string())`,
  not `z.string()`. A raw value fails to typecheck *and* fails schema validation. There is no code path that
  yields a bare status string. (§5 adds a source-inspection test that no contract field is a bare status enum.)
- **Honest absence.** M3-only state (approvals/audit/executions) is `status:'absent'` with a `reason` — a typed
  "we don't know yet," never a mocked record (§6).
- **Provenance is stamped only at the adapter boundary** — the one place that actually read the source — so it
  cannot be forged downstream.

### 2.2 The read objects (zod schemas → inferred TS types)

| Schema | Key fields (each operational field `provenanced(...)`) |
|---|---|
| `GitState` | `head` (commit), `branch`, `dirty` (bool), `recent` (log entries: sha/subject/author/iso) |
| `Provenance` | as §2.1 (Present \| Absent) — exported for the UI |
| `HarvestReport` | `domain`, `generatedAtIso`, `productMode`, `subDomains: SubDomainResult[]`, plus §3 sections |
| `SubDomainResult` | `key`, `title`, `query`, `decision` (badge), `spine: Candidate\|null`, `candidates: Candidate[]`, `unmeasured: string[]`, `humanRequired: string[]`, `evidence: string[]` |
| `Candidate` | `identity {host,owner,name}`, `repoUrl`, `license {detected,decision,disagreement}`, `eligibility`, `score {total,band}`, `dimensions: DimensionSignal[]` |
| `DimensionSignal` | `dimension`, `value`, `confidence` (badge), `delta` (number) — the facts/measured/judgment/unknown split (§3) |
| `Run` | a harvest run descriptor: `domain`, `productMode`, `reportPath`, `generatedAtIso`, `status` |
| `LawTestRun` | `suite`, `prohibitions: {id,title,status}[]` (4a…4k, boundaries), `passed`, `failed`, pinned to HEAD |
| `TestSuiteRun` | `total`, `passed`, `failed`, `skipped`, `failing: {file,name}[]`, `dirty`, pinned to HEAD |
| `CapabilityState` | `sandboxJailPrefix`, `toolClasses`, `writeTools`, `seamTools`, `confirmToken`, `mintPrivacy` (badge+proof) |

**Badge unions (zod enums, shared with the UI):**
- `decision`: `'FORK' | 'EXTEND' | 'BUILD' | 'NEEDS-ASSESSMENT'`
- `evidence`/confidence: `'measured' | 'partial' | 'not-mechanizable'`
- `law`: `'pass' | 'fail' | 'skipped'`
- `capability`: `'enabled' | 'disabled' | 'gated' | 'absent'`

The API returns a `FactoryStateEnvelope<T> = { data: T, meta: { apiVersion, head, generatedAt } }` where `T`'s
operational fields are `Provenanced`. Envelope `meta.head` pins the whole response to a commit.

---

## 3. The harvest-report parser

Parses the committed `docs/HARVEST_REPORT_*.md` into typed `HarvestReport` objects. The report grammar is stable
(produced by `harvest-orchestrator.renderMarkdown`); the parser reads these anchors:

- `# Harvest Report — <domain>` and `**Product mode:** <MODE>` (the Stage-2 stamp; sovereign reports predate it
  ⇒ parser defaults `productMode:'sovereign'` with provenance noting the field was absent-in-file).
- `## 1. Sub-domain decomposition & decisions` → the summary table + per-sub-domain blocks:
  - `### <Title>  —  decision: **<VERDICT>**` · `_Query:_ \`...\``
  - `- spine: <owner>/<name> — real score <T>/100, band "<band>" (<M>/6 dims measured, coverage <C>%)`
  - decision-evidence bullets, incl. `- unmeasured at decision: <dims>` and `HUMAN APPROVAL REQUIRED: …` lines
  - candidate table rows: `| [owner/name](url) | <license> · "<detected>" | <decision> | <eligibility> | <T>/100 | <band> | <per-dim signals> |`
  - per-dim signal cell: `maintainability=maintainable(meas,+7) · architecture=good(meas,+11) · air-gap=partial(part,+0) · white-label=unknown(n/m,+0)` → `{dimension, value, confidence: meas→measured/part→partial/n-m→not-mechanizable, delta}`.

### 3.1 Facts / measured signals / judgments / unknowns / human-required — the report already separates these

The parser buckets each candidate's evidence so the UI can render the glass-box honestly:

| Bucket | Parsed from | Meaning |
|---|---|---|
| **Facts** | license (detected + decision + `⚠︎hint≠file` disagreement), identity/url, eligibility | objective observations of the repo |
| **Measured signals** | dims tagged `(meas,+N)` | real fetched evidence, full-weight |
| **Judgments (bounded)** | dims tagged `(part,+N)` | partial/bounded signal — contributes weakly |
| **Unknowns** | dims tagged `(n/m,+0)` + the `unmeasured at decision:` line | deny-by-default; not mechanizable |
| **Human-required** | `HUMAN APPROVAL REQUIRED: …` lines (air-gap / white-label / multi-tenancy) | needs a human before FORK |

This maps 1:1 to the scout's confidence contract (`measured/partial/not-mechanizable`) and the seam gates.

### 3.2 Golden round-trip (the acceptance test)

The parser is golden-tested against the **actual committed files** — the five EXTEND verdicts must parse out
exactly (score, band, spine, decision):

| Domain | Sub-domain | Spine | Score | Band | Decision |
|---|---|---|---|---|---|
| IAM | Authorization & Policy (RBAC/ABAC) | abhishekayu/react-access-engine | 78.5 | acceptable | EXTEND |
| IAM | OAuth2 / OIDC Token Services | JohnBasrai/tokn | 70.8 | acceptable | EXTEND |
| HR & Payroll | Time, Attendance & Leave | arkhitech/redmine_leaves | 70.8 | acceptable | EXTEND |
| HR & Payroll | Recruitment & ATS | chamals3n4/OpenATS | 75.4 | acceptable | EXTEND |
| HR & Payroll | Onboarding & Performance | Bitnoise/dutyduke | 70.8 | acceptable | EXTEND |

Plus the non-EXTEND verdicts (BUILD / NEEDS-ASSESSMENT) and the Legal report parse without loss. **Parser
discipline:** it never *computes* a score — it reads the number the report states, and stamps provenance
`{source:'report-file', path, sha256(file), readAt}`. If a report's stated total doesn't match its own candidate
row, the parser flags a `parse-inconsistency` rather than silently reconciling (honest, no fabrication).

---

## 4. The Factory State API — adapters + provenance attachment

A local, read-only Node service (framework-light: a small handler map; no DB, no auth in M2 — localhost read
plane). **Each adapter is the sole place provenance is stamped**, because it is the thing that read the source.

| Adapter | Reads | Provenance it stamps |
|---|---|---|
| **GitAdapter** | real `git log`/`status`/`rev-parse`/`show` (child_process, read-only) | `source:'git'`, `locator.cmd`, `pin.commit = HEAD`, `readAt` |
| **ReportAdapter** | the §3 parser over `docs/HARVEST_REPORT_*.md` | `source:'report-file'`, `locator.path`, `pin.sha256`, `readAt` |
| **LawAdapter** | runs/reads `write-asks-read-first.test.ts` + `layer-boundaries.test.ts`, extracts per-Prohibition pass/fail | `source:'test-run'`, `locator.cmd`, `pin.commit = HEAD` (+ `dirty` flag), `readAt` |
| **TestAdapter** | runs `vitest run --reporter=json`, summarizes | `source:'test-run'`, `cmd`, `pin.commit`, `readAt` — **reports the 12 pre-existing db-* failures honestly**, never hides them |
| **CapabilityAdapter** | **imports** real source constants — `JAIL_PREFIX` (filesystem-executor.ts:53), `SANDBOX_PATH_PREFIX`, `TOOL_CLASSES`, `EXECUTE_CONFIRM_TOKEN`, the write/seam tool names | `source:'source-constant'`, `locator.module+export`, `pin.none`, `readAt`. **Never restates a literal.** |
| **StoreAdapter** | **nothing — M3** (approvals/audit/executions stores don't exist) | returns `status:'absent'`, `source:'absent'`, `reason:'store lands in M3'` (§6) |

**Endpoints** (all `GET`, all return `FactoryStateEnvelope<T>`):

```
GET /state/git            → GitState
GET /state/reports        → Run[]              (list of parsed report descriptors)
GET /state/reports/:domain→ HarvestReport      (full parsed report)
GET /state/laws           → LawTestRun         (Prohibitions 3,1,4a…4k + boundaries)
GET /state/tests          → TestSuiteRun       (full-suite summary, honest failures)
GET /state/capabilities   → CapabilityState    (imported constants, mint-privacy = 'gated')
GET /state/stores         → StoreState         (honest ABSENT — approvals/audit/executions, M3)
GET /healthz              → { ok, head, apiVersion }
```

**How provenance attaches:** an adapter returns `Provenanced<T>` values directly; the state-api layer only
composes them into the envelope and serializes — it has no path to inject a value without the adapter's
provenance. The envelope `meta.head` is stamped once from `GitAdapter`. Test/Law runs may be **cached** keyed by
HEAD commit (re-run on a new HEAD); a dirty tree is surfaced in provenance so a reader never mistakes a
working-tree run for a committed one.

---

## 5. Rule 0 enforcement — the read plane cannot fabricate operational state

A **UI-law-style test** (new file, e.g. `src/read-plane/read-plane.law.test.ts`) freezes:

1. **No status without a provenance source (structural).** Source-inspection of `contracts/`: every operational
   field is `provenanced(...)` — assert there is no bare `status:`/`total:`/`decision:` field typed as a raw
   enum/number in a read object (they must be wrapped). Plus a **runtime** pass: hit every endpoint, `zod.parse`
   the response against its contract, and assert every leaf operational field is a `Provenanced` union member
   whose `present` branch carries a `source ∈ {git,report-file,test-run,source-constant,derived}` (never a
   value with a missing/`absent` provenance while `status:'present'`).
2. **Capability constant does not drift.** `import { JAIL_PREFIX } from '…/filesystem-executor.js'` in the test,
   and assert `CapabilityAdapter.capabilityState().sandboxJailPrefix.value === JAIL_PREFIX`. **Plus** source-
   inspection that `capability-adapter.ts` imports `JAIL_PREFIX` (and the other constants) and contains **no
   hardcoded `'/tmp/ece-dryrun-'` literal** — so the value is *derived from source*, never restated, and cannot
   silently drift. (If the executor changes the constant, the adapter follows automatically; if someone hardcodes
   it, the source test fails.)
3. **The read plane holds no write/mint/gate power.** Source-inspection (mirrors the Prohibition style): no file
   under `src/read-plane/` imports `mintConsumedApproval`/`APPROVAL_BRAND`, the ClassDispatcher's execute path,
   `executeFilesystemPlan`, `node:fs` **write** calls, or any gate `resolve`/`consume`. It reads git, reads
   files, runs the existing suites, imports constants — nothing more.
4. **Honest absence is typed.** Assert `GET /state/stores` returns `status:'absent'` with a non-empty `reason`
   and `value:null` — never a fabricated approval/audit/execution record.

Plain terms: *the read plane can only echo what it actually read (git, report files, test runs, source
constants), each stamped with where it came from; it cannot state an operational status it did not read, and it
cannot restate a capability constant instead of importing it.*

---

## 6. Scope boundary — read-only, additive, StoreAdapter out of scope

- **Read-only + additive.** M2 adds `src/read-plane/` + the `zod` dep. It reads git, reads `docs/HARVEST_REPORT_*.md`,
  runs the **existing** suites, and imports **existing** constants. It performs **no** factory writes, and touches
  **no** scoring, seam, token, mint, or gate code. All gated/byte-identical code (5c8cc53, 834a7b6, the mode
  switch, Prohibitions 4a–4k) is untouched and unread-for-execution.
- **StoreAdapter explicitly out of scope (M3).** The approvals/audit/executions stores do not exist yet. The API
  returns **honest `absent`** for them (`source:'absent'`, `reason`), never mocked records. When M3 lands those
  stores, `StoreAdapter` becomes a real adapter and the `absent` branches flip to `present` with real provenance
  — no contract change required (the `Provenanced` union already models both).
- **The one new dependency** is `zod`. The one new runtime behaviour is spawning read-only `git` commands and the
  existing `vitest` runner (both side-effect-free w.r.t. the factory).

---

## 7. Test plan

| Test | File | Kind | Proves |
|---|---|---|---|
| golden report round-trip | `report-parser/report-parser.test.ts` | golden | the 5 EXTEND verdicts (+ BUILD/NEEDS-ASSESSMENT, Legal) parse out exactly from the real files |
| parser buckets | `report-parser/report-parser.test.ts` | unit | facts/measured/judgment/unknown/human-required split matches the report's `(meas\|part\|n/m)` + human-required lines |
| parse-inconsistency | `report-parser/report-parser.test.ts` | unit | a stated total that contradicts its row is flagged, not reconciled |
| contract schemas | `contracts/contracts.test.ts` | unit | zod round-trips each read object; a bare (un-provenanced) value fails validation |
| Rule 0 — no status w/o provenance | `read-plane.law.test.ts` | source + runtime | §5.1 |
| Rule 0 — capability no-drift | `read-plane.law.test.ts` | source + runtime | §5.2 (`===` the imported `JAIL_PREFIX`; no hardcoded literal) |
| Rule 0 — no write/mint/gate | `read-plane.law.test.ts` | source-inspection | §5.3 |
| honest absence | `read-plane.law.test.ts` | runtime | §5.4 (`/state/stores` ⇒ typed absent + reason) |
| adapters | `adapters/*.test.ts` | unit | Git/Report/Law/Test/Capability each stamp correct provenance; TestAdapter reports the 12 db-* failures honestly |
| endpoints | `state-api/state-api.test.ts` | integration | each endpoint returns a valid `FactoryStateEnvelope`, `meta.head` = real HEAD |

---

## 8. Ratified (was: open items) — all four settled

1. **This M2 spec is authoritative.** The masterbuild plan (`docs/UI_MASTERBUILD_PLAN_TIER0.md`) will be committed
   separately by the human — implementation does NOT block on it.
2. **Location: `src/read-plane/`** — no workspace/monorepo. Promote to a package later only if the UI needs
   cross-repo reuse.
3. **`zod`** is the one new dependency.
4. **HEAD-keyed test/law caching** — Law/Test results cache keyed by HEAD commit; a dirty working tree is
   surfaced in provenance so a reader never mistakes a working-tree run for a committed one.

On implementation, the first prompt writes the failing Rule-0 law test + the contracts skeleton, then the parser
(golden-first), then the adapters + API — per the dual-Claude loop.
