# DESIGN — M4: Command Center + Approvals Console

**Status:** DESIGN — **APPROVED (design-only)**. No UI code exists yet. Design + test plan only; build proceeds step-by-step on separate approval.
**Milestone:** M4 (masterbuild `docs/UI_MASTERBUILD_PLAN_TIER0.md`, Phase 3 — the first pixels).
**Companion truth:** the M2 read plane (`src/read-plane/`) and the M3 stores (`factory-state/*.jsonl`) this console renders.
**Ground at design time:** `origin/main` = `ea2deb9`, tree clean.

**Governing rule (Rule 0, restated for the UI):** the console may not display factory state — a commit, a status, a hash, an approval, a law verdict, a write boundary — unless that value was **read from the provenanced Factory State API**. A hardcoded operational claim is a defect, not a style choice. This document's job is to make that rule *structural*: the console will be **incapable** of rendering unprovenanced state, and a test will prove it.

**The one non-negotiable:** the console **reads** the API. It holds **no write, mint, or gate path**. The single UI-initiated action class — approving at the gate — is **out of scope for M4** and, when it ships later, routes through the seam's real tool path, never a parallel UI route.

---

## 0. What M4 is, in one paragraph

A local, dark, sovereign command console — two live pages (Command Center, Approvals) inside a three-zone shell — that renders **only** real factory state pulled from the M2 State API, every value wearing its provenance. Command Center shows the repo's real HEAD/branch/dirty, the law and test status pinned to that HEAD, the real sandbox write boundary, recent commits as milestones, and a factory-flow strip whose stages light from real evidence (and show **locked**, honestly, where the machinery is unbuilt). Approvals renders the real committed `approvals.jsonl` — the FORK approval by `bitez`, the two-gate lifecycle — with the critical display **Transferable: No · Bound to exact plan hash: Yes · Consumed: Y/N**. Kill the API and every operational field flips to an explicit **unavailable**; nothing is ever shown cached-as-current.

---

## 1. Stack & where it lives

### 1.1 Recommendation

| Concern | Choice | Why this, not the alternative |
|---|---|---|
| UI framework | **React 19 + TypeScript (strict)** | Plan-aligned (B.1). The universal provenance Inspector is *one* component reused everywhere — React's composition + a single render primitive make the Rule-0 "one sanctioned path" enforceable. Testing story (below) is strongest here. |
| Build / dev server | **Vite 6** | Fast, ESM-native (matches `"type":"module"`), zero-config TS, trivial static build for the sovereign single-process serve. |
| Test runtime | **Vitest + @testing-library/react + jsdom** | The repo already runs Vitest — the UI law suite runs in the *same* `vitest run`, so `npm test` covers factory laws **and** console laws in one command (plan E.2 discipline). |
| Styling | **CSS custom properties (design tokens) + CSS Modules** | Semantic color/spacing live as tokens; components never hand-pick a hex. This makes "no hardcoded status color" a lint, not a hope. No Tailwind (utility sprawl fights the centralized-token honesty argument). |
| Data fetching | **A minimal typed client + a small `useEnvelope` hook** — *not* TanStack Query | Deliberate: a caching library retains last-good data, which fights the "kill the API → no cached-as-current" contract (M3.1). Our hook has three explicit states — `loading` / `unavailable` / `present` — and **never** serves a stale operational value on error. Honesty over convenience. |
| Fonts | **Self-hosted, bundled** (no CDN) | Sovereignty: no external calls, ever. Faces named in §5; all OFL. |

### 1.2 Where it lives — and the hard client/server boundary

```
src/console/
  index.html
  vite.config.ts                 # dev proxy /state/* → API host; build → static
  client/                        # BROWSER bundle — no node, no fs, no git, GET-only
    main.tsx  app.tsx
    shell/                       # Sidebar · Workspace · Inspector (the three zones)
    pages/command-center/
    pages/approvals/
    primitives/                  # Operational, ProvenanceStamp, StatusChip, Unavailable
    data/state-client.ts         # typed GET client; zod-validates every envelope
    tokens.css  type.css
  server/                        # NODE host — the ONLY place that touches the read plane
    serve.ts                     # thin http wrapper: mounts createStateApi + SSE watcher
  console.law.test.tsx           # Rule 0 (console) — the UI law suite
```

**The boundary is the safety argument.** `client/` is the browser bundle; it may import **only** the pure contract schemas (`src/read-plane/contracts/` — zod + plain objects, no node) and speak **HTTP GET** to `/state/*`. It may **not** import a node builtin, a read-plane *adapter*, or any `src/layer-*` module. `server/` is the only code that touches git/fs/vitest/source-constants, and it does so **exclusively** by calling the existing `createStateApi().handle(path)` — unchanged. This mirrors the read plane's own separation: the browser holds no write/gate/mint/fs power *by construction*, and a test (0c.4) enforces it.

### 1.3 How it talks to the API

The State API today is an **in-process router** (`createStateApi().handle('/state/git')`) — it has no HTTP listener. M4 adds a **thin HTTP host** (`server/serve.ts`) that mounts that router over `localhost`:

```
Browser (client/)  ──GET /state/git ────►  server/serve.ts  ──►  createStateApi().handle('/state/git')
                   ◄── {data, meta} ───────                       (existing read plane — UNCHANGED)
```

M4 is a **static render**: the client fetches on load and on a manual refresh; there is **no live watcher/SSE in M4** (deferred to M5+, ruling §10.2). Getting the honest static render right — including the kill→`unavailable` behavior — comes first.

- **Dev:** `vite` serves `client/` on one port; `serve.ts` runs the API on another; Vite proxies `/state/*`. HMR for the UI, live API for truth.
- **Operator/prod:** `vite build` → static assets served *by the same* `serve.ts` — one sovereign process on `localhost`, no cloud, no telemetry.
- **The client's only verb is GET.** `serve.ts` exposes no POST/PUT/DELETE. There is no route through which the console could write, approve, mint, or execute. (Enforced: 0c.3.)

`server/serve.ts` is **additive** — a new file that *composes* the read plane; it modifies no existing read-plane file (sha-verified in the build order). It is intentionally placed under `src/console/` (not `src/read-plane/`) to keep the read-plane directory byte-identical and the "console reads the API" separation literal.

### 1.4 The one read-plane addition M4 requires — flagged for approval

The Approvals page must render the **full approval records** (approver, reason, `boundIntentHash`, timestamps, per-event lifecycle). But the existing `/state/stores` returns only `StoreSnapshot {count, latest}` — a summary, not the record list. So M4 needs **one additive read-plane endpoint**:

- New adapter `src/read-plane/adapters/approvals-adapter.ts` — `approvalsLog({root?, now?})`, **mirroring `evidence-adapter.ts` exactly**: read `approvals.jsonl` via the read-only record reader, `safeParse` each line against a new read-view schema `ApprovalRecordSchema` (drop malformed, never fabricate), stamp `store-file` provenance, pin by the tip hash.
- New route `/state/approvals` in `state-api.ts` (one line, same shape as `/state/evidence`).
- New contract `ApprovalRecordSchema` in `contracts/read-objects.ts` (a light read-view mirror of the payloads — `event, actionId, tool, approver?, reason?, approvalId?, boundIntentHash?, atIso`).

**This is the only place M4 touches read-plane territory, and it is purely additive and read-only** — the same pattern already sanctioned for `evidence-adapter` in M3. Existing read-plane files stay byte-identical (proven by sha in the build order). *Because it edges the read plane, I'm surfacing it here for explicit approval rather than folding it silently into the console work.* If the reviewer prefers, the Command Center–only slice of M4 can ship first (it needs no new endpoint), with `/state/approvals` gated as its own sub-step.

### 1.5 Dependencies & the license gate

New deps: `react`, `react-dom`, `vite`, `@vitejs/plugin-react`, `@testing-library/react`, `@testing-library/jest-dom`, `jsdom`; bundled fonts (Archivo, IBM Plex Sans, IBM Plex Mono). *(No `chokidar` in M4 — the SSE watcher is deferred to M5+, ruling §10.2.)* All are permissive (MIT / OFL). **Per governance, licenses are verified live from each LICENSE file before install** — that check is a gate inside build-order step 1, output pasted into the step evidence. New `package.json` scripts (additive): `console:dev`, `console:api`, `console:build`, `console:serve`.

---

## 2. The shell — three zones

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│  ECE · SOVEREIGN COMMAND CONSOLE            ea2deb9 · main · clean      ◐ live            │ top status bar
├──────────────┬───────────────────────────────────────────────────────┬───────────────────┤
│ L1  LAW      │                                                        │  INSPECTOR        │
│ L2  COMMAND  │                 CENTER WORKSPACE                       │  ───────────────  │
│ L3  HARVEST  │        (Command Center  or  Approvals)                 │  what it is       │
│ L4  BUILD    │                                                        │  status  ● chip   │
│ L5  ACTION   │                                                        │  ─ provenance ─   │
│ L6  INTEL    │                                                        │  source  store    │
│ ············ │                                                        │  locator …jsonl   │
│ ▸ Command    │                                                        │  pin  #80d7eb34   │
│ ▸ Approvals  │                                                        │  read 12:04:22Z   │
│ · Harvest 🔒 │                                                        │  ─ actions ─      │
│ · Build   🔒 │                                                        │  Approve — n/a    │
│ · Audit   🔒 │                                                        │   (M4 read-only;  │
│ · Evidence🔒 │                                                        │    routes via gate│
│ · Law     🔒 │                                                        │    later)         │
└──────────────┴───────────────────────────────────────────────────────┴───────────────────┘
```

### 2.1 Left rail — the six layers are *truth*, not decoration

The rail's top block is the factory's own six layers (L1 law → L6 venture-intel) — the real architecture of the repo (`src/layer-1-law` … `src/layer-6-venture-intel`). It is a structural device that **encodes something true** (the plan's "structure is information"), not ornamental numbering. Below a divider sit the **nav destinations**: the two live pages (Command Center, Approvals) and the **honestly-locked** future pages (Harvest, Build, Audit, Evidence, Law) — rendered dim with a lock glyph and, on hover/click, an Inspector note stating *why* they're locked and *which* milestone unlocks them (sourced from the plan, not invented status).

### 2.2 Right Inspector — the universal provenance component (built once, reused everywhere)

The Inspector is the heart of the design and the reason Rule 0 holds visually. It is a **pure function of one selected object**. Click any object anywhere — a Command Center field, an approval record, a milestone, a flow stage — and it renders four blocks:

1. **Identity** — *what it is*: a typed label + short id (e.g. "Approval record · apr_1", "Git HEAD", "Law: Prohibition 4l").
2. **Status** — one semantic chip (verified / pending-review / violation / active / locked / **unavailable**).
3. **Provenance** — rendered straight from the object's own `Provenanced<T>` (no invention):
   - `source` — git · report-file · test-run · source-constant · store-file · **absent**
   - `locator` — the `path` / `cmd` / `module::export` it was read from (monospace)
   - `pin` — `commit <sha>` · `sha256 <hash>` · `none` (monospace, source-tinted)
   - `readAt` — ISO timestamp
   - When the value is **absent**, this block shows `source: absent` + the **reason** — an honest "we don't know yet / the API is down," never a blank.
4. **Actions** — allowed vs forbidden. **In M4 every write-class action is forbidden here**, and the Inspector says so plainly: *"Approve — not available in this console (M4 is read-only). Approving routes through the DecisionConsole seat and the real gate."* This encodes plan non-negotiable #4 in the UI itself.

**Feeding model.** Every page emits a small typed union of `Inspectable` objects, each of which *carries its own `Provenanced` provenance*. The Inspector renders what the object already carries — it performs no read of its own, holds no adapter, and cannot manufacture a source. That is what makes it safe to reuse on every page: it is incapable of adding provenance that wasn't there.

---

## 3. Command Center — real state only

Every panel below is fed by a named adapter through the `<Operational>` primitive (§6.1). No field has a hardcoded value.

| Panel | Field(s) | Adapter → route | Provenance shown |
|---|---|---|---|
| **Repo** | HEAD, branch, dirty | GitAdapter → `/state/git` | source `git`, pin `commit <HEAD>` |
| **Milestones** | recent commits (as factory milestones) | GitAdapter → `/state/git` `.recent` | source `git`, each pinned to its commit |
| **Tests** | total / passed / failed + timestamp | TestAdapter → `/state/tests` | source `test-run`, pin `commit <HEAD>` |
| **Law** | Prohibitions 4a…4l pass/fail, pinned to HEAD | LawAdapter → `/state/laws` | source `test-run`, pin `commit <HEAD>` |
| **Write boundary** | the real `JAIL_PREFIX`, seam/write tool names, mint = *gated* | CapabilityAdapter → `/state/capabilities` | source `source-constant`, `module::export` |

### 3.1 The hero — the factory-flow strip (harvest → approval → build → execute)

The most characteristic thing in this subject's world is not a metric — it's the **gated pipeline**. So the Command Center hero is a horizontal flow of the factory's stages, each stage lit from **real evidence**, with the **gates** drawn between them:

```
  HARVEST ──▣gate──► APPROVAL ──▣gate──► BUILD ──▣gate──► EXECUTE          … HARDEN 🔒
  ● reports:4         ● approvals: 5      ● plan: 1       ● written: 1        (machinery
  (report-file)       (store-file)        (store-file)    (store-file)         unbuilt)
```

- **Stage status is derived, provenanced, and honest.** Harvest = active because `/state/reports` lists real reports. Approval = active because `/state/stores.approvals.count > 0`. Build/Execute = active because `plan-created` / execution records exist. A stage whose machinery is **unbuilt** (e.g. Hardening & Packaging, GitHub live push) renders **locked** — dim, lock glyph, and an Inspector note naming the blocking milestone. No stage is ever faked green.
- Each stage and each gate is an `Inspectable`; clicking a gate shows its provenance (which store/evidence proves it) and, for locked stages, the honest reason.

### 3.2 Cold open & the unplug behavior

- **Cold open (load / refresh):** on page load (and manual refresh) fields resolve from a dim skeleton (`unknown`) to their provenanced value as envelopes arrive — a calm, staggered reveal (§5.4), so you *see* the console reading truth. No live push in M4 (§10.2).
- **Unplug (M3.1):** kill `serve.ts` (or it returns errors) → `useEnvelope` yields `unavailable` for each route → **every** operational slot renders the explicit **Unavailable** state (red-hollow stamp + reason), and **zero** show a prior value. This is structural, not disciplined: `<Operational>` has no cache and is a pure function of the current prop; there is no last-good value to leak. Proven by test 0c.6.

---

## 4. Approvals — the real M3 store

The committed `approvals.jsonl` holds **5 real records** for one `actionId` (`act_1`) across two tools — this page renders that history, grouped into **approval lifecycles**:

| Lifecycle | Events (real) | Tab | Critical display |
|---|---|---|---|
| **FORK decision** (medusajs/medusa, subscription) | requested → approved (`bitez`, *"approve subscription FORK…"*) → **consumed** (`apr_1`, `boundIntentHash 80d7eb34`) | **Consumed** | Transferable: **No** · Bound to exact plan hash: **Yes** (`80d7eb34`) · Consumed: **Yes** |
| **Sandbox scaffold write** | requested → approved (`bitez`, *"approve sandbox scaffold write"*) | **Approved** | Transferable: **No** · Bound: — (no consume record yet) · Consumed: **No** |

- **Tabs = pending / approved / consumed**, populated from real data: **1 consumed**, **1 approved-not-consumed**, **0 pending**. The pending tab shows an honest empty state ("No approvals awaiting a decision") — an empty store is truth, never a placeholder row.
- **The critical triad, and where each leg's provenance comes from** (so even these three words obey Rule 0):
  - **Transferable: No** — a structural invariant of the token type, sourced as `source-constant`: the gate mints **bound, non-transferable** `ConsumedApproval`s (Prohibitions 4a / 4i / 4k, via CapabilityAdapter's `mintPrivacy` proof). Not asserted per-record; cited to its constant.
  - **Bound to exact plan hash: Yes** — sourced `store-file`: the `boundIntentHash` (`80d7eb34`) present in the consumed record. If absent, the field reads "—", not "Yes."
  - **Consumed: Y/N** — sourced `store-file`: whether a `consumed` event exists for this `approvalId`.
- **Read-only in M4 (deliberate deviation from plan Phase 3).** The plan's M3.4 bundled an *approve-through-the-console* action; **M4 defers it**. This page **displays** approvals; it performs none. When the approve action ships (a later milestone) it will route through the seam's real `approve_build_decision` tool path and the real gate — never a UI shortcut. The Inspector states this on every approval object.

Data source: the additive `/state/approvals` endpoint (§1.4). Each record is an `Inspectable` carrying `store-file` provenance pinned to the store's tip hash.

---

## 5. Visual system

The spec (§3) pins the palette *semantics* and the monospace-for-machine-values rule. Where it pins direction, I follow it; where it leaves an axis free (typefaces, layout character, the signature), I make a deliberate choice for **this** brief — a sovereign instrument panel for a governed factory, closer to a glass-cockpit / control-room than a SaaS dashboard.

### 5.1 Palette (near-black / graphite + coded semantic accents)

| Token | Hex | Meaning |
|---|---|---|
| `--ink` | `#0A0C10` | page (near-black) |
| `--graphite` | `#12161C` | panels |
| `--graphite-raised` | `#191F27` | cards, raised surfaces |
| `--edge` / `--edge-strong` | `#262E38` / `#38424E` | hairlines, borders |
| `--text` / `--text-dim` / `--text-faint` | `#E7ECF2` / `#93A0AF` / `#5C6875` | text ramp |
| `--active` (cyan) | `#35D6C4` | live · selected · links · the connected pulse |
| `--authority` (gold) | `#D9A94C` | gates · human-required · authority |
| `--violation` (red) | `#EF5350` | violation · discrepancy · absent-when-expected |
| `--review` (amber) | `#E08A2B` | pending · under review |
| `--verified` (green) | `#45C98A` | passed · verified · present-truth |

Colors are **semantic tokens** (`--status-verified`, `--status-violation`, …), never raw hex in a component — so a status color can't be hand-picked, and the "no ad-hoc status color" check is a lint. The cyan/green split is meaningful: **cyan = active/interactive/live-connection**, **green = verified/present-truth**.

### 5.2 Type — a deliberate, non-default pairing

| Role | Face | Use |
|---|---|---|
| Display / authority | **Archivo Expanded** (600/700) | wordmark, the six-layer rail labels, page titles — the control-room "signage" voice, used with restraint |
| Body / UI | **IBM Plex Sans** (400/500/600) | labels, prose, controls |
| Machine values | **IBM Plex Mono** (400/500) | **every** hash, path, commit, sha, timestamp, score, `module::export` |

The Plex family is IBM's institutional type — engineered, governed, sovereign in feel; Archivo Expanded gives the authority moments a distinct marquee character without reaching for the warm-serif cliché. All OFL, **bundled locally** (no CDN — sovereignty). Scale is a compact instrument scale (11 caption · 13 body · 15 emphasis · 20/28/40 headings), dense and calm.

### 5.3 Signature — *everything wears its source*

The one memorable element, and it embodies the brief: **the provenance stamp**. Every operational value on screen carries a small monospace source-tag —

```
◆ git @ea2deb9      ▤ store approvals.jsonl#80d7eb34      ◇ const filesystem-executor::JAIL_PREFIX
⟳ test @ea2deb9     ▤ file …/HARVEST_REPORT_IAM.md#<sha7>      ∅ unavailable — API not reachable
```

— and clicking any value **blooms** it into the full Inspector lineage. Most dashboards hide provenance; this console makes it the visible skin. That is the justified aesthetic risk: **the governance rule *is* the dominant visual texture** — you can see, at a glance, that every number came from somewhere, and exactly where. Kill the API and the stamps go red-hollow (`∅ unavailable`). A restrained supporting motif — the Approvals lifecycle drawn as a literal `prevHash → hash` chain (tamper-evident to the eye) — echoes it without competing for attention (boldness spent in one place).

### 5.4 Motion — calm, deliberate

Standard 180 ms ease-out; the one orchestrated moment is the cold-open resolve (fields fade unknown→value, 60 ms stagger); unavailable transitions cross-fade (220 ms), never flash. `prefers-reduced-motion` → instant, no exceptions.

### 5.5 Reviewed against the defaults

Current AI-design clusters around three looks; I checked mine against them. Warm-cream serif and dense broadsheet are simply *wrong* for a sovereign console — rejected outright. The third default — near-black + a single acid accent — is superficially adjacent, so I made the difference deliberate: this is near-black with a **coded multi-accent system where each color carries governance meaning** (verified/violation/review/authority/active), not one decorative accent. The accents are a status language, and the provenance-texture signature is the thing that makes the page unmistakably *this* factory's.

---

## 6. Rule 0 for the UI — how it's enforced (the part to scrutinize)

Rule 0 UI-side has **four legs**: one render primitive, a source-level law test, a runtime trace test, and the structural client/server boundary. Together: *no operational value reaches the screen except through a live provenanced API field.*

### 6.1 Leg 1 — the single render primitive

Every operational value is rendered through exactly one component:

```tsx
<Operational field={env.data.head} label="HEAD" />
// present → renders value + provenance stamp; click → Inspector
// absent  → renders the explicit Unavailable state + reason
```

`<Operational>` takes a `Provenanced<T>` and can render **only** what that prop carries. It has **no cache, no default, no fallback string**. There is no other sanctioned way to put a status/number/hash on screen. Raw operational string literals in components are forbidden (0c.2).

### 6.2 Leg 2 — the source-level law test (`console.law.test.tsx`)

Mirroring `read-plane.law.test.ts` and the Prohibition suite, it scans `client/` source:

- **0c.1** — the `<Operational>` primitive exists and is the only component that renders an operational value (source scan).
- **0c.2 — no hardcoded operational literals.** Deny-list scan over `client/**/*.tsx` (excluding `*.test.tsx`, token files, and type/enum defs): commit-like hex `\b[0-9a-f]{7,40}\b`, `'/tmp/ece-dryrun-'`, status words rendered as text (`PASS|FAIL|verified|dirty|FORK|EXTEND|consumed|approved|locked`), bare score numerals. **Zero hits.** *This is the "no hardcoded status strings" the brief names.*
- **0c.3 — no write/mint/gate/fs power in the client.** Deny-list: `mintConsumedApproval`, `APPROVAL_BRAND`, `approvalWrite`, `execute(`, `node:fs`, `node:child_process`, `fetch(...{method:'POST'|'PUT'|'DELETE'})`, imports from `src/layer-*` or `src/read-plane/adapters`. **Zero.** (The read-plane 0.2 analog.)
- **0c.4 — client imports only pure contracts.** No `client/` file imports a node builtin or an adapter; the only read-plane import allowed is `src/read-plane/contracts/` (pure zod). Structural proof the browser bundle holds no factory power.

### 6.3 Leg 3 — the runtime trace test (the strongest leg)

**0c.5 — every rendered operational value traces to an API field.** In test mode `<Operational>` tags its DOM node `data-operational` + `data-field` + `data-prov-source`. The test renders Command Center and Approvals against a **captured real envelope set** (fixtures generated from the *actual* `createStateApi` output — real, not mocked), then walks every `[data-operational]` node and asserts: its displayed text exists in the envelope payload for that field, **and** it carries a non-absent provenance — or else it shows the Unavailable state. **A rendered operational node with no backing provenance fails the test.** This is "every rendered value traces to an API field" made executable.

### 6.4 Leg 4 — the unplug test

**0c.6 — kill switch.** Render with the state client forced to error/empty; assert **every** operational slot shows `unavailable` and **none** shows a prior value (no cache leak). Verified twice: in Vitest, and manually against the preview by stopping `serve.ts` and observing an all-`unavailable` board.

### 6.5 The Discrepancy Detector — M4 stub (full graph is M7)

A client-side consistency check over the already-fetched envelopes (no separate crawl in M4):

- If Command Center cites a **commit** not present in `/state/git.recent` (and a cheap `/state/git` presence check can't find it) → **red banner**.
- If any displayed value claims `source: report-file` at a path not listed by `/state/reports` → **red banner**.
- On consistent envelopes it renders **nothing** — and *that is asserted*, not assumed (0c.7).
- **Chaos test (pre-echo of M7.2):** temporarily rename a committed report → the detector flags red within one watch cycle; restore → it clears.

The full evidence-lineage / walkable-graph detector is explicitly deferred to M7; the M4 stub only proves the mechanism catches a *shown-but-missing* artifact.

---

## 7. Scope & non-goals

**In M4:** the shell (three zones, six-layer rail, universal Inspector), Command Center, Approvals, the visual system, the four-leg Rule-0 enforcement + Detector stub, and the additive `/state/approvals` endpoint.

**Not in M4 (honest locks / later milestones):**
- Harvest, Build, Audit, Evidence, Law pages → **locked**, shown honestly with their unlocking milestone (Phases 4–6).
- **The approve action** (plan M3.4) → deferred. M4 Approvals is read-only. When it ships it routes through the real gate.
- Full evidence-lineage graph + full Discrepancy Detector → M7.
- The console **never** gains a second write path (plan non-negotiable #4). No mint, no gate, no execute, no direct store write.

---

## 8. Proposed build order (for the *next* gate — not now)

Each step stops and proves with a verification command; nothing merges on a claim.

| Step | Work | Proof / verification |
|---|---|---|
| **1** | Scaffold `src/console/{client,server}`, tokens/type, `<Operational>` + Inspector shell, typed `state-client`; license-verify deps live | boundary tests **0c.3/0c.4** green; app boots to an empty shell; deps' LICENSE files pasted into evidence |
| **2** | Additive read-plane endpoint `/state/approvals` (`approvals-adapter` + route + `ApprovalRecordSchema`) | adapter unit test + `/state/approvals` returns the **5 real records** provenanced; **existing read-plane files byte-identical (sha diff = none)**; read-plane law/adapters/state-api suites unchanged & green |
| **3** | Command Center: factory-flow hero + field↔adapter panels, all via `<Operational>` | **0c.5** trace test green; renders real HEAD `ea2deb9` / tests / laws / `JAIL_PREFIX` / milestones |
| **4** | Unplug behavior + Discrepancy Detector stub (static render; no SSE — §10.2) | **0c.6** unplug green; **0c.7** detector + chaos test green |
| **5** | Approvals page: lifecycle grouping, tabs, the critical triad w/ per-leg provenance, Inspector wiring | shows real FORK **consumed** (`apr_1`, `80d7eb34`) + **approved**-not-consumed scaffold + **empty** pending; **0c.5** extended green |
| **6** | Cold-open motion, reduced-motion, keyboard-first nav, responsive, honest locked pages → **commit** | full `console.law` suite green; a11y/focus pass; preview screenshot as the evidence artifact |

## 9. Test plan summary

| id | claim | kind | command |
|---|---|---|---|
| 0c.1 | `<Operational>` is the sole operational renderer | source-scan | `npx vitest run src/console/console.law.test.tsx` |
| 0c.2 | no hardcoded operational literals | source-scan | ″ |
| 0c.3 | client holds no write/mint/gate/fs path | source-scan | ″ |
| 0c.4 | client imports only pure contracts (no node/adapters) | source-scan | ″ |
| 0c.5 | every rendered operational value traces to an API field | render (real envelopes) | ″ |
| 0c.6 | kill API → all `unavailable`, zero cached-as-current | render (unplug) | ″ + manual preview |
| 0c.7 | Detector flags shown-but-missing; clean ⇒ silent | render + chaos | ″ + scripted rename |
| — | `/state/approvals` returns the 5 real records, provenanced | adapter/contract | `npx vitest run src/read-plane` |
| — | existing read-plane files byte-identical | sha diff | `git diff --stat src/read-plane` |

---

## 10. Reviewer rulings (resolved at approval)

1. **`/state/approvals` (§1.4) — APPROVED.** Ship the single additive, read-only endpoint as part of M4, mirroring `evidence-adapter`; existing read-plane files stay byte-identical (sha-verified in step 2).
2. **SSE live-update — DEFERRED to M5+.** M4 is a **static render** (fetch-on-load + manual refresh / poll). Get the honest static render right first; the chokidar→SSE watcher (plan M3.2) is not in M4. *(Reflected below: `server/serve.ts` mounts the API only — no watcher; step 4 drops SSE; §3.2 cold-open is load/refresh-driven.)*
3. **Read-only Approvals — CONFIRMED.** M4 Approvals only displays. The approve action (plan M3.4) is deferred and, when it ships, routes through the real gate — never a UI shortcut.
4. **Font bundling — APPROVED.** Self-host Archivo + IBM Plex (OFL) into the repo; sovereignty over a system default stack.

**No code is written yet.** On the build gate I proceed step 1 → prove → stop, per the loop.
```
