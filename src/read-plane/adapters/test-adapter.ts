// TestAdapter + LawAdapter — run/read the existing suites and pin results to HEAD (Design §4). The vitest runner
// is INJECTABLE: the default spawns `npx vitest run --reporter=json`, but every test injects a fake runner so the
// read-plane's own suite never recursively spawns vitest. Results are reported HONESTLY (the 12 pre-existing db-*
// failures are surfaced, never hidden). Provenance source is 'test-run'; a dirty working tree is surfaced so a
// reader never mistakes a working-tree run for a committed one. HEAD-keyed caching lives in the State API layer.

import { execSync } from 'node:child_process';
import { present } from '../contracts/index.js';
import type { TestSuiteRun, LawTestRun, Prohibition, LawBadge } from '../contracts/index.js';

/** The Jest-compatible shape vitest's json reporter emits. */
export interface VitestJson {
  numTotalTests: number; numPassedTests: number; numFailedTests: number; numPendingTests?: number; numTodoTests?: number;
  testResults: { name: string; assertionResults: { title: string; fullName?: string; status: string }[] }[];
}
/** Injectable read-only runner: returns stdout containing the json report. */
export type VitestRunner = (files: string[]) => string;

export const realRunner: VitestRunner = (files) =>
  execSync(`npx vitest run --reporter=json ${files.join(' ')}`.trim(), { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 });

export function parseVitestJson(stdout: string): VitestJson {
  const start = stdout.indexOf('{'); const end = stdout.lastIndexOf('}');
  if (start < 0 || end < 0) throw new Error('no JSON report found in vitest output');
  return JSON.parse(stdout.slice(start, end + 1)) as VitestJson;
}

export interface RunCtx { head: string; dirty: boolean; now?: () => string; runner?: VitestRunner; files?: string[]; }
const nowIso = () => new Date().toISOString();
const testProv = (head: string, cmd: string, now: () => string): Parameters<typeof present>[1] => ({ source: 'test-run', locator: { kind: 'cmd', cmd }, pin: { kind: 'commit', commit: head }, readAt: now() });

export function testSuiteRun(ctx: RunCtx): TestSuiteRun {
  const now = ctx.now ?? nowIso;
  const files = ctx.files ?? [];
  const j = parseVitestJson((ctx.runner ?? realRunner)(files));
  const cmd = `npx vitest run --reporter=json ${files.join(' ')}`.trim();
  const p = () => testProv(ctx.head, cmd, now);
  const failing = j.testResults.flatMap((tr) => tr.assertionResults.filter((a) => a.status === 'failed').map((a) => ({ file: tr.name, name: a.title })));
  return {
    total: present(j.numTotalTests, p()),
    passed: present(j.numPassedTests, p()),
    failed: present(j.numFailedTests, p()),
    skipped: present((j.numPendingTests ?? 0) + (j.numTodoTests ?? 0), p()),
    failing: present(failing, p()),
    dirty: present(ctx.dirty, p()),
  };
}

export const LAW_FILES = ['src/architecture/write-asks-read-first.test.ts', 'src/architecture/layer-boundaries.test.ts'];

export function lawTestRun(ctx: RunCtx): LawTestRun {
  const now = ctx.now ?? nowIso;
  const files = ctx.files ?? LAW_FILES;
  const j = parseVitestJson((ctx.runner ?? realRunner)(files));
  const cmd = `npx vitest run --reporter=json ${files.join(' ')}`;
  const p = () => testProv(ctx.head, cmd, now);
  const prohibitions: Prohibition[] = j.testResults.flatMap((tr) => tr.assertionResults).map((a) => {
    const id = /Prohibition\s+(\w+)/.exec(a.title)?.[1] ?? a.title.slice(0, 48);
    const status: LawBadge = a.status === 'passed' ? 'pass' : a.status === 'failed' ? 'fail' : 'skipped';
    return { id, title: a.title, status };
  });
  return {
    suite: files.join(' + '),
    prohibitions: present(prohibitions, p()),
    passed: present(prohibitions.filter((x) => x.status === 'pass').length, p()),
    failed: present(prohibitions.filter((x) => x.status === 'fail').length, p()),
  };
}
