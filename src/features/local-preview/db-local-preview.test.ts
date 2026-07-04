import { describe, it, expect, afterAll } from 'vitest';
import pkg from 'pg';
const { Pool } = pkg;
import { PostgresHashChainSink } from '../audit-engine/postgres-sink.js';
import { RedactionEngine } from '../redaction-engine/redaction-engine.js';
import { factoryBuildObserver, spawnLocalBuild } from '../../mcp-server/live-build-observer.js';
import { factoryPreviewGenerator, factoryPreviewAuditor } from '../../mcp-server/live-local-preview.js';
import type { PreviewManifest } from './local-preview.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Factory capability #3 — the preview/status generator against REAL PostgreSQL + a REAL factory build: the
// Observer watches a local build, the generator produces the honest Preview/Status Report, and recording that
// report to the append-only hash-chain is verifiable (verifyChain ok). Proves wired-to-a-factory-build end-to-end
// AND that a FAILED build yields an honest, non-compliant report (never overstated).

const cfg = { host: process.env.PGHOST ?? '127.0.0.1', port: Number(process.env.PGPORT ?? 55432), database: process.env.PGDATABASE ?? 'ece_audit_test' };
const pool = new Pool({ ...cfg, user: 'ece_app' });
const sink = new PostgresHashChainSink(pool, new RedactionEngine());
afterAll(async () => { await pool.end(); });

const ORG = `orgPrev-${process.pid}`;
const NODE = process.execPath;

function manifestFor(artifact: string, over: Partial<PreviewManifest> = {}): PreviewManifest {
  return {
    name: 'factory-thing', kind: 'module', version: '0.1.0',
    runCommands: { install: 'npm ci', run: `${NODE} run`, preview: `${NODE} preview`, status: `${NODE} status` },
    demo: { command: `${NODE} demo`, description: 'demo with seed data' },
    capabilities: [
      { id: 'build', description: 'builds a bundle', state: 'present' },
      { id: 'installer', description: 'packaged app', state: 'absent' },
    ],
    artifacts: [artifact],
    ...over,
  };
}

describe('capability #3 — wired to a REAL factory build: observe → generate honest report → audit → verifyChain', () => {
  it('a successful factory build ⇒ compliant report; recording it to the hash-chain verifies', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'ece-prev-'));
    const artifact = path.join(dir, 'bundle.js');
    const observer = factoryBuildObserver({ now: (() => { let t = 1000; return () => (t += 100); })() });
    const observation = await observer.observe({
      kind: 'build', command: `${NODE} build`, target: 'factory-thing',
      run: spawnLocalBuild(NODE, ['-e', `require('fs').writeFileSync(${JSON.stringify(artifact)}, 'bundle')`]),
      artifactPaths: [artifact],
    });
    expect(observation.status).toBe('success');

    const report = factoryPreviewGenerator().generate(manifestFor(artifact), observation);
    expect(report.built).toBe(true);
    expect(report.compliance.compliant).toBe(true);
    expect(report.artifacts[0]).toMatchObject({ path: artifact, observed: true });
    expect(report.missing.map((c) => c.id)).toEqual(['installer']); // honest current-vs-missing

    const r = await factoryPreviewAuditor(sink, ORG).record(report);
    expect(r.seq).toBeGreaterThan(0);
    const v = await sink.verifyChain(ORG);
    expect(v.ok).toBe(true); // the shown state is tamper-evident evidence

    const rows = await sink.readEntries(ORG);
    expect(rows.filter((x) => x.kind === 'read').length).toBeGreaterThanOrEqual(1);
  });

  it('a FAILED factory build ⇒ HONEST non-compliant report (built:false, build-failure gap); still recorded', async () => {
    const observer = factoryBuildObserver({ now: (() => { let t = 5000; return () => (t += 100); })() });
    const observation = await observer.observe({
      kind: 'build', command: `${NODE} build`, target: 'factory-thing',
      run: spawnLocalBuild(NODE, ['-e', 'process.exit(2)']),
      artifactPaths: ['dist/never-made.js'],
    });
    expect(observation.status).toBe('failure');

    const report = factoryPreviewGenerator().generate(manifestFor('dist/never-made.js'), observation);
    expect(report.built).toBe(false);                 // NOT overstated
    expect(report.summary).toContain('did NOT build');
    expect(report.compliance.compliant).toBe(false);
    expect(report.compliance.gaps.join(' ')).toMatch(/build did not succeed/);
    expect(report.compliance.gaps.join(' ')).toMatch(/declared artifact\(s\) not observed/);
    expect(report.artifacts[0].observed).toBe(false);

    await factoryPreviewAuditor(sink, ORG).record(report); // honest failure is evidence too
    const v = await sink.verifyChain(ORG);
    expect(v.ok).toBe(true);
  });
});
