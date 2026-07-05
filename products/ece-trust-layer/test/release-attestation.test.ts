import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ReleaseAttestationService, releaseDigest, sbomDigest,
  generateIssuerKey, AttestationLog, ECETrustVC, BUNDLED_CONTEXT_URLS,
  type ReleasePackageManifest,
} from '../src/index.ts';

// ECE Trust Layer — Release/Package Attestation + Signing (Factory capability #5, slice 1). The factory signs its
// OWN release artifacts (capability #4 output). A signed Release Attestation binds version + artifact SHA-256
// checksums + SBOM digest + source-observation ref (#2) + compliance verdict (#3/#4); it is offline-verifiable
// against an ECE did:key root (network-blocked verify still true), and tampering ANY bound field ⇒ verify FALSE.

// A manifest shaped EXACTLY as capability #4's AppPackagingFlow emits (structural — #5 has no import coupling to
// the main app; it consumes the exact object #4 produces). This is the #2→#3→#4 provenance the attestation binds.
function factoryManifest(over: Partial<ReleasePackageManifest> = {}): ReleasePackageManifest {
  return {
    name: 'factory-app',
    version: '1.0.0',
    kind: 'app',
    artifacts: [
      { path: 'dist/factory-app-1.0.0.app/Contents/Info.plist', sha256: 'a'.repeat(64), bytes: 412 },
      { path: 'dist/factory-app-1.0.0.app/Contents/Resources/bundle.js', sha256: 'b'.repeat(64), bytes: 24 },
    ],
    sbom: { format: 'ece-sbom/1', subject: 'factory-app', version: '1.0.0', generatedFromObservation: 'obs-42', components: [{ name: 'left-pad', version: '1.3.0', license: 'MIT', decision: 'ACCEPT' }] },
    sourceObservationId: 'obs-42',
    complianceAtPackage: { compliant: true, gaps: [] },
    ...over,
  };
}

test('#5 attests a real #4 PackageManifest: binds version+checksums+SBOM+provenance+compliance, ECE did:key issuer', async () => {
  const issuer = await generateIssuerKey();
  assert.match(issuer.did, /^did:key:z6Mk/); // ECE-controlled root — the key IS the id, no external registry
  const m = factoryManifest();
  const att = await new ReleaseAttestationService().attest(m, issuer);

  assert.equal(att.name, 'factory-app');
  assert.equal(att.version, '1.0.0');
  assert.equal(att.issuer, issuer.did);
  assert.equal(att.releaseDigest, releaseDigest(m));        // the binding is the canonical digest over all bound fields
  assert.equal(att.sbomDigest, sbomDigest(m.sbom));
  const proof = (att.credential as { proof?: { type?: string } }).proof;
  assert.equal(proof?.type, 'Ed25519Signature2020');       // reused VC primitive — no crypto reimplemented
  const subj = (att.credential as { credentialSubject: { id: string; attestation: string } }).credentialSubject;
  assert.equal(subj.id, 'urn:ece:release:factory-app:1.0.0');
  assert.equal(subj.attestation, att.releaseDigest);       // the signed VC carries the release binding
});

test('#5 verifies FULLY OFFLINE against the ECE root (network-blocked fetch ⇒ still verified:true; zero remote URLs)', async () => {
  const issuer = await generateIssuerKey();
  const vc = new ECETrustVC();
  const svc = new ReleaseAttestationService(vc);
  const m = factoryManifest();
  const att = await svc.attest(m, issuer);

  const realFetch = globalThis.fetch;
  (globalThis as unknown as { fetch: unknown }).fetch = () => { throw new Error('NETWORK-BLOCKED: fetch called during verify'); };
  try {
    const res = await svc.verify(att, m);
    assert.equal(res.verified, true); // genuine attestation verifies with the network physically blocked
  } finally { (globalThis as unknown as { fetch: unknown }).fetch = realFetch; }

  const remote = vc.resolvedUrls().filter((u) => /^https?:\/\//.test(u) && !BUNDLED_CONTEXT_URLS.includes(u));
  assert.deepEqual(remote, [], 'no remote/un-bundled URL may be resolved during verify (air-gap)');
});

test('#5 TAMPER of ANY bound field ⇒ verify FALSE (checksum / version / SBOM / compliance / provenance)', async () => {
  const issuer = await generateIssuerKey();
  const svc = new ReleaseAttestationService();
  const m = factoryManifest();
  const att = await svc.attest(m, issuer);

  // genuine ⇒ true
  assert.equal((await svc.verify(att, m)).verified, true);

  // each of these is a DIFFERENT bound release than the one signed ⇒ digest mismatch ⇒ false
  const tampers: Array<[string, ReleasePackageManifest]> = [
    ['artifact checksum', factoryManifest({ artifacts: [{ path: 'dist/factory-app-1.0.0.app/Contents/Info.plist', sha256: 'a'.repeat(64), bytes: 412 }, { path: 'dist/factory-app-1.0.0.app/Contents/Resources/bundle.js', sha256: 'c'.repeat(64), bytes: 24 }] })],
    ['version', factoryManifest({ version: '1.0.1' })],
    ['sbom', factoryManifest({ sbom: { format: 'ece-sbom/1', subject: 'factory-app', version: '1.0.0', generatedFromObservation: 'obs-42', components: [{ name: 'left-pad', version: '9.9.9', license: 'MIT', decision: 'ACCEPT' }] } })],
    ['compliance verdict', factoryManifest({ complianceAtPackage: { compliant: false, gaps: ['forced'] } })],
    ['provenance (observation ref)', factoryManifest({ sourceObservationId: 'obs-SWAPPED' })],
  ];
  for (const [label, tampered] of tampers) {
    const res = await svc.verify(att, tampered);
    assert.equal(res.verified, false, `tampering ${label} must fail verification`);
    assert.match(res.reason ?? '', /mismatch/i);
  }

  // tampering the SIGNED credential itself (the digest inside the VC) also fails at the signature layer
  const forged = JSON.parse(JSON.stringify(att));
  forged.credential.credentialSubject.attestation = 'f'.repeat(64);
  assert.equal((await svc.verify(forged, m)).verified, false);
});

test('#5 ECE-root pinning: an attestation from an UNTRUSTED issuer is rejected (no external registry)', async () => {
  const eceRoot = await generateIssuerKey();
  const rogue = await generateIssuerKey();
  const svc = new ReleaseAttestationService();
  const m = factoryManifest();
  const rogueAtt = await svc.attest(m, rogue);
  // pin the ECE root only ⇒ the rogue-signed (but cryptographically valid) attestation is NOT trusted
  const res = await svc.verify(rogueAtt, m, { trustedRoots: [eceRoot.did] });
  assert.equal(res.verified, false);
  assert.match(res.reason ?? '', /not a trusted ECE root/);
  // and the same attestation verifies when its own root is pinned (did:key identity, no registry lookup)
  assert.equal((await svc.verify(rogueAtt, m, { trustedRoots: [rogue.did] })).verified, true);
});

test('#5 signing is recorded to the hash-chain ledger (verifyChain ok; tamper detected); NO key material logged', async () => {
  const log = new AttestationLog(() => 0);
  const svc = new ReleaseAttestationService(new ECETrustVC({ log }));
  const issuer = await generateIssuerKey();
  const m = factoryManifest();
  const att = await svc.attest(m, issuer);
  await svc.verify(att, m);

  const events = log.list().map((e) => e.event);
  assert.ok(events.includes('release.attested'));           // "what release was attested, by which root, over which digest"
  assert.equal(log.verifyChain().ok, true);

  // no private key material anywhere in the ledger or the attestation
  const ledgerDump = JSON.stringify(log.list());
  const attDump = JSON.stringify(att);
  for (const dump of [ledgerDump, attDump]) {
    assert.ok(!/privateKey|privateKeyMultibase|secretKey/i.test(dump), 'no private key material may appear');
  }

  // tamper a ledger entry payload via its live reference (list() copies the array but returns the SAME entry
  // objects) ⇒ the SHA-256 chain recomputation detects it
  const entries = log.list();
  entries[0].payload.issuer = 'did:key:zFORGED';
  assert.equal(log.verifyChain().ok, false);
});

test('#5 SIGN/VERIFY-ONLY (structural): no gate/approve/mint/publish method; cannot act or modify the manifest', async () => {
  const svc = new ReleaseAttestationService() as unknown as Record<string, unknown>;
  for (const m of ['approve', 'commit', 'mint', 'resolve', 'consume', 'gate', 'grant', 'publish', 'release', 'upload', 'distribute', 'callTool']) {
    assert.equal(typeof svc[m], 'undefined', `must NOT expose ${m}`);
  }
  assert.equal(typeof svc.attest, 'function');
  assert.equal(typeof svc.verify, 'function');

  // attest() does not mutate the manifest it reads (generate/crypto-only)
  const issuer = await generateIssuerKey();
  const m = factoryManifest();
  const snapshot = JSON.stringify(m);
  await (new ReleaseAttestationService()).attest(m, issuer);
  assert.equal(JSON.stringify(m), snapshot);
});
