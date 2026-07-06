// PostgresRiskRegisterStore — append-only persistence of risk registrations / status snapshots.
// Uses an injected pg Pool; append-only enforced at the DB layer (0006 migration).

import type { Pool } from 'pg';
import type { RiskRegisterStore, RiskRecord, RiskType, Severity, RiskStatus } from './risk-register.js';

interface Row {
  record_id: string;
  registered_at: Date | string;
  risk_key: string;
  title: string | null;
  type: RiskType;
  owner: string;
  severity: Severity;
  mitigation: string | null;
  status: RiskStatus;
  linked_project: string | null;
  linked_repo: string | null;
  linked_decision: string | null;
  linked_evidence: string | null;
}

function toRecord(r: Row): RiskRecord {
  return {
    recordId: r.record_id,
    registeredAtIso: r.registered_at instanceof Date ? r.registered_at.toISOString() : String(r.registered_at),
    key: r.risk_key, title: r.title, type: r.type, owner: r.owner, severity: r.severity, mitigation: r.mitigation, status: r.status,
    linkedProject: r.linked_project, linkedRepo: r.linked_repo, linkedDecision: r.linked_decision, linkedEvidence: r.linked_evidence,
  };
}

export class PostgresRiskRegisterStore implements RiskRegisterStore {
  constructor(private readonly pool: Pool) {}

  async put(record: RiskRecord): Promise<RiskRecord> {
    const r = await this.pool.query<Row>(
      `INSERT INTO risk_register
         (risk_key, title, type, owner, severity, mitigation, status, linked_project, linked_repo, linked_decision, linked_evidence)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [record.key, record.title, record.type, record.owner, record.severity, record.mitigation, record.status, record.linkedProject, record.linkedRepo, record.linkedDecision, record.linkedEvidence],
    );
    return toRecord(r.rows[0]!);
  }

  async getLatest(key: string): Promise<RiskRecord | null> {
    const r = await this.pool.query<Row>(`SELECT * FROM risk_register WHERE risk_key=$1 ORDER BY registered_at DESC, record_id DESC LIMIT 1`, [key]);
    return r.rows[0] ? toRecord(r.rows[0]) : null;
  }

  async history(key: string): Promise<RiskRecord[]> {
    const r = await this.pool.query<Row>(`SELECT * FROM risk_register WHERE risk_key=$1 ORDER BY registered_at, record_id`, [key]);
    return r.rows.map(toRecord);
  }

  async list(): Promise<RiskRecord[]> {
    const r = await this.pool.query<Row>(`SELECT DISTINCT ON (risk_key) * FROM risk_register ORDER BY risk_key, registered_at DESC, record_id DESC`);
    return r.rows.map(toRecord);
  }
}
