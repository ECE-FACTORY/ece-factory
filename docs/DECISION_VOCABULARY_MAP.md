# DECISION — Vocabulary Map: Waves (governance) ↔ M-track (post-completion build track)

> **STATUS: DRAFT — PENDING HUMAN APPROVAL.** This map is proposed, not authoritative, until a human
> approval is recorded in `organization-source-of-truth/review/AUTOPILOT_REVIEW_LOG.md`. Nothing in it
> changes any gate or rule; it only names what the commit history already shows.

## Why this document exists

The governance stack (`organization-source-of-truth`, `BUILD_SEQUENCE_OVERLAY.md`) speaks in **Waves**.
Recent commits in this repo speak in **M-milestones** (M2/M3/M4 …). No committed document mapped one to
the other, so a reader of the governance repo could not tell what "M4 step 2" is or whether wave
governance still applies to it. This page is that map. Every claim cites a commit or a file on disk.

## The two vocabularies

| Vocabulary | Where it is defined | What it covers |
|---|---|---|
| **Wave 0–6** | `organization-source-of-truth/blueprint/BUILD_SEQUENCE_OVERLAY.md` | The governed construction sequence of the factory's modules (ROOT → CORE → LEAF) |
| **M-track (M0–M8)** | `docs/UI_MASTERBUILD_PLAN_TIER0.md` in this repo (commit `f76e639`) | The Tier-0 UI masterbuild roadmap: read plane → persistence → console → harvest/build/action sections |

## Timeline (from `git log`, this repo)

| Period | Track | Evidence |
|---|---|---|
| 2026-06-29 → 2026-07-02 | **Waves 1–6** — engines, action layer, policy engine, console v1 | `docs/WAVE_1..5_COMPLETION_REPORT.md`; Wave 6 Pieces 1–4 commits `8f8760a`, `d84c178`, `1fa282e`, `82e4932`, `3143de9` (last: 2026-07-02 22:46 +0400) |
| **Completion baseline** | Wave-numbered work ends at Wave 6 Piece 4 (`3143de9`). This is the boundary referred to as the **2026-07-03 completion baseline** (the org-repo snapshot of that state is dated 2026-07-03). | `git show 3143de9 --no-patch` |
| 2026-07-04 → 2026-07-06 | **Post-baseline factory infrastructure** — factory capabilities #1–5, VI wave (Phases 1–4 + Judgment Engines 1–4) | commits `8896ebe` … `c499000`, `9ca2da0`, `23a0fb9` … `47c17b6` |
| 2026-07-06 → 2026-07-09 | Product-mode switch + promotion seams | `115fc86`, `5c8cc53`, `834a7b6`, `4d91d85` |
| 2026-07-09 → now | **M-track** — UI masterbuild Tier-0 | plan `f76e639`; M2 `ec53843`/`94b3506`/`273a0d3`; M3 `05e14ec`/`b36164f`/`be873e8`/`c4e7cb5`/`ea2deb9`; M4 `af649ee`/`65274e0`/`5d347d2` (HEAD) |

## The map

- **Waves 0–6** are the *module-construction* vocabulary. That sequence has been **built and committed**
  (per the in-repo completion reports and commit history above). Wave-boundary **human sign-offs are a
  separate artifact** recorded in the org repo's `review/AUTOPILOT_REVIEW_LOG.md` — this map does not
  assert their status.
- **The M-track is not a Wave.** It is **factory infrastructure work continuing after the completion
  baseline**: instrumenting and operating the already-built factory (typed read plane, append-only
  hash-chained persistence, honest operator console). It jumps no gates — each M-milestone shipped
  behind its own APPROVED design commit (`ec53843`, `05e14ec`, `af649ee`) and the law suite stays green.
- **Milestone labels used in commits:** **M2** = UI read plane (contracts + harvest parser + read-only
  Factory State API) · **M3** = factory persistence (append-only hash-chained stores + emitters) ·
  **M4** = Command Center + Approvals console (in progress at `5d347d2`). The roadmap doc numbers its
  internal checkpoints M0.x–M8.x per phase; the commit-level M-labels follow the design docs
  (`DESIGN_UI_READ_PLANE_M2.md`, `DESIGN_M3_PERSISTENCE.md`, `DESIGN_M4_CONSOLE.md`).
- **Governance is unchanged by vocabulary.** All Wave-era gates (harvest-before-build, human approval,
  instruction boundary, append-only audit) apply identically to M-track work.

---

*DRAFT — PENDING HUMAN APPROVAL. Do not cite this map as authority until the approval row exists.*
