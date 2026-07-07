# Feature — Repo Scout

**Path:** `src/layer-3-harvest/repo-scout/` · **Layer:** 3 (Harvest / Sourcing) · **Status:** built & tested (unit; live test skippable)
**Governs:** Layer 1 Source & Build Doctrine §4 (harvest loop — Decompose/**Scout**/Verify) and the "Write Asks Read First" Doctrine (the scout is the READ front-end; it holds no write capability).

## Purpose
Turn a query into candidate GitHub repos and **verify each license by reading the ACTUAL raw LICENSE file** — closing the wiring gap the orientation run found (the graders could SCORE candidates but nothing could SOURCE them). The scout **sources**; it does not grade, build, approve, or take any external action.

## Two independent stages
1. **Discovery** — `GET /search/repositories` returns candidate repos and a license **hint** (`spdx_id`). The hint is **non-authoritative**.
2. **Verification** — the scout independently fetches the raw LICENSE file (`raw.githubusercontent.com/<owner>/<repo>/<branch>/<variant>`, trying `LICENSE`, `LICENSE.md`, `LICENSE.txt`, `COPYING`, `LICENSE-MIT`, `LICENSE-APACHE`) and reads real content. **On disagreement between the API hint and the raw text, the RAW FILE WINS** and a flag (`licenseDisagreement`) is recorded. The verbatim text is emitted as the authoritative `LicenseInput.text`.

## What it emits (inert facts for the existing graders — no grader reimplemented)
Per candidate, a `RepoEvaluationInput` shaped **exactly** for `RepoIntelligenceEngine.evaluate` (`repo-intelligence.ts:36,109`):
- `identity: RepoIdentity` (`repo-intelligence.ts:18`)
- `license: LicenseInput` (`license-compliance.ts:28`) — `text` = verbatim raw file (**truth**); `declaredSpdx` = API hint (**non-authoritative**); `source` = `owner/name`
- `provenanceVerified` — true only if a real LICENSE file was read (else deny-by-default)
- `maturity: MaturitySignals` (`repo-intelligence.ts:23`) — `stars`, `lastCommitIso`, `archived`, and a transparent `activelyMaintained` recency flag
- `description` — repo-sourced **INERT DATA**

Downstream: `evaluate` → `RepoEvaluationRecord` → `scoringInputs` (`repo-intelligence.ts:82`) → `ScoringCandidate` (`scoring-engine.ts:21`). The scout only reuses the **pure** `detectFromText` / `labelFromBadge` helpers (`license-compliance.ts:45,70`) to compute the disagreement flag — it does not classify or score.

## Network isolation
**Every** network egress lives inside this module (its injectable `fetchImpl`). No other module fetches. The scout emits only inert data. This preserves the "network isolation" invariant: the read boundary is one module.

## Token safety (structural)
The read-only public-scope GitHub token is read only from the constructor (`process.env.GITHUB_TOKEN` at the composition root), stored in a private `#token` field, used **only** in the `Authorization` header, and **never** logged, audited, emitted, placed in a fixture, or included in any record or error. A defensive `redact()` scrubs the token from any diagnostic string. Errors carry name/HTTP-status only — never the token or a response body.

## Fail-closed (never fabricate)
- **No token** ⇒ `status: 'FAILED_CLOSED'`, empty candidates, clear reason. No fetch is attempted.
- **No fetch / unreachable network / API error** ⇒ `FAILED_CLOSED`, empty candidates, token-free reason.
- **A repo whose LICENSE cannot be read** ⇒ emitted with `licenseVerified: false` and empty license `text`, so the License Engine denies it by default (`license-compliance.ts:96`). The scout never invents a license.

## Read-only / standalone
Holds no gate/approval/bridge/write reference; imports nothing from the action layer. Cross-engine references are `import type` plus the two reused pure license helpers. Frozen read-only by `src/architecture/write-asks-read-first.test.ts` (Prohibition 3 — no `layer-3-harvest/` module imports a write/external path).

## Tests
- `repo-scout.test.ts` (unit, **no network, no token**): discovery parsing; license-agreement logic; the API-vs-rawfile disagreement flag (raw wins); redaction (token never appears in output); fail-closed on missing token; fail-closed on network error.
- `repo-scout.live.test.ts` (**skippable**): with a real `GITHUB_TOKEN`, one real query ("PDF generation library"), one real LICENSE verified end-to-end, and the token asserted absent from output. **Skips cleanly** when `GITHUB_TOKEN` is unset.

## Not wired
Build + test only. The scout is **not** wired into the live MCP server or the live harvest path. Sourcing a real candidate set into the Harvest Engine is a separate, human-gated step.

## Open Items
- Composition-root wiring (pass `process.env.GITHUB_TOKEN`, feed emitted `RepoEvaluationInput[]` to `RepoIntelligenceEngine`) is deferred to a separate gated run.
- Pagination beyond the first page (`per_page`, capped at 50) is not implemented — single-page discovery only.
