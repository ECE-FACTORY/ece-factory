# Feature — Autopilot Scheduler

**Path:** `src/features/autopilot-scheduler/` · **Module:** 18b (Wave 5) · **Status:** **built & tested** (Phase 8.9)
**Governs:** blueprint §18b + `ARCHITECTURE_NOTE_MODEL_TOPOLOGY.md` + the Autopilot ceiling.

## Purpose
A **clock** over Autopilot. It decides only **when** an Autopilot run fires; it grants Autopilot **no new authority**. Scheduling is not a back door to autonomy — a scheduled run is bounded by the exact same READ_ONLY/DRAFT_ONLY ceiling as a manual run.

## Design
`AutopilotScheduler.tick(ctx)` decides whether to fire; if so it invokes the injected `AutopilotPort.run(ctx)` once and returns its **bounded** `AutopilotOutcome`. It holds only: the Autopilot port (read+draft), an injected `Clock`, a `SchedulerAuditHook`, a `SchedulerKillReader`, and a `ConfigChangeAuthorizer`. It has **no** approval/token/write/external capability of its own. The clock is injected so tests are deterministic (fake clock, no waiting).

## Inherited ceiling (the core)
- A fired run returns the **same** `AutopilotOutcome` (propose/await/read/halt) — the scheduler cannot widen it; there is **no executed/committed/approved variant** (type-proven via Autopilot's outcome).
- A scheduled run that reaches a **consequential** step ⇒ STOPs at the human/approval boundary exactly as a manual run does. The scheduler cannot supply a token, self-approve, or advance a gate — driving a write/external ⇒ `STOP_FOR_APPROVAL`, the write/external port is **never called**.

## Scheduler safety
- **Bounded cadence:** a hard minimum interval (`HARD_MIN_INTERVAL_MS`) plus the configured `minIntervalMs` floor — it cannot fire faster than its floor (no runaway tight loop).
- **Bounded per run:** each fired run inherits Autopilot's hard step budget (terminates; finite run record) — no infinite run.
- **Kill switch halts it:** killed ⇒ no fire (and a running run halts via Autopilot's own kill-halt). The human override stops the clock.
- **Every trigger is audited:** each fire/skip/config-change writes an audit record (when, what, the run's outcome) — a scheduled run is as auditable as a manual one; no unobserved autonomous activity.
- **Governed enable/disable:** turning the scheduler on/off requires a permissioned, token-gated human authorization (maps to the Settings APPROVAL_REQUIRED_WRITE path) **and** is audited — never a free action.

## Deny-by-default
An invalid/unverifiable schedule config (non-numeric/`< HARD_MIN_INTERVAL_MS` interval, non-boolean enabled) ⇒ rejected at construction; a config change not attributed to a real human ⇒ rejected.

## Standalone packaging
Imports nothing concrete from other engines; the runner, clock, audit hook, kill reader, and authorizer are injected (`import type` only). Independently packageable.

## Tests
Pure-logic (fake clock): a scheduled fire invokes Autopilot once → a bounded propose/await/read/halt outcome; type-level the outcome is Autopilot's (no executed/approved/committed); a consequential step ⇒ STOP, the write/external port never called (real `AutopilotRunner` + full fake bridge, via the scheduler); bounded cadence (no double-fire inside the floor; fires after the floor); kill halts the scheduler; governed enable/disable (unauthorized/claude ⇒ refused; authorized ⇒ audited); deny-by-default (invalid schedule rejected); bounded per run (terminates). Real PostgreSQL: a scheduled fire's run activity is audited (intents+results in the audit log) — every trigger is auditable.

## Status
**Built & tested (Phase 8.9).** Full accumulated suite green vs real PostgreSQL 16.14.

## Open Items
- Wiring the `ConfigChangeAuthorizer` to the live Settings APPROVAL_REQUIRED_WRITE token path (vs the injected port) is a thin composition step; the gate semantics (permissioned + audited) are enforced here.
- The real timer/cron loop that calls `tick()` on a cadence is a deployment-time driver; the bounded-cadence + kill + audit guarantees hold regardless of the trigger source.
