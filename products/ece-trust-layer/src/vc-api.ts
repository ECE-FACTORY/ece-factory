// ECE Trust Layer — the sovereign Verifiable Credentials API (the ECE-owned surface, VC pillar).
//
// EXTEND, not fork-and-diverge: this wraps @digitalbazaar/vc + the Ed25519 suite + did:key behind a small
// typed ECE API (issueCredential / verifyCredential). ECE owns THIS surface; upstream is an implementation
// detail behind it. The API ALWAYS uses the air-gap documentLoader (offline, remote-throwing) with the bundled
// @contexts, and records every issue/verify to the tamper-evident attestation ledger. There is no code path
// that reaches the network at verify time.

import * as vc from '@digitalbazaar/vc';
import { Ed25519Signature2020 } from '@digitalbazaar/ed25519-signature-2020';
import { createAirGapDocumentLoader, VC_V1_CONTEXT_URL, ECE_CONTEXT_URL, type DocumentLoader } from './document-loader.ts';
import { resolveDidKey, type IssuerKey } from './trust-roots.ts';
import { AttestationLog } from './attestation-log.ts';

/** An ECE attestation claim — `subject` plus terms defined by the ECE @context (clearanceLevel, attestation, …). */
export interface AttestationClaim {
  subject: string;
  clearanceLevel?: string;
  attestation?: string;
  issuedFor?: string;
}

export interface VerifyResult { verified: boolean; error?: unknown; }

/** The signed Verifiable Credential (opaque W3C VC object — callers treat it as data). */
export type SignedCredential = Record<string, unknown>;

export class ECETrustVC {
  private readonly loader: DocumentLoader;
  private readonly resolved: string[] = [];
  /** The tamper-evident attestation ledger — every issue/verify is recorded here. */
  readonly log: AttestationLog;

  constructor(opts: { log?: AttestationLog } = {}) {
    this.log = opts.log ?? new AttestationLog();
    this.loader = createAirGapDocumentLoader(resolveDidKey, { onResolve: (u) => this.resolved.push(u) });
  }

  /** Issue a sovereign, offline-signed ECE attestation VC. */
  async issueCredential(claim: AttestationClaim, issuerKey: IssuerKey): Promise<SignedCredential> {
    const { subject, ...terms } = claim;
    const credential = {
      '@context': [VC_V1_CONTEXT_URL, ECE_CONTEXT_URL],
      type: ['VerifiableCredential', 'ECEAttestation'],
      issuer: issuerKey.did,
      issuanceDate: '2026-07-02T00:00:00Z',
      credentialSubject: { id: subject, ...terms },
    };
    const suite = new Ed25519Signature2020({ key: issuerKey.signingKey });
    const signed = (await vc.issue({ credential, suite, documentLoader: this.loader })) as SignedCredential & { type?: unknown };
    this.log.record('vc.issued', { issuer: issuerKey.did, subject, type: signed.type });
    return signed;
  }

  /** Verify a VC FULLY OFFLINE against ECE roots. Any network reach throws (air-gap loader). */
  async verifyCredential(signedVC: SignedCredential): Promise<VerifyResult> {
    const res = (await vc.verifyCredential({ credential: signedVC, suite: new Ed25519Signature2020(), documentLoader: this.loader })) as { verified?: boolean; error?: unknown };
    const verified = res.verified === true;
    this.log.record('vc.verified', { issuer: signedVC.issuer, verified });
    return { verified, error: res.error };
  }

  /** URLs the loader has resolved (air-gap proof — every one must be a bundled context or a did:key). */
  resolvedUrls(): readonly string[] { return this.resolved.slice(); }
}
