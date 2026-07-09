// Contracts — a bare operational value must be a TYPE error (tsc, below) AND a SCHEMA failure (runtime, below).
import { describe, it, expect } from 'vitest';
import { GitStateSchema, CapabilityStateSchema, StoreStateSchema, provenanced, present, absent } from './index.js';
import type { GitState, Provenanced } from './index.js';
import { z } from 'zod';

const P = (v: unknown) => ({ status: 'present', value: v, provenance: { source: 'git', locator: { kind: 'cmd', cmd: 'git rev-parse HEAD' }, pin: { kind: 'commit', commit: 'abc' }, readAt: '2026-07-09T00:00:00.000Z' } });

describe('contracts — Provenanced<T> is load-bearing', () => {
  it('a provenanced value round-trips; a BARE operational value fails the schema', () => {
    expect(GitStateSchema.safeParse({ head: P('sha'), branch: P('main'), dirty: P(false), recent: P([]) }).success).toBe(true);
    expect(GitStateSchema.safeParse({ head: 'sha', branch: 'main', dirty: false, recent: [] }).success).toBe(false);
  });

  it("a 'present' value carrying 'absent' provenance is a contradiction and fails", () => {
    const bad = { head: { status: 'present', value: 'x', provenance: { source: 'absent', reason: 'no', readAt: '2026-07-09T00:00:00.000Z' } }, branch: P('m'), dirty: P(false), recent: P([]) };
    expect(GitStateSchema.safeParse(bad).success).toBe(false);
  });

  it('an absent value carries null + a reason (honest unknown)', () => {
    const schema = provenanced(z.string());
    const a = absent<string>('store lands in M3', '2026-07-09T00:00:00.000Z');
    expect(schema.safeParse(a).success).toBe(true);
    expect(a.value).toBeNull();
    // A present value REQUIRES a real source (not 'absent').
    const good = present('x', { source: 'source-constant', locator: { kind: 'module', module: 'm', export: 'e' }, pin: { kind: 'none' }, readAt: '2026-07-09T00:00:00.000Z' });
    expect(schema.safeParse(good).success).toBe(true);
  });

  it('capability + store schemas validate their provenanced shapes', () => {
    const cap = { sandboxJailPrefix: P('/tmp/ece-dryrun-'), toolClasses: P(['READ_ONLY']), writeTools: P([]), seamTools: P([]), confirmToken: P('X'), mintPrivacy: P({ status: 'gated', proof: '4a' }) };
    expect(CapabilityStateSchema.safeParse(cap).success).toBe(true);
    const store = { approvals: absent('M3', 'iso'), audit: absent('M3', 'iso'), executions: absent('M3', 'iso') };
    expect(StoreStateSchema.safeParse(store).success).toBe(true);
  });

  it('TYPE-LEVEL: a bare operational field does not typecheck (enforced by tsc, not runtime)', () => {
    // @ts-expect-error — a bare string is not Provenanced<string>; operational fields cannot be bare.
    const bad: GitState = { head: 'deadbeef', branch: 'main', dirty: false, recent: [] };
    void bad;
    const ok: Provenanced<string> = present('sha', { source: 'git', locator: { kind: 'cmd', cmd: 'git' }, pin: { kind: 'commit', commit: 'c' }, readAt: 'iso' });
    expect(ok.status).toBe('present');
  });
});
