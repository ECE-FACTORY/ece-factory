// ECE Trust & Attestation Layer — Verifiable Credentials pillar. Public product surface.
export { ECETrustVC } from './vc-api.ts';
export type { AttestationClaim, VerifyResult, SignedCredential } from './vc-api.ts';
export { generateIssuerKey, resolveDidKey } from './trust-roots.ts';
export type { IssuerKey } from './trust-roots.ts';
export { AttestationLog } from './attestation-log.ts';
export type { AttestationEntry } from './attestation-log.ts';
export { createAirGapDocumentLoader, BUNDLED_CONTEXT_URLS, ECE_CONTEXT_URL, VC_V1_CONTEXT_URL, ED25519_2020_CONTEXT_URL } from './document-loader.ts';
export type { DocumentLoader } from './document-loader.ts';

// Capability #5 slice 1 — release/package attestation + signing (internal factory infra; reuses the VC primitives).
export { ReleaseAttestationService, releaseDigest, sbomDigest } from './release-attestation.ts';
export type { ReleasePackageManifest, ReleaseArtifactRef, ReleaseAttestation, ReleaseVerifyResult } from './release-attestation.ts';
