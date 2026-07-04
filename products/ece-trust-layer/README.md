# ECE Trust & Attestation Layer

> **Classification: INTERNAL ECE FACTORY trust/security module (factory infrastructure) — NOT a sellable product (yet).**
> Per the recorded classification reset (`registry/FACTORY_COMPLETION_PLAN.md`, governance repo), no sellable products exist until the factory is complete. This module is **internal factory infrastructure** — evidence/credential signing & verification, provenance, audit + release attestations, offline verification, package-release integrity, and trust-root handling for the factory itself. It is **not** to be published as `ECE-PLATFORMS/ece-trust-layer`. The Tier-0 product-repo standard and product-packaging apply **later** — only if/when the factory is complete and this is ever promoted to a product.

A sovereign, **air-gapped-first** trust fabric — an **internal ECE Factory trust/security module**, part of the factory (not a standalone product).

**This slice — Pillar 1: Verifiable Credentials (vertical slice 1).** Issue and verify tamper-evident W3C Verifiable Credentials **fully offline**, against trust roots ECE controls (`did:key` — the key *is* the root; no external registry, ledger, or verification service).

## What it does (this slice)
- `generateIssuerKey()` — mint + hold a sovereign ECE issuer key (Ed25519 → `did:key`).
- `ECETrustVC.issueCredential(claim, issuerKey)` — issue a signed `ECEAttestation` credential.
- `ECETrustVC.verifyCredential(vc)` — verify **offline** against ECE roots. The documentLoader **throws on any remote URL** — a network reach is a loud failure, never a silent success.
- Every issue/verify is recorded to an append-only, SHA-256 **hash-chained attestation ledger** (`verifyChain`) — tamper-evident and inspectable.

## Air-gap guarantee
Verification resolves **only** locally-bundled `@context`s (the air-gap packaging manifest) or a `did:key` (from the key itself). Any other URL throws. Empirically proven — see `test/vc-pillar.test.ts` (`verified:true` with the remote-throwing loader; tamper ⇒ fail).

## Design: EXTEND, not fork
The ECE API is the sovereign surface; it **wraps** `@digitalbazaar/vc` + the Ed25519 suite + `did:key` (upstream, BSD-3-Clause) behind `issueCredential`/`verifyCredential`. Upstream stays upstream (see `UPSTREAM_TRACKING.md`); ECE owns the API, the sovereign trust roots, the offline verification, the attestation ledger.

## Build / test
Standalone workspace (own `package.json`, own deps, own test runner — no coupling to factory internals):
```
cd products/ece-trust-layer
npm install
npm test          # node --test (Node 26 native TS)
```

## Not in this slice
C2PA/media (Pillar 2a), document signatures (Pillar 2b), revocation/status lists, wallets, external DID methods, the unified multi-pillar API, UI. Thin and complete: issue + verify a sovereign VC, offline, tamper-evident, audited.

© Emirates Cloud Enterprises. Internal ECE Factory infrastructure — ECE-owned, not open source, not a product. Upstream components remain under their permissive licenses (see `UPSTREAM_TRACKING.md`).
