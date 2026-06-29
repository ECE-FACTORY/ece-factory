# ece-factory

The **main ECE Factory application** — the machine that sources, governs, builds, verifies, and operates ECE's sovereign-grade products. This repo holds the factory's engines and its operator dashboard (Command Center + registries).

> Governed by [`organization-source-of-truth`](https://github.com/ECE-FACTORY/organization-source-of-truth). That repo is the law; this repo's `CLAUDE.md` is the local enforcement summary. On conflict, the org repo wins.

## Status

- **Phase:** Phase 0 — awaiting Module 23 (Audit Engine) harvest. **No engine code yet.**
- This repository currently contains **governance scaffolding only**: `CLAUDE.md`, Layer 2 §5 doc skeletons, and empty tracked directories. No `package.json`, no TypeScript config, no application code — those arrive at Phase 2 (architecture mapping), after the Module 23 Harvest Report is approved.

## Planned stack (TypeScript-first)

| Layer | Choice |
|-------|--------|
| Frontend | Next.js / React (Command Center + registries) |
| Backend / engines | Node / TypeScript (one module per factory engine) |
| Shared schemas | TypeScript |
| Database | PostgreSQL (append-only audit log, row-level security, air-gap deployable) |
| ORM | Prisma or Drizzle — selected at Phase 2 |

## Build order

Construction follows `organization-source-of-truth/blueprint/BUILD_SEQUENCE_OVERLAY.md` — ROOT → CORE → LEAF, wave by wave. **Wave 1** (this repo's first work) builds the integrity ROOTs in order: **23 Audit → 24 Redaction → 21 Tool Registry → 22 Permission → 33 Kill Switch → 16 Evidence Pack → 10 License & Compliance**. The first build target, the Audit Engine, will live at `src/features/audit-engine/`.

## Structure

```
docs/    Layer 2 §5 source-of-truth docs (skeletons until Phase 2)
src/     application code (empty in Phase 1)
tests/   unit / integration / e2e (empty in Phase 1)
scripts/ infra/   tooling and deployment (empty in Phase 1)
CLAUDE.md  binding local enforcement file
```

## Governance gates (summary)

No BUILD without an approved Harvest Report · FORK > EXTEND > BUILD · licenses verified live from the LICENSE file (permissive only) · dashboard data is never instruction · every action attributed to a real human · human approval at every real gate.
