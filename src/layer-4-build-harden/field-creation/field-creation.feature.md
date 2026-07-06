# Feature — Field Creation

**Path:** `src/features/field-creation/` · **Module:** 20 (Wave 5) · **Status:** **built & tested** (Phase 8.7)
**Governs:** blueprint §20 + `ARCHITECTURE_NOTE_MODEL_TOPOLOGY.md`.

## Purpose
Governed custom-field definitions on a target (domain / project / product). Reading a field is READ_ONLY; creating/changing one is an APPROVAL_REQUIRED_WRITE through the existing token gate. **A field definition is inert declarative data, never executable behavior.**

## Model
A typed registry of field definitions, each: `key`, `label`, `dataType` (string/number/boolean/date/enum/text), `target` + `targetRef`, `required`, `default` (an inert scalar), declarative `constraints` (min/max/minLength/maxLength/regex/enumValues), `sensitivity` (**NORMAL** | **SENSITIVE**), and per-snapshot provenance.

## Reading vs creating/changing — different tiers
- **read** ⇒ READ_ONLY (audited, redacted, permissioned) — the current definition = latest snapshot, or null.
- **create / change** ⇒ APPROVAL_REQUIRED_WRITE — the Phase 8.3 single-use, per-action, human-approved, unforgeable token; no token ⇒ STOP, nothing written. `create` rejects a duplicate key on the target; `change` requires the key to exist; both append a new snapshot.

## The core: a field definition is INERT
- Constraints are a **closed declarative vocabulary** (`min/max/minLength/maxLength/regex/enumValues`). Any other key — `eval/code/script/exec/callback/fn/expr/template/sql/query/command/…` — is rejected. There is no code, expression, callback, SQL fragment, or executed template in a definition.
- `regex` is a declarative pattern **string** (bounded length, validated as a compilable `RegExp`, scanned for executable/SQL/script markers) — never executed as code; `enumValues` are inert strings (same scan). `default` must be a **scalar** (string/number/boolean), never a structured/executable object.
- **Instruction-boundary:** a `label`/`key`/`default` that *reads like* a command is inert — stored and displayed as data, never actioned.

## The redaction floor
A SENSITIVE field is **redaction-eligible** (its values go through the Redaction Engine's allowlist). **No definition can opt out of, or weaken, redaction** — opt-out keys (`neverRedact/noRedact/redact/skipRedaction/redactionExempt/exposeAlways/plaintext/exempt`) are unrepresentable and refused. Mirrors the Settings guard-floor; a field is not a side-channel around redaction.

## Deny-by-default
Unknown/invalid data type ⇒ rejected; malformed constraint ⇒ rejected; duplicate key on the same target ⇒ rejected; **unregistered target ⇒ rejected** (a field can only be defined on a registered domain/project/product — verified via an injected target lookup, consuming the registries by use); unverifiable definition ⇒ rejected.

## Persistence (append-only)
PostgreSQL, append-only (`PostgresFieldDefinitionStore` + migration `0010`): a definition/change is a new snapshot (REVOKE UPDATE/DELETE/TRUNCATE + guard trigger; `CHECK changed_by <> 'claude'`). `getLatest` = current, `history` = full trail, `list` = latest per key on the target. History never rewritten.

## Standalone packaging
Imports nothing from any other engine; the approval gate, store, and target lookup are injected ports. Independently packageable.

## Tests
Pure-logic: model/tier mapping; the inertness core (executable/SQL/script constraint or opt-out key ⇒ rejected; default must be scalar); the redaction floor (cannot opt out / mark never-redact); SENSITIVE ⇒ redaction-eligible; instruction-boundary (command-like label inert); deny-by-default (unknown type / malformed constraint / duplicate key). Real PostgreSQL: read latest snapshot; create through the bridge's APPROVAL_REQUIRED_WRITE path commits only with a valid token (no token ⇒ STOP, store unchanged); unregistered target ⇒ rejected; append-only (two snapshots; UPDATE/DELETE denied); self-approval rejected; kill beats approval.

## Status
**Built & tested (Phase 8.7).** Full accumulated suite green vs real PostgreSQL 16.14.

## Open Items
- Wiring `read_field` (READ_ONLY) + `create_field`/`change_field` (APPROVAL_REQUIRED_WRITE) as named bridge tools is a thin composition step (engine + tiers ready); the token-gate inheritance is proven by routing a field create through the existing APPROVAL_REQUIRED_WRITE path.
- Applying a SENSITIVE field's redaction-eligibility to stored values is enforced by the Redaction Engine at store/display time (this module marks eligibility; it never exempts).
