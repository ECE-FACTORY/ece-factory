import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ECETrustVC, generateIssuerKey, resolveDidKey, AttestationLog,
  createAirGapDocumentLoader, BUNDLED_CONTEXT_URLS,
} from '../src/index.ts';

// ECE Trust Layer — VC pillar, vertical slice 1. Issue + verify a sovereign VC OFFLINE, tamper-evident, audited.
// The air-gap guarantee is enforced by a documentLoader that THROWS on any remote URL — a network reach is a
// loud failure, never a silent success.

test('issuer key is an ECE-controlled did:key (the key IS the root — no external registry)', async () => {
  const issuer = await generateIssuerKey();
  assert.match(issuer.did, /^did:key:z6Mk/);
  assert.ok(issuer.keyId.startsWith(issuer.did + '#'));
});

test('ECE API issues a valid VC (Ed25519Signature2020, did:key issuer)', async () => {
  const issuer = await generateIssuerKey();
  const api = new ECETrustVC();
  const signed = await api.issueCredential({ subject: issuer.did, clearanceLevel: 'sovereign', attestation: 'trusted-layer' }, issuer) as any;
  assert.equal(signed.proof.type, 'Ed25519Signature2020');
  assert.equal(signed.issuer, issuer.did);
  assert.deepEqual(signed.type, ['VerifiableCredential', 'ECEAttestation']);
  assert.equal(signed.credentialSubject.clearanceLevel, 'sovereign');
});

test('verify OFFLINE with the remote-throwing loader ⇒ verified:true; every resolution is local/did:key (zero remote)', async () => {
  const issuer = await generateIssuerKey();
  const api = new ECETrustVC();
  const signed = await api.issueCredential({ subject: issuer.did, clearanceLevel: 'sovereign' }, issuer);
  // belt-and-suspenders: physically kill global fetch during verify
  const realFetch = globalThis.fetch;
  (globalThis as any).fetch = () => { throw new Error('NETWORK-BLOCKED: fetch called during verify'); };
  try {
    const res = await api.verifyCredential(signed);
    assert.equal(res.verified, true);
  } finally { (globalThis as any).fetch = realFetch; }
  const remote = api.resolvedUrls().filter((u) => /^https?:\/\//.test(u) && !BUNDLED_CONTEXT_URLS.includes(u));
  assert.deepEqual(remote, [], 'no remote/un-bundled URL may be resolved during verify');
});

test('tamper ⇒ verify FAILS (tamper-evidence)', async () => {
  const issuer = await generateIssuerKey();
  const api = new ECETrustVC();
  const signed = await api.issueCredential({ subject: issuer.did, clearanceLevel: 'sovereign' }, issuer);
  const tampered = JSON.parse(JSON.stringify(signed));
  tampered.credentialSubject.clearanceLevel = 'TAMPERED';
  const res = await api.verifyCredential(tampered);
  assert.equal(res.verified, false);
});

test('a remote / un-bundled @context ⇒ LOUD throw at the loader; never a silent verify via the API', async () => {
  // the air-gap boundary: the loader THROWS on any remote URL — loud failure, never a silent success.
  const loader = createAirGapDocumentLoader(resolveDidKey);
  await assert.rejects(loader('https://evil.example/context/v1'), /air-gap: refusing to resolve non-bundled\/remote URL/);
  // via the API: a credential referencing a remote context does NOT silently verify — the loader refuses the
  // URL, so verification fails (verified:false). No network is reached; the remote context cannot slip through.
  const issuer = await generateIssuerKey();
  const api = new ECETrustVC();
  const signed = await api.issueCredential({ subject: issuer.did }, issuer) as any;
  const evil = JSON.parse(JSON.stringify(signed));
  evil['@context'] = [...evil['@context'], 'https://evil.example/context/v1'];
  const res = await api.verifyCredential(evil);
  assert.equal(res.verified, false);
});

test('attestation events recorded to the hash-chain ledger; verifyChain ok; tamper detected', async () => {
  const log = new AttestationLog(() => 0);
  const issuer = await generateIssuerKey();
  const api = new ECETrustVC({ log });
  const signed = await api.issueCredential({ subject: issuer.did, clearanceLevel: 'sovereign' }, issuer);
  await api.verifyCredential(signed);

  const entries = log.list();
  assert.equal(entries.length, 2);
  assert.deepEqual(entries.map((e) => e.event), ['vc.issued', 'vc.verified']);
  assert.equal(log.verifyChain().ok, true);

  // tamper an entry's payload via its live reference → the SHA-256 chain recomputation detects it
  entries[0].payload.issuer = 'did:key:zFORGED';
  const after = log.verifyChain();
  assert.equal(after.ok, false);
  assert.equal(after.brokenAt, 1);
});
