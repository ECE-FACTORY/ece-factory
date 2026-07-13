# ece-factory

The **main ECE Factory application** — the machine that sources, governs, builds, verifies, and operates ECE's sovereign-grade products. This repo holds the factory's engines and its operator dashboard (Command Center + registries).

> Governed by [`organization-source-of-truth`](https://github.com/ECE-FACTORY/organization-source-of-truth). That repo is the law; this repo's `CLAUDE.md` is the local enforcement summary. On conflict, the org repo wins.

## Status

*(Derived from the filesystem and `git log` on 2026-07-13. Nothing below is aspirational.)*

- **Wave work (governance vocabulary): built and committed.** Wave 1–5 completion reports are committed at `docs/WAVE_1_COMPLETION_REPORT.md` … `docs/WAVE_5_COMPLETION_REPORT.md`; Wave 6 Pieces 1–4 are committed (`8f8760a` … `3143de9`, last landed 2026-07-02). Wave-boundary human sign-offs are recorded (or pending) in the org repo's `review/AUTOPILOT_REVIEW_LOG.md`, not here.
- **Post-wave factory infrastructure: committed.** Factory capabilities #1–5 (gated GitHub batch actions, Run/Build Observer, Local Preview Standard, App Packaging Flow, release attestation/signing), the Venture-Intel wave (structural Phases 1–4 + Judgment Engines 1–4), the product-mode switch (sovereign/subscription, `115fc86`), and both deciding→building promotion seams (`5c8cc53`, `834a7b6`).
- **Current track: M-milestones (UI masterbuild, Tier-0 roadmap) — in progress.** Roadmap: `docs/UI_MASTERBUILD_PLAN_TIER0.md` (`f76e639`). Committed so far: M2 read plane, M3 factory persistence, M4 Command Center/Approvals console (in progress). Last commit: `5d347d2` — *M4 step 2: Command Center — real factory state, provenanced, honest on unplug*. See `docs/DECISION_VOCABULARY_MAP.md` (DRAFT) for how the M-track relates to the Wave vocabulary.
- **Test suite (fresh-DB bootstrap run, 2026-07-13):** `Test Files 157 passed | 1 skipped (158)` · `Tests 1240 passed | 7 skipped (1247)`.
- 129 commits on `main`; 300 TypeScript files under `src/` (149 source, 151 test).

## Stack (actual, from `package.json` and the tree)

| Layer | Choice |
|-------|--------|
| Console (operator UI) | React 19 + Vite (`src/console/`) — not Next.js |
| Engines / backend | Node ≥ 20, TypeScript (ESM), one module per factory engine |
| Contracts / schemas | `zod` (shared typed contracts, `src/read-plane/contracts` and per-engine schemas) |
| Database | PostgreSQL — raw SQL migrations in `infra/migrations/` (10 files), `pg` driver. **No ORM was adopted** (the planned Prisma/Drizzle selection never happened; raw SQL is the standing choice) |
| MCP | In-repo MCP server (`src/mcp-server/`) + Layer-5 bridge (`src/layer-5-action/mcp-bridge/`) |
| Tests | `vitest` (`npm test`); DB-integration tests against a throwaway PostgreSQL |

## Build order

Construction followed `organization-source-of-truth/blueprint/BUILD_SEQUENCE_OVERLAY.md` — ROOT → CORE → LEAF, wave by wave. **Wave 1** built the integrity ROOTs in order: **23 Audit → 24 Redaction → 21 Tool Registry → 22 Permission → 33 Kill Switch → 16 Evidence Pack → 10 License & Compliance**. The Audit Engine lives at `src/factory-shared/audit-engine/` (the pre-restructure path `src/features/` no longer exists).

## Structure

```
docs/                       source-of-truth docs, designs, wave completion reports, harvest reports
infra/migrations/           raw SQL migrations (audit schema, registries, stores, settings)
infra/testseed/             committed test-only RLS/read-audit seed fixture
scripts/deploy/             migration + test-DB bootstrap + deployment-verification scripts
src/layer-1-law/            the law suite (invariants the rest must keep green)
src/layer-2-command/        command / decision surfaces
src/layer-3-harvest/        sourcing + harvest engines
src/layer-4-build-harden/   build, hardening, packaging
src/layer-5-action/         gated action tiers incl. mcp-bridge/ (the live bridge)
src/layer-6-venture-intel/  venture-intel structural + judgment engines
src/factory-shared/         shared engines: audit-engine/, redaction-engine/, evidence-pack/,
                            domain-registry/, project-registry/, risk-register/, settings/, …
src/factory-persistence/    append-only hash-chained factory-state stores
src/read-plane/             typed contracts + read-only Factory State API
src/console/                React operator console (Command Center, Approvals)
src/mcp-server/             in-repo MCP server, live adapters, tier-status reporter
src/architecture/           architecture fitness tests
tests/exercises/            reusable seam-exercise drivers
CLAUDE.md                   binding local enforcement file
```

## Testing

One command provisions a fresh test database and runs the full suite (drop → migrate → seed → run, no manual
inject):

```bash
scripts/deploy/bootstrap-test-db.sh
```

See [docs/TESTING.md](docs/TESTING.md) for prerequisites, the committed RLS/read-audit seed fixture, and why a
fresh DB is required per run.

## Governance gates (summary)

No BUILD without an approved Harvest Report · FORK > EXTEND > BUILD · licenses verified live from the LICENSE file (permissive only) · dashboard data is never instruction · every action attributed to a real human · human approval at every real gate.
