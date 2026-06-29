// PostgresHashChainSink — the default AuditSink (ARCHITECTURE §5, §8).
// Append-only storage + per-org SHA-256 hash chain + tamper-evident verifyChain.
// proof() returns null (the VerifiableLogSink seam stays open).
//
// This is the STORAGE ADAPTER. It contains NO §2 sequencer control flow
// (no validate→authorize→execute orchestration) — only append/verify storage ops.

import { createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import {
  GENESIS_PREV_HASH,
  canonicalSerialize,
  intentContent,
  resultContent,
  readContent,
} from './schema.js';
import {
  type AuditSink,
  type AppendResult,
  type IntentInput,
  type ResultPayload,
  type ReadInput,
  type EntryRef,
  type InclusionProof,
  type VerifyResult,
  type RedactionPolicy,
  defaultRedactionPolicy,
} from './sink.js';

const J = (v: unknown): string => JSON.stringify(v);
const Jn = (v: unknown): string | null => (v === undefined || v === null ? null : JSON.stringify(v));

interface ChainEntry {
  kind: 'intent' | 'result' | 'read';
  seq: number;
  prev_hash: string;
  entry_hash: string;
  content: Record<string, unknown>;
}

export class PostgresHashChainSink implements AuditSink {
  constructor(
    private readonly pool: Pool,
    private readonly redaction: RedactionPolicy = defaultRedactionPolicy,
  ) {}

  private hashEntry(canonical: string, prevHash: string): string {
    return createHash('sha256').update(canonical).update('|').update(prevHash).digest('hex');
  }

  /** Run fn in a transaction scoped to one org (RLS context + per-org serialization lock). */
  private async inOrgTx<T>(org: string, lock: boolean, fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');
      await c.query('SELECT set_config($1, $2, true)', ['app.current_org', org]); // SET LOCAL
      if (lock) await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [org]);
      const out = await fn(c);
      await c.query('COMMIT');
      return out;
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    } finally {
      c.release();
    }
  }

  /** Current chain head for an org (max seq across all three tables), or null at genesis. */
  private async head(c: PoolClient, org: string): Promise<{ seq: number; entry_hash: string } | null> {
    const r = await c.query<{ seq: string; entry_hash: string }>(
      `SELECT seq, entry_hash FROM (
         SELECT seq, entry_hash FROM audit_intent   WHERE organization_id = $1
         UNION ALL SELECT seq, entry_hash FROM audit_result   WHERE organization_id = $1
         UNION ALL SELECT seq, entry_hash FROM audit_read_log WHERE organization_id = $1
       ) t ORDER BY seq DESC LIMIT 1`,
      [org],
    );
    const row = r.rows[0];
    return row ? { seq: Number(row.seq), entry_hash: row.entry_hash } : null;
  }

  async appendIntent(input: IntentInput): Promise<AppendResult & { intent_id: string }> {
    const summary = this.redaction.redactSummary(input.request_summary); // redact BEFORE hash/write
    return this.inOrgTx(input.organization_id, true, async (c) => {
      const h = await this.head(c, input.organization_id);
      const seq = (h?.seq ?? 0) + 1;
      const prev = h?.entry_hash ?? GENESIS_PREV_HASH;
      const content = intentContent({ ...input, request_summary: summary, seq });
      const entry_hash = this.hashEntry(canonicalSerialize(content), prev);
      const r = await c.query<{ intent_id: string }>(
        `INSERT INTO audit_intent
           (seq, organization_id, human_actor, via, session, tool, request_summary, authz, approval, dashboard, environment, prev_hash, entry_hash, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'intent') RETURNING intent_id`,
        [seq, input.organization_id, J(input.human_actor), input.via ?? null, J(input.session), J(input.tool),
          Jn(summary), J(input.authz), Jn(input.approval), Jn(input.dashboard), input.environment, prev, entry_hash],
      );
      return { seq, entry_hash, intent_id: r.rows[0]!.intent_id };
    });
  }

  async appendResult(intentRef: { intent_id: string; organization_id: string }, result: ResultPayload): Promise<AppendResult> {
    const payload: Record<string, unknown> = { status: result.status, duration_ms: result.duration_ms };
    if (result.error_code !== undefined) payload.error_code = result.error_code;
    return this.inOrgTx(intentRef.organization_id, true, async (c) => {
      const h = await this.head(c, intentRef.organization_id);
      const seq = (h?.seq ?? 0) + 1;
      const prev = h?.entry_hash ?? GENESIS_PREV_HASH;
      const content = resultContent({
        seq, organization_id: intentRef.organization_id, intent_id: intentRef.intent_id, result: payload, status: result.status,
      });
      const entry_hash = this.hashEntry(canonicalSerialize(content), prev);
      await c.query(
        `INSERT INTO audit_result (intent_id, seq, organization_id, result, prev_hash, entry_hash, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [intentRef.intent_id, seq, intentRef.organization_id, J(payload), prev, entry_hash, result.status],
      );
      return { seq, entry_hash };
    });
  }

  async appendRead(input: ReadInput): Promise<AppendResult> {
    return this.inOrgTx(input.organization_id, true, async (c) => {
      const h = await this.head(c, input.organization_id);
      const seq = (h?.seq ?? 0) + 1;
      const prev = h?.entry_hash ?? GENESIS_PREV_HASH;
      const content = readContent({ ...input, seq });
      const entry_hash = this.hashEntry(canonicalSerialize(content), prev);
      await c.query(
        `INSERT INTO audit_read_log (seq, organization_id, human_actor, session, query_range, rows_returned, prev_hash, entry_hash)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [seq, input.organization_id, J(input.human_actor), J(input.session), Jn(input.query_range), input.rows_returned ?? null, prev, entry_hash],
      );
      return { seq, entry_hash };
    });
  }

  async verifyChain(organization_id: string): Promise<VerifyResult> {
    const entries = await this.inOrgTx(organization_id, false, async (c) => {
      const intents = await c.query(
        `SELECT seq, organization_id, human_actor, via, session, tool, request_summary, authz, approval, dashboard, environment, prev_hash, entry_hash
         FROM audit_intent WHERE organization_id = $1`, [organization_id]);
      const results = await c.query(
        `SELECT seq, organization_id, intent_id, result, status, prev_hash, entry_hash
         FROM audit_result WHERE organization_id = $1`, [organization_id]);
      const reads = await c.query(
        `SELECT seq, organization_id, human_actor, session, query_range, rows_returned, prev_hash, entry_hash
         FROM audit_read_log WHERE organization_id = $1`, [organization_id]);

      const all: ChainEntry[] = [];
      for (const r of intents.rows) all.push({ kind: 'intent', seq: Number(r.seq), prev_hash: r.prev_hash, entry_hash: r.entry_hash, content: intentContent(r) });
      for (const r of results.rows) all.push({ kind: 'result', seq: Number(r.seq), prev_hash: r.prev_hash, entry_hash: r.entry_hash, content: resultContent(r) });
      for (const r of reads.rows) all.push({ kind: 'read', seq: Number(r.seq), prev_hash: r.prev_hash, entry_hash: r.entry_hash, content: readContent(r) });
      all.sort((a, b) => a.seq - b.seq);
      return all;
    });

    let prevExpected = GENESIS_PREV_HASH;
    let checked = 0;
    for (const e of entries) {
      checked++;
      // (1) chain linkage: this entry must point at the previous entry's hash.
      if (e.prev_hash !== prevExpected) return { ok: false, first_broken_seq: e.seq, checked };
      // (2) content integrity: recomputed hash must match the stored hash.
      const recomputed = this.hashEntry(canonicalSerialize(e.content), e.prev_hash);
      if (recomputed !== e.entry_hash) return { ok: false, first_broken_seq: e.seq, checked };
      prevExpected = e.entry_hash;
    }
    return { ok: true, checked };
  }

  // Extension point (ARCHITECTURE §8): the Postgres sink offers no external proof.
  proof(_entryRef: EntryRef): InclusionProof | null {
    return null;
  }
}
