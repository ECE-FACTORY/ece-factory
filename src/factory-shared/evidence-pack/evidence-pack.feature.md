# Feature — Evidence Pack Engine

**Path:** `src/features/evidence-pack/` · **Module:** 16 (Wave 1 ROOT) · **Status:** **built & tested** (Phase 4.4)
**Governs:** blueprint §16; Layer 0 §23 (machine-true evidence).

## Purpose
Make every build step provable. Models the Step Evidence Pack as a typed artifact and validates it, enforcing **machine-true evidence**: a load-bearing claim is invalid unless backed by verbatim command output.

## Model
`EvidencePack { stepIdentity, repositoryEvidence, commands[], loadBearingClaims[], proseClaims?[], policyGates, failuresRisksOpenItems[], proposedNextStep }`. `EvidenceCommand { id, command, output (verbatim), exitCode? }`. A `LoadBearingClaim { type, statement, evidenceCommandId }` cites a command by id.

## Machine-true-evidence guarantee (§16.2)
The validator's core job is to catch *the dangerous case*: a confident-sounding load-bearing claim with nothing executable behind it. For each load-bearing claim it checks: (1) the type is one of the five; (2) the cited command exists; (3) that command's `output` is **non-empty** — a claim with no captured output is **REJECTED as UNPROVEN**; (4) the output **corresponds** to the claim type (heuristic markers) so a claim can't cite the wrong evidence.

## Load-bearing vs prose
The model separates `loadBearingClaims` (typed, must cite verbatim output) from `proseClaims` (narrative context, not output-checked). Only load-bearing claims gate phase transitions, so only they are enforced. This is how the engine tells "tests passed (proven)" from "we believe this is solid" — the former is a typed claim that must cite a runner's output; the latter is prose.

## Required-section set (explicit)
`stepIdentity` (workflow/step/mode/environment), `repositoryEvidence`, `commands`, `loadBearingClaims`, `policyGates`, `failuresRisksOpenItems`, `proposedNextStep` (with a recommendation). A pack missing any is invalid.

## Load-bearing claim types
`test`, `lint`, `typecheck`, `build`, `license`.

## Correspondence-check depth (justified)
Correspondence is a **heuristic marker match** (the backing command/output must carry a keyword of the claimed type). It catches gross mismatches (a `license` claim backed by vitest output) but does **not** prove the output is authentic or that it is the exact run — that is the human reviewer's independent re-derivation (Layer 0 §22). The engine guarantees structure and presence-of-evidence; the human guarantees authenticity. This boundary is intentional and stated.

## Standalone packaging
Imports nothing from any other engine. Pure types + a pure validator. Independently packageable.

## Tests
Bare "tests passed" with no output ⇒ REJECTED (central); same claim with verbatim output ⇒ ACCEPTED; missing required section ⇒ REJECTED; each of the 5 types with/without output ⇒ REJECTED/ACCEPTED; evidence-of-wrong-type (license claim backed by test output) ⇒ REJECTED.

## Status
**Built & tested (Phase 4.4).** Pure-logic (no DB). Full suite green.

## Open Items
- Authenticity of captured output (was the command actually run, unedited?) is out of scope by design — the reviewer re-derives load-bearing facts from source (L0 §22).
