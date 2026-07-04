import { describe, it, expect, afterAll } from 'vitest';
import pkg from 'pg';
const { Pool } = pkg;
import { PostgresHashChainSink } from '../audit-engine/postgres-sink.js';
import { RedactionEngine } from '../redaction-engine/redaction-engine.js';
import { factoryBuildObserver, spawnLocalBuild } from '../../mcp-server/live-build-observer.js';
import { factoryPreviewGenerator } from '../../mcp-server/live-local-preview.js';
import { factoryPackagingFlow, factoryPackagingAuditor } from '../../mcp-server/live-app-packaging.js';
import type { PreviewManifest } from '../local-preview/local-preview.js';
import { mkdtempSync, existsSync, statSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';

// Factory capability #4 — the governed packaging flow against REAL PostgreSQL + a REAL factory build + the REAL
// default Mac bundler: observe a local build → generate the #3 compliance report → package (real .app dir on
// disk, real checksums, SBOM) → record to the hash-chain (verifyChain ok). Also proves the gate: a real FAILED
// build is REFUSED. And a real dependency SBOM (the trust-layer package.json).

const cfg = { host: process.env.PGHOST ?? '127.0.0.1', port: Number(process.env.PGPORT ?? 55432), database: process.env.PGDATABASE ?? 'ece_audit_test' };
const pool = new Pool({ ...cfg, user: 'ece_app' });
const sink = new PostgresHashChainSink(pool, new RedactionEngine());
afterAll(async () => { await pool.end(); });

const ORG = `orgPkg-${process.pid}`;
const NODE = process.execPath;
const noDeps = () => [];

function manifestFor(artifact: string, over: Partial<PreviewManifest> = {}): PreviewManifest {
  return {
    name: 'factory-app', kind: 'app', version: '1.0.0',
    runCommands: { install: 'npm ci', run: `${NODE} run`, preview: `${NODE} preview`, status: `${NODE} status` },
    demo: { command: `${NODE} demo`, description: 'demo with seed data' },
    capabilities: [{ id: 'core', description: 'core', state: 'present' }],
    artifacts: [artifact], ...over,
  };
}

describe('capability #4 — end-to-end on a REAL factory build: observe → preview → PACKAGE → audit → verifyChain', () => {
  it('a compliant build ⇒ real .app produced on disk with real SHA-256 checksums; recorded + verifyChain ok', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'ece-pkg-'));
    const artifact = path.join(dir, 'bundle.js');
    const contents = 'console.log("ece app");\n';
    const observation = await factoryBuildObserver({ now: (() => { let t = 1000; return () => (t += 100); })() }).observe({
      kind: 'build', command: `${NODE} build`, target: 'factory-app',
      run: spawnLocalBuild(NODE, ['-e', `require('fs').writeFileSync(${JSON.stringify(artifact)}, ${JSON.stringify(contents)})`]),
      artifactPaths: [artifact],
    });
    const report = factoryPreviewGenerator().generate(manifestFor(artifact), observation);
    expect(report.compliance.compliant).toBe(true);

    const outDir = path.join(dir, 'dist-pkg');
    const out = await factoryPackagingFlow(noDeps, { now: () => 1_700_000_000_000 }).package({ report, compliance: report.compliance, observation, outDir, serious: true });
    expect(out.status).toBe('packaged');
    if (out.status !== 'packaged') return;

    // a real .app directory exists on disk, installable without the repo
    const appDir = path.join(outDir, 'factory-app-1.0.0.app');
    expect(existsSync(path.join(appDir, 'Contents', 'Info.plist'))).toBe(true);
    // the bundled source artifact is inside Resources, and its recorded checksum matches the real file
    const bundled = out.manifest.artifacts.find((a) => a.path.endsWith('bundle.js'));
    expect(bundled).toBeTruthy();
    if (bundled) {
      const realSha = createHash('sha256').update(readFileSync(bundled.path)).digest('hex');
      expect(bundled.sha256).toBe(realSha);          // checksum verifiable against the real artifact
      expect(bundled.bytes).toBe(statSync(bundled.path).size);
    }
    // manifest written alongside the artifact
    expect(existsSync(path.join(outDir, 'factory-app-1.0.0.package.json'))).toBe(true);

    const r = await factoryPackagingAuditor(sink, ORG).record(out.manifest);
    expect(r.seq).toBeGreaterThan(0);
    const v = await sink.verifyChain(ORG);
    expect(v.ok).toBe(true); // "what was packaged, from which compliant build" is tamper-evident evidence
  });

  it('a REAL failed build ⇒ packaging REFUSED (gate-on-#3); nothing written', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'ece-pkg-fail-'));
    const observation = await factoryBuildObserver({ now: (() => { let t = 5000; return () => (t += 100); })() }).observe({
      kind: 'build', command: `${NODE} build`, target: 'factory-app',
      run: spawnLocalBuild(NODE, ['-e', 'process.exit(1)']), artifactPaths: ['dist/never.js'],
    });
    const report = factoryPreviewGenerator().generate(manifestFor('dist/never.js'), observation);
    expect(report.compliance.compliant).toBe(false);

    const outDir = path.join(dir, 'dist-pkg');
    const out = await factoryPackagingFlow(noDeps).package({ report, compliance: report.compliance, observation, outDir });
    expect(out.status).toBe('refused');
    if (out.status === 'refused') expect(out.reason).toMatch(/did not succeed|not local-preview-compliant/i);
    expect(existsSync(outDir)).toBe(false); // refused ⇒ nothing packaged
  });

  it('no silent clobber: re-packaging the SAME version into the same outDir is refused', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'ece-pkg-clobber-'));
    const artifact = path.join(dir, 'b.js');
    const observation = await factoryBuildObserver({ now: (() => { let t = 9000; return () => (t += 100); })() }).observe({
      kind: 'build', command: `${NODE} build`, target: 'factory-app',
      run: spawnLocalBuild(NODE, ['-e', `require('fs').writeFileSync(${JSON.stringify(artifact)}, 'x')`]), artifactPaths: [artifact],
    });
    const report = factoryPreviewGenerator().generate(manifestFor(artifact), observation);
    const outDir = path.join(dir, 'dist-pkg');
    const first = await factoryPackagingFlow(noDeps).package({ report, compliance: report.compliance, observation, outDir });
    expect(first.status).toBe('packaged');
    const second = await factoryPackagingFlow(noDeps).package({ report, compliance: report.compliance, observation, outDir });
    expect(second.status).toBe('refused'); // v1.0.0 already packaged in this outDir
    if (second.status === 'refused') expect(second.reason).toMatch(/already packaged|no silent clobber/);
  });
});
