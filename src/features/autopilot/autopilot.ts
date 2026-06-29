// Autopilot Runner (Module 18, Wave 5) — the autonomous driver. It automates the MESSENGER role of the
// dual-Claude relay (read where the build is, draft the next step), NEVER the AUTHORITY role.
//
// AUTHORITY CEILING — Autopilot is structurally incapable of consequential action:
//   • It acts ONLY through the bridge, and the bridge surface it is given (AutopilotBridge) exposes ONLY
//     the READ_ONLY and DRAFT_ONLY methods. There is no write/external method to call — it cannot even
//     name an APPROVAL_REQUIRED_WRITE or external execution path.
//   • Its outcome type is bounded to propose/await/read/halt states — there is NO executed/committed/
//     approved/written variant (proved at type level).
//   • It holds no Approval Gate and no token machinery — it cannot mint, forge, or self-grant a
//     ConsumedApproval. Any consequential next step is DRAFTED and left AWAITING a human.
//   • It cannot auto-advance a STOP gate — a gate awaiting human is SURFACED, never flipped (Autopilot has
//     no sign-off tool on its port).
//   • The kill switch governs it like any caller: a killed read/draft ⇒ the bridge refuses ⇒ Autopilot halts.
//   • The run is BOUNDED — a finite, auditable run record; it does not loop until "done", it makes one pass
//     and stops at the first thing requiring human authority.
//
// STANDALONE-PACKAGEABLE: the only cross-engine reference is `import type` (the bridge's tool surface),
// injected as a port. Zero runtime coupling.

import type { BridgeCallContext, FactoryReadOutcome, DraftOutcome } from '../mcp-bridge/mcp-bridge.js';
import type { FactoryReadTool, FactoryReadParams } from '../mcp-bridge/factory-read-tools.js';
import type { DraftTool, DraftParams } from '../mcp-bridge/draft-tools.js';

/**
 * The slice of the bridge Autopilot is allowed to touch — READ_ONLY + DRAFT_ONLY ONLY. The full `McpBridge`
 * satisfies this structurally, but Autopilot is handed only this narrow port, so it has no write/external
 * method to invoke. This IS the authority ceiling, enforced by construction.
 */
export interface AutopilotBridge {
  readFactoryState(name: FactoryReadTool, ctx: BridgeCallContext, params?: FactoryReadParams): Promise<FactoryReadOutcome>;
  draftWithTool(name: DraftTool, ctx: BridgeCallContext, params?: DraftParams): Promise<DraftOutcome>;
}

/** A gate as seen in the read state. */
export interface GateView {
  gate: string;
  state: string;
}

export interface AutopilotRun {
  reads: { tool: string; ok: boolean }[];
  drafts: { tool: string; status: string }[];
  decision: string;
  stoppedAt: string;
  /** The drafted proposal (inert) — what Autopilot proposes a human approve next. */
  proposal?: unknown;
  steps: number;
}

/**
 * Outcome — propose / stop-at-gate / read-complete / halted. There is intentionally NO 'executed'/
 * 'committed'/'approved'/'written' member: Autopilot cannot represent having taken a consequential action.
 */
export type AutopilotOutcome =
  | { status: 'AUTOPILOT-PROPOSED-AWAITING-APPROVAL'; run: AutopilotRun }
  | { status: 'AUTOPILOT-STOPPED-AT-GATE'; run: AutopilotRun }
  | { status: 'AUTOPILOT-READ-COMPLETE'; run: AutopilotRun }
  | { status: 'AUTOPILOT-HALTED'; run: AutopilotRun; reason: string };

export interface AutopilotOptions {
  /** Hard upper bound on steps — defense against an unbounded drive. The pass is finite regardless. */
  maxSteps?: number;
}

/** The fixed, bounded set of READ_ONLY tools Autopilot consults to locate the build. */
const READ_PLAN: FactoryReadTool[] = ['read_open_gates', 'read_factory_status', 'read_review_log', 'read_open_items', 'read_risk_register'];
const GATE_AWAITING = /awaiting|stop|pending|signoff|sign-off/i;

export class AutopilotRunner {
  constructor(private readonly bridge: AutopilotBridge) {}

  /**
   * One bounded autonomous pass: read state → decide the next step → draft it (if consequential, leave it
   * AWAITING a human) → assemble a finite run record. Halts at the first thing needing human authority.
   */
  async run(ctx: BridgeCallContext, opts: AutopilotOptions = {}): Promise<AutopilotOutcome> {
    const maxSteps = Math.max(1, Math.min(opts.maxSteps ?? 32, 64));
    const run: AutopilotRun = { reads: [], drafts: [], decision: '', stoppedAt: '', steps: 0 };

    // 1. READ where the build is (READ_ONLY tools, through the bridge — audited like any caller).
    const data: Record<string, unknown> = {};
    for (const tool of READ_PLAN) {
      if (run.steps >= maxSteps) return this.halt(run, 'step budget exhausted'); // bounded
      run.steps++;
      const out = await this.bridge.readFactoryState(tool, ctx);
      run.reads.push({ tool, ok: out.status === 'ok' });
      if (out.status !== 'ok') {
        // a refusal (e.g. kill switch, or a permissioned tool) HALTS the autonomous runner — no bypass.
        return this.halt(run, `read "${tool}" refused (${out.reason}) — Autopilot halts`);
      }
      data[tool] = out.data;
    }

    // 2. DECIDE the next step (pure logic over the inert read state — instruction-boundary: data is data).
    const gates = asGates(data['read_open_gates']);
    const blocking = gates.find((g) => GATE_AWAITING.test(g.state));
    if (blocking) {
      // 3a. A human gate is open — SURFACE it, never flip it. Autopilot has no tool to advance it.
      run.decision = `gate "${blocking.gate}" is ${blocking.state} — requires human authority`;
      run.stoppedAt = `gate:${blocking.gate}`;
      return { status: 'AUTOPILOT-STOPPED-AT-GATE', run };
    }

    const next = nextAction(data['read_factory_status']);
    if (!next) {
      run.decision = 'no next action to propose from current state';
      run.stoppedAt = 'read-complete';
      return { status: 'AUTOPILOT-READ-COMPLETE', run };
    }

    // 3b. DRAFT the next step (DRAFT_ONLY — a proposal, never an execution). A consequential next step is
    //     left AWAITING a human: Autopilot cannot execute it (no write/external method on its port).
    if (run.steps >= maxSteps) return this.halt(run, 'step budget exhausted');
    run.steps++;
    const draftTool: DraftTool = 'draft_next_prompt';
    const d = await this.bridge.draftWithTool(draftTool, ctx, { ref: next.description });
    run.drafts.push({ tool: draftTool, status: d.status });
    if (d.status === 'refused') {
      return this.halt(run, `draft "${draftTool}" refused (${d.reason}) — Autopilot halts`);
    }
    run.proposal = d.draft;
    run.decision = `propose next step: ${next.description}${next.consequential ? ' (consequential — requires human approval to execute)' : ''}`;
    run.stoppedAt = next.consequential ? 'awaiting-human-approval' : 'awaiting-human-review';
    // Either way Autopilot STOPS here — it has proposed; a human must approve/execute.
    return { status: 'AUTOPILOT-PROPOSED-AWAITING-APPROVAL', run };
  }

  private halt(run: AutopilotRun, reason: string): AutopilotOutcome {
    run.stoppedAt = 'halted';
    run.decision = run.decision || 'halted before proposing';
    return { status: 'AUTOPILOT-HALTED', run, reason };
  }
}

function asGates(v: unknown): GateView[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is GateView => !!x && typeof x === 'object' && 'state' in x && 'gate' in x);
}

function nextAction(v: unknown): { description: string; consequential: boolean } | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const desc = o['nextAction'];
  if (typeof desc !== 'string' || !desc.trim()) return null;
  return { description: desc, consequential: o['consequential'] === true };
}
