import { describe, it, expect } from 'vitest';
import { AutopilotScheduler, SchedulerError, validateScheduleConfig, type AutopilotPort, type SchedulerAuditHook, type SchedulerAuditEvent, type SchedulerKillReader, type ConfigChangeAuthorizer } from './autopilot-scheduler.js';
import { AutopilotRunner, type AutopilotBridge, type AutopilotOutcome, type AutopilotRun } from '../autopilot/autopilot.js';
import { DRAFT_STATUS } from '../../layer-5-action/mcp-bridge/tool-classes.js';
import type { BridgeCallContext, FactoryReadOutcome, DraftOutcome } from '../../layer-5-action/mcp-bridge/mcp-bridge.js';
import type { FactoryReadTool } from '../../layer-5-action/mcp-bridge/factory-read-tools.js';
import type { DraftTool } from '../../layer-5-action/mcp-bridge/draft-tools.js';

// Autopilot Scheduler (Module 18b) — pure-logic with a FAKE CLOCK (deterministic, no waiting). The scheduler
// is a clock over Autopilot; it grants no new authority.

const emptyRun = (): AutopilotRun => ({ reads: [], drafts: [], decision: '', stoppedAt: '', steps: 0 });

class FakeAutopilot implements AutopilotPort {
  runCount = 0;
  constructor(private readonly outcome: AutopilotOutcome = { status: 'AUTOPILOT-READ-COMPLETE', run: emptyRun() }) {}
  async run(): Promise<AutopilotOutcome> { this.runCount++; return this.outcome; }
}
class RecordingAudit implements SchedulerAuditHook {
  events: SchedulerAuditEvent[] = [];
  async record(e: SchedulerAuditEvent): Promise<void> { this.events.push(e); }
}
class Kill implements SchedulerKillReader { killed = false; isKilled(): boolean { return this.killed; } }
const allow: ConfigChangeAuthorizer = { authorize: () => true };
const deny: ConfigChangeAuthorizer = { authorize: () => false };

function fakeClock(start = 10_000) { const c = { now: start }; return { clock: () => c.now, advance: (ms: number) => { c.now += ms; } }; }
function ctx(): BridgeCallContext {
  return { principal: { user_id: 'op', email: 'o@e', role: 'operator' }, organization_id: 'orgSCH', session: { session_id: 's' }, environment: 'local', via: 'autopilot' };
}

describe('Autopilot Scheduler — a scheduled fire invokes Autopilot once (bounded outcome)', () => {
  it('tick ⇒ fired with a bounded propose/await/read/halt outcome; Autopilot invoked once', async () => {
    const ap = new FakeAutopilot();
    const { clock } = fakeClock();
    const audit = new RecordingAudit();
    const sch = new AutopilotScheduler(ap, clock, audit, new Kill(), { minIntervalMs: 1000, enabled: true }, allow);
    const out = await sch.tick(ctx());
    expect(out.status).toBe('fired');
    if (out.status === 'fired') expect(out.outcome.status).toBe('AUTOPILOT-READ-COMPLETE');
    expect(ap.runCount).toBe(1);
    expect(audit.events.some((e) => e.kind === 'trigger-fired')).toBe(true); // every trigger audited
  });
});

describe('Autopilot Scheduler — grants no new authority (the core, type-level)', () => {
  it('the fired outcome is Autopilot\'s bounded type — no executed/approved/committed variant', () => {
    // @ts-expect-error Autopilot has no 'executed' outcome — the scheduler returns Autopilot's type, unwidened
    const _e: AutopilotOutcome = { status: 'executed', run: emptyRun() };
    // @ts-expect-error nor 'approved'
    const _a: AutopilotOutcome = { status: 'approved', run: emptyRun() };
    // @ts-expect-error nor 'committed'
    const _c: AutopilotOutcome = { status: 'committed', run: emptyRun() };
    void _e; void _a; void _c;
  });
});

// A full fake bridge for the REAL AutopilotRunner — read+draft is the port; write/external counters prove
// a scheduled run never reaches them.
class FullFakeBridge implements AutopilotBridge {
  writeCalls = 0; externalCalls = 0;
  constructor(private readonly state: Partial<Record<FactoryReadTool, unknown>>) {}
  async readFactoryState(name: FactoryReadTool): Promise<FactoryReadOutcome> { return { status: 'ok', tool: name, data: this.state[name] ?? null, auditSeq: 1 }; }
  async draftWithTool(name: DraftTool, _ctx: BridgeCallContext, params?: { ref?: string }): Promise<DraftOutcome> { return { status: DRAFT_STATUS, tool: name, draft: { proposedFor: params?.ref ?? null }, auditSeq: 2 }; }
  async writeWithTool() { this.writeCalls++; return { status: 'refused' as const, tool: 'x', stage: 'registry' as const, reason: 'unreachable' }; }
  async externalActionWithTool() { this.externalCalls++; return { status: 'refused' as const, tool: 'x', stage: 'registry' as const, reason: 'unreachable' }; }
}

describe('Autopilot Scheduler — a scheduled run driving a consequential step ⇒ STOP, port never called', () => {
  it('the scheduled Autopilot run proposes (AWAITING-APPROVAL) and never calls write/external', async () => {
    const bridge = new FullFakeBridge({ read_open_gates: [], read_factory_status: { nextAction: 'create_github_repo ECE-FACTORY/x', consequential: true } });
    const runner = new AutopilotRunner(bridge); // the REAL runner, behind the scheduler
    const { clock } = fakeClock();
    const sch = new AutopilotScheduler(runner, clock, new RecordingAudit(), new Kill(), { minIntervalMs: 1000, enabled: true }, allow);
    const out = await sch.tick(ctx());
    expect(out.status).toBe('fired');
    if (out.status === 'fired') expect(out.outcome.status).toBe('AUTOPILOT-PROPOSED-AWAITING-APPROVAL'); // STOPs at the human boundary
    expect(bridge.writeCalls).toBe(0);    // the scheduler granted no authority to execute
    expect(bridge.externalCalls).toBe(0);
  });
});

describe('Autopilot Scheduler — bounded cadence (cannot fire faster than the floor)', () => {
  it('a second tick inside the minimum interval is skipped; after the floor it fires again', async () => {
    const ap = new FakeAutopilot();
    const fc = fakeClock(10_000);
    const sch = new AutopilotScheduler(ap, fc.clock, new RecordingAudit(), new Kill(), { minIntervalMs: 1000, enabled: true }, allow);
    expect((await sch.tick(ctx())).status).toBe('fired');   // t=10000 fire
    fc.advance(500);
    expect((await sch.tick(ctx())).status).toBe('skipped');  // t=10500 within floor — NO double fire
    fc.advance(600);
    expect((await sch.tick(ctx())).status).toBe('fired');    // t=11100 past floor — fires
    expect(ap.runCount).toBe(2);                             // exactly two fires, not three
  });
});

describe('Autopilot Scheduler — kill switch halts it', () => {
  it('killed ⇒ no fire (skipped); Autopilot is not invoked', async () => {
    const ap = new FakeAutopilot();
    const kill = new Kill(); kill.killed = true;
    const sch = new AutopilotScheduler(ap, fakeClock().clock, new RecordingAudit(), kill, { minIntervalMs: 1000, enabled: true }, allow);
    const out = await sch.tick(ctx());
    expect(out.status).toBe('skipped');
    if (out.status === 'skipped') expect(out.reason).toMatch(/kill/i);
    expect(ap.runCount).toBe(0);
  });
});

describe('Autopilot Scheduler — enable/disable is a governed change (not free)', () => {
  it('an unauthorized / claude-attributed enable/disable ⇒ refused; an authorized one ⇒ audited', async () => {
    const audit = new RecordingAudit();
    const ap = new FakeAutopilot();
    const denied = new AutopilotScheduler(ap, fakeClock().clock, audit, new Kill(), { minIntervalMs: 1000, enabled: true }, deny);
    expect((await denied.setEnabled({ enabled: false, by: 'human_boss' })).ok).toBe(false); // not authorized ⇒ refused
    expect(denied.isEnabled()).toBe(true);

    const sch = new AutopilotScheduler(ap, fakeClock().clock, audit, new Kill(), { minIntervalMs: 1000, enabled: true }, allow);
    expect((await sch.setEnabled({ enabled: false, by: 'claude' })).ok).toBe(false); // claude attribution ⇒ refused
    const ok = await sch.setEnabled({ enabled: false, by: 'human_boss' });
    expect(ok.ok).toBe(true);
    expect(sch.isEnabled()).toBe(false);
    expect(audit.events.some((e) => e.kind === 'config-change' && e.by === 'human_boss')).toBe(true); // audited
  });
  it('a disabled scheduler does not fire', async () => {
    const ap = new FakeAutopilot();
    const sch = new AutopilotScheduler(ap, fakeClock().clock, new RecordingAudit(), new Kill(), { minIntervalMs: 1000, enabled: false }, allow);
    expect((await sch.tick(ctx())).status).toBe('skipped');
    expect(ap.runCount).toBe(0);
  });
});

describe('Autopilot Scheduler — deny-by-default: an invalid schedule is rejected', () => {
  it('non-numeric / sub-floor / non-boolean configs are rejected', () => {
    expect(validateScheduleConfig({ minIntervalMs: 1000, enabled: true }).ok).toBe(true);
    expect(validateScheduleConfig({ minIntervalMs: 0, enabled: true }).ok).toBe(false);       // runaway floor
    expect(validateScheduleConfig({ minIntervalMs: 500, enabled: true }).ok).toBe(false);      // below HARD floor
    expect(validateScheduleConfig({ minIntervalMs: NaN, enabled: true }).ok).toBe(false);
    const ap = new FakeAutopilot();
    expect(() => new AutopilotScheduler(ap, fakeClock().clock, new RecordingAudit(), new Kill(), { minIntervalMs: 0, enabled: true }, allow)).toThrow(SchedulerError);
  });
});
