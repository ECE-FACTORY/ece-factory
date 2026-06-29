# Feature — Repo Builder / Operator

**Path:** `src/features/repo-builder/` · **Module:** 29 (Wave 4) · **Status:** **built & tested** (Phase 7.4)
**Governs:** blueprint §29; Layer 2 §5 (repo structure), §11 (upstream tracking), §20 (CI).

## Purpose
Given an approved project, **plan** a governed repo scaffold — and stop for approval. It plans; a human approves; actual creation happens later through a gated action layer (Wave 5).

## Core guarantee — plans, never executes
No filesystem writes, no git, no network. A plan's status is the single literal type `'PLAN-AWAITING-APPROVAL'` — there is **no code path and no type variant** that creates a real repo or reports "executed"/"created". The only two outcomes are `PLAN-AWAITING-APPROVAL` and `REFUSED`. (Type-level proof in the tests: the plan status can only be the literal.)

## Harvest-before-build gate (inherited)
The planner consumes the Project Registry's `GateView` (via type) and **refuses to even plan** a repo when `gateView.clearedToBuild !== true` — no repo is planned for a project that hasn't cleared harvest approval.

## Deny-by-default
Unverifiable input — missing project/repo, or an unknown gate state (`clearedToBuild` not a boolean) — ⇒ **REFUSED**, never "probably fine".

## Plan structure (Layer 2 §5)
- **Directories:** `docs/`, `src/`, `src/features/`, `tests/{unit,integration,e2e}`, `scripts/`, `infra/`, and `src/features/<feature>/` (+ `/tests`) per feature.
- **Files:** `CLAUDE.md`, `README.md`, `SECURITY.md`, `CONTRIBUTING.md`, `CHANGELOG.md`, `.env.example`, `.gitignore`, `.github/workflows/ci.yml`, the 12 §5 `docs/*.md`, and `src/features/<f>/<f>.feature.md` per feature.
- **Upstream tracking (§11):** one entry per forked repo (upstream URL, license, fork-point commit) — preserve upstream license notices.

## Standalone packaging
Only cross-engine reference is `import type` (the Project-Registry gate). Pure function; no side effects. Independently packageable.

## Tests
A cleared project ⇒ a complete plan ending `PLAN-AWAITING-APPROVAL` with the full §5 structure; an uncleared project ⇒ refused (no plan); the plan never self-executes (no execute/create state; type-level proof); a forked repo ⇒ an upstream-tracking entry planned; deny-by-default on unverifiable input ⇒ refused.

## Status
**Built & tested (Phase 7.4).** Pure-logic. Full suite green.

## Open Items
- Actual repo creation (fs/git/GitHub) is a Wave-5 gated action-layer concern — this module only produces the plan; a human approves; the action layer executes under per-action confirmation + audit.
