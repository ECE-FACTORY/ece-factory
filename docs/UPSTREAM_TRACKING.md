# Upstream Tracking — ECE Factory

> Per Layer 1.1 §11. Every sourced/forked dependency stays traceable to upstream. Module 23 (Audit Engine) sources below. No code is forked yet — these are the approved sourcing decisions and the licenses verified live (Phase 2A).

## Adopted (Module 23 — Audit Engine)

| Component | Upstream | License (SPDX, read from LICENSE file) | Role | Fork/adopt status |
|-----------|----------|----------------------------------------|------|-------------------|
| PostgreSQL | https://www.postgresql.org/ (mirror: github.com/postgres/postgres) | PostgreSQL License (allowlist-ratified 2026-06-29) | **Spine** — append-only audit storage, RLS, privilege model, triggers | Adopted as infrastructure (not forked); pinned version recorded at Phase 3.0 |
| pgaudit | https://github.com/pgaudit/pgaudit | PostgreSQL License (allowlist-ratified 2026-06-29) | Optional DB-layer audit (defense-in-depth) | Not yet integrated; optional Phase 3.6. Pin fork-point commit if vendored |

## Reserved escalation options (NOT adopted now — behind the ARCHITECTURE §8 seam)

| Component | Upstream | License (SPDX, read from LICENSE file) | Role | Status |
|-----------|----------|----------------------------------------|------|--------|
| Trillian | https://github.com/google/trillian | Apache-2.0 | External-verifiability (verifiable Merkle log) — `VerifiableLogSink` | Reserved; attach only if a sovereign client mandates externally-verifiable crypto audit |
| Rekor | https://github.com/sigstore/rekor | Apache-2.0 | Transparency-log alternative | Reserved (reference) |
| Tessera | (sigstore/trillian-tessera ecosystem) | Apache-2.0 (verify live before adoption) | Lightweight verifiable-log alternative | Reserved (reference) — license to be re-verified live at adoption time |

## Build toolchain (Phase 3.0 — dev dependencies only, exact-pinned)

Direct dev dependencies, license verified **live from the npm registry** (`npm view <pkg>@<ver> license`). No application/runtime dependencies, no PostgreSQL client, no crypto libs, no engine deps.

| Dependency | Exact version | SPDX (live) | Allowlist status |
|------------|---------------|-------------|------------------|
| typescript | 6.0.3 | Apache-2.0 | ✅ accepted |
| vitest | 4.1.9 | MIT | ✅ accepted |
| eslint | 10.6.0 | MIT | ✅ accepted |
| typescript-eslint | 8.62.0 | MIT | ✅ accepted |
| @types/node | 26.0.1 | MIT | ✅ accepted |
| pg (node-postgres) | 8.22.0 | MIT | ✅ accepted — added Phase 3.1 (run migration/T5/T8 tests against real PostgreSQL) |
| @types/pg | 8.20.0 | MIT | ✅ accepted — added Phase 3.1 |

**Full transitive tree scan (145 packages, Phase 3.1):** MIT 110 · Apache-2.0 15 · ISC 9 · BSD-2-Clause 6 · MPL-2.0 2 · BSD-3-Clause 2 · BlueOak-1.0.0 1. **Copyleft/SSPL/BSL: 0. Unknown: 0.** All are permissive (all on the ratified allowlist). `package-lock.json` pins the entire tree for reproducible offline (air-gap) builds.

- **MPL-2.0 (2):** `lightningcss@1.32.0`, `lightningcss-darwin-arm64@1.32.0` — MPL-2.0 is on the accepted allowlist. ✅
- **⚠ BlueOak-1.0.0 (1):** `minimatch@10.2.5` (verified live) — permissive, OSI-approved, non-copyleft, MIT-equivalent, but **not on the enumerated allowlist**. **Flagged for human ratification** (same posture as PostgreSQL License + ISC). Not silently accepted. See OPEN_ITEMS / evidence pack. Recommendation: ratify BlueOak-1.0.0 into the accepted set.

## Rejected (do not reconsider unless conditions met — see org FACTORY_REPO_INTELLIGENCE.md)
- **codenotary/immudb** — Business Source License (BSL). Rejected. Reconsider only if relicensed to a permissive allowlist license.
- **event-driven-io/emmett** — license unverifiable (no LICENSE file). Rejected. Reconsider only if a clear permissive LICENSE is added.

## Rules
- Every actually-forked repo records here: upstream URL, fork date, fork-point commit, upstream branch, upstream license, local modifications, upgrade/patch/security-update strategy (Layer 1.1 §11). To be filled when any code is forked at Phase 3.
- License notices preserved as the license requires; the PostgreSQL-License external-redistribution caveat (ORG_DECISION_LOG 2026-06-29) applies at the white-label release gate.
