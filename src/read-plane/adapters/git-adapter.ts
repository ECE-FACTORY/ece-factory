// GitAdapter — real, read-only git state. Runs `git rev-parse / status / log` (read-only; no writes) and stamps
// each field with provenance {source:'git', locator:{cmd}, pin:{commit: HEAD}}. The `run` command executor is
// injectable so tests can drive canned git output with no real repo dependency (Design §4).

import { execSync } from 'node:child_process';
import { present } from '../contracts/index.js';
import type { GitState, GitLogEntry, Provenanced } from '../contracts/index.js';

const nowIso = () => new Date().toISOString();
const US = '\x1f'; // unit separator for log fields

export interface GitAdapterOpts {
  cwd?: string;
  now?: () => string;
  /** Injectable read-only command runner (default: execSync). Returns trimmed stdout. */
  run?: (cmd: string) => string;
}

export function gitState(opts: GitAdapterOpts = {}): GitState {
  const cwd = opts.cwd ?? process.cwd();
  const now = opts.now ?? nowIso;
  const run = opts.run ?? ((cmd: string) => execSync(cmd, { cwd, encoding: 'utf8' }).trim());

  const head = run('git rev-parse HEAD');
  const branch = run('git rev-parse --abbrev-ref HEAD');
  const dirty = run('git status --porcelain').length > 0;
  const logCmd = `git log -5 --format=%H${US}%s${US}%an${US}%aI`;
  const logRaw = run(logCmd);
  const recent: GitLogEntry[] = logRaw
    ? logRaw.split('\n').filter(Boolean).map((l) => { const [sha = '', subject = '', author = '', iso = ''] = l.split(US); return { sha, subject, author, iso }; })
    : [];

  const gitProv = (cmd: string): Parameters<typeof present>[1] => ({ source: 'git', locator: { kind: 'cmd', cmd }, pin: { kind: 'commit', commit: head }, readAt: now() });
  return {
    head: present(head, gitProv('git rev-parse HEAD')) as Provenanced<string>,
    branch: present(branch, gitProv('git rev-parse --abbrev-ref HEAD')),
    dirty: present(dirty, gitProv('git status --porcelain')),
    recent: present(recent, gitProv(logCmd)),
  };
}
