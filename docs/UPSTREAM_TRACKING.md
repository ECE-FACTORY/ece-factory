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

## Rejected (do not reconsider unless conditions met — see org FACTORY_REPO_INTELLIGENCE.md)
- **codenotary/immudb** — Business Source License (BSL). Rejected. Reconsider only if relicensed to a permissive allowlist license.
- **event-driven-io/emmett** — license unverifiable (no LICENSE file). Rejected. Reconsider only if a clear permissive LICENSE is added.

## Rules
- Every actually-forked repo records here: upstream URL, fork date, fork-point commit, upstream branch, upstream license, local modifications, upgrade/patch/security-update strategy (Layer 1.1 §11). To be filled when any code is forked at Phase 3.
- License notices preserved as the license requires; the PostgreSQL-License external-redistribution caveat (ORG_DECISION_LOG 2026-06-29) applies at the white-label release gate.
