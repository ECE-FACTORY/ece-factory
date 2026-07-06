// Audit-of-reads + permissioned viewer (§24 — "the watchers are watched").
// Every read of audit data: (a) checks read permission via the Authorizer seam,
// (b) records a chained audit_read_log entry via AuditSink.appendRead, (c) returns
// org-scoped rows (Phase 3.1 RLS). An unpermitted read is refused and reads nothing.
//
// Depends ONLY on AuditSink + Authorizer. NO MCP tools, NO UI, NO Permission Engine
// internals (the Authorizer is the stubbed seam). NO refusal-audit yet — refused reads
// are intentionally NOT logged here; that is the locked Phase 3.5 refusal-audit path
// (see docs/DECISION_LOG.md + OPEN_ITEMS.md). This is a recorded gap, not a silent one.

import type { HumanActor, SessionInfo, Environment } from './schema.js';
import type { AuditSink, AuditRow, AppendResult } from './sink.js';
import type { Authorizer } from './sequencer.js';

/** Logical tool name used when authorizing a read of the audit log. */
export const AUDIT_READ_TOOL = 'audit.read';

export interface ReadRequest {
  /** The authenticated human performing the read. Required; never "claude". */
  principal: HumanActor;
  organization_id: string;
  session: SessionInfo;
  environment: Environment;
  /** Descriptor of what was requested (recorded in the read-log entry). */
  query_range?: Record<string, unknown>;
  limit?: number;
}

export type ReadOutcome =
  | { status: 'ok'; rows: AuditRow[]; read_log: AppendResult }
  | { status: 'refused'; stage: 'validate' | 'authorize'; reason: string };

export class AuditViewer {
  constructor(
    private readonly sink: AuditSink,
    private readonly authorizer: Authorizer,
  ) {}

  private validate(req: ReadRequest): { ok: true } | { ok: false; reason: string } {
    const uid = req.principal?.user_id?.trim();
    if (!uid) return { ok: false, reason: 'missing human principal (actor is required)' };
    if (uid.toLowerCase() === 'claude') return { ok: false, reason: 'actor may not be "claude"' };
    if (!req.organization_id) return { ok: false, reason: 'missing organization_id' };
    if (!req.session?.session_id) return { ok: false, reason: 'missing session' };
    if (!req.environment) return { ok: false, reason: 'missing environment' };
    return { ok: true };
  }

  async read(req: ReadRequest): Promise<ReadOutcome> {
    // 1. VALIDATE
    const v = this.validate(req);
    if (!v.ok) return { status: 'refused', stage: 'validate', reason: v.reason };

    // 2. AUTHORIZE the read (hook runs BEFORE anything is read or logged)
    const decision = await this.authorizer.authorize({
      human_actor: req.principal,
      organization_id: req.organization_id,
      tool: { name: AUDIT_READ_TOOL },
      environment: req.environment,
    });
    if (decision.decision !== 'ALLOW') {
      // Refused reads return nothing AND read nothing — but the denied attempt IS now recorded
      // as a distinct, chained refusal entry (Phase 3.5). It is never an intent, so it can never
      // be mistaken for an orphan.
      try {
        await this.sink.appendRefusal({
          organization_id: req.organization_id,
          human_actor: req.principal,
          session: req.session,
          tool: { name: AUDIT_READ_TOOL },
          stage: 'authorize',
          decision: decision.decision,
          reason: decision.reason,
          environment: req.environment,
        });
      } catch {
        // refusal-audit unavailable; the read is still refused (reads nothing).
      }
      return { status: 'refused', stage: 'authorize', reason: decision.reason ?? decision.decision };
    }

    // 3. READ (org-scoped via RLS)
    const rows = await this.sink.readEntries(req.organization_id, { limit: req.limit });

    // 4. AUDIT THE READ (the watchers are watched — a chained read-log entry)
    const read_log = await this.sink.appendRead({
      organization_id: req.organization_id,
      human_actor: req.principal,
      session: req.session,
      query_range: req.query_range,
      rows_returned: rows.length,
    });

    return { status: 'ok', rows, read_log };
  }
}
