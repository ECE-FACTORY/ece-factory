import { describe, it, expect } from 'vitest';
import { InMemoryKillSwitch, type KillSwitchChangeEvent } from './kill-switch.js';

// Kill Switch (Module 33) — pure-logic: scope matching, immediacy, and audit-of-state-changes
// are all in-memory decision logic, no DB needed (integration with the sequencer is separate).

describe('Kill Switch — per-scope disabling', () => {
  it('tool scope disables that tool only', () => {
    const ks = new InMemoryKillSwitch();
    ks.activate({ type: 'tool', name: 't1' }, 'admin', 'incident');
    expect(ks.isKilled({ toolName: 't1' })).toBe(true);
    expect(ks.isKilled({ toolName: 't2' })).toBe(false);
  });
  it('all-writes scope disables write tools but not reads', () => {
    const ks = new InMemoryKillSwitch();
    ks.activate({ type: 'all-writes' }, 'admin', 'freeze writes');
    expect(ks.isKilled({ toolName: 'x', readOrWrite: 'write' })).toBe(true);
    expect(ks.isKilled({ toolName: 'x', readOrWrite: 'read' })).toBe(false);
  });
  it('connector scope disables a named connector only', () => {
    const ks = new InMemoryKillSwitch();
    ks.activate({ type: 'connector', id: 'c1' }, 'admin', 'bad connector');
    expect(ks.isKilled({ toolName: 'x', connector: 'c1' })).toBe(true);
    expect(ks.isKilled({ toolName: 'x', connector: 'c2' })).toBe(false);
  });
  it('environment scope disables that environment only', () => {
    const ks = new InMemoryKillSwitch();
    ks.activate({ type: 'environment', env: 'production' }, 'admin', 'prod incident');
    expect(ks.isKilled({ toolName: 'x', environment: 'production' })).toBe(true);
    expect(ks.isKilled({ toolName: 'x', environment: 'local' })).toBe(false);
  });
  it('bridge scope disables everything', () => {
    const ks = new InMemoryKillSwitch();
    ks.activate({ type: 'bridge' }, 'admin', 'full stop');
    expect(ks.isKilled({ toolName: 'anything', readOrWrite: 'read' })).toBe(true);
  });
  it('autopilot scope disables autopilot calls only', () => {
    const ks = new InMemoryKillSwitch();
    ks.activate({ type: 'autopilot' }, 'admin', 'pause autopilot');
    expect(ks.isKilled({ toolName: 'x', autopilot: true })).toBe(true);
    expect(ks.isKilled({ toolName: 'x', autopilot: false })).toBe(false);
  });
});

describe('Kill Switch — immediacy and audit', () => {
  it('a flip is seen immediately (no restart) and reverses on deactivate', () => {
    const ks = new InMemoryKillSwitch();
    expect(ks.isKilled({ toolName: 't1' })).toBe(false);
    ks.activate({ type: 'tool', name: 't1' }, 'admin', 'incident');
    expect(ks.isKilled({ toolName: 't1' })).toBe(true); // immediate
    ks.deactivate({ type: 'tool', name: 't1' }, 'admin', 'resolved');
    expect(ks.isKilled({ toolName: 't1' })).toBe(false); // immediate
  });
  it('state changes are audited (who/what/when/why) via the injected hook', () => {
    const events: KillSwitchChangeEvent[] = [];
    const ks = new InMemoryKillSwitch({ record: (e) => { events.push(e); } });
    ks.activate({ type: 'bridge' }, 'rania', 'security incident #42');
    expect(events).toHaveLength(1);
    expect(events[0]!.action).toBe('activate');
    expect(events[0]!.scope).toEqual({ type: 'bridge' });
    expect(events[0]!.actor).toBe('rania');
    expect(events[0]!.reason).toBe('security incident #42');
    expect(events[0]!.at).toMatch(/^\d{4}-\d{2}-\d{2}T/); // ISO timestamp
    expect(ks.changeLog()).toHaveLength(1);
  });
  it('the actor may not be "claude"', () => {
    const ks = new InMemoryKillSwitch();
    expect(() => ks.activate({ type: 'bridge' }, 'claude', 'nope')).toThrow(/claude/i);
  });
});
