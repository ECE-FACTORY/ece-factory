import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BuildObserver,
  ObservationAuditor,
  SecretPatternRedactor,
  OBSERVATION_AUDIT_ALLOWLIST,
  type ArtifactProbe,
  type BuildOutcome,
} from './build-observer.js';
import { RedactionEngine } from '../../factory-shared/redaction-engine/redaction-engine.js';

// Factory capability #2 — the Run/Build Observer OBSERVES, never ACTS. These prove: capture accuracy, accurate
// success/failure, secret redaction, output bounding, artifact integrity (for preview/packaging), the observe-
// only structural property (no gate/approve/mint reference or method; cannot initiate a consequential action),
// observing does not modify what is watched, and the record carries what preview/packaging need.

const NOW = (() => { let t = 1_000_000; return () => (t += 500); })(); // deterministic clock: +500ms per call
function clockAt(start: number, end: number) { let n = 0; return () => (n++ === 0 ? start : end); }

const probeNone: ArtifactProbe = () => null;
const run = (o: Partial<BuildOutcome>): (() => Promise<BuildOutcome>) => async () => ({ exitCode: 0, stdout: '', stderr: '', ...o });

describe('BuildObserver — captures command / status / duration / output / artifacts accurately', () => {
  it('records the command, kind, target, exit, output and a positive duration', async () => {
    const obs = new BuildObserver(probeNone, { now: clockAt(1000, 4200) });
    const rec = await obs.observe({ kind: 'build', command: 'npm run build', target: 'module-23', run: run({ exitCode: 0, stdout: 'compiled ok', stderr: '' }) });
    expect(rec).toMatchObject({ kind: 'build', command: 'npm run build', target: 'module-23', exitCode: 0, status: 'success', stdout: 'compiled ok', stderr: '' });
    expect(rec.durationMs).toBe(3200);
    expect(rec.startedAtIso).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(rec.observationId).toContain('module-23');
  });

  it('a SUCCESSFUL build ⇒ status success; a FAILED build ⇒ status failure (exit code drives it)', async () => {
    const obs = new BuildObserver(probeNone, { now: NOW });
    const ok = await obs.observe({ kind: 'test', command: 'npm test', run: run({ exitCode: 0, stdout: '600 passed' }) });
    const bad = await obs.observe({ kind: 'test', command: 'npm test', run: run({ exitCode: 1, stderr: '2 failed' }) });
    const crashed = await obs.observe({ kind: 'run', command: './svc', run: run({ exitCode: null, stderr: 'spawn error' }) });
    expect(ok.status).toBe('success');
    expect(bad.status).toBe('failure');
    expect(bad.exitCode).toBe(1);
    expect(crashed.status).toBe('failure'); // null exit ⇒ not a success
  });

  it('bounds oversized output and flags truncation (evidence stays sane)', async () => {
    const obs = new BuildObserver(probeNone, { now: NOW, maxOutputBytes: 100 });
    const rec = await obs.observe({ kind: 'build', command: 'x', run: run({ exitCode: 0, stdout: 'A'.repeat(5000) }) });
    expect(rec.stdoutTruncated).toBe(true);
    expect(rec.stdout.length).toBeLessThan(5000);
    expect(rec.stdout).toContain('…[truncated]');
  });

  it('captures artifacts with size + SHA-256 (integrity for preview/packaging)', async () => {
    const probe: ArtifactProbe = (p) => (p === 'dist/app.js' ? { bytes: 42, sha256: 'a'.repeat(64) } : p === 'dist/app.map' ? { bytes: 9, sha256: 'b'.repeat(64) } : null);
    const obs = new BuildObserver(probe, { now: NOW });
    const rec = await obs.observe({ kind: 'build', command: 'build', run: run({ exitCode: 0, artifactPaths: ['dist/app.js', 'dist/app.map', 'dist/missing'] }) });
    expect(rec.artifacts).toEqual([
      { path: 'dist/app.js', bytes: 42, sha256: 'a'.repeat(64) },
      { path: 'dist/app.map', bytes: 9, sha256: 'b'.repeat(64) },
    ]); // the missing path is omitted (probe returned null)
  });
});

describe('BuildObserver — secrets in observed output are REDACTED before recording', () => {
  it('masks GitHub tokens, bearer creds, secret env assignments and DSN passwords in stdout/stderr/command', async () => {
    const obs = new BuildObserver(probeNone, { now: NOW });
    const leaky = [
      'using token ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345',
      'Authorization: Bearer eyJhbGciOiJI.payload.sig',
      'ECE_GITHUB_TOKEN=ghp_SECRETSECRETSECRETSECRET123456',
      'PGPASSWORD=hunter2supersecret',
      'DATABASE_URL=postgres://user:p4ssw0rd@db:5432/x',
    ].join('\n');
    const rec = await obs.observe({ kind: 'run', command: 'deploy --token ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345', run: run({ exitCode: 0, stdout: leaky, stderr: 'PRIVATE_KEY=abcd1234efgh5678' }) });
    for (const s of [rec.stdout, rec.stderr, rec.command]) {
      expect(s).not.toMatch(/ghp_[A-Za-z0-9]{20,}/);
      expect(s).not.toMatch(/hunter2supersecret|p4ssw0rd|abcd1234efgh5678/);
    }
    expect(rec.stdout).toContain('[REDACTED]');
    expect(rec.command).toContain('[REDACTED]');
  });
});

describe('ObservationAuditor — records to the hash-chain via appendRead, secret-free (fake sink)', () => {
  it('end-to-end: an observed leaky build → the chain summary is allowlist-only + carries hashes, and NO token reaches it', async () => {
    const writes: Array<Record<string, unknown>> = [];
    const fakeSink = { appendRead: async (e: { query_range?: Record<string, unknown> }) => { writes.push(e.query_range ?? {}); return { seq: writes.length, entry_hash: 'h'.repeat(64) }; } };
    const probe: ArtifactProbe = () => ({ bytes: 7, sha256: 'c'.repeat(64) });
    const obs = new BuildObserver(probe, { now: clockAt(0, 1000) });
    // the Observer scrubs the command + output; the auditor then allowlist-redacts the summary onto the chain.
    const rec = await obs.observe({ kind: 'build', command: 'build --token ghp_SHOULDNOTBEHERE0000000000000000', target: 't', run: run({ exitCode: 0, stdout: 'PGPASSWORD=leakme', artifactPaths: ['dist/a'] }) });
    const auditor = new ObservationAuditor(fakeSink, new RedactionEngine(OBSERVATION_AUDIT_ALLOWLIST), 'orgObs', { user_id: 'build-observer', email: '', role: 'service' });
    await auditor.record(rec);
    const w = writes[0];
    expect(w).toMatchObject({ observation: rec.observationId, kind: 'build', status: 'success', exitCode: 0, durationMs: 1000, artifacts: [{ path: 'dist/a', bytes: 7, sha256: 'c'.repeat(64) }] });
    expect(w).not.toHaveProperty('stdout'); // deny-by-default: raw output is never in the summary
    expect(w).not.toHaveProperty('stderr');
    expect(JSON.stringify(w)).not.toMatch(/ghp_[A-Za-z0-9]{20,}/);   // token scrubbed by the Observer, absent from the chain
    expect(JSON.stringify(w)).not.toMatch(/leakme/);                 // secret env value never reaches the chain
  });
});

describe('BuildObserver — INFORMS, never ACTS: no gate/approve/mint reference or method (structural)', () => {
  it('exposes ONLY observe(); no approve/commit/mint/gate/resolve/consume method exists', () => {
    const obs = new BuildObserver(probeNone) as unknown as Record<string, unknown>;
    for (const m of ['approve', 'commit', 'mint', 'resolve', 'consume', 'gate', 'grant', 'run', 'callTool', 'createGithubRepo', 'disableAudit', 'disableKill']) {
      expect(typeof obs[m]).toBe('undefined');
    }
    expect(typeof (obs as { observe?: unknown }).observe).toBe('function'); // its ONLY capability
  });

  it('the auditor exposes ONLY record(); it holds appendRead + a redactor, nothing that can approve/commit', () => {
    const auditor = new ObservationAuditor({ appendRead: async () => ({ seq: 1, entry_hash: 'h' }) }, new RedactionEngine(), 'o', { user_id: 'svc', email: '', role: 'service' }) as unknown as Record<string, unknown>;
    for (const m of ['approve', 'commit', 'mint', 'resolve', 'consume', 'callTool']) expect(typeof auditor[m]).toBe('undefined');
    expect(typeof (auditor as { record?: unknown }).record).toBe('function');
  });

  it('a BuildRun cannot smuggle a gated action: it is a plain output-returning thunk (no capability/target/approval)', async () => {
    // The watched run yields only { exitCode, stdout, stderr, artifactPaths } — there is no field through which a
    // consequential external action, capability, or approval could be requested. Observing it changes nothing.
    const obs = new BuildObserver(probeNone, { now: NOW });
    const rec = await obs.observe({ kind: 'run', command: 'echo', run: async () => ({ exitCode: 0, stdout: 'inert', stderr: '' }) });
    expect(rec.status).toBe('success');
  });
});

describe('BuildObserver — observing does NOT modify what is watched', () => {
  it('the run is invoked exactly once and the observer mutates neither the input nor the outcome', async () => {
    let calls = 0;
    const watchedResource = { builds: 0 };
    const input = { kind: 'build' as const, command: 'build', target: 'm', run: async (): Promise<BuildOutcome> => { calls++; watchedResource.builds++; return { exitCode: 0, stdout: 'ok', stderr: '', artifactPaths: [] }; } };
    const frozenPaths = input.run;
    const obs = new BuildObserver(probeNone, { now: NOW });
    await obs.observe(input);
    expect(calls).toBe(1);               // watched exactly once — no re-run, no retry
    expect(watchedResource.builds).toBe(1); // only the build itself changed the resource, not the observer
    expect(input.run).toBe(frozenPaths); // the observer did not rewrite the input
    expect(input.command).toBe('build'); // input untouched
  });
});

describe('BuildObserver — the record carries what Local Preview (#3) + App Packaging (#4) need', () => {
  it('has status + artifacts[].{path,bytes,sha256} + timing — the packaging/preview input shape', async () => {
    const probe: ArtifactProbe = () => ({ bytes: 10, sha256: 'd'.repeat(64) });
    const obs = new BuildObserver(probe, { now: clockAt(0, 250) });
    const rec = await obs.observe({ kind: 'build', command: 'build', target: 'ece-app', run: run({ exitCode: 0, artifactPaths: ['dist/ece-app.tar'] }) });
    expect(Object.keys(rec).sort()).toEqual(['artifacts', 'command', 'durationMs', 'endedAtIso', 'exitCode', 'kind', 'observationId', 'startedAtIso', 'status', 'stderr', 'stderrTruncated', 'stdout', 'stdoutTruncated', 'target'].sort());
    expect(rec.status).toBe('success');
    expect(rec.artifacts[0]).toEqual({ path: 'dist/ece-app.tar', bytes: 10, sha256: 'd'.repeat(64) });
  });
});

describe('BuildObserver — OBSERVE-ONLY by construction: the module imports no gate/gauntlet/bridge/external code', () => {
  it('build-observer.ts imports nothing from the gate/approval/bridge/external-action modules', () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(path.join(here, 'build-observer.ts'), 'utf8');
    const imports = [...src.matchAll(/^\s*import\s.*?from\s+['"]([^'"]+)['"]/gm)].map((m) => m[1]);
    const forbidden = /approval-gate|mcp-bridge|external-gateways|external-tools|decision-console|kill-switch|tool-classes|permission-engine/;
    expect(imports.filter((i) => forbidden.test(i))).toEqual([]); // zero coupling to any acting/gating module
    // and every cross-module import is a TYPE import (no runtime engine coupling — standalone-packageable)
    const runtimeCrossImports = [...src.matchAll(/^\s*import\s+(?!type\b)[^;]*?from\s+['"](\.\.\/[^'"]+)['"]/gm)].map((m) => m[1]);
    expect(runtimeCrossImports).toEqual([]);
  });
});

describe('SecretPatternRedactor — deny-by-default free-text scrub', () => {
  it('is idempotent and leaves non-secret text intact', () => {
    expect(SecretPatternRedactor.redact('all good, exit 0')).toBe('all good, exit 0');
    const once = SecretPatternRedactor.redact('t=ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345');
    expect(SecretPatternRedactor.redact(once)).toBe(once); // masking again changes nothing
  });
});
