# MCP Inventory, Connection Map & Improvement Report

> **Evidence-only inspection** (no code/config/registration/tool/dependency change). Machine-true from the source tree, the migrations, and safe `claude mcp` inspection.
> **Repo:** `ece-factory` · **Date:** 2026-06-30 · **Full suite at report time:** 432/432 (last fresh-DB run, Phase 8.9).
> **Convention:** *live-wired* = the server composition injects the real adapter; *live-running* additionally needs a persistent DB + Claude Code registration (neither exists here). *fake-backed* = injected fake (no real side effect). *UNKNOWN* = not derivable from code.

---

## Part 1 — Factory MCP architecture inventory

| Component | File path | Purpose | Status | Evidence |
|---|---|---|---|---|
| Server entrypoint | `src/mcp-server/server.ts` | stdio JSON-RPC MCP server; env config; wires bridge + adapters; `main()` | **built** | `export async function main()`; `initialize`/`tools/list`/`tools/call` in `handleRpc` |
| Runner command | `package.json` → `mcp:server` | `node src/mcp-server/run.mjs` | **built** | scripts block |
| Runnable launcher | `src/mcp-server/run.mjs` + `ts-load.mjs` | dependency-free TS loader (Node 26 `registerHooks` + bundled `typescript`) | **built** | `registerHooks({resolve,load})` then `import('./server.ts')` |
| Transport | stdio, JSON-RPC 2.0 (newline-delimited) | standard Claude Code transport | **built** | `handleRpc` methods; no SDK dependency |
| Server core | `src/mcp-server/server-core.ts` | pure transport adapter; lists surface + routes by class; **no guard logic** | **built** | `McpServerCore.callTool` switch by `classifyRegisteredTool` |
| McpBridge | `src/features/mcp-bridge/mcp-bridge.ts` | the one guarded door (registry→dispatch→permission→kill→audit→redaction) | **built** | `class McpBridge` |
| Tool registry | `src/features/tool-registry/tool-registry.ts` + `createDefaultToolRegistry` + `register*Tools` | tool definitions, fail-closed lookup | **built** | `registerFactoryReadTools/DraftTools/WriteTools/ExternalTools/ForbiddenTools` |
| Classification source | `src/features/mcp-bridge/factory-read-tools.ts` → `classifyRegisteredTool` + `tool-classes.ts` | 4-class taxonomy + dispatch | **built** | `ToolClass`, `ClassDispatcher` |
| Approval token / gate | `src/features/mcp-bridge/tool-classes.ts` (`BridgeApprovalGate`, `ConsumedApproval`) over Module 17 Approval Gate | single-use, per-action, unforgeable token | **built** | branded symbol; `consumeApproval` |
| Audit integration | `src/features/audit-engine/{sequencer,postgres-sink}.ts` | write-ahead intent→result, hash-chain | **built / live-wired** | bridge constructs `WriteAheadSequencer(PostgresHashChainSink,…)` in `server.ts` |
| Redaction integration | `src/features/redaction-engine/redaction-engine.ts` | deny-by-default allowlist before return | **built / live-wired** | bridge `redactor`; `server.ts` allowlist |
| Refusal-audit | `src/features/audit-engine/sequencer.ts` (`appendRefusal`) | denied attempts recorded distinctly | **built** | refusal path in `runGuardedApprovedAction`/sequencer |
| External adapter boundary | `src/features/mcp-bridge/external-tools.ts` (`ExternalSystems` port) | injected external systems seam | **built; fake-backed** | `server.ts` injects `fakeExternalSystems()` |
| Fake/live selection point | `src/mcp-server/server.ts` (`buildServer`) | composition root choosing live vs fake per tier | **built** | `factoryPorts: LiveFactoryReadPorts`, `writeStores: LiveWriteStores`, `draftPorts: fakeDraftPorts()`, `externalSystems: fakeExternalSystems()` |
| Live read adapters | `src/mcp-server/live-read-adapters.ts` | real registries/sink/registry/docs read-only | **built / live-wired** | `LiveFactoryReadPorts` |
| Live internal-write adapters | `src/mcp-server/live-write-adapters.ts` | append-only INSERT to real tables | **built / live-wired** | `LiveWriteStores` → `review_log_entries`/`open_items`/`risk_register` |
| Settings dependency | `src/features/settings/` (Module 25) | governed config; guard-floor | **built** | not yet wired as bridge tools (engine ready) |
| Autopilot dependency | `src/features/autopilot/` (18) + `src/features/autopilot-scheduler/` (18b) | autonomous read+propose driver + clock | **built** | `AutopilotRunner`, `AutopilotScheduler`; not live-scheduled |

---

## Part 2 — Factory MCP tool surface

**Counts:** READ_ONLY **16** · DRAFT_ONLY **7** · APPROVAL_REQUIRED_WRITE-internal **6** · APPROVAL_REQUIRED_WRITE-external **6** · FORBIDDEN **6** (registered-and-refused, not exposed). **Exposed total = 35.** **Unknown/unclassified = 0 → CLEAN.**

### READ_ONLY (16) — backing **live-wired**, approval **no**, external side-effect **no**, audit **yes**, redaction **yes**
`search_clients` (system of record → `PostgresClientReadModel` → `clients`, SELECT-only) · `read_factory_status` · `read_wave_status` · `read_module_status` · `read_open_gates` · `read_review_log` · `read_evidence_pack` · `read_open_items` · `read_domain_registry` · `read_project_registry` · `read_feature_registry` · `read_risk_register` · `read_product_creation_plan` · `read_repo_build_plan` · `read_tool_registry` *(operator-permissioned)* · `read_audit_summary` *(operator-permissioned)*.
Internal: `LiveFactoryReadPorts` → real risk/domain/project stores, audit sink, tool registry, governance docs. *Open item: several governance reads are doc-file-backed (real files), not DB projections.*

### DRAFT_ONLY (7) — backing **fake-backed (in server)**, approval **no**, external side-effect **no**, audit **yes**, redaction **yes**
`draft_next_prompt` · `draft_review_decision` *(operator)* · `draft_wave_report` *(operator)* · `draft_product_plan` · `draft_risk_summary` · `draft_open_items_summary` · `draft_repo_plan`. Outcome literal `DRAFT-AWAITING-HUMAN-REVIEW`; structurally inert. In `server.ts` the draft *content* comes from `fakeDraftPorts()` (canned) — open item: wire to real proposal sources.

### APPROVAL_REQUIRED_WRITE — internal (6) — backing **live-wired** (append-only), approval **yes (token)**, external **no**, audit **yes (bracketed)**, redaction **yes**
`record_review_decision` → `review_log_entries` · `record_human_signoff` *(admin)* → `review_log_entries` · `create_open_item` → `open_items` · `record_approval_gate` → `review_log_entries` · `update_risk_status` → `risk_register` (append snapshot) · `record_wave_signoff` *(admin)* → `review_log_entries`. Store: `LiveWriteStores` via `ece_writer` (INSERT-only). WRITE-COMMITTED only via consumed token.

### APPROVAL_REQUIRED_WRITE — external (6) — backing **fake-backed**, approval **yes (token + 8.4 gauntlet)**, external side-effect **possible (not now)**, current live external side-effect **NONE**, audit **yes (blast-radius)**, redaction **yes**
`create_github_repo` *(admin)* · `open_pull_request` *(capability-gated — PR Engine sole authority, 8.8b)* · `create_ticket` · `update_crm_record` · `send_email` · `deploy_package` *(admin)*. All wired to `fakeExternalSystems()` — zero real calls. Open item: real adapters = separately-gated external-tier live wiring.

### FORBIDDEN (6) — backing **n/a**, never callable (refused even with a token)
`force_delete_repo` · `rewrite_git_history` · `mass_delete` · `disable_audit` · `disable_kill_switch` · `bulk_export_pii`.

---

## Part 3 — Connection map

| Tool (tier) | Bridge path | Engine/service | Store/table/adapter | Current mode |
|---|---|---|---|---|
| `search_clients` (READ) | core→`searchClients`→guardedDispatch(READ_ONLY) | `ClientReadModel` | `PostgresClientReadModel` → `clients` (SELECT-only) | live-wired |
| 15 `read_*` (READ) | core→`readFactoryState`→guardedDispatch(READ_ONLY) | `LiveFactoryReadPorts` | real risk/domain/project stores · audit sink · tool registry · docs | live-wired |
| 7 `draft_*` (DRAFT) | core→`draftWithTool`→dispatch(DRAFT_ONLY) | `DraftPorts` | `fakeDraftPorts()` (canned) | fake-backed |
| 6 internal `record_*/create_open_item/update_risk_status` (WRITE) | core→`writeWithTool`→approval pre-check→`runGuardedApprovedAction` | `LiveWriteStores` | `review_log_entries` · `open_items` · `risk_register` (`ece_writer`) | live-wired |
| `open_pull_request` (EXTERNAL) | **PR Engine→`bridge.openPullRequest(capability,…)`**→`runExternalAction` | `ExternalSystems.openPullRequest` | `fakeExternalSystems()` | fake-backed (sole-authority) |
| 5 other external (EXTERNAL) | core→`externalActionWithTool`→`runExternalAction` | `ExternalSystems.*` | `fakeExternalSystems()` | fake-backed |
| 6 FORBIDDEN | core→`externalActionWithTool`→refused `forbidden` | — | — | refused |
| audit (all) | `WriteAheadSequencer`→`PostgresHashChainSink` | Audit Engine | `audit_intent`/`audit_result`/`audit_refusal` (`ece_app`) | live-wired |

No `UNKNOWN` paths — every exposed tool's route is derivable from code.

---

## Part 4 — Claude Code MCP registration inventory

| Question | Answer | Evidence |
|---|---|---|
| `claude` CLI exists? | **YES** | `command -v claude` present |
| `claude mcp list` works? | **YES** | lists 4 connected claude.ai remote servers |
| `ece-factory` registered? | **NO** | `claude mcp get ece-factory` → `No MCP server found with name: "ece-factory"` |
| command / cwd / env | n/a | not registered |
| points to this repo? | **NO** (not registered) | — |
| old path / unknown global? | **NO** ece-factory entry of any kind | configured: claude.ai Code Remote, Gmail, Google Calendar, Google Drive |
| health | n/a (the 4 remote servers report ✔ Connected) | — |
| connection appears live? | **NO** — the factory server is **built-not-registered** | — |

*(No add/remove/modify performed — inspection only.)*

---

## Part 5 — Live/fake/disabled matrix

| Layer | Status | Evidence | Risk | Next action |
|---|---|---|---|---|
| Server entrypoint | built-not-registered | `server.ts` runs over stdio; proven Phase 9.0 | none until run | register at deploy |
| Claude Code registration | built-not-registered | `claude mcp get` not found | reads as "not live" | human `claude mcp add` |
| READ_ONLY tools | live-wired | `LiveFactoryReadPorts` | needs persistent DB | provision persistent DB |
| DRAFT_ONLY tools | fake-backed | `fakeDraftPorts()` | drafts are canned | wire real proposal sources |
| Internal write tools | live-wired | `LiveWriteStores` + `ece_writer` | needs persistent DB + role | provision DB/role |
| External action tools | fake-backed | `fakeExternalSystems()` | mistaken-as-live | external-tier live wiring (gated) |
| FORBIDDEN tools | disabled (refused) | bridge refuses | none | none |
| Autopilot runner | built-not-wired | `AutopilotRunner`; no live trigger | none | wire trigger at deploy |
| Autopilot scheduler | built-not-wired | `AutopilotScheduler`; no live timer/cron | none | wire timer + ConfigChangeAuthorizer→Settings |
| PR Engine | built; external fake-backed | `PrEngine` (sole authority) | none | external live wiring |
| Settings | built-not-wired (as tools) | Module 25 engine | none | wire `read_setting`/`change_setting` tools |
| Field Creation | built-not-wired (as tools) | Module 20 engine | none | wire field tools |
| External GitHub adapter | fake-backed | `fakeExternalSystems.createGithubRepo/openPullRequest` | none | real adapter (gated) |
| Email adapter | fake-backed | `fakeExternalSystems.sendEmail` | none | real adapter (gated) |
| CRM adapter | fake-backed | `fakeExternalSystems.updateCrmRecord` | none | real adapter (gated) |
| Deploy adapter | fake-backed | `fakeExternalSystems.deployPackage` | none | real adapter (gated) |
| Pulse runtime | planned | not in `src/features` | none | future wave |
| Decision Console | planned | not in `src/features` | none | future wave |

---

## Part 6 — Guard-stack verification (MCP surface)

| Component | Applies to tiers | Evidence | Gaps |
|---|---|---|---|
| Tool Registry (fail-closed) | all | `registry.require` in `server-core`/bridge; unregistered ⇒ refused | none |
| Dispatch-by-class | all | `classifyRegisteredTool` + `ClassDispatcher`; only the class's path is offered | none |
| Permission Engine (deny-by-default, per-tool) | all | `PermissionEngine` in the sequencer authorizer; elevated roles enforced | none |
| Kill Switch (beats all) | all | `PermissionEngine` consults `KillSwitchReader` at the top | none |
| Approval Gate (token) | internal-write + external | `BridgeApprovalGate` pre-check + consume; STOP without token | none |
| Audit intent (before) | all that execute | `WriteAheadSequencer.appendIntent` | none |
| Audit result (after) | all that execute | `appendResult` (mutation bracketed) | none |
| Redaction (before return) | all | bridge `redactValue`/`redactor`; allowlist | none |
| Refusal Audit | refused authorize/kill | `appendRefusal` | none |

**No bypass found.** Reads are SELECT-only (`ece_app`), internal writes append-only (`ece_writer`), external on fakes; every path goes through `McpServerCore → McpBridge`. **No CRITICAL GAP.**

## Part 6b — Sole-authority & capability boundaries

- **PR Engine sole authority (8.8b): CONFIRMED.** `open_pull_request` is reachable only via `bridge.openPullRequest(capability,…)`; the capability is an unforgeable module-private branded symbol (`OpenPrCapability`); the generic `externalActionWithTool('open_pull_request')` refuses (`stage: encapsulated`). Boundary grep (production, non-test, excluding the bridge seam-definition): **exactly one assembler — `src/features/pr-engine/pr-engine.ts`.**
- **Gap (MEDIUM/INFO):** the other 5 external actions (`create_github_repo`, `create_ticket`, `update_crm_record`, `send_email`, `deploy_package`) are reachable via the generic `externalActionWithTool` and do **not** yet have an equivalent per-tool sole-authority capability/owner module. They remain fully gated by the 8.4 gauntlet and are fake-backed, but lack the "exactly one assembler" structural property. Consider capability-encapsulating each behind a dedicated owner engine before its live wiring.

---

## Part 7 — Security & governance gaps

| # | Sev | Finding | Evidence | Impact | Recommended fix | Phase |
|---|-----|---------|----------|--------|-----------------|-------|
| 1 | INFO | Unknown/unclassified tools | 0 — all 35 classify into the 4 tiers; FORBIDDEN registered-and-refused | none | — | — |
| 2 | INFO | Every tool audited + redacted | guard-stack verification (Part 6) | none | — | — |
| 3 | LOW | No direct DB/external bypass | reads SELECT-only, writes append-only, external on fakes | none | — | — |
| 4 | INFO | Live external NOT enabled by default | `fakeExternalSystems()` | none | keep gated | — |
| 5 | LOW | No committed/hardcoded credentials | env-only config; prior scan clean | none | keep `.env`-only | — |
| 6 | MEDIUM | Other external actions lack a sole-authority owner (only PR Engine has it) | Part 6b | inconsistent structural ceiling | capability-encapsulate per external action | pre-external-live |
| 7 | HIGH | Fake mistaken as live (external/draft) | `server.ts` injects fakes | a reader could assume external/draft are live | this report + startup banner already says "externals on fakes"; add explicit `/healthz` tier-status | pre-external-live |
| 8 | HIGH | Live components have no persistent infra | only throwaway test clusters; `ece-factory` not registered | not actually running | provision persistent PG + `ece_app`/`ece_writer` + register | pre-live |
| 9 | MEDIUM | Scheduler `ConfigChangeAuthorizer` is an injected port, not wired to the Settings token path | `autopilot-scheduler.ts` | enable/disable gate depends on composition | wire to Settings APPROVAL_REQUIRED_WRITE | pre-scheduler-live |
| 10 | MEDIUM | No operator runbook / health-check / observability | none in `docs/` | hard to run/monitor live | add operator docs + `/healthz` + metrics | pre-live |
| 11 | MEDIUM | No backup/recovery plan for the persistent audit/append-only DB | n/a (no persistent DB yet) | audit loss risk when live | document backup/PITR | pre-live |
| 12 | LOW | Fresh-DB-per-run test model | OPEN_ITEM #7 | shared-DB CI shows spurious failures | per-test isolation in CI | CI readiness |
| 13 | LOW | §5 doc set duplicated | OPEN_ITEM #8 | silent drift | shared constant / cross-list test | later |
| 14 | LOW | Kill-switch audit-adapter not wired at a composition root | OPEN_ITEM #3 | kill events not audited end-to-end | inject Audit adapter | composition |
| 15 | INFO | No self-approval / no token-minting power leaked / no guard-weakening setting / no reachable FORBIDDEN | Settings guard-floor; Approval Gate refuses claude; FORBIDDEN refused | none | — | — |
| 16 | MEDIUM | Settings + Field Creation engines not exposed as bridge tools | Parts 1/5 | capabilities exist but unreachable via MCP | wire `read_setting`/`change_setting`/field tools | next |

---

## Part 8 — Improvement roadmap

**Must-fix before live external actions:** real external adapters behind per-action sole-authority capabilities (#6); explicit tier-status health endpoint so fakes can't read as live (#7); persistent infra + secret-managed creds (#8); operator runbook + backup/recovery (#10, #11).
**Must-fix before Autopilot scheduler live:** wire `ConfigChangeAuthorizer` to the Settings token path (#9); a real bounded timer/cron driver; kill-switch audit-adapter (#14); observability for fired runs (#10).
**Must-fix before Decision Console:** expose Settings/Field-Creation as bridge tools (#16); a read API for the audited governance state; Decision Console module itself (planned).
**Must-fix before Venture Intelligence:** the analytics/read surface over the registries + audit; (module planned).
**Nice-to-have later:** CI per-test isolation (#12); §5 shared-constant refactor (#13).

---

## Part 9 — Final verdict

**MCP INVENTORY CLEAN** — 35 tools all classified (0 unknown), every path guarded (no bypass), FORBIDDEN refused, PR-Engine sole-authority confirmed. Caveat: several components are **live-wired but not live-running** (no persistent DB, not registered), and external/draft are intentionally fake-backed.

| Question | Answer |
|---|---|
| Factory MCP server built? | **YES** |
| Registered in Claude Code? | **NO** |
| READ_ONLY live? | **live-wired, not live-running** (needs persistent DB) |
| Internal writes live? | **live-wired, not live-running** (needs persistent DB + `ece_writer`) |
| External actions live? | **NO** |
| External fake/disabled? | **FAKE** (FORBIDDEN: refused) |
| Autopilot live-scheduled? | **NO** (built, not wired to a live timer) |
| Decision Console built? | **NO** (planned) |

---

## Step Evidence Pack
- **Commands run (inspection only):** `ls` of `src/mcp-server` + bridge; `grep` of tool constants/roles/wiring/adapter tables; `claude mcp list`; `claude mcp get ece-factory`; module-existence checks. No build, no tests run this step.
- **Files inspected:** `server.ts`, `server-core.ts`, `live-read-adapters.ts`, `live-write-adapters.ts`, bridge files (`mcp-bridge`, `tool-classes`, `factory-read-tools`, `draft-tools`, `write-tools`, `external-tools`), `package.json`, `infra/migrations/*`.
- **Report file created:** `docs/MCP_INVENTORY_AND_CONNECTION_REPORT.md`.
- **Confirmations:** no code change · no config change · no MCP registration change · no new tool · no dependency · no module started · no self-approval.
- **Tests run:** none (inspection only); last full-suite result 432/432 (Phase 8.9).
- **Limitations:** "live-running" status cannot be confirmed (no persistent DB, server not registered); `claude mcp get ece-factory` definitively shows not-registered.
- **Proposed next step:** the **Wave 5 completion report + human wave-boundary sign-off**, then prioritize the roadmap (persistent infra + Claude Code registration; external-tier sole-authority + live wiring).
