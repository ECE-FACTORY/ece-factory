// ECE Trust Layer — sovereign trust roots (VC pillar).
//
// The trust root is ECE's own. An issuer key is an Ed25519 key ECE generates and holds; its identifier is a
// `did:key` — the key IS the identifier, so there is NO external DID registry, ledger, or trust service. This
// slice manages the key in-process; production custody (HSM/rotation) plugs in behind the same interface.

import { driver } from '@digitalbazaar/did-method-key';
import { Ed25519VerificationKey2020 } from '@digitalbazaar/ed25519-verification-key-2020';

export interface IssuerKey {
  /** The sovereign identifier — a did:key derived from the key itself (no registry). */
  did: string;
  /** The did:key verification-method id used in the credential proof. */
  keyId: string;
  /** The Ed25519 key pair WITH private material (held by ECE) — used to sign. Opaque to callers. */
  signingKey: unknown;
}

function makeDidKeyDriver() {
  const d = driver();
  d.use({ multibaseMultikeyHeader: 'z6Mk', fromMultibase: Ed25519VerificationKey2020.from });
  return d;
}

/** Generate + hold a sovereign ECE issuer key (Ed25519 → did:key). No external trust root is contacted. */
export async function generateIssuerKey(): Promise<IssuerKey> {
  const verificationKeyPair = (await Ed25519VerificationKey2020.generate()) as Record<string, unknown>; // generated LOCALLY
  const { didDocument } = (await makeDidKeyDriver().fromKeyPair({ verificationKeyPair })) as { didDocument: { id: string; assertionMethod: Array<string | { id: string }> } };
  const am = didDocument.assertionMethod[0];
  const keyId = typeof am === 'string' ? am : am.id;
  // the returned key map is public-only; the ORIGINAL key pair retains the private material. Tag it with the did:key id.
  verificationKeyPair.id = keyId;
  verificationKeyPair.controller = didDocument.id;
  return { did: didDocument.id, keyId, signingKey: verificationKeyPair };
}

/** Resolve a did:key from the key material itself (offline). Used by the air-gap documentLoader at verify time. */
export async function resolveDidKey(url: string): Promise<unknown> {
  return await makeDidKeyDriver().get({ url });
}
