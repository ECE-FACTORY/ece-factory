# Harvest Report — ECE Trust & Attestation Layer · Pillar 1 (Verifiable Credentials)

> **Classification: INTERNAL ECE FACTORY trust/security module — NOT a sellable product (yet).** This harvest record covers factory infrastructure; the "product" doctrine headings below are the doctrine's §6 template — the harvested provenance FACTS (upstream URLs, SPDX, pinned versions) are the technical record and are unchanged. Tier-0 / product-packaging apply only if/when the factory is complete and this is promoted to a product.
>
> Per `SOURCE_AND_BUILD_DOCTRINE.md` §6. Verdict: **EXTEND**. Verified live 2026-07-02/03 (LICENSE files + npm metadata + empirical air-gap spike — not from memory/badges).

## Sub-domain: Verifiable Credentials — **VERDICT: EXTEND**

**Spine repo:** `@digitalbazaar/vc` — https://github.com/digitalbazaar/vc
- **SPDX (live-verified, from the LICENSE file):** **BSD-3-Clause**. ⚠️ *Correction:* `registry/ORG_DECISION_LOG.md` labelled this "Apache-2.0"; the actual LICENSE file (and the npm `license` field) is **BSD-3-Clause**. Both are permissive and doctrine-§3.1-compliant, so the verdict stands — but the recorded SPDX is corrected here per "verify the actual LICENSE file, not the badge."
- **Primary language:** JavaScript. **Role:** spine (VC crypto/suites + documentLoader machinery).
- **Air-gap readiness:** **YES** — caller-controlled `documentLoader`; empirically proven offline (spike: local-only loader throwing on remote still returned `verified:true`; tamper ⇒ fail; `did:key` resolves from the key, no registry).
- **Maturity:** W3C VC reference lineage (Digital Bazaar); actively maintained.
- **White-label friction:** none of note — ECE wraps it behind its own API; no branding/telemetry to strip.

**Supporting repos (all live-verified BSD-3-Clause):**
| Package | SPDX | Role |
|---|---|---|
| `@digitalbazaar/ed25519-signature-2020` | BSD-3-Clause | Ed25519 proof suite |
| `@digitalbazaar/ed25519-verification-key-2020` | BSD-3-Clause | Ed25519 key type |
| `@digitalbazaar/did-method-key` | BSD-3-Clause | `did:key` (no registry) |
| `@digitalbazaar/credentials-context` | BSD-3-Clause (code) + **W3C Software and Document License** (context data) | VC v1 `@context` |
| `ed25519-signature-2020-context` | BSD-3-Clause | Ed25519-2020 `@context` |

**Exact adopted versions (pinned, no floating ranges):**
```
@digitalbazaar/vc@7.3.0
@digitalbazaar/ed25519-signature-2020@5.4.0
@digitalbazaar/ed25519-verification-key-2020@4.2.0
@digitalbazaar/did-method-key@5.3.0
@digitalbazaar/credentials-context@3.2.0
ed25519-signature-2020-context@1.1.0
```
Adoption model: **adopt-as-pinned-dependency** (EXTEND behind the ECE API), not a source fork. The "fork point" is the exact version above.

**What is missing (the ECE gap — custom code, the moat):** the unified sovereign VC API; ECE trust-root/key management (`did:key`); the offline air-gap documentLoader + bundled-context manifest; the hash-chain attestation ledger tie-in; (later) Console/gate governance integration, revocation, and Arabic-first/white-label.

## Rejected candidates (live-verified)
- **Sphereon SSI-SDK** (Apache-2.0, TS) — **REJECTED**: defaults to an external Universal Resolver (`dev.uniresolver.io`) → air-gap liability; self-labelled "Legacy".
- **walt.id / waltid-identity** (Apache-2.0) — **not spine**: Kotlin/JVM runtime + OID4VC-protocol-centric; offline self-managed-key path unconfirmed.

## Module-level summary (factory infrastructure)
- **Stack composition (this slice):** the 6 pinned packages above, behind the ECE VC API. TypeScript/Node spine (Node 26 native TS).
- **License-compatibility verdict:** **CLEAN** — all BSD-3-Clause (+ W3C S&D for context data), all permissive, compose into one white-labelable ECE distribution. No copyleft/SSPL/BSL.
- **Air-gap readiness:** **YES** — offline issue + verify proven; the remote-throwing loader is the enforcement.
- **Integration/custom-code layer ECE owns:** the sovereign API, trust roots, offline verification, the hash-chain attestation ledger, and (next) the governance/Console integration.
- **UAE sovereign gap this fills:** offline-verifiable, ECE-root-controlled credentials with no dependence on any public ledger/registry/cloud verifier.
- **Effort-to-integrate (into the factory):** low–medium for this pillar. **Biggest risk:** none for VC (offline de-risked); did:web (if later adopted) needs a local DID mirror — this slice uses did:key.
