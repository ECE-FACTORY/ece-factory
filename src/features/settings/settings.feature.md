# Feature — Settings

**Path:** `src/features/settings/` · **Module:** 25 (Wave 5) · **Status:** **built & tested** (Phase 8.6)
**Governs:** blueprint §25 + `ARCHITECTURE_NOTE_MODEL_TOPOLOGY.md`.

## Purpose
Governed factory configuration state. Reading a setting is READ_ONLY; changing one is an APPROVAL_REQUIRED_WRITE through the existing guard stack. **Settings are not an escape hatch around any gate.**

## Model
A typed registry of settings, each: `key`, `type` (boolean/string/number/enum), `scope` (factory-wide / per-domain / per-project), `classification` (**OPERATIONAL** | **SECURITY_CRITICAL**), `default`, optional `allowedValues`/`floor`, and (per snapshot) last-changed provenance (`changedBy`, `reason`, `changedAtIso`).

## Reading vs changing — different tiers
- **read** ⇒ READ_ONLY (through the guard stack, audited, redacted, permissioned). `read` returns the current value = latest snapshot, or the registered default if never changed.
- **change OPERATIONAL** ⇒ APPROVAL_REQUIRED_WRITE — the Phase 8.3 single-use, per-action, human-approved, unforgeable token; no token ⇒ STOP, nothing written.
- **change SECURITY_CRITICAL** ⇒ gated **and** floored — the value structurally cannot cross into a guarantee-weakening state.

## The hard floor (the core)
**No setting may disable/weaken the Tool Registry, Permission Engine, Kill Switch, Audit Engine, Redaction Engine, or the approval-token requirement, nor make a FORBIDDEN tool callable.**
- Such keys are **unrepresentable** — they are not in the registry, so deny-by-default rejects them (`audit.enabled`, `redaction.enabled`, `kill_switch.enabled`, `approval.required`, `permission.enforce`, `tool.<x>.forbidden` do not exist).
- Defence-in-depth: `crossesGuardFloor(key, value)` refuses any change naming a guard subsystem (audit/redaction/kill-switch/permission/approval/tool-registry/forbidden) with a disabling value (`false`/`0`/`off`/`disable`/…) — even for a registered SECURITY_CRITICAL key. Mirrors the Phase 8.4 rule that the kill switch and audit can never be targeted.
- SECURITY_CRITICAL keys that exist are tunable **within** the guarantee, never across it: `audit.retention_days` ≥ 1 (never 0), `redaction.mode` ∈ {standard, strict} (never "off"), `approval.window_minutes` > 0.

## Persistence (append-only)
PostgreSQL, append-only (`PostgresSettingsStore` + migration `0009`): a change is a new snapshot (REVOKE UPDATE/DELETE/TRUNCATE + guard trigger; CHECK `changed_by <> 'claude'`). `getLatest` = current value, `history` = full trail, `list` = latest per (key, scopeRef). History is never rewritten.

## Deny-by-default
Unknown key ⇒ rejected (not silently created); invalid value for the key's type ⇒ rejected; a value not in `allowedValues` ⇒ rejected; an unverifiable / guard-weakening change ⇒ rejected.

## Standalone packaging
Imports nothing from any other engine; the approval gate + store are injected ports. Independently packageable.

## Tests
Pure-logic: model/classification; the guard-floor (guard-disabling change refused — audit/redaction/kill-switch/approval/permission cannot be turned off; FORBIDDEN-enabling key unknown); SECURITY_CRITICAL floored; deny-by-default (unknown key / invalid value). Real PostgreSQL: read returns latest snapshot; a change through the bridge's APPROVAL_REQUIRED_WRITE path commits a snapshot **only with a valid token** (no token ⇒ STOP, store unchanged); self-approval rejected; kill beats approval; append-only (two changes ⇒ two snapshots; UPDATE/DELETE denied).

## Status
**Built & tested (Phase 8.6).** Full accumulated suite green vs real PostgreSQL 16.14.

## Open Items
- Wiring `read_setting` (READ_ONLY) + `change_setting` (APPROVAL_REQUIRED_WRITE) as named bridge tools on the classified surface is a thin composition step (the engine + tiers are ready); deferred to avoid a surface-count refactor this phase. The token-gate inheritance is proven by routing a settings change through the existing APPROVAL_REQUIRED_WRITE path.
