// ECE Trust Layer — the sovereign AIR-GAP documentLoader (VC pillar).
//
// This is the load-bearing air-gap guarantee: verification resolves ONLY (1) a locally-bundled @context, or
// (2) a did:key (which resolves from the key material itself — no external registry). ANY other URL — i.e. any
// attempt to reach the network for a @context, schema, DID document, or status list — THROWS loudly. A network
// reach is a hard failure, never a silent success. The bundled contexts below are the AIR-GAP PACKAGING
// MANIFEST — the exact contexts the empirical spike proved are needed for offline verify.

// Contexts are loaded from the pinned, LOCAL context packages (vendored in node_modules) — never fetched.
import { contexts as credentialsContexts } from '@digitalbazaar/credentials-context';
import { contexts as ed25519Contexts } from 'ed25519-signature-2020-context';

export const VC_V1_CONTEXT_URL = 'https://www.w3.org/2018/credentials/v1';
export const ED25519_2020_CONTEXT_URL = 'https://w3id.org/security/suites/ed25519-2020/v1';
export const ECE_CONTEXT_URL = 'https://trust.ece.ae/attestation/v1';

/** ECE's OWN attestation @context — ECE authors and controls it; bundled locally like any sovereign context. */
export const ECE_CONTEXT = {
  '@context': {
    '@version': 1.1,
    '@protected': true,
    ECEAttestation: 'https://trust.ece.ae/attestation#ECEAttestation',
    clearanceLevel: 'https://trust.ece.ae/attestation#clearanceLevel',
    attestation: 'https://trust.ece.ae/attestation#attestation',
    issuedFor: 'https://trust.ece.ae/attestation#issuedFor',
  },
};

// The bundled cache — the air-gap manifest.
const BUNDLED = new Map<string, unknown>();
for (const [url, doc] of credentialsContexts as Map<string, unknown>) BUNDLED.set(url, doc);
for (const [url, doc] of ed25519Contexts as Map<string, unknown>) BUNDLED.set(url, doc);
BUNDLED.set(ECE_CONTEXT_URL, ECE_CONTEXT);

/** The exact @context URLs bundled for offline operation (the air-gap packaging manifest). */
export const BUNDLED_CONTEXT_URLS: readonly string[] = [...BUNDLED.keys()];

export interface LoaderResult { contextUrl: null; documentUrl: string; document: unknown; }
export type DocumentLoader = (url: string) => Promise<LoaderResult>;
export type DidKeyResolver = (url: string) => Promise<unknown>;

/**
 * Build the air-gap documentLoader. Resolves a bundled @context or a did:key; THROWS on anything else. The
 * optional `onResolve` hook records every URL the library asks for — the air-gap proof (all must be local/did:key).
 */
export function createAirGapDocumentLoader(
  didKeyResolver: DidKeyResolver,
  opts: { onResolve?: (url: string) => void } = {},
): DocumentLoader {
  return async (url: string): Promise<LoaderResult> => {
    opts.onResolve?.(url);
    if (BUNDLED.has(url)) return { contextUrl: null, documentUrl: url, document: BUNDLED.get(url) };
    if (url.startsWith('did:key:')) return { contextUrl: null, documentUrl: url, document: await didKeyResolver(url) };
    throw new Error(`ECE air-gap: refusing to resolve non-bundled/remote URL "${url}" — verification must be fully offline (no network).`);
  };
}
