import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AppPackagingFlow,
  PackagingAuditor,
  PACKAGING_AUDIT_ALLOWLIST,
  type MacBundler,
  type BundleResult,
  type PackageManifest,
  type PackageInput,
  type DependencyResolver,
} from './app-packaging.js';
import { classifyLicense } from '../license-compliance/license-compliance.js';
import { SecretPatternRedactor, type ObservationRecord, type ArtifactProbe } from '../build-observer/build-observer.js';
import type { PreviewStatusReport, StandardCompliance } from '../local-preview/local-preview.js';
import { RedactionEngine } from '../redaction-engine/redaction-engine.js';

// Factory capability #4 — the GOVERNED packaging flow. These prove: it REFUSES to package a non-compliant/failed
// build (the gate-on-#3 property, with the specific reason), SUCCEEDS for a compliant build; versions + no silent
// clobber; SHA-256 checksums over the produced artifacts (verifiable); an SBOM (deps+versions+licenses); the
// bundler is pluggable (flow bundler-agnostic); generate-only (no gate/approve/mint/publish method; can't modify
// the source build); and redaction (no secret in the manifest/audit).

const OBS_ID = 'obs-pkg-1';
function observation(over: Partial<ObservationRecord> = {}): ObservationRecord {
  return {
    observationId: OBS_ID, kind: 'build', command: 'npm run build', target: 'ece-app', startedAtIso: '2026-07-04T00:00:00.000Z',
    endedAtIso: '2026-07-04T00:00:03.000Z', durationMs: 3000, status: 'success', exitCode: 0, stdout: 'ok', stderr: '',
    stdoutTruncated: false, stderrTruncated: false, artifacts: [{ path: 'dist/app.js', bytes: 20, sha256: 'a'.repeat(64) }],
    ...over,
  };
}
function report(over: Partial<PreviewStatusReport> = {}): PreviewStatusReport {
  return {
    name: 'ece-app', kind: 'app', version: '1.0.0', built: true, observationId: OBS_ID, observedStatus: 'success', exitCode: 0,
    observedAtIso: '2026-07-04T00:00:03.000Z', runCommands: { run: 'npm start', preview: 'npm run preview', status: 'npm run status' },
    demo: null, present: [{ id: 'core', description: 'c', state: 'present' }], partial: [], missing: [],
    artifacts: [{ path: 'dist/app.js', observed: true, bytes: 20, sha256: 'a'.repeat(64) }],
    compliance: compliant(), summary: 'ece-app v1.0.0 built OK — local-preview-compliant', ...over,
  };
}
function compliant(): StandardCompliance {
  return { compliant: true, gaps: [], checks: { requiredCommandsDeclared: true, capabilitiesDeclared: true, demoDeclared: true, buildSucceeded: true, declaredArtifactsPresent: true } };
}
function nonCompliant(gaps: string[], checks: Partial<StandardCompliance['checks']> = {}): StandardCompliance {
  return { compliant: false, gaps, checks: { requiredCommandsDeclared: true, capabilitiesDeclared: true, demoDeclared: true, buildSucceeded: false, declaredArtifactsPresent: true, ...checks } };
}

// injected fakes (no fs) — a bundler, a hash probe, a manifest writer, a deps resolver.
function fakeBundler(format = 'macapp-dir', bundler = 'test-bundler/1'): MacBundler {
  return { async bundle(req): Promise<BundleResult> { return { bundler, format, artifactPaths: [`${req.outDir}/${req.name}-${req.version}.app/Info.plist`, `${req.outDir}/${req.name}-${req.version}.app/Resources/app.js`], installInstructions: `install ${req.name}` }; } };
}
const fakeHash: ArtifactProbe = (p) => ({ bytes: p.length, sha256: 'f'.repeat(64) });
function capturingWriter() { const written: PackageManifest[] = []; return { written, writer: async (m: PackageManifest) => { written.push(m); return { manifestPath: `/out/${m.name}-${m.version}.package.json` }; } }; }
const twoDeps: DependencyResolver = () => [
  { name: 'left-pad', version: '1.3.0', declaredSpdx: 'MIT' },
  { name: 'some-lib', version: '2.1.0', declaredSpdx: 'Apache-2.0' },
];
function flow(over: { bundler?: MacBundler; deps?: DependencyResolver; existing?: Set<string> } = {}) {
  const cap = capturingWriter();
  const f = new AppPackagingFlow(over.bundler ?? fakeBundler(), over.deps ?? twoDeps, classifyLicense, fakeHash, cap.writer, {
    now: () => 1_700_000_000_000, existingVersions: () => over.existing ?? new Set<string>(),
  });
  return { f, written: cap.written };
}
function input(over: Partial<PackageInput> = {}): PackageInput {
  return { report: report(), compliance: compliant(), observation: observation(), outDir: '/out', ...over };
}

describe('AppPackagingFlow — GATES on #3 compliance: REFUSES to package a build that is not seen+run-compliant', () => {
  it('a NON-COMPLIANT build ⇒ refused with the specific reason + gaps; nothing written', async () => {
    const { f, written } = flow();
    const out = await f.package(input({ report: report({ built: false, observedStatus: 'failure' }), compliance: nonCompliant(['build did not succeed (observed status: failure, exit 1)']), observation: observation({ status: 'failure', exitCode: 1 }) }));
    expect(out.status).toBe('refused');
    if (out.status === 'refused') { expect(out.reason).toMatch(/did not succeed/); expect(out.gaps.join(' ')).toMatch(/build did not succeed/); }
    expect(written).toHaveLength(0);
  });

  it('a compliant #3 verdict but an OBSERVED FAILURE ⇒ refused (honest: cannot package what did not build)', async () => {
    const { f } = flow();
    const out = await f.package(input({ observation: observation({ status: 'failure', exitCode: 2 }), report: report({ built: false }) }));
    expect(out.status).toBe('refused');
  });

  it('declared artifacts NOT present ⇒ refused', async () => {
    const { f } = flow();
    const out = await f.package(input({ compliance: nonCompliant(['declared artifact(s) not observed: dist/app.js'], { buildSucceeded: true, declaredArtifactsPresent: false }) }));
    expect(out.status).toBe('refused');
    if (out.status === 'refused') expect(out.reason).toMatch(/declared artifacts are not present|not local-preview-compliant/i);
  });

  it('the observation does not match the report (mismatched build) ⇒ refused', async () => {
    const { f } = flow();
    const out = await f.package(input({ observation: observation({ observationId: 'obs-DIFFERENT' }) }));
    expect(out.status).toBe('refused');
    if (out.status === 'refused') expect(out.reason).toMatch(/does not match|mismatched build/);
  });
});

describe('AppPackagingFlow — packages a COMPLIANT build: version → checksum → SBOM → record', () => {
  it('a compliant build ⇒ packaged; manifest carries version, source observation, compliance verdict, install intent', async () => {
    const { f, written } = flow();
    const out = await f.package(input({ serious: true }));
    expect(out.status).toBe('packaged');
    if (out.status !== 'packaged') return;
    const m = out.manifest;
    expect(m).toMatchObject({ name: 'ece-app', version: '1.0.0', kind: 'app', bundler: 'test-bundler/1', format: 'macapp-dir', sourceObservationId: OBS_ID, serious: true });
    expect(m.complianceAtPackage).toEqual({ compliant: true, gaps: [] });
    expect(m.install.runsWithoutRepo).toBe(true); // installable without the source repo
    expect(written).toHaveLength(1); // manifest recorded alongside the artifact
  });

  it('SHA-256 checksums are generated over EACH produced artifact and match the probe (verifiable)', async () => {
    const { f } = flow();
    const out = await f.package(input());
    if (out.status !== 'packaged') throw new Error('expected packaged');
    expect(out.manifest.artifacts.length).toBe(2); // Info.plist + Resources/app.js
    for (const a of out.manifest.artifacts) {
      expect(a.sha256).toBe('f'.repeat(64));    // matches fakeHash → verifiable
      expect(a.bytes).toBe(a.path.length);
    }
  });

  it('an SBOM is generated with deps + versions + licenses (reusing the factory license classifier)', async () => {
    const { f } = flow();
    const out = await f.package(input());
    if (out.status !== 'packaged') throw new Error('expected packaged');
    const sbom = out.manifest.sbom;
    expect(sbom.format).toBe('ece-sbom/1');
    expect(sbom.components.map((c) => c.name).sort()).toEqual(['left-pad', 'some-lib']);
    const lp = sbom.components.find((c) => c.name === 'left-pad')!;
    expect(lp).toMatchObject({ version: '1.3.0' });
    expect(typeof lp.license).toBe('string');
    expect(['ACCEPT', 'REJECT', 'NEEDS_REVIEW']).toContain(lp.decision); // classifier verdict per component
  });
});

describe('AppPackagingFlow — versioned, no silent clobber', () => {
  it('refuses to package a version that is already packaged (bump the version)', async () => {
    const { f, written } = flow({ existing: new Set(['1.0.0']) });
    const out = await f.package(input());
    expect(out.status).toBe('refused');
    if (out.status === 'refused') expect(out.reason).toMatch(/already packaged|no silent clobber/);
    expect(written).toHaveLength(0);
  });
  it('a NEW version packages fine', async () => {
    const { f } = flow({ existing: new Set(['0.9.0']) });
    const out = await f.package(input());
    expect(out.status).toBe('packaged');
  });
});

describe('AppPackagingFlow — the Mac bundler is PLUGGABLE (flow is bundler-agnostic)', () => {
  it('swapping the bundler changes the produced format without touching the flow', async () => {
    const { f } = flow({ bundler: fakeBundler('dmg', 'dmg-bundler/9') });
    const out = await f.package(input());
    if (out.status !== 'packaged') throw new Error('expected packaged');
    expect(out.manifest.format).toBe('dmg');
    expect(out.manifest.bundler).toBe('dmg-bundler/9'); // the adapter, not the flow, decides the bundle format
  });
});

describe('AppPackagingFlow — GENERATE-ONLY: no gate/approve/mint/publish reference or method (structural)', () => {
  it('the flow exposes ONLY package(); no approve/mint/gate/publish/release/upload method', () => {
    const { f } = flow();
    const g = f as unknown as Record<string, unknown>;
    for (const m of ['approve', 'commit', 'mint', 'resolve', 'consume', 'gate', 'grant', 'publish', 'release', 'upload', 'callTool', 'createGithubRepo']) {
      expect(typeof g[m]).toBe('undefined');
    }
    expect(typeof (g as { package?: unknown }).package).toBe('function'); // its ONLY capability
  });
  it('the auditor exposes ONLY record(); nothing that can approve/commit/act/publish', () => {
    const a = new PackagingAuditor({ appendRead: async () => ({ seq: 1, entry_hash: 'h' }) }, new RedactionEngine(), 'o', { user_id: 'svc', email: '', role: 'service' }) as unknown as Record<string, unknown>;
    for (const m of ['approve', 'commit', 'mint', 'publish', 'release', 'upload', 'callTool']) expect(typeof a[m]).toBe('undefined');
    expect(typeof (a as { record?: unknown }).record).toBe('function');
  });
  it('package() does not mutate its #2/#3 inputs (report/compliance/observation)', async () => {
    const inp = input();
    const snap = JSON.stringify(inp);
    await flow().f.package(inp);
    expect(JSON.stringify(inp)).toBe(snap); // generate-only: source records untouched
  });
});

describe('AppPackagingFlow — redaction: no secret in the manifest or the audited summary', () => {
  it('a secret in the bundler install instructions is scrubbed in the manifest', async () => {
    const leakyBundler: MacBundler = { async bundle(req) { return { bundler: 'b', format: 'macapp-dir', artifactPaths: [`${req.outDir}/x`], installInstructions: 'run with TOKEN=ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345' }; } };
    const f = new AppPackagingFlow(leakyBundler, twoDeps, classifyLicense, fakeHash, async () => ({ manifestPath: 'x' }), { redactor: SecretPatternRedactor, existingVersions: () => new Set<string>() });
    const out = await f.package(input());
    if (out.status !== 'packaged') throw new Error('expected packaged');
    expect(out.manifest.install.instructions).not.toMatch(/ghp_[A-Za-z0-9]{20,}/);
    expect(out.manifest.install.instructions).toContain('[REDACTED]');
  });
  it('the audited summary is allowlist-only + secret-free; records the SBOM + integrity hashes', async () => {
    const writes: Array<Record<string, unknown>> = [];
    const sink = { appendRead: async (e: { query_range?: Record<string, unknown> }) => { writes.push(e.query_range ?? {}); return { seq: writes.length, entry_hash: 'h'.repeat(64) }; } };
    const out = await flow().f.package(input());
    if (out.status !== 'packaged') throw new Error('expected packaged');
    await new PackagingAuditor(sink, new RedactionEngine(PACKAGING_AUDIT_ALLOWLIST), 'orgPkg', { user_id: 'app-packaging', email: '', role: 'service' }).record(out.manifest);
    const w = writes[0];
    expect(w).toMatchObject({ package: 'ece-app', version: '1.0.0', compliant: true });
    expect(JSON.stringify(w)).toMatch(/left-pad/);          // SBOM recorded
    expect(JSON.stringify(w)).toMatch(/f{64}/);             // integrity hashes recorded
    expect(w).not.toHaveProperty('install');                // non-allowlisted field dropped
  });
});

describe('AppPackagingFlow — external publish is OUT OF SCOPE (future gated action) + no gate/bridge import', () => {
  it('app-packaging.ts imports nothing from the gate/approval/bridge/external modules and has no publish/release code', () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(path.join(here, 'app-packaging.ts'), 'utf8');
    const imports = [...src.matchAll(/^\s*import\s.*?from\s+['"]([^'"]+)['"]/gm)].map((m) => m[1]);
    const forbidden = /approval-gate|mcp-bridge|external-gateways|external-tools|decision-console|kill-switch|tool-classes|permission-engine/;
    expect(imports.filter((i) => forbidden.test(i))).toEqual([]);
    const runtimeCrossImports = [...src.matchAll(/^\s*import\s+(?!type\b)[^;]*?from\s+['"](\.\.\/[^'"]+)['"]/gm)].map((m) => m[1]);
    expect(runtimeCrossImports).toEqual([]); // every cross-module import is `import type` — standalone-packageable
    expect(/\b(fetch|https?:\/\/|publishRelease|uploadAsset|createRelease)\b/.test(src)).toBe(false); // no external publish
  });
});
