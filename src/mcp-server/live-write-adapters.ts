// Live internal-write adapters (Phase 9.1) — thin append-only stores behind the EXISTING WriteStores ports.
//
// These are NOT a guard: all gating (the single-use, per-action, human-approved, unforgeable ConsumedApproval
// token) stays in the proven bridge. By the time a method here runs, the bridge has already consumed a valid
// token inside the committed audit callback. Each method does a single append-only INSERT into a real table
// and returns the new row — no UPDATE/DELETE/TRUNCATE path exists, and the role (ece_writer) has no mutation
// privilege. Used by the composition root (server.ts); the external tier stays on fakes this phase.

import type { Pool } from 'pg';
import type { WriteStores, WriteParams, WriteRecord } from '../layer-5-action/mcp-bridge/write-tools.js';

export class LiveWriteStores implements WriteStores {
  constructor(private readonly pool: Pool) {}

  // ── review log: governance decisions, sign-offs, approval-gate outcomes (append-only) ──
  private async appendReviewLog(kind: string, p: WriteParams): Promise<WriteRecord> {
    const payload = p.payload ?? {};
    const actor = typeof payload.actor === 'string' ? payload.actor : null;
    const r = await this.pool.query<WriteRecord>(
      `INSERT INTO review_log_entries (kind, actor, target, payload) VALUES ($1,$2,$3,$4)
       RETURNING record_id, registered_at, kind`,
      [kind, actor, p.target ?? null, payload],
    );
    return r.rows[0]!;
  }
  recordReviewDecision = (p: WriteParams): Promise<WriteRecord> => this.appendReviewLog('review_decision', p);
  recordHumanSignoff = (p: WriteParams): Promise<WriteRecord> => this.appendReviewLog('human_signoff', p);
  recordApprovalGate = (p: WriteParams): Promise<WriteRecord> => this.appendReviewLog('approval_gate', p);
  recordWaveSignoff = (p: WriteParams): Promise<WriteRecord> => this.appendReviewLog('wave_signoff', p);

  // ── open-items store (append-only) ──
  async createOpenItem(p: WriteParams): Promise<WriteRecord> {
    const r = await this.pool.query<WriteRecord>(
      `INSERT INTO open_items (target, payload) VALUES ($1,$2) RETURNING record_id, registered_at`,
      [p.target ?? null, p.payload ?? {}],
    );
    return r.rows[0]!;
  }

  // ── Risk Register: append a new status-transition snapshot (never an overwrite) ──
  async updateRiskStatus(p: WriteParams): Promise<WriteRecord> {
    const v = p.payload ?? {};
    const r = await this.pool.query<WriteRecord>(
      `INSERT INTO risk_register (risk_key, title, type, owner, severity, status, mitigation)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING record_id, registered_at, risk_key, status`,
      [v.key ?? p.target, v.title ?? null, v.type, v.owner, v.severity, v.status, v.mitigation ?? null],
    );
    return r.rows[0]!;
  }
}
