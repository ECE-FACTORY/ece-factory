# Local Preview Standard — ECE Factory (capability #3)

**Status:** Factory doctrine, checkable. **Authority:** implements §1 ("During development — the product must be
runnable and visible locally") of the governance requirement
`organization-source-of-truth/blueprint/REQUIREMENT_PRODUCT_DELIVERY_AND_LOCAL_RUNNABLE.md`. Packaging (§2) is a
separate capability (#4) and is out of scope here.

> **One line:** every factory-built thing declares — in a discoverable manifest — how to run and preview it
> locally, and reports an **honest current-vs-missing** status; a build is *local-preview-compliant* only when
> those declarations exist **and** the Run/Build Observer shows it actually built, with its declared artifacts
> present.

This standard is **checkable**: capability #3's preview/status generator (`src/features/local-preview/`) verifies
a build against it and produces a Preview/Status Report. Honest status is mandatory — the report never claims a
success the Observer did not show.

---

## 1. What every built thing MUST declare — the Preview Manifest

Every factory-built thing (module / product-slice / app) declares a **preview manifest** — a plain, discoverable
data object (shape: `PreviewManifest` in `src/features/local-preview/local-preview.ts`):

| Field | Requirement |
|-------|-------------|
| `name` | the thing's name |
| `kind` | `module` \| `product-slice` \| `app` |
| `version` | explicit version (no floating) |
| `runCommands` | declared, **copy-pasteable** local commands (see §2). **Required:** `run`, `preview`, `status`. **Recommended:** `install`. |
| `demo` | optional `{ command, description }` — a demo/preview mode exercising the core capability with sample/seed data (see §3) |
| `capabilities` | non-empty list of `{ id, description, state }` where `state ∈ present \| partial \| absent` — the honest current-vs-missing view (see §4) |
| `artifacts` | declared artifact locators (paths) the build is expected to produce (may be empty for a source-only CLI; if declared, they must be observed present) |

The manifest is the **single discoverable source** for "how do I run and see this locally" — starting the thing
must never require reverse-engineering the code.

## 2. Required local run commands

`runCommands` declares the operator-facing commands. To be compliant a manifest MUST declare:

- **`run`** — how to start/use the thing locally on the laptop.
- **`preview`** — how to see it working (a local UI, a CLI with real output, or a demo run).
- **`status`** — a health/status check the operator can run to see the real state.

`install` (dependency install) is recommended. Commands are strings the operator can copy-paste.

## 3. Preview / demo convention

Where applicable, `demo` declares a **demo mode** that exercises the core capability with sample/seed data, so the
thing's value is legible without a full production setup. A demo is recommended for anything with a runnable
surface; its absence is reported (not a hard failure) so the operator knows preview depth.

## 4. Current-vs-missing status format (honest, structured)

`capabilities[]` is the honest state, each `{ id, description, state }`:

- `present` — implemented and working now.
- `partial` — partially implemented / limited.
- `absent` — declared/planned but **not yet** built.

The generated report surfaces `present` / `partial` / `missing` as **first-class** fields — "what's missing" is
never hidden. Overstating (marking `present` what the Observer shows did not build) is a standard violation.

## 5. Compliance (what the checker verifies)

A build is **local-preview-compliant** iff ALL hold, else it is **non-compliant** with the specific gaps listed:

1. **Required commands declared** — `run`, `preview`, `status` are all present.
2. **Capabilities declared** — at least one `capabilities[]` entry (the current-vs-missing view exists).
3. **Build succeeded** — the Run/Build Observer's `ObservationRecord.status === 'success'` for this build.
4. **Declared artifacts present** — every `artifacts[]` locator appears in the observation's captured artifacts
   (with an integrity hash). No declared artifacts ⇒ this check passes vacuously.

The checker consumes the Observer's `ObservationRecord` (capability #2) — it never re-runs or trusts a claim; the
build state comes from tamper-evident observation evidence, and generating a report is itself recorded to the
hash-chain audit.
