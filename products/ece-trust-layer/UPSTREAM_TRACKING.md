# Upstream Tracking — ECE Trust & Attestation Layer · Pillar 1 (VC)

> **Classification: INTERNAL ECE FACTORY trust/security module (factory infrastructure) — not a sellable product.** Upstream provenance (URLs / SPDX / pinned versions) below is the technical record and is unchanged.

Per `SOURCE_AND_BUILD_DOCTRINE.md` §7. This internal ECE Factory trust/security module **EXTENDS** the packages below (adopt-as-pinned-dependency behind the ECE API — not a diverged fork). Upstream licenses are preserved; upstream stays upstream.

| Upstream package | Upstream URL | SPDX (live-verified) | Adopted version (pinned = fork-point) | Role behind the ECE API |
|---|---|---|---|---|
| `@digitalbazaar/vc` | https://github.com/digitalbazaar/vc | BSD-3-Clause | 7.3.0 | VC issue/verify core |
| `@digitalbazaar/ed25519-signature-2020` | https://github.com/digitalbazaar/ed25519-signature-2020 | BSD-3-Clause | 5.4.0 | Ed25519 proof suite |
| `@digitalbazaar/ed25519-verification-key-2020` | https://github.com/digitalbazaar/ed25519-verification-key-2020 | BSD-3-Clause | 4.2.0 | Ed25519 key type |
| `@digitalbazaar/did-method-key` | https://github.com/digitalbazaar/did-key | BSD-3-Clause | 5.3.0 | `did:key` (no registry) |
| `@digitalbazaar/credentials-context` | https://github.com/digitalbazaar/credentials-context | BSD-3-Clause (code) + W3C Software & Document License (context data) | 3.2.0 | VC v1 `@context` |
| `ed25519-signature-2020-context` | https://github.com/digitalbazaar/ed25519-signature-2020-context | BSD-3-Clause | 1.1.0 | Ed25519-2020 `@context` |

## Adoption model & boundary
- **EXTEND, not fork-and-diverge.** ECE writes NO upstream code. The upstream libraries are consumed as pinned dependencies behind the ECE-owned surface (`ECETrustVC`, `generateIssuerKey`, the air-gap `documentLoader`, the attestation ledger). All ECE-specific behavior (sovereign roots, offline enforcement, bundled contexts, audit tie-in) lives in `src/` and is ECE's.
- **No coupling to ECE Factory internals** (per the product-packaging requirement): the attestation ledger reuses the factory's proven hash-chain *pattern* but is self-contained here; nothing is imported from the factory's `src/`.
- **Upgrade discipline:** versions are pinned exactly (no `^`/`~`). Any upstream bump is a deliberate, re-verified change (re-run the air-gap + tamper tests; re-confirm SPDX).
- **Air-gap manifest:** the exact `@context`s bundled for offline verification are enumerated by `BUNDLED_CONTEXT_URLS` (VC-v1, Ed25519-2020, and ECE's own attestation context). `did:key` needs no bundle.
