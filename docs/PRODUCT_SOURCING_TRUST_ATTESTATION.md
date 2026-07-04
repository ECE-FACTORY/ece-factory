# Product Sourcing Report — ECE Trust & Attestation Layer

> **Type:** SOURCING EVALUATION (harvest-first, per `SOURCE_AND_BUILD_DOCTRINE.md` §6). **No product built, nothing forked/cloned, no seed added as a dependency.** This is the evaluation that PRECEDES the human's build decision.
> **Governance:** subordinate to the Source & Build Doctrine (Layer 1) and the AI Repository Governance Contract (Layer 2). Verdicts require **live verification** — every license/maturity fact below was checked against the repo *as of 2026-07-02*, not from memory.
> **Verdict at a glance:** VC → **EXTEND** (digitalbazaar/vc) · Doc/media authenticity → **FORK** (contentauth/c2pa-rs via WASM) · Integrity log → **EXTEND the factory's own hash-chain audit** (no external seed). No pillar requires BUILD-from-scratch.

---

## 1. Product definition (what we are sourcing FOR)

The **ECE Trust & Attestation Layer** — a sovereign, air-gapped-first trust fabric: ONE PKI-rooted layer with three faces, verifiable **fully offline** against trust roots ECE controls (no public ledger, no external DID registry, no hosted verification service — the SENTINEL air-gap posture):

1. **Verifiable Credentials (VC)** — issue/hold/verify tamper-evident W3C VCs offline (local documentLoader, did:web/did:key, no blockchain).
2. **Document/media authenticity** — cryptographically signed, tamper-evident provenance for documents/certificates/media via standard PKI (X.509 / SHA-256 / digital signatures — NOT blockchain).
3. **Integrity/attestation log** — append-only, hash-chained tamper-evidence.

**Air-gap is the hard filter.** Any candidate with a mandatory public ledger, external DID resolver, hosted verification service, or network trust root is **disqualified** (doctrine §3.3).

---

## 2. Per-pillar candidate scoring (verified live 2026-07-02)

### Pillar 1 — Verifiable Credentials

| Candidate | License (verified) | Lang | Stars | Activity (verified) | Air-gap fit | Verdict |
|---|---|---|---|---|---|---|
| **digitalbazaar/vc** ★spine | **BSD-3-Clause** ✓ permissive | JavaScript | 217 | active (Digital Bazaar; W3C VC WG editors) | **YES** — caller-controlled `documentLoader` (`extendContextLoader`); did:key/did:web; keys+contexts resolved locally, no mandated service | **candidate spine** |
| walt-id/waltid-identity | **Apache-2.0** ✓ | Kotlin 90.8% / Vue / TS | 292 | very active (v0.21.3, 2026-07-02; 14,034 commits) | **partial/unconfirmed** — OID4VC (OpenID4VCI/VP) protocol-centric; pulls a **JVM runtime**; offline self-managed-key path not confirmed | alternate only |
| Sphereon-Opensource/SSI-SDK | **Apache-2.0** ✓ | TypeScript 99.9% | 75 | active (v0.40.0, 2026-06-05) but **self-labelled "Legacy"** | **PARTIAL → risk** — Veramo-dependent; defaults to an **external Universal Resolver (`dev.uniresolver.io`)**; project migrating to a new IDK | rejected as spine |

- **License:** all three permissive (BSD-3 / Apache-2.0) — none disqualified on license.
- **Air-gap:** `digitalbazaar/vc` is the cleanest — the `documentLoader` is *entirely* the caller's; ECE supplies contexts, DID docs, and keys from a bundled offline store. Sphereon's default external resolver is an **air-gap liability** (would need hardening to strip). walt.id leans on OID4VC *protocol* flows (often hosted issuers/wallets) and a JVM.
- **Maturity/standards:** Digital Bazaar authored much of the W3C VC Data Model; `vc` is the reference lineage. walt.id is the largest/most active but broader than we need. Sphereon is legacy.
- **Sovereign-hardenability:** with `vc`, ECE owns the whole trust surface (documentLoader, roots, suites choice); minimal upstream surface. High.
- **Stack:** `vc` = JS (native fit for the factory's TS/Node). walt.id = **+JVM** (second runtime). Sphereon = TS but Veramo baggage.

**Pillar 1 verdict → EXTEND `digitalbazaar/vc`.** Fork the proven VC crypto/suites + documentLoader machinery; ECE writes ONLY the gap: the sovereign offline documentLoader (ECE contexts/DIDs), trust-root wiring, revocation/status, and the unified issue/verify API. walt.id/Sphereon **rejected as spine** (JVM runtime / external-resolver air-gap liability + legacy).

### Pillar 2 — Document/media authenticity

| Candidate | License (verified) | Lang | Stars | Activity (verified) | Air-gap fit | Verdict |
|---|---|---|---|---|---|---|
| **contentauth/c2pa-rs** ★spine | **MIT AND Apache-2.0** ✓ dual-permissive | Rust 99.4% | 364 | **very active** — `c2patool-v0.26.68` (2026-06-22), 450+ releases | **YES** — standard **X.509 PKI**, SHA-256, digital signatures; **not blockchain**; verification takes caller trust anchors | **FORK (spine)** |
| contentauth/**c2pa-js** (binding home) | **MIT** ✓ | TS/Rust(WASM) | 24 | **active** — `@contentauth/c2pa-node@0.6.0` (2026-06-17); ships `c2pa-wasm`, `c2pa-node`, `c2pa-web`, `c2pa-types` | **YES** — `c2pa-wasm` runs offline in Node with no native toolchain; caller-provided anchors | **binding path** |
| contentauth/c2pa-node (v1) | MIT | Node | 20 | **ARCHIVED/deprecated 2025-09-22** → use successor | n/a | **REJECTED (dead)** |
| contentauth/c2pa-node-v2 | MIT | Node | 10 | **ARCHIVED 2026-06-22** → moved into `c2pa-js` | (offline confirmed) | **superseded** |

- **License:** `c2pa-rs` dual **MIT/Apache-2.0**; the JS bindings **MIT** — all permissive.
- **Air-gap (confirmed from the binding docs):** signing via `LocalSigner.newSigner(certBuffer, privateKeyBuffer, 'es256')`; verification via `trustAnchors` / `userAnchors` (PEM path or buffer). No transparency log, no network, no CAI cloud required → **ECE roots as the anchors** = exact fit.
- **Maturity/standards:** the reference implementation of the **C2PA** standard (Content Authenticity Initiative); the **Rust core is very stable** (450+ releases, current June 2026).
- **Sovereign-hardenability:** ECE writes **zero** C2PA crypto — it consumes the binding and supplies ECE trust anchors + brand. Small owned surface, large harvested value. High.
- **Stack:** Rust core; consumed from TS via **`c2pa-wasm` (WASM)** — bundled `.wasm`, offline, **no Rust build in the isolated environment**.

**Pillar 2 verdict → FORK `contentauth/c2pa-rs`**, integrated via **`c2pa-js`/`c2pa-wasm`** (MIT). ECE builds only the trust-root wiring + unified API + brand. ⚠️ **Live-check caught real churn:** the Node binding moved **c2pa-node → c2pa-node-v2 → c2pa-js monorepo** (two archivals in <1 yr). The **Rust core is stable**; the *JS packaging* is a moving target — see Risks.

### Pillar 3 — Integrity / attestation log

| Candidate | License | Air-gap fit | Verdict |
|---|---|---|---|
| **ECE's own `PostgresHashChainSink`** (`src/features/audit-engine/`) | ECE-owned (permissive, in-house) | **YES** — append-only + **per-org SHA-256 hash chain** + tamper-evident **`verifyChain`**, offline; tamper-tested since Wave 1 (T6) | **REUSE / EXTEND (owned)** |
| Sigstore **Rekor** / **Trillian** / **Tessera** (transparency logs) | Apache-2.0 | **PARTIAL/NO** — designed as networked, witnessed transparency logs; add operational + air-gap surface | reserved as **optional additive external-verifiability seam** (future, never required) |

**Pillar 3 verdict → EXTEND the factory's own hash-chain audit.** The append-only, SHA-256-chained, offline-`verifyChain` tamper-evidence the product needs **already exists, is proven, air-gapped, and ECE-owned**. Harvesting an external transparency log here would ADD a network dependency and air-gap risk for a capability we already own — a rare, well-justified "reuse-owned" over "fork-external." Trillian/Rekor/**Tessera** stay reserved as an *additive, offline-witness* seam for a future external-verifiability requirement, not a core dependency.

---

## 3. Unified stack recommendation (evaluation-driven, not defaulted)

The seeds span **JS (digitalbazaar/vc, TS)** and **Rust (c2pa-rs)**. The factory itself is **TypeScript/Node** (the Console, gate, MCP bridge, hash-chain audit, Policy Engine are all TS).

**Recommended spine: one TypeScript/Node layer**, with Rust encapsulated as a **prebuilt WebAssembly module**:

- **Pillar 1 (VC)** → native JS (`digitalbazaar/vc`), no FFI.
- **Pillar 2 (C2PA)** → the Rust core consumed as **`c2pa-wasm`** (a bundled `.wasm`) — runs offline in Node with **no native Rust toolchain in the air-gapped environment**. ECE writes no Rust.
- **Pillar 3 (log)** → the factory's existing TS/Postgres hash-chain audit — native.

**Why TS-spine + WASM (tradeoffs):**
- Unifying on the factory's **own language** reuses *everything already built and governed* in Waves 1–6 (gate, Decision Console, Policy Engine, hash-chain audit, MCP tiers) — the integration cost is near-zero and the governance is inherited.
- Encapsulating C2PA as **WASM** keeps the air-gap posture clean (no compiler/network at deploy) and avoids a doctrine violation (rewriting C2PA in TS would be a massive, unjustified BUILD).
- **Rejected alternatives, with reasons:** (a) *Rust spine + FFI to JS VC* — inverts the factory's language, loses the TS governance reuse; (b) *service boundary / Rust C2PA sidecar over loopback* — viable air-gapped **fallback** if the WASM/N-API binding proves fragile, but adds a second process/artifact for no benefit today; (c) *walt.id JVM* — a third runtime, rejected.

---

## 4. ECE surface vs upstream (the proprietary moat)

**Harvested (ECE writes NONE of this):** VC crypto/suites + documentLoader engine (`digitalbazaar/vc`); C2PA manifest sign/verify + X.509 handling (`c2pa-rs` via `c2pa-wasm`).

**ECE builds and OWNS (the moat):**
1. **Unified Trust API** — one façade over VC + C2PA + attestation log (issue / verify / revoke / attest).
2. **Sovereign trust-root management** — the ECE-controlled offline CA/roots, key custody (HSM-ready), rotation — the anchors both pillars consume. *This is the highest-value, highest-risk surface and is entirely ours.*
3. **Offline verification** — bundled documentLoader (ECE contexts + did:key/did:web mirror); C2PA `userAnchors` = ECE roots; zero network.
4. **The attestation log** — extend the factory's hash-chain audit as the append-only issuance/revocation/verification ledger with offline `verifyChain`.
5. **Console / governance integration** — issuance, revocation, and trust-root changes as **gated actions** through the Decision Console + gate + Policy Engine (glass-box, human-approved, audited).
6. **Arabic-first + white-label brand layer.**

---

## 5. Air-gap verification architecture

- **One ECE-controlled PKI root** (offline CA; keys in ECE custody / HSM). Nothing outside ECE is a trust anchor.
- **VC:** verify with a **local documentLoader** — ECE `@context`s and DID documents (prefer **did:key**; for **did:web**, resolve from a **local mirror/bundle**, never live HTTPS) loaded from disk. No ledger, no external resolver.
- **C2PA:** verify against ECE **trust anchors** (`userAnchors`, PEM) passed by the caller; `c2pa-wasm` runs in-process offline. No CAI cloud, no transparency log.
- **Integrity log:** the factory's local, per-org **SHA-256 hash chain**; tamper-evidence proven offline via `verifyChain`. No network witness required.
- **Nothing phones home.** Verification is fully offline against ECE roots — identical posture to the audit engine and the live-external gating already shipped.
- **Optional future seam:** a **Tessera/Trillian** offline witness for cross-org external verifiability — *additive, gated, never required for core operation.*

---

## 6. Risks / disqualifiers found

1. **C2PA JS binding churn (biggest productization risk).** `c2pa-node → c2pa-node-v2 → c2pa-js` (two archivals in <1 yr). Mitigation: the **stable Rust core is the real dependency** — pin an **exact** `c2pa-rs`/`c2pa-wasm` version, **vendor the prebuilt `.wasm`**, and keep the **C API / local Rust sidecar** as an offline fallback. No floating versions, ever.
2. **did:web offline nuance.** did:web normally resolves over HTTPS; in air-gap ECE must resolve from a local mirror or **prefer did:key**. Design decision, not a blocker.
3. **Sphereon SSI-SDK — REJECTED as spine.** Default external Universal Resolver (`dev.uniresolver.io`) = air-gap liability; self-labelled "Legacy."
4. **walt.id — not the spine.** Adds a JVM runtime and is OID4VC-protocol-centric; keep only if hosted OID4VC wallet flows become a hard requirement.
5. **Trust-root custody is ECE's to build** — the moat *and* the sharpest risk surface (key custody, rotation, revocation). This is legitimate BUILD (the gap), concentrated exactly where the doctrine says custom code belongs.
6. **No BUILD-from-scratch pillar** — consistent with the doctrine's expectation (most sub-domains FORK/EXTEND); no red flag.

---

## 7. Candidate registry entries (for the sourcing/product registry)

> Recorded here as the candidate registry. **Committing these to the append-only Postgres project/domain registry is itself a gated, audited write** — deferred to the human's build decision (no ungated registry writes in a sourcing evaluation).

| # | Sub-domain | Candidate | URL | SPDX | Lang | Verified activity | Air-gap | Role | Verdict |
|---|---|---|---|---|---|---|---|---|---|
| 1 | VC | digitalbazaar/vc | github.com/digitalbazaar/vc | BSD-3-Clause | JS | active, 217★ | yes (caller documentLoader) | **spine** | EXTEND |
| 2 | VC (alt) | walt-id/waltid-identity | github.com/walt-id/waltid-identity | Apache-2.0 | Kotlin/JVM | v0.21.3 2026-07-02, 292★ | partial (JVM/OID4VC) | alt | reject-as-spine |
| 3 | VC (alt) | Sphereon SSI-SDK | github.com/Sphereon-Opensource/SSI-SDK | Apache-2.0 | TS | v0.40.0 2026-06-05, legacy | **partial (ext resolver)** | — | REJECT |
| 4 | Doc/media | contentauth/c2pa-rs | github.com/contentauth/c2pa-rs | MIT AND Apache-2.0 | Rust | c2patool 0.26.68 2026-06-22, 364★ | yes (X.509 anchors) | **spine** | FORK |
| 5 | Doc/media (binding) | contentauth/c2pa-js | github.com/contentauth/c2pa-js | MIT | TS/WASM | c2pa-node 0.6.0 2026-06-17 | yes (c2pa-wasm offline) | binding | FORK |
| 6 | Integrity log | ECE PostgresHashChainSink | src/features/audit-engine/ | ECE-owned | TS | proven Wave 1 (T6) | yes (offline verifyChain) | **spine (owned)** | EXTEND |
| — | Integrity log (future) | Sigstore Rekor / Trillian / Tessera | — | Apache-2.0 | Go | active | partial (networked) | optional witness | reserved/additive |

---

## 8. How this product routes through the EXISTING factory

1. **This report → the Decision Console.** The FORK/EXTEND/BUILD decision is a consequential action: a real human operator approves/refuses it through the gate (single-operator flow; the Policy Engine may advise, never decide). No build begins without that human gate.
2. **On approval → doctrine §7 handoff.** Forks are assembled into the product repo; each fork's origin, upstream URL, SPDX, and fork-point commit recorded in `docs/DECISION_LOG.md` + `docs/REPO_AUDIT.md`. The AI Repository Governance Contract takes over.
3. **Runtime governance (inherited, not rebuilt).** Issuance / revocation / external attestation are **APPROVAL_REQUIRED_WRITE / external** actions through the **MCP bridge's gated tiers** + the **Decision Console** + the **Policy Engine** (advisory) — each a single-use, human-approved, per-action token, **audited in the hash chain** (glass-box). **Sovereign trust-root changes are gated + audited exactly like policy changes** (Wave 6 Piece 3).
4. **Air-gap + sole-authority preserved.** Verification is offline against ECE roots; consequential actions carry the unforgeable per-action human token; nothing commits without the gauntlet.

---

## 9. RECOMMENDATION BLOCK (for the human to approve or redirect)

- **Pillar 1 — Verifiable Credentials: EXTEND `digitalbazaar/vc`** (BSD-3-Clause). ECE writes the sovereign offline documentLoader + trust-root wiring + revocation + unified API. *Reject walt.id (JVM) and Sphereon (external-resolver air-gap liability, legacy) as the spine.*
- **Pillar 2 — Document/media authenticity: FORK `contentauth/c2pa-rs`** (MIT/Apache-2.0) via **`c2pa-js`/`c2pa-wasm`** (MIT). ECE writes no C2PA crypto — integrate + ECE trust anchors + brand. *Pin exact version, vendor the `.wasm`, keep C-API/sidecar fallback (binding churn).*
- **Pillar 3 — Integrity log: EXTEND the factory's own `PostgresHashChainSink`** (owned, proven, offline `verifyChain`). *No external seed; reserve Tessera/Trillian as an optional additive offline-witness seam.*
- **Unified stack: one TypeScript/Node layer**; Rust encapsulated as bundled **WASM**; reuse the factory's Console/gate/Policy/audit wholesale.
- **Effort-to-productize:** medium. **Biggest risk:** the C2PA JS binding packaging churn (mitigated by pinning the stable Rust core + vendoring the WASM).
- **BUILD (the gap ECE owns):** the unified Trust API, sovereign trust-root/key custody, offline verification wiring, and Console/governance integration — exactly where the doctrine says custom code belongs.

**No product built. Nothing forked, cloned, or added as a dependency. Awaiting the human's build decision.**
