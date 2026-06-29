// Write-ahead sequencer — the §23.1 control flow and the factory's integrity linchpin.
//   validate → authorize → commit audit intent → execute → commit audit result → return
//
// Guarantees enforced here:
//  - FAIL-CLOSED: if the audit intent cannot be durably committed, the action does not run.
//  - NO-SKIP (type-enforced): `execute` receives a branded CommittedIntent that cannot be
//    fabricated outside this module, so it is impossible to execute without a prior commit.
//  - ATTRIBUTION: the actor is a required HumanActor sourced from the authenticated principal;
//    it is structurally impossible to record "claude" as the actor (validate + DB CHECK).
//
// Depends ONLY on the AuditSink interface — never on a concrete sink. Contains NO MCP tools,
// NO UI, and NO Permission Engine internals (the authorizer is a stubbed typed hook).

import type { HumanActor, SessionInfo, ToolInfo, ApprovalInfo, DashboardInfo, Environment } from './schema.js';
import type { AuditSink, AppendResult, OrphanedIntent } from './sink.js';

// ---- Authorizer hook (Permission Engine is a later wave; this is the typed seam) ----
export interface AuthorizationRequest {
  human_actor: HumanActor;
  organization_id: string;
  tool: ToolInfo;
  environment: Environment;
}
export interface AuthorizationDecision {
  decision: 'ALLOW' | 'REFUSE' | 'STOP_FOR_APPROVAL';
  reason?: string;
}
export interface Authorizer {
  authorize(req: AuthorizationRequest): Promise<AuthorizationDecision>;
}
/** Stub used until Module 22 (Permission Engine) exists. Proves the hook is wired in order. */
export class AllowAllAuthorizer implements Authorizer {
  async authorize(): Promise<AuthorizationDecision> {
    return { decision: 'ALLOW' };
  }
}

// ---- Branded CommittedIntent: only the sequencer can mint one (structural no-skip) ----
const COMMITTED = Symbol('committedIntent');
export interface CommittedIntent {
  readonly intent_id: string;
  readonly organization_id: string;
  readonly seq: number;
  readonly [COMMITTED]: true;
}

// ---- Request + outcome shapes ----
export interface SequencerRequest {
  /** The authenticated human. Required. The model is NOT an actor — it is the `via` conduit. */
  principal: HumanActor;
  organization_id: string;
  session: SessionInfo;
  tool: ToolInfo;
  environment: Environment;
  via?: string;
  request_summary?: Record<string, unknown>;
  approval?: ApprovalInfo;
  dashboard?: DashboardInfo;
}

export interface ExecuteOutcome {
  status: 'success' | 'error';
  error_code?: string;
}
/** Caller-supplied action. It can only be reached WITH a CommittedIntent (no-skip). */
export type ExecuteFn<T> = (committed: CommittedIntent) => Promise<{ value: T; outcome: ExecuteOutcome }>;

export type SequencerOutcome<T> =
  | { status: 'completed'; value: T; intent: CommittedIntent; result: AppendResult }
  | { status: 'execute-failed'; intent: CommittedIntent; result: AppendResult; error: unknown }
  | { status: 'refused'; stage: 'validate' | 'authorize' | 'intent-commit'; reason: string };

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export class WriteAheadSequencer {
  constructor(
    private readonly sink: AuditSink,
    private readonly authorizer: Authorizer,
  ) {}

  private validate(req: SequencerRequest): { ok: true } | { ok: false; reason: string } {
    const uid = req.principal?.user_id?.trim();
    if (!uid) return { ok: false, reason: 'missing human principal (actor is required)' };
    if (uid.toLowerCase() === 'claude') return { ok: false, reason: 'actor may not be "claude" — attribution must be a real human' };
    if (!req.organization_id) return { ok: false, reason: 'missing organization_id' };
    if (!req.session?.session_id) return { ok: false, reason: 'missing session' };
    if (!req.tool?.name) return { ok: false, reason: 'missing tool' };
    if (!req.environment) return { ok: false, reason: 'missing environment' };
    return { ok: true };
  }

  async run<T>(req: SequencerRequest, execute: ExecuteFn<T>): Promise<SequencerOutcome<T>> {
    // 1. VALIDATE
    const v = this.validate(req);
    if (!v.ok) return { status: 'refused', stage: 'validate', reason: v.reason };

    // 2. AUTHORIZE (the hook runs BEFORE any intent is committed)
    const decision = await this.authorizer.authorize({
      human_actor: req.principal,
      organization_id: req.organization_id,
      tool: req.tool,
      environment: req.environment,
    });
    if (decision.decision !== 'ALLOW') {
      return { status: 'refused', stage: 'authorize', reason: decision.reason ?? decision.decision };
    }

    // 3. COMMIT AUDIT INTENT (write-ahead). If this fails, FAIL CLOSED — do not execute.
    let appended: AppendResult & { intent_id: string };
    try {
      appended = await this.sink.appendIntent({
        organization_id: req.organization_id,
        human_actor: req.principal, // the real human — never "claude"
        via: req.via,
        session: req.session,
        tool: req.tool,
        request_summary: req.request_summary,
        authz: { permission_checked: true, decision: 'ALLOW', reason: decision.reason },
        approval: req.approval,
        dashboard: req.dashboard,
        environment: req.environment,
      });
    } catch (e) {
      // Audit unavailable BEFORE the action fired → refuse. Execute never runs.
      return { status: 'refused', stage: 'intent-commit', reason: `audit unavailable: ${errMessage(e)}` };
    }

    const committed: CommittedIntent = {
      intent_id: appended.intent_id,
      organization_id: req.organization_id,
      seq: appended.seq,
      [COMMITTED]: true,
    };

    // 4. EXECUTE (only reachable now that the intent is durable)
    const start = Date.now();
    let value: T | undefined;
    let outcome: ExecuteOutcome;
    let thrown: unknown;
    try {
      const r = await execute(committed);
      value = r.value;
      outcome = r.outcome;
    } catch (e) {
      thrown = e;
      outcome = { status: 'error', error_code: errMessage(e) };
    }
    const duration_ms = Date.now() - start;

    // 5. COMMIT AUDIT RESULT (paired with the intent → not an orphan)
    const result = await this.sink.appendResult(
      { intent_id: committed.intent_id, organization_id: committed.organization_id },
      { status: outcome.status, error_code: outcome.error_code, duration_ms },
    );

    // 6. RETURN
    if (thrown !== undefined) return { status: 'execute-failed', intent: committed, result, error: thrown };
    return { status: 'completed', value: value as T, intent: committed, result };
  }

  /** Surface committed-intent-with-no-result (possible partial actions) for human review (§I3). */
  async reconcileOrphans(organization_id: string, opts?: { olderThanSeconds?: number }): Promise<OrphanedIntent[]> {
    return this.sink.orphanedIntents(organization_id, opts?.olderThanSeconds ?? 0);
  }
}
