// Live Build Observer wiring (Factory capability #2, composition layer) — supplies the Node-side ports the
// general BuildObserver core needs (fs+crypto artifact probe, a local-process runner) and wires it FIRST to the
// factory's own build/run/test activity. This is a THIN composition adapter: it adds NO guard logic, holds NO
// gate/approval/bridge, and can only observe → record.
//
// The ONLY thing this adapter ever causes to run is `spawnLocalBuild` — a LOCAL, NON-consequential build/run/
// test process (e.g. a module build or the test suite). It NEVER runs a gated external action: it shells out to
// a local command with shell:false and no network authority, and it carries no capability/approval/target. The
// factory decides what to build/run; the Observer only watches and records.

import { spawn } from 'node:child_process';
import { statSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { RedactionEngine } from '../features/redaction-engine/redaction-engine.js';
import type { AuditSink } from '../features/audit-engine/sink.js';
import type { HumanActor, Environment } from '../features/audit-engine/schema.js';
import {
  BuildObserver,
  ObservationAuditor,
  OBSERVATION_AUDIT_ALLOWLIST,
  type ArtifactProbe,
  type BuildOutcome,
  type ObserverConfig,
} from '../features/build-observer/build-observer.js';

/** Real artifact probe: size + SHA-256 of a file's bytes. Returns null for a missing/non-file path. */
export const nodeArtifactProbe: ArtifactProbe = (path) => {
  try {
    const st = statSync(path);
    if (!st.isFile()) return null;
    const sha256 = createHash('sha256').update(readFileSync(path)).digest('hex');
    return { bytes: st.size, sha256 };
  } catch {
    return null;
  }
};

/**
 * Build a `BuildRun` that spawns a LOCAL, NON-consequential command and captures its stdout/stderr/exit. Uses
 * shell:false (no shell interpolation) — the observer watches a local build/test, never a gated external action.
 * The process never rejects: an error is reported as exitCode:null + stderr so the observation is always recorded.
 */
export function spawnLocalBuild(
  command: string,
  args: string[] = [],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): () => Promise<BuildOutcome> {
  return () =>
    new Promise<BuildOutcome>((resolve) => {
      const child = spawn(command, args, { cwd: opts.cwd, env: opts.env, shell: false });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (d) => { stdout += d.toString(); });
      child.stderr.on('data', (d) => { stderr += d.toString(); });
      child.on('error', (e) => resolve({ exitCode: null, stdout, stderr: stderr + `\n[spawn error] ${e.message}` }));
      child.on('close', (code) => resolve({ exitCode: code, stdout, stderr }));
    });
}

/** The factory's general Observer core, backed by the real fs+crypto probe. */
export function factoryBuildObserver(cfg: ObserverConfig = {}): BuildObserver {
  return new BuildObserver(nodeArtifactProbe, cfg);
}

/** The default service identity for factory build observations (a service actor, never 'claude'/a fake human). */
export const BUILD_OBSERVER_ACTOR: HumanActor = { user_id: 'build-observer', email: '', role: 'service' };

/** The observation auditor, wired to the factory's real hash-chain sink with the allowlist redactor. */
export function factoryObservationAuditor(
  sink: Pick<AuditSink, 'appendRead'>,
  organizationId: string,
  actor: HumanActor = BUILD_OBSERVER_ACTOR,
  environment: Environment = 'local',
): ObservationAuditor {
  return new ObservationAuditor(sink, new RedactionEngine(OBSERVATION_AUDIT_ALLOWLIST), organizationId, actor, environment);
}
