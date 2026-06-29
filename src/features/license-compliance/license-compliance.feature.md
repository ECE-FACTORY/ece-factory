# Feature — License & Compliance Engine

**Path:** `src/features/license-compliance/` · **Module:** 10 (Wave 1 ROOT) · **Status:** **built & tested** (Phase 4.5)
**Governs:** blueprint §10; Layer 1 §3.1; ORG_STANDARDS.md accepted-license list.

## Purpose
Prevent unsafe licenses from entering ECE white-labeled products. Classify a component's license and produce a whole-stack compatibility verdict.

## Core guarantee — text over badge
The classifier decides from the **actual LICENSE text**, not a declared badge/SPDX field. When a badge and the text disagree, **the text wins** — the immudb lesson (badge/reputation "Apache", actual text Business Source License ⇒ REJECT). Badge-only (no text) ⇒ NEEDS_REVIEW (or REJECT if the badge itself claims a rejected license), because a badge alone is unverifiable.

## Decision model
`classifyLicense({ text?, declaredSpdx?, source? }) → { decision: ACCEPT|REJECT|NEEDS_REVIEW, detected, reason, badgeContradiction }`:
- detected (from text) ∈ **accepted allowlist** ⇒ ACCEPT
- detected ∈ **rejected set** ⇒ REJECT
- detected is **off-allowlist but permissive** ⇒ NEEDS_REVIEW (human ratification — the BlueOak posture, never silent ACCEPT)
- text **unrecognized** ⇒ NEEDS_REVIEW (manual identification)
- **empty / no text & no badge** ⇒ REJECT (unverifiable)

## Allowlist / rejected sets (as implemented)
- **Accepted:** Apache-2.0, MIT, BSD-2-Clause, BSD-3-Clause, MPL-2.0, PostgreSQL, ISC, BlueOak-1.0.0.
- **Rejected:** GPL, LGPL, AGPL, SSPL, BSL/BUSL, Elastic-2.0, Commons-Clause, NonCommercial (and unverifiable/empty).
- **Off-allowlist permissive (⇒ NEEDS_REVIEW):** Unlicense, Zlib, 0BSD.

## Stack-compatibility verdict
`stackVerdict(results)`: any REJECT ⇒ **Collision-blocking**; else any NEEDS_REVIEW ⇒ **Collision-resolvable**; else (all ACCEPT) ⇒ **Clean**.

## Detection depth (justified)
Detection is signature/keyword based on license text. It reliably identifies the standard licenses and the rejected families, and resolves badge-vs-text conflicts in favor of the text. It is not a full legal parser — a genuinely novel or heavily-modified license falls to NEEDS_REVIEW (human reads it), which is the safe direction. Authenticity of the supplied text (was it the real default-branch LICENSE?) remains the harvester/reviewer's live-verification duty (Layer 1 §3).

## Standalone packaging
Imports nothing from any other engine. Pure functions. Independently packageable.

## Tests
BSL/SSPL/GPL/AGPL ⇒ REJECT; the 8 allowlisted licenses ⇒ ACCEPT; off-allowlist permissive ⇒ NEEDS_REVIEW; empty ⇒ REJECT; **immudb-BSL regression** (badge "Apache-2.0", text BSL ⇒ REJECT + badgeContradiction); stack with one rejected ⇒ Collision-blocking; all-allowlisted ⇒ Clean.

## Status
**Built & tested (Phase 4.5).** Pure-logic. Full suite green. **Wave 1 ROOTs complete.**

## Open Items
- Detection signatures cover the common licenses; expand as new licenses are encountered (new licenses safely fall to NEEDS_REVIEW).
- Text authenticity (real default-branch LICENSE) is verified live at harvest time, not by this engine.
