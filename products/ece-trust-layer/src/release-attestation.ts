// ECE Trust Layer — Release/Package Attestation + Signing (Factory capability #5, slice 1).
//
// INTERNAL factory infrastructure: the trust module gains the ability to sign the factory's OWN release/package
// artifacts (the ones capability #4 produces) so releases are tamper-evident and offline-verifiable against an
// ECE-controlled root. It REUSES the VC slice's primitives — Ed25519 signing, did:key sovereign root, the
// air-gap (remote-throwing) document loader, and the hash-chain attestation ledger — and adds NO crypto.
//
// WHAT IT BINDS: given a capability-#4 PackageManifest, it produces a signed Release Attestation that
// cryptographically binds the package identity + version, the artifact SHA-256 checksums, the SBOM digest, the
// source build-observation reference (#2), and the compliance verdict at package time (#3/#4). Any tamper of any
// bound field ⇒ offline verification FAILS.
//
// AIR-GAP (load-bearing): sign + verify are fully offline against the ECE did:key root — no external registry,
// no network at verify time (the reused air-gap loader throws on any remote URL). A verifier pins the ECE root.
//
// SIGN/VERIFY-ONLY (safety): this module holds NO gate/approval/mint/bridge reference and cannot initiate a
// consequential action or modify the package/manifest — it reads the manifest, signs, verifies, and records to
// the hash-chain ledger. Producing a signed attestation is a crypto/generate step, NOT a gated external action.
// Publishing/distributing the signed release externally remains a FUTURE GATED action — out of scope here (this
// module has no publish/release/upload method and reaches no network).

import { createHash } from 'node:crypto';
import { ECETrustVC, type SignedCredential } from './vc-api.ts';
import type { IssuerKey } from './trust-roots.ts';
import type { AttestationLog } from './attestation-log.ts';

/** One artifact reference from a #4 PackageManifest — path + SHA-256 checksum + size. */
export interface ReleaseArtifactRef { path: string; sha256: string; bytes: number }

/**
 * Structural shape of capability #4's PackageManifest (the fields #5 binds). Structural typing — NO import
 * coupling to the main app; #5 consumes the exact object #4 emits.
 */
export interface ReleasePackageManifest {
  name: string;
  version: string;
  kind: string;
  artifacts: ReleaseArtifactRef[];
  sbom: unknown;
  sourceObservationId: string;
  complianceAtPackage: { compliant: boolean; gaps: string[] };
}

export interface ReleaseAttestation {
  name: string;
  version: string;
  /** SHA-256 over all bound fields — the cryptographic binding carried (signed) in the credential. */
  releaseDigest: string;
  sbomDigest: string;
  /** the ECE-controlled did:key root that signed it */
  issuer: string;
  /** the offline-signed VC (Ed25519Signature2020) that binds the digest */
  credential: SignedCredential;
}

export interface ReleaseVerifyResult { verified: boolean; reason?: string }

// ── canonicalization + digests (deterministic; reuses node:crypto — no new crypto) ──────────────────────────
function sortDeep(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortDeep);
  if (v && typeof v === 'object') {
    const src = v as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(src).sort()) out[k] = sortDeep(src[k]);
    return out;
  }
  return v;
}
function canonical(v: unknown): string { return JSON.stringify(sortDeep(v)); }
function sha256Hex(s: string): string { return createHash('sha256').update(s).digest('hex'); }

/** SHA-256 over the canonical SBOM — bound into the release digest so a swapped SBOM is detectable. */
export function sbomDigest(sbom: unknown): string { return sha256Hex(canonical(sbom)); }

/**
 * The canonical release digest — binds identity+version+kind, the artifact checksums, the SBOM digest, the
 * source build-observation reference, and the compliance verdict. Changing ANY bound field changes the digest.
 */
export function releaseDigest(m: ReleasePackageManifest): string {
  const bound = {
    name: m.name,
    version: m.version,
    kind: m.kind,
    artifacts: [...m.artifacts]
      .map((a) => ({ path: a.path, sha256: a.sha256, bytes: a.bytes }))
      .sort((x, y) => (x.path < y.path ? -1 : x.path > y.path ? 1 : 0)),
    sbomDigest: sbomDigest(m.sbom),
    sourceObservationId: m.sourceObservationId,
    compliance: { compliant: m.complianceAtPackage.compliant, gaps: [...m.complianceAtPackage.gaps].sort() },
  };
  return sha256Hex(canonical(bound));
}

function releaseUrn(name: string, version: string): string { return `urn:ece:release:${name}:${version}`; }

/**
 * Signs + verifies Release Attestations over #4 PackageManifests, offline, against an ECE did:key root. Its ONLY
 * methods are attest() and verify() (+ the read-only ledger) — it cannot approve/mint/gate/act/publish.
 */
export class ReleaseAttestationService {
  #vc: ECETrustVC;

  constructor(vc?: ECETrustVC) {
    this.#vc = vc ?? new ECETrustVC();
  }

  /** The tamper-evident attestation ledger (read-only accessor) — every attest/verify is recorded here. */
  get log(): AttestationLog { return this.#vc.log; }

  /**
   * Sign a Release Attestation over a #4 PackageManifest with an ECE-controlled did:key root. Fully offline;
   * records the event to the hash-chain ledger (NO key material). Produces a signature artifact — NOT a gated
   * external action; it neither publishes nor modifies the manifest.
   */
  async attest(manifest: ReleasePackageManifest, issuerKey: IssuerKey): Promise<ReleaseAttestation> {
    const digest = releaseDigest(manifest);
    const sd = sbomDigest(manifest.sbom);
    // Bind via the ECE @context's SIGNED, @protected terms (subject id / attestation / issuedFor / clearanceLevel).
    const credential = await this.#vc.issueCredential(
      {
        subject: releaseUrn(manifest.name, manifest.version),
        attestation: digest,
        issuedFor: `${manifest.name}@${manifest.version}`,
        clearanceLevel: manifest.complianceAtPackage.compliant ? 'release-compliant' : 'non-compliant',
      },
      issuerKey,
    );
    // Audit tie-in: WHAT release was attested, by WHICH root, over WHICH digest — never any private key material.
    this.#vc.log.record('release.attested', {
      name: manifest.name,
      version: manifest.version,
      issuer: issuerKey.did,
      releaseDigest: digest,
      sbomDigest: sd,
      artifacts: manifest.artifacts.length,
    });
    return { name: manifest.name, version: manifest.version, releaseDigest: digest, sbomDigest: sd, issuer: issuerKey.did, credential };
  }

  /**
   * Verify a Release Attestation FULLY OFFLINE against the ECE root and RE-BIND it to the given manifest: the VC
   * must verify, the credential's issuer must be a trusted ECE root (if roots are pinned), the release identity
   * must match, AND the manifest must recompute to the signed digest. Any tamper of any bound field ⇒ false.
   */
  async verify(att: ReleaseAttestation, manifest: ReleasePackageManifest, opts: { trustedRoots?: readonly string[] } = {}): Promise<ReleaseVerifyResult> {
    const vcRes = await this.#vc.verifyCredential(att.credential);
    if (!vcRes.verified) return { verified: false, reason: 'signature/credential verification failed (offline)' };

    const cred = att.credential as { issuer?: unknown; credentialSubject?: { id?: string; attestation?: string } };
    const issuer = typeof cred.issuer === 'string' ? cred.issuer : String(cred.issuer);
    if (opts.trustedRoots && !opts.trustedRoots.includes(issuer)) {
      return { verified: false, reason: `issuer ${issuer} is not a trusted ECE root` };
    }
    const subject = cred.credentialSubject ?? {};
    const expectedUrn = releaseUrn(manifest.name, manifest.version);
    if (subject.id !== expectedUrn) {
      return { verified: false, reason: `release identity mismatch (attested ${subject.id ?? 'none'} ≠ ${expectedUrn})` };
    }
    const recomputed = releaseDigest(manifest);
    if (subject.attestation !== recomputed) {
      return { verified: false, reason: 'release digest mismatch — a bound field (checksum/version/SBOM/compliance/provenance) was altered' };
    }
    return { verified: true };
  }
}
