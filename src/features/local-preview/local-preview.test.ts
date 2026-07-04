import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  LocalPreviewGenerator,
  PreviewAuditor,
  PREVIEW_AUDIT_ALLOWLIST,
  type PreviewManifest,
} from './local-preview.js';
import { SecretPatternRedactor, type ObservationRecord } from '../build-observer/build-observer.js';
import { RedactionEngine } from '../redaction-engine/redaction-engine.js';

// Factory capability #3 — the Local Preview Standard generator. These prove: it consumes an ObservationRecord +
// manifest and produces a correct Preview/Status Report; HONEST current-vs-missing (a failed/incomplete build
// says so, never overstated); the standard-compliance check flags specific gaps; report/generate-only (no
// gate/approve/mint ref or method; cannot act or modify the build); redaction applied; and the standard doc
// defines the required run/demo/status declarations.

function observation(over: Partial<ObservationRecord> = {}): ObservationRecord {
  return {
    observationId: 'obs-x', kind: 'build', command: 'npm run build', target: 't', startedAtIso: '2026-07-04T00:00:00.000Z',
    endedAtIso: '2026-07-04T00:00:02.000Z', durationMs: 2000, status: 'success', exitCode: 0, stdout: 'ok', stderr: '',
    stdoutTruncated: false, stderrTruncated: false, artifacts: [{ path: 'dist/app.js', bytes: 12, sha256: 'a'.repeat(64) }],
    ...over,
  };
}
function manifest(over: Partial<PreviewManifest> = {}): PreviewManifest {
  return {
    name: 'ece-app', kind: 'app', version: '1.2.3',
    runCommands: { install: 'npm ci', run: 'npm start', preview: 'npm run preview', status: 'npm run status' },
    demo: { command: 'npm run demo', description: 'demo with seed data' },
    capabilities: [
      { id: 'core', description: 'core capability', state: 'present' },
      { id: 'reports', description: 'reporting', state: 'partial' },
      { id: 'billing', description: 'billing', state: 'absent' },
    ],
    artifacts: ['dist/app.js'],
    ...over,
  };
}

describe('LocalPreviewGenerator — consumes the Observer record + manifest → a correct Preview/Status Report', () => {
  it('a successful, complete build ⇒ built:true, compliant, run commands + demo + current-vs-missing present', () => {
    const rep = new LocalPreviewGenerator().generate(manifest(), observation());
    expect(rep).toMatchObject({ name: 'ece-app', kind: 'app', version: '1.2.3', built: true, observedStatus: 'success', exitCode: 0, observationId: 'obs-x' });
    expect(rep.runCommands).toEqual({ install: 'npm ci', run: 'npm start', preview: 'npm run preview', status: 'npm run status' });
    expect(rep.demo).toEqual({ command: 'npm run demo', description: 'demo with seed data' });
    expect(rep.present.map((c) => c.id)).toEqual(['core']);
    expect(rep.partial.map((c) => c.id)).toEqual(['reports']);
    expect(rep.missing.map((c) => c.id)).toEqual(['billing']); // "what's missing" is first-class
    expect(rep.artifacts).toEqual([{ path: 'dist/app.js', observed: true, bytes: 12, sha256: 'a'.repeat(64) }]);
    expect(rep.compliance.compliant).toBe(true);
    expect(rep.compliance.gaps).toEqual([]);
    expect(rep.summary).toContain('built OK');
    expect(rep.summary).toContain('1 capability(ies) still missing');
  });
});

describe('LocalPreviewGenerator — HONEST status: a failed / incomplete build is reported as such, never overstated', () => {
  it('a FAILED build ⇒ built:false, summary says did NOT build, and a compliance gap for the failure', () => {
    const rep = new LocalPreviewGenerator().generate(manifest(), observation({ status: 'failure', exitCode: 1 }));
    expect(rep.built).toBe(false);
    expect(rep.summary).toContain('did NOT build');
    expect(rep.compliance.compliant).toBe(false);
    expect(rep.compliance.gaps.join(' ')).toMatch(/build did not succeed/);
    expect(rep.compliance.checks.buildSucceeded).toBe(false);
  });

  it('a declared artifact NOT observed ⇒ artifact.observed:false + a specific gap (integrity honesty)', () => {
    const rep = new LocalPreviewGenerator().generate(manifest({ artifacts: ['dist/app.js', 'dist/missing.js'] }), observation());
    expect(rep.artifacts.find((a) => a.path === 'dist/missing.js')).toEqual({ path: 'dist/missing.js', observed: false, bytes: null, sha256: null });
    expect(rep.compliance.compliant).toBe(false);
    expect(rep.compliance.gaps.join(' ')).toMatch(/declared artifact\(s\) not observed: dist\/missing\.js/);
  });
});

describe('LocalPreviewGenerator — the standard-compliance check flags a non-compliant build with SPECIFIC gaps', () => {
  it('missing required run commands + no capabilities ⇒ non-compliant, each gap named', () => {
    const bad = manifest({ runCommands: { run: 'npm start' }, capabilities: [] }); // missing preview+status, no caps
    const c = new LocalPreviewGenerator().checkStandard(bad, observation());
    expect(c.compliant).toBe(false);
    expect(c.checks.requiredCommandsDeclared).toBe(false);
    expect(c.checks.capabilitiesDeclared).toBe(false);
    expect(c.gaps.join(' ')).toMatch(/missing required run command\(s\): preview, status/);
    expect(c.gaps.join(' ')).toMatch(/no capabilities declared/);
  });

  it('a fully-declared, successfully-built thing with all artifacts present ⇒ compliant, zero gaps', () => {
    const c = new LocalPreviewGenerator().checkStandard(manifest(), observation());
    expect(c.compliant).toBe(true);
    expect(c.gaps).toEqual([]);
    expect(c.checks).toMatchObject({ requiredCommandsDeclared: true, capabilitiesDeclared: true, demoDeclared: true, buildSucceeded: true, declaredArtifactsPresent: true });
  });
});

describe('LocalPreviewGenerator — REPORT/GENERATE-ONLY: no gate/approve/mint reference or method (structural)', () => {
  it('exposes ONLY generate()/checkStandard(); no approve/commit/mint/gate/run/act method exists', () => {
    const g = new LocalPreviewGenerator() as unknown as Record<string, unknown>;
    for (const m of ['approve', 'commit', 'mint', 'resolve', 'consume', 'gate', 'grant', 'run', 'spawn', 'launch', 'callTool', 'createGithubRepo', 'disableAudit']) {
      expect(typeof g[m]).toBe('undefined');
    }
    expect(typeof (g as { generate?: unknown }).generate).toBe('function');
    expect(typeof (g as { checkStandard?: unknown }).checkStandard).toBe('function'); // its ONLY capabilities → data
  });

  it('the auditor exposes ONLY record(); nothing that can approve/commit/act', () => {
    const a = new PreviewAuditor({ appendRead: async () => ({ seq: 1, entry_hash: 'h' }) }, new RedactionEngine(), 'o', { user_id: 'svc', email: '', role: 'service' }) as unknown as Record<string, unknown>;
    for (const m of ['approve', 'commit', 'mint', 'resolve', 'consume', 'callTool']) expect(typeof a[m]).toBe('undefined');
    expect(typeof (a as { record?: unknown }).record).toBe('function');
  });

  it('generate() does not mutate the manifest or the observation it reads', () => {
    const m = manifest();
    const o = observation();
    const mSnapshot = JSON.stringify(m);
    const oSnapshot = JSON.stringify(o);
    new LocalPreviewGenerator().generate(m, o);
    expect(JSON.stringify(m)).toBe(mSnapshot); // report-only: inputs untouched
    expect(JSON.stringify(o)).toBe(oSnapshot);
  });
});

describe('LocalPreviewGenerator — redaction: no secret reaches the report or the audited summary', () => {
  it('secrets in a run/demo command are scrubbed in the report (with the Observer scrubber)', () => {
    const leaky = manifest({ runCommands: { run: 'start --token ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345', preview: 'preview', status: 'status' }, demo: { command: 'demo PGPASSWORD=hunter2secret', description: 'd' } });
    const rep = new LocalPreviewGenerator(SecretPatternRedactor).generate(leaky, observation());
    expect(rep.runCommands.run).not.toMatch(/ghp_[A-Za-z0-9]{20,}/);
    expect(rep.runCommands.run).toContain('[REDACTED]');
    expect(rep.demo?.command).not.toMatch(/hunter2secret/);
  });

  it('the audited summary is allowlist-only + secret-free (end-to-end via the allowlist redactor)', async () => {
    const writes: Array<Record<string, unknown>> = [];
    const sink = { appendRead: async (e: { query_range?: Record<string, unknown> }) => { writes.push(e.query_range ?? {}); return { seq: writes.length, entry_hash: 'h'.repeat(64) }; } };
    const rep = new LocalPreviewGenerator(SecretPatternRedactor).generate(
      manifest({ runCommands: { run: 'x ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345', preview: 'p', status: 's' } }),
      observation(),
    );
    await new PreviewAuditor(sink, new RedactionEngine(PREVIEW_AUDIT_ALLOWLIST), 'orgP', { user_id: 'local-preview', email: '', role: 'service' }).record(rep);
    const w = writes[0];
    expect(w).toMatchObject({ preview: 'ece-app', built: true, compliant: true });
    expect(w).not.toHaveProperty('runCommands'); // deny-by-default: commands are not on the allowlist
    expect(JSON.stringify(w)).not.toMatch(/ghp_[A-Za-z0-9]{20,}/);
    expect(JSON.stringify(w).match(/"missing"/)).toBeTruthy(); // current-vs-missing IS recorded (honest evidence)
  });
});

describe('Local Preview Standard — the doctrine doc exists and defines the required run/demo/status declarations', () => {
  it('docs/LOCAL_PREVIEW_STANDARD.md exists and names run + preview + status + current-vs-missing', () => {
    const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
    const doc = path.join(repoRoot, 'docs', 'LOCAL_PREVIEW_STANDARD.md');
    expect(existsSync(doc)).toBe(true);
    const text = readFileSync(doc, 'utf8');
    for (const token of ['runCommands', '`run`', '`preview`', '`status`', 'demo', 'current-vs-missing', 'present', 'partial', 'absent', 'compliant']) {
      expect(text).toContain(token);
    }
  });
});

describe('LocalPreviewGenerator — OBSERVE/REPORT-ONLY by construction: no gate/gauntlet/bridge import', () => {
  it('local-preview.ts imports nothing from the gate/approval/bridge/external-action modules and has zero runtime cross-engine imports', () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(path.join(here, 'local-preview.ts'), 'utf8');
    const imports = [...src.matchAll(/^\s*import\s.*?from\s+['"]([^'"]+)['"]/gm)].map((m) => m[1]);
    const forbidden = /approval-gate|mcp-bridge|external-gateways|external-tools|decision-console|kill-switch|tool-classes|permission-engine/;
    expect(imports.filter((i) => forbidden.test(i))).toEqual([]);
    const runtimeCrossImports = [...src.matchAll(/^\s*import\s+(?!type\b)[^;]*?from\s+['"](\.\.\/[^'"]+)['"]/gm)].map((m) => m[1]);
    expect(runtimeCrossImports).toEqual([]); // every cross-module import is `import type` — standalone-packageable
  });
});
