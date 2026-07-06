# Feature — White-Label Hardening Engine

**Path:** `src/features/white-label/` · **Module:** 13 (Wave 3) · **Status:** **built & tested** (Phase 6.3)
**Governs:** Layer 1.1 §9 (white-label hardening).

## Purpose
Classify each branding/legal element of a sourced product and produce a per-element action list + a white-label readiness verdict — without ever recommending a license violation.

## Classification taxonomy
- **must-keep** — legal attribution, license notice (Apache NOTICE, MIT/BSD copyright lines), required "powered by" clauses. Action: **preserve** (never strip).
- **replaceable** — logo, product name, UI reference, email template, domain, CLI name, favicon, doc branding. Action: **replace** with ECE branding.
- **trademark-caution** — names/marks that may carry trademark obligations even under a permissive code license. Action: **review**.
- **disable** — telemetry, analytics keys, update-check URLs, support links, phone-home. Action: **disable**.

## Legal core — must-keep is never stripped
The engine **never** emits a strip/replace/disable action for a `must-keep` element — it only ever returns **preserve**. If the requested white-labeling would require removing a legally-required notice (`whiteLabelingRequiresRemoval`), the verdict is **Blocked-by-legal-obligation**, and the element's action stays **preserve** with a flagged `legalConflict`. Stripping an Apache NOTICE or an MIT copyright line is a license violation, not white-labeling, and the engine structurally refuses to recommend it.

## Deny-by-default
An **unclassified** element (no category) is **not** treated as replaceable — it is mapped to **trademark-caution / needs-review** ("might be legally required"). When unsure whether something is legally required, the safe assumption is "might be," not "probably just branding."

## Verdict semantics
- any must-keep with `whiteLabelingRequiresRemoval` ⇒ **Blocked-by-legal-obligation**
- else any replace/disable/review action ⇒ **Ready-after-stripping**
- else (only preserve, nothing to strip) ⇒ **Ready**

## Standalone packaging
Imports nothing from any other engine. Pure function over a typed element list. Independently packageable.

## Tests
Replaceable ⇒ replace action; must-keep license notice ⇒ preserve, never stripped (legal-core); white-labeling that requires removing a required attribution ⇒ Blocked-by-legal-obligation (still preserve, not strip); unclassified ⇒ trademark-caution/review (deny-by-default); telemetry ⇒ disable; the three verdict cases; structural — no must-keep ever gets a non-preserve action.

## Status
**Built & tested (Phase 6.3).** Pure-logic. Full suite green.

## Open Items
- A scanner that *discovers and classifies* branding/legal elements from a real repo (NOTICE files, package metadata, UI strings, telemetry endpoints) is a later integration; this engine assesses a supplied, classified element list, deny-by-default on the unclassified.
