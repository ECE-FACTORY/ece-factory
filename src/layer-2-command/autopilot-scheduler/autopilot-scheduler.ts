// Autopilot Scheduler (Module 18b, Wave 5) — a CLOCK over Autopilot. It decides only WHEN an Autopilot run
// fires; it grants Autopilot NO new authority. A scheduled run is bounded by the exact same READ_ONLY/
// DRAFT_ONLY ceiling as a manual run. The scheduler cannot execute, approve, mint a token, open anything, or
// advance a gate — it holds only the Autopilot port (read+draft) plus a clock, an audit hook, and a kill reader.
//
// INHERITED CEILING (the core): a fired run returns the SAME bounded `AutopilotOutcome` (propose/await/read/
// halt) — the scheduler cannot widen it. A scheduled run that reaches a consequential step STOPs at the
// human/approval boundary exactly as a manual run does (the scheduler has no token/approval/write/external).
//
// SCHEDULER SAFETY: bounded cadence (a hard minimum interval — no runaway tight loop); bounded per run
// (Autopilot's own step budget — terminates); the kill switch halts it (no fire while killed); every trigger
// is audited; enable/disable is a GOVERNED change (permissioned + audited), never free.
//
// STANDALONE-PACKAGEABLE: imports nothing concrete from other engines; the runner, clock, audit hook, kill
// reader, and config-change authorizer are injected ports (so tests use a fake clock — deterministic, no waiting).

import type { BridgeCallContext } from '../../layer-5-action/mcp-bridge/mcp-bridge.js';
import type { AutopilotOutcome, AutopilotOptions } from '../autopilot/autopilot.js';

/** The Autopilot port — read+draft ceiling ONLY. `AutopilotRunner` satisfies it structurally. */
export interface AutopilotPort {
  run(ctx: BridgeCallContext, opts?: AutopilotOptions): Promise<AutopilotOutcome>;
}

/** Injected clock — epoch ms. Tests pass a fake clock for deterministic cadence. */
export type Clock = () => number;

/** The scheduler's audit hook — every fire/skip/config-change is recorded. */
export interface SchedulerAuditHook {
  record(event: SchedulerAuditEvent): void | Promise<void>;
}
export interface SchedulerAuditEvent {
  kind: 'trigger-fired' | 'trigger-skipped' | 'config-change';
  atMs: number;
  reason?: string;
  /** For a fired trigger — the bounded Autopilot outcome status (never an executed/committed/approved one). */
  outcomeStatus?: AutopilotOutcome['status'];
  by?: string; // for a config change — the real human
}

/** Read-only kill reader the scheduler consults before each fire. */
export interface SchedulerKillReader {
  isKilled(): boolean;
}

/** Permissioned authorizer for enable/disable — a config change is NOT free. */
export interface ConfigChangeAuthorizer {
  /** True iff a real, permissioned human authorized this enable/disable (maps to the Settings token path). */
  authorize(change: { enabled: boolean; by: string }): boolean;
}

export interface ScheduleConfig {
  /** Minimum interval between fires (ms). The configured cadence floor. */
  minIntervalMs: number;
  enabled: boolean;
}

/** Hard floor — a scheduler can NEVER be configured to fire faster than this (no runaway tight loop). */
export const HARD_MIN_INTERVAL_MS = 1000;

export class SchedulerError extends Error {
  constructor(message: string) { super(message); this.name = 'SchedulerError'; }
}

export type SchedulerTickOutcome =
  | { status: 'fired'; outcome: AutopilotOutcome; firedAtMs: number }
  | { status: 'skipped'; reason: string };

export function validateScheduleConfig(config: ScheduleConfig): { ok: true } | { ok: false; reason: string } {
  if (typeof config?.minIntervalMs !== 'number' || !Number.isFinite(config.minIntervalMs)) {
    return { ok: false, reason: 'invalid schedule: minIntervalMs must be a finite number (deny-by-default)' };
  }
  if (config.minIntervalMs < HARD_MIN_INTERVAL_MS) {
    return { ok: false, reason: `invalid schedule: minIntervalMs must be ≥ ${HARD_MIN_INTERVAL_MS}ms (no runaway tight-loop cadence)` };
  }
  if (typeof config.enabled !== 'boolean') return { ok: false, reason: 'invalid schedule: enabled must be a boolean' };
  return { ok: true };
}

export class AutopilotScheduler {
  private readonly minIntervalMs: number;
  private enabled: boolean;
  private lastFiredMs: number | null = null;

  constructor(
    private readonly autopilot: AutopilotPort,
    private readonly clock: Clock,
    private readonly audit: SchedulerAuditHook,
    private readonly kill: SchedulerKillReader,
    config: ScheduleConfig,
    private readonly authorizer: ConfigChangeAuthorizer,
  ) {
    const v = validateScheduleConfig(config);
    if (!v.ok) throw new SchedulerError(v.reason); // deny-by-default: an invalid schedule is rejected
    this.minIntervalMs = config.minIntervalMs;
    this.enabled = config.enabled;
  }

  isEnabled(): boolean { return this.enabled; }

  /**
   * A trigger tick. Decides whether to fire; if so, invokes Autopilot ONCE and returns its bounded outcome —
   * the scheduler grants no new authority. Bounded cadence, kill, and disabled all SKIP (audited).
   */
  async tick(ctx: BridgeCallContext, opts?: AutopilotOptions): Promise<SchedulerTickOutcome> {
    const now = this.clock();
    // Kill switch halts the clock — no fire while killed.
    if (this.kill.isKilled()) {
      await this.audit.record({ kind: 'trigger-skipped', atMs: now, reason: 'kill switch active' });
      return { status: 'skipped', reason: 'kill switch active — scheduler halted' };
    }
    if (!this.enabled) {
      await this.audit.record({ kind: 'trigger-skipped', atMs: now, reason: 'scheduler disabled' });
      return { status: 'skipped', reason: 'scheduler disabled' };
    }
    // Bounded cadence — cannot fire faster than the configured floor.
    if (this.lastFiredMs !== null && now - this.lastFiredMs < this.minIntervalMs) {
      await this.audit.record({ kind: 'trigger-skipped', atMs: now, reason: 'within minimum interval' });
      return { status: 'skipped', reason: `within minimum interval (${this.minIntervalMs}ms) — bounded cadence` };
    }
    // FIRE — invoke Autopilot once. Bounded per run by Autopilot's own step budget (it terminates).
    this.lastFiredMs = now;
    const outcome = await this.autopilot.run(ctx, opts); // read + draft ONLY — the scheduler adds no authority
    await this.audit.record({ kind: 'trigger-fired', atMs: now, outcomeStatus: outcome.status });
    return { status: 'fired', outcome, firedAtMs: now };
  }

  /**
   * Enable/disable — a GOVERNED change (permissioned + audited), never free. Maps to the Settings
   * APPROVAL_REQUIRED_WRITE / token path via the injected authorizer.
   */
  async setEnabled(change: { enabled: boolean; by: string }): Promise<{ ok: boolean; reason?: string }> {
    if (!change?.by?.trim() || change.by.trim().toLowerCase() === 'claude') {
      return { ok: false, reason: 'a scheduler config change must be attributed to a real human (never "claude")' };
    }
    if (!this.authorizer.authorize(change)) {
      return { ok: false, reason: 'scheduler enable/disable is not a free action — it requires a permissioned, token-gated human authorization' };
    }
    this.enabled = change.enabled;
    await this.audit.record({ kind: 'config-change', atMs: this.clock(), by: change.by, reason: `scheduler ${change.enabled ? 'enabled' : 'disabled'}` });
    return { ok: true };
  }
}
