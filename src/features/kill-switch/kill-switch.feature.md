# Feature — Kill Switch / Emergency Control

**Path:** `src/features/kill-switch/` · **Module:** 33 (Wave 1 ROOT) · **Status:** **built & tested** (Phase 4.3)
**Governs:** blueprint §33 ("must not require deployment — takes effect immediately at runtime").

## Purpose
Emergency, runtime, deployment-free disabling of tool calls. Consulted by the Permission Engine: a killed scope ⇒ REFUSE, ahead of every other rule.

## Scopes
one **tool** (by name) · **all write tools** · a named **connector** · an **environment** · the entire **bridge** · **Autopilot**.

## Business Logic
`InMemoryKillSwitch` holds current kill state in memory. `reason(query)` returns a human-readable cause if the call is killed (else null); `isKilled` is the boolean form. `activate(scope, actor, reason)` / `deactivate(...)` flip state **immediately** — the next `reason()`/`isKilled()` call (i.e. the next authorization decision) sees it; no redeploy/restart.

## Precedence (justified)
The kill switch is checked **at the top** of the Permission Engine's decision — before role, approval, and classification. A killed scope REFUSEs even a call that would otherwise be ALLOW or STOP_FOR_APPROVAL. *A kill switch that a high privilege could override is not a kill switch* — so it sits at/near the very top, as deny-by-default's emergency form. (Implementation: scope checks that need no tool metadata — bridge/autopilot/environment/tool/connector — run before the registry lookup; the all-writes scope runs immediately after lookup, still before any ALLOW/approval logic.)

## Persistence (justified)
**Current state is in-memory** — correct for a single-process factory and the cleanest way to guarantee *immediate* effect (a DB round-trip would add latency/availability coupling to the emergency path). But **every state change is audit-worthy** ("who killed what, when, why"), so `activate`/`deactivate` emit a `KillSwitchChangeEvent {action, scope, actor, reason, at}` through an injected `KillSwitchAuditHook` port that the composition routes to the Audit Engine. A future multi-process deployment replaces the in-memory store behind the same `KillSwitchReader` interface (with a fast cache + audited persistence). The actor may never be "claude" (enforced).

## Consumer interface
`KillSwitchReader { isKilled(q); reason(q) }` — injected into the Permission Engine via type-only import (no runtime coupling).

## Standalone packaging
Imports nothing from any other engine (own types + audit port). Independently packageable.

## Tests
Per-scope disabling (each scope disables the right calls, leaves others working); immediacy (flip mid-run → next decision flips, no restart); precedence (killed tool that would be ALLOW ⇒ REFUSE; killed tool that would be STOP_FOR_APPROVAL ⇒ REFUSE); audit hook captures who/what/when/why; integration (real PostgreSQL): a kill-switched tool through Permission Engine + sequencer ⇒ REFUSE + one refusal record, no orphan.

## Status
**Built & tested (Phase 4.3).** Full suite green vs real PostgreSQL 16.14.

## Open Items
- Multi-process/persisted kill state behind the same interface (later waves).
- Wiring the real Audit Engine adapter into `KillSwitchAuditHook` at the (not-yet-existing) composition root.
