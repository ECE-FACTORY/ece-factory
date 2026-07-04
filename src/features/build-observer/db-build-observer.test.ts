import { describe, it, expect, afterAll } from 'vitest';
import pkg from 'pg';
const { Pool, Client } = pkg;
import { PostgresHashChainSink } from '../audit-engine/postgres-sink.js';
import { RedactionEngine } from '../redaction-engine/redaction-engine.js';
import { BuildObserver, ObservationAuditor, OBSERVATION_AUDIT_ALLOWLIST } from './build-observer.js';
import { nodeArtifactProbe, spawnLocalBuild, factoryBuildObserver, factoryObservationAuditor } from '../../mcp-server/live-build-observer.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';

// Factory capability #2 — the Observer's evidence tie-in against REAL PostgreSQL: observations are recorded to
// the append-only, hash-chained audit (verifyChain ok), are IMMUTABLE (the append-only trigger rejects UPDATE),
// carry NO secret, and — wired to the factory's OWN builds via a real local process — capture status accurately.

const cfg = { host: process.env.PGHOST ?? '127.0.0.1', port: Number(process.env.PGPORT ?? 55432), database: process.env.PGDATABASE ?? 'ece_audit_test' };
const pool = new Pool({ ...cfg, user: 'ece_app' });
const sink = new PostgresHashChainSink(pool, new RedactionEngine());

afterAll(async () => { await pool.end(); });

const ORG = `orgObs-${process.pid}`;
const NODE = process.execPath; // the current node binary — a safe local build/run to observe

describe('capability #2 — observations are recorded to the hash-chain, immutable, verifiable, secret-free', () => {
  it('records two observations to the chain; verifyChain ok; entries are present as read-kind evidence', async () => {
    const observer = new BuildObserver(nodeArtifactProbe, { now: (() => { let t = 5_000; return () => (t += 100); })() });
    const auditor = new ObservationAuditor(sink, new RedactionEngine(OBSERVATION_AUDIT_ALLOWLIST), ORG, { user_id: 'build-observer', email: '', role: 'service' });

    const ok = await observer.observe({ kind: 'test', command: `${NODE} -e ok`, target: 'suite', run: spawnLocalBuild(NODE, ['-e', "process.stdout.write('600 passed')"]) });
    const bad = await observer.observe({ kind: 'test', command: `${NODE} -e fail`, target: 'suite', run: spawnLocalBuild(NODE, ['-e', 'process.exit(1)']) });
    expect(ok.status).toBe('success');
    expect(bad.status).toBe('failure');

    const r1 = await auditor.record(ok);
    const r2 = await auditor.record(bad);
    expect(r2.seq).toBe(r1.seq + 1); // chained, monotonic

    const v = await sink.verifyChain(ORG);
    expect(v.ok).toBe(true); // tamper-evident chain intact

    const rows = await sink.readEntries(ORG);
    const reads = rows.filter((x) => x.kind === 'read');
    expect(reads.length).toBeGreaterThanOrEqual(2); // both observations are on the chain as evidence
  });

  it('an observation carries NO secret: a leaky build recorded to the chain has the token scrubbed', async () => {
    const observer = factoryBuildObserver({ now: (() => { let t = 9_000; return () => (t += 100); })() });
    const auditor = factoryObservationAuditor(sink, ORG);
    const rec = await observer.observe({
      kind: 'build', command: `${NODE} -e leak`, target: 'leaky',
      run: spawnLocalBuild(NODE, ['-e', "process.stdout.write('ECE_GITHUB_TOKEN=ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345')"]),
    });
    expect(rec.stdout).not.toMatch(/ghp_[A-Za-z0-9]{20,}/); // scrubbed in the record
    expect(rec.stdout).toContain('[REDACTED]');
    await auditor.record(rec);

    // read it back straight from the store — the raw stored row must contain no token
    const client = new Client({ ...cfg, user: 'ece_app' });
    await client.connect();
    try {
      await client.query(`SET app.current_org = '${ORG}'`);
      const raw = await client.query<{ query_range: unknown }>(`SELECT query_range FROM audit_read_log WHERE organization_id = $1`, [ORG]);
      const dump = JSON.stringify(raw.rows);
      expect(dump).not.toMatch(/ghp_[A-Za-z0-9]{20,}/);      // no token persisted anywhere in the audit
      expect(dump).not.toMatch(/ECE_GITHUB_TOKEN=\S/);       // nor the secret env assignment
      expect(raw.rows.length).toBeGreaterThan(0);            // the observation WAS recorded (just secret-free)
    } finally { await client.end(); }
  });

  it('an observation is IMMUTABLE once written: the app role cannot UPDATE it (append-only enforced)', async () => {
    const auditor = new ObservationAuditor(sink, new RedactionEngine(OBSERVATION_AUDIT_ALLOWLIST), ORG, { user_id: 'build-observer', email: '', role: 'service' });
    await auditor.record({ observationId: 'obs-immutable', kind: 'build', command: 'build', target: null, startedAtIso: '2026-07-04T00:00:00.000Z', endedAtIso: '2026-07-04T00:00:00.100Z', durationMs: 100, status: 'success', exitCode: 0, stdout: 'ok', stderr: '', stdoutTruncated: false, stderrTruncated: false, artifacts: [] });
    const c = new Client({ ...cfg, user: 'ece_app' });
    await c.connect();
    try {
      await c.query(`SET app.current_org = '${ORG}'`);
      // ece_app has no UPDATE grant AND the audit_read_no_mutate trigger guards it — either way the row is immutable.
      await expect(c.query(`UPDATE audit_read_log SET rows_returned = 999 WHERE organization_id = $1`, [ORG])).rejects.toThrow(/append-only|no.?mutate|permission denied|cannot|not allowed/i);
    } finally { await c.end(); }
  });
});

describe('capability #2 — wired to the factory\'s OWN build: real artifacts get real integrity hashes', () => {
  it('observes a local build that produces a file; the record carries the file\'s true size + SHA-256', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'ece-obs-'));
    const artifact = path.join(dir, 'app.bundle.js');
    const contents = 'console.log("ece app bundle");\n';
    const observer = factoryBuildObserver({ now: (() => { let t = 20_000; return () => (t += 100); })() });
    const rec = await observer.observe({
      kind: 'build', command: `${NODE} build`, target: 'ece-app',
      run: spawnLocalBuild(NODE, ['-e', `require('fs').writeFileSync(${JSON.stringify(artifact)}, ${JSON.stringify(contents)})`]),
      artifactPaths: [artifact],
    });
    expect(rec.status).toBe('success');
    const expectedSha = createHash('sha256').update(contents).digest('hex');
    expect(rec.artifacts).toEqual([{ path: artifact, bytes: Buffer.byteLength(contents), sha256: expectedSha }]);
  });
});
