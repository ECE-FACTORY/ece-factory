// Adapter unit tests — each adapter stamps correct provenance; git/vitest are driven by injected fakes (no real
// repo/subprocess), report/capability read the real files/constants.
import { describe, it, expect } from 'vitest';
import { gitState } from './git-adapter.js';
import { listReports, getReport } from './report-adapter.js';
import { capabilityState } from './capability-adapter.js';
import { storeState } from './store-adapter.js';
import { testSuiteRun, lawTestRun } from './test-adapter.js';
import { JAIL_PREFIX } from '../../layer-5-action/filesystem-executor/filesystem-executor.js';

const US = '\x1f';
const P = (x: { status: string }) => x.status === 'present';

describe('GitAdapter — real read-only git, injected runner', () => {
  it('stamps git provenance (source git, pin commit=HEAD) from canned output', () => {
    const run = (cmd: string) => cmd.includes('rev-parse HEAD') ? 'deadbeefcafebabe'
      : cmd.includes('abbrev-ref') ? 'main'
      : cmd.includes('status --porcelain') ? ''
      : cmd.includes('log -5') ? `s1${US}subj1${US}auth1${US}2026-01-01T00:00:00Z` : '';
    const g = gitState({ run, now: () => 'ISO' });
    expect(g.head).toMatchObject({ status: 'present', value: 'deadbeefcafebabe' });
    expect(g.head.status === 'present' && g.head.provenance).toMatchObject({ source: 'git', pin: { kind: 'commit', commit: 'deadbeefcafebabe' } });
    expect(g.dirty.status === 'present' && g.dirty.value).toBe(false);
    expect(g.recent.status === 'present' && g.recent.value.length).toBe(1);
  });
});

describe('ReportAdapter — real committed files, report-file provenance', () => {
  it('lists all committed reports with sha256 provenance', () => {
    const runs = listReports();
    expect(runs.length).toBe(3);
    expect(runs.every(P)).toBe(true);
    expect(runs.every((r) => r.status === 'present' && r.provenance.source === 'report-file' && r.provenance.pin.kind === 'hash')).toBe(true);
  });
  it('gets a report by domain; a miss is honest-absent', () => {
    const iam = getReport('Identity & Access');
    expect(iam.status).toBe('present');
    expect(iam.status === 'present' && iam.value.subDomains.length).toBe(5);
    expect(getReport('Nonexistent Domain XYZ').status).toBe('absent');
  });
});

describe('CapabilityAdapter — imported constants, no drift', () => {
  it('exposes the executor JAIL_PREFIX (===) with source-constant provenance', () => {
    const c = capabilityState(() => 'ISO');
    expect(c.sandboxJailPrefix.status === 'present' && c.sandboxJailPrefix.value).toBe(JAIL_PREFIX);
    expect(c.sandboxJailPrefix.status === 'present' && c.sandboxJailPrefix.provenance.source).toBe('source-constant');
    expect(c.toolClasses.status === 'present' && c.toolClasses.value).toContain('APPROVAL_REQUIRED_WRITE');
    expect(c.mintPrivacy.status === 'present' && c.mintPrivacy.value.status).toBe('gated');
    expect(c.seamTools.status === 'present' && c.seamTools.value).toContain('approve_build_decision_subscription');
  });
});

describe('StoreAdapter — honest absent (M3)', () => {
  it('all three stores are typed absent with a reason', () => {
    const s = storeState(() => 'ISO');
    for (const k of ['approvals', 'audit', 'executions'] as const) {
      expect(s[k].status).toBe('absent');
      expect(s[k].value).toBeNull();
      expect(s[k].provenance.source).toBe('absent');
    }
  });
});

describe('Test/Law adapters — parse vitest json (fake runner), pin to HEAD, surface failures honestly', () => {
  const fake = () => JSON.stringify({
    numTotalTests: 5, numPassedTests: 4, numFailedTests: 1, numPendingTests: 0,
    testResults: [{ name: 'x.test.ts', assertionResults: [
      { title: 'Prohibition 4a — mint private', status: 'passed' },
      { title: 'Prohibition 4z — broken', status: 'failed' },
      { title: 'db thing', status: 'passed' },
    ] }],
  });
  it('TestSuiteRun summarizes + lists failures, dirty surfaced', () => {
    const t = testSuiteRun({ head: 'H', dirty: true, now: () => 'ISO', runner: fake });
    expect(t.total.status === 'present' && t.total.value).toBe(5);
    expect(t.failed.status === 'present' && t.failed.value).toBe(1);
    expect(t.dirty.status === 'present' && t.dirty.value).toBe(true);
    expect(t.failing.status === 'present' && t.failing.value[0]).toMatchObject({ file: 'x.test.ts', name: 'Prohibition 4z — broken' });
    expect(t.total.status === 'present' && t.total.provenance.pin).toMatchObject({ kind: 'commit', commit: 'H' });
  });
  it('LawTestRun maps each Prohibition id → pass/fail', () => {
    const l = lawTestRun({ head: 'H', dirty: false, now: () => 'ISO', runner: fake });
    const prohs = l.prohibitions.status === 'present' ? l.prohibitions.value : [];
    expect(prohs.find((p) => p.id === '4a')).toMatchObject({ status: 'pass' });
    expect(prohs.find((p) => p.id === '4z')).toMatchObject({ status: 'fail' });
    expect(l.failed.status === 'present' && l.failed.value).toBe(1);
  });
});
