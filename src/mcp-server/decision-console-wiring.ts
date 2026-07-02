// Decision Console — connective wiring (Wave 6, Piece 1b). Makes the Console live in the running system with
// TWO things only, both at the composition-root/transport layer — NO guard/gauntlet file is touched:
//
//   (1) AUTO-ENQUEUE — an OBSERVATION of the STOP_FOR_APPROVAL outcome. When a consequential action returns
//       STOP_FOR_APPROVAL, the wrapper enqueues a pending item into the Console. It reads the outcome AFTER
//       the fact and feeds NOTHING back into the gauntlet: it cannot change the decision, add a commit path,
//       or bypass a stage. The action still commits ONLY by passing the full unchanged gauntlet with a minted
//       single-use human approval (exactly Piece 1). Idempotent: the same still-held action is not re-enqueued.
//
//   (2) POSTGRES AUDIT — `PostgresConsoleAudit` routes every Console transition (enqueue/approve/refuse/
//       resolve-rejected) into the real append-only, hash-chained audit sink, operator-attributed. The
//       in-memory sink remains for tests (the port is unchanged).
//
// This file lives at the composition/transport layer (it may import concrete constants); the Console + sink +
// core are injected as ports so it is unit-testable with fakes.

import type { McpServerCore, McpCallResult } from './server-core.js';
import type { BridgeCallContext } from '../features/mcp-bridge/mcp-bridge.js';
import { EXPOSED_EXTERNAL_TOOLS } from '../features/mcp-bridge/mcp-bridge.js';
import { canonicalPayload } from '../features/mcp-bridge/tool-classes.js';
import type { ActionDescriptor } from '../features/approval-gate/approval-gate.js';
import type { ExternalParams, ExternalTarget } from '../features/mcp-bridge/external-tools.js';
import type { WriteParams } from '../features/mcp-bridge/write-tools.js';
import type { DecisionConsole, EnqueueMeta, ConsoleAuditSink, ConsoleAuditEvent } from '../features/decision-console/decision-console.js';
import type { AuditSink } from '../features/audit-engine/sink.js';
import type { HumanActor, SessionInfo, Environment } from '../features/audit-engine/schema.js';

// ── (2) Postgres-backed Console audit ────────────────────────────────────────────────────────────────────
/**
 * Routes Console governance transitions into the real append-only, hash-chained audit sink (the same store the
 * rest of the factory uses), via the audit-of-reads append path. Operator-attributed; the actor is the real
 * operator for approve/refuse, and the Console SERVICE ('decision-console') for enqueue/resolve-rejected —
 * NEVER 'claude' and never a fabricated human. The typed event (incl. its decision) is carried in query_range.
 */
export class PostgresConsoleAudit implements ConsoleAuditSink {
  constructor(
    private readonly sink: Pick<AuditSink, 'appendRead'>,
    private readonly organizationId: string,
    private readonly environment: Environment = 'local',
    private readonly session: SessionInfo = { session_id: 'decision-console' },
  ) {}

  async append(e: ConsoleAuditEvent): Promise<void> {
    const isOperator = !!(e.operator && e.operator.trim());
    const actor: HumanActor = { user_id: isOperator ? e.operator! : 'decision-console', email: '', role: isOperator ? 'operator' : 'service' };
    try {
      await this.sink.appendRead({
        organization_id: this.organizationId,
        human_actor: actor,
        session: this.session,
        query_range: { consoleEvent: e.type, actionId: e.actionId, tool: e.tool, operator: e.operator ?? null, proposingCaller: e.proposingCaller ?? null, reason: e.reason ?? null, atIso: e.atIso, environment: this.environment },
        rows_returned: 0,
      });
    } catch (err) {
      // Best-effort: the load-bearing audit is the sequencer (commit) + the gate's own hook; a Console-log
      // write failure must not crash the operator's decision. Surfaced on stderr, never swallowed silently.
      process.stderr.write(`[decision-console audit] failed to persist ${e.type} for ${e.actionId}: ${err instanceof Error ? err.message : String(err)}\n`);
    }
  }
}

// ── (1) Stop observation → enqueue ───────────────────────────────────────────────────────────────────────
export interface StopStatus { status: string }

/** Builds the EXACT bound descriptor the gate/bridge would bind for a stopped action, so the operator's later
 *  approval is consumable by the re-driven action (per-action binding inherited from 9.3/9.4/Piece 1). */
export function descriptorForStop(name: string, ctx: BridgeCallContext, args: Record<string, unknown>): ActionDescriptor {
  const requestedBy = { user_id: ctx.principal.user_id, email: ctx.principal.email, role: ctx.principal.role };
  if ((EXPOSED_EXTERNAL_TOOLS as readonly string[]).includes(name)) {
    const t = (args as ExternalParams).target ?? ({ system: '', targetId: '', effect: '', reversible: 'soft-only' } as ExternalTarget);
    const payload = (args as ExternalParams).payload ?? null;
    return {
      tool: name, target: t.targetId,
      after: { system: t.system, effect: t.effect, environment: t.environment ?? null, payload },
      risk: 'WRITE_MEDIUM_RISK', reversible: t.reversible, requestedBy,
    };
  }
  // internal APPROVAL_REQUIRED_WRITE — the bridge binds { tool, target: params.target, payload: params.payload }
  const w = args as WriteParams;
  return { tool: name, target: w.target, after: w.payload ?? null, risk: 'WRITE_MEDIUM_RISK', reversible: 'soft-only', requestedBy };
}

/** Tier + blast-radius metadata for the queue view (display only — NOT part of the approval binding). */
export function metaForStop(name: string, ctx: BridgeCallContext): EnqueueMeta {
  const external = (EXPOSED_EXTERNAL_TOOLS as readonly string[]).includes(name);
  return { tier: external ? 'APPROVAL_REQUIRED_WRITE (external)' : 'APPROVAL_REQUIRED_WRITE (internal)', blastRadius: 1, proposingCaller: ctx.via ?? ctx.principal.user_id };
}

/**
 * Observes a STOP_FOR_APPROVAL outcome and enqueues it into the Console — idempotently. It returns the pending
 * actionId (existing or new). It NEVER runs unless the outcome already IS a stop, and it returns nothing that
 * can re-enter the gauntlet. If the outcome is not a stop, it does nothing and returns undefined.
 */
export class StopEnqueuer {
  constructor(private readonly console: DecisionConsole) {}

  observe(name: string, ctx: BridgeCallContext, args: Record<string, unknown>, outcome: StopStatus): string | undefined {
    if (outcome.status !== 'STOP_FOR_APPROVAL') return undefined;
    const descriptor = descriptorForStop(name, ctx, args);
    // idempotent: reuse a still-held item with the same exact bound descriptor (no double-enqueue on retry)
    const existing = this.console.listPending().find((it) => sameDescriptor(it.descriptor, descriptor));
    if (existing) return existing.actionId;
    return this.console.enqueue(descriptor, metaForStop(name, ctx));
  }
}

function sameDescriptor(a: ActionDescriptor, b: ActionDescriptor): boolean {
  return a.tool === b.tool && (a.target ?? '') === (b.target ?? '') && canonicalPayload(a.after) === canonicalPayload(b.after);
}

// ── (1) Composition-root wrapper over the transport core (observation-only) ──────────────────────────────
/** The subset of McpServerCore this wrapper needs. `McpServerCore` satisfies it. */
export interface CallableCore {
  callTool(name: string, args: Record<string, unknown>, ctx: BridgeCallContext): Promise<McpCallResult>;
  listTools(): ReturnType<McpServerCore['listTools']>;
  isForbidden(name: string): boolean;
}

/** Result of the wrapped core — the SAME McpCallResult, optionally annotated with the auto-enqueued pending id
 *  so the caller learns which queue item to have a human approve. The annotation is additive; it changes no decision. */
export type EnqueuingCallResult = McpCallResult & { pendingActionId?: string };

/**
 * Wraps the transport core so a STOP_FOR_APPROVAL outcome auto-enqueues into the Console. It delegates to the
 * inner core FIRST (the full unchanged guarded path), then OBSERVES the returned outcome. The observation
 * cannot alter the outcome — the wrapper returns the inner outcome verbatim (plus an additive pendingActionId).
 */
export class EnqueueingServerCore implements CallableCore {
  constructor(private readonly inner: CallableCore, private readonly enqueuer: StopEnqueuer) {}

  async callTool(name: string, args: Record<string, unknown>, ctx: BridgeCallContext): Promise<EnqueuingCallResult> {
    const result = await this.inner.callTool(name, args, ctx); // ← the full unchanged guarded path runs first
    if (result.ok && isStop(result.outcome)) {
      const pendingActionId = this.enqueuer.observe(name, ctx, args, result.outcome); // observation only
      return { ...result, pendingActionId };
    }
    return result;
  }
  listTools(): ReturnType<McpServerCore['listTools']> { return this.inner.listTools(); }
  isForbidden(name: string): boolean { return this.inner.isForbidden(name); }
}

function isStop(outcome: unknown): outcome is StopStatus {
  return typeof outcome === 'object' && outcome !== null && (outcome as { status?: unknown }).status === 'STOP_FOR_APPROVAL';
}
