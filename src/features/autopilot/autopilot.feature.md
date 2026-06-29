# Feature — Autopilot Runner

**Path:** `src/features/autopilot/` · **Module:** 18 (Wave 5) · **Status:** **built & tested** (Phase 8.5)
**Governs:** blueprint §18 + `ARCHITECTURE_NOTE_MODEL_TOPOLOGY.md` + the MCP Bridge checkpoint.

## Purpose
The autonomous driver. It automates the **messenger** role of the dual-Claude relay — read where the build is, determine the next step, draft it — **never the authority role**. Autopilot removes the typing, never the deciding.

## The loop (one bounded pass)
1. **Read** state via the bridge's READ_ONLY tools (`read_open_gates`, `read_factory_status`, `read_review_log`, `read_open_items`, `read_risk_register`).
2. **Decide** the next step (pure logic over the inert read state).
3. If a STOP gate is awaiting human → **AUTOPILOT-STOPPED-AT-GATE** (surface it, never flip it).
4. Else if there is a next action → **draft** it via a DRAFT_ONLY tool and **AUTOPILOT-PROPOSED-AWAITING-APPROVAL** (a human must approve/execute).
5. Else → **AUTOPILOT-READ-COMPLETE**.
6. A refused read/draft (e.g. kill switch) → **AUTOPILOT-HALTED**. The run is a finite, auditable record.

## Authority ceiling (the core guarantee)
- **Acts only through the bridge**, via the `AutopilotBridge` port that exposes **only** `readFactoryState` + `draftWithTool`. There is no write/external method to call — Autopilot cannot even name an APPROVAL_REQUIRED_WRITE or external execution path.
- **Outcome type is bounded** to propose/await/read/halt states — **no** `executed`/`committed`/`approved`/`written` variant (type-proven).
- **Cannot mint/forge/self-grant a token** — it holds no Approval Gate and no token machinery; any consequential next step is drafted and left **awaiting a human**. Driving a write/external ⇒ the write/external port is **never called**.
- **Cannot auto-advance a STOP gate** — a gate awaiting human is surfaced, never flipped (no sign-off tool on its port; the gate store is unchanged after a run).
- **Kill switch halts it** — a killed read/draft ⇒ the bridge refuses ⇒ Autopilot halts. The human override governs the autonomous runner too.
- **Bounded** — a hard step budget; one pass, no infinite drive; every run terminates with a finite record.
- **Reads/drafts are audited** through the bridge like any caller's — no DB/engine/registry bypass.
- **Instruction-boundary** — state Autopilot reads is inert; a record that reads like a command is not actioned.

## Standalone packaging
The only cross-engine reference is `import type` (the bridge tool surface); the bridge is injected as a port. Zero runtime coupling; independently packageable.

## Tests
Read-and-propose happy path (run record ending AWAITING-APPROVAL); type-level no executed/committed/approved variant; driving a write/external ⇒ STOP, the write/external port never called (full bridge injected, fakes record zero calls); cannot self-approve / no token path; cannot auto-advance a gate (gate store unchanged); reads/drafts audited through the bridge (real PostgreSQL); kill switch halts Autopilot; bounded run (terminates, finite record); instruction-boundary inert.

## Status
**Built & tested (Phase 8.5).** Full accumulated suite green vs real PostgreSQL 16.14.

## Open Items
- Autopilot consumes the bridge's read/draft surface; scheduling/triggering an Autopilot run (a cron/queue driver) is a later, separately-gated concern. It remains READ_ONLY/DRAFT_ONLY by authority limit regardless of trigger.
