// PostgresProjectRegistryStore — append-only persistence of project registrations / status snapshots.
// Uses an injected pg Pool; append-only enforced at the DB layer (0005 migration).

import type { Pool } from 'pg';
import type { ProjectRegistryStore, ProjectRecord, ProjectStatus, HarvestApprovalStatus } from './project-registry.js';

interface Row {
  record_id: string;
  registered_at: Date | string;
  project: string;
  repo: string;
  domain: string;
  purpose: string;
  owner: string;
  stack: string;
  deployment: string;
  status: ProjectStatus;
  maturity: string | null;
  open_risks: string[] | null;
  last_review_decision: string | null;
  next_gate: string | null;
  harvest_approval_status: HarvestApprovalStatus;
}

function toRecord(r: Row): ProjectRecord {
  return {
    recordId: r.record_id,
    registeredAtIso: r.registered_at instanceof Date ? r.registered_at.toISOString() : String(r.registered_at),
    project: r.project, repo: r.repo, domain: r.domain, purpose: r.purpose, owner: r.owner, stack: r.stack, deployment: r.deployment,
    status: r.status, maturity: r.maturity, openRisks: r.open_risks ?? [], lastReviewDecision: r.last_review_decision,
    nextGate: r.next_gate, harvestApprovalStatus: r.harvest_approval_status,
  };
}

export class PostgresProjectRegistryStore implements ProjectRegistryStore {
  constructor(private readonly pool: Pool) {}

  async put(record: ProjectRecord): Promise<ProjectRecord> {
    const r = await this.pool.query<Row>(
      `INSERT INTO project_registration
         (project, repo, domain, purpose, owner, stack, deployment, status, maturity, open_risks, last_review_decision, next_gate, harvest_approval_status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [
        record.project, record.repo, record.domain, record.purpose, record.owner, record.stack, record.deployment,
        record.status, record.maturity, JSON.stringify(record.openRisks), record.lastReviewDecision, record.nextGate, record.harvestApprovalStatus,
      ],
    );
    return toRecord(r.rows[0]!);
  }

  async getLatest(project: string): Promise<ProjectRecord | null> {
    const r = await this.pool.query<Row>(
      `SELECT * FROM project_registration WHERE project=$1 ORDER BY registered_at DESC, record_id DESC LIMIT 1`,
      [project],
    );
    return r.rows[0] ? toRecord(r.rows[0]) : null;
  }

  async history(project: string): Promise<ProjectRecord[]> {
    const r = await this.pool.query<Row>(`SELECT * FROM project_registration WHERE project=$1 ORDER BY registered_at, record_id`, [project]);
    return r.rows.map(toRecord);
  }

  async list(): Promise<ProjectRecord[]> {
    const r = await this.pool.query<Row>(`SELECT DISTINCT ON (project) * FROM project_registration ORDER BY project, registered_at DESC, record_id DESC`);
    return r.rows.map(toRecord);
  }
}
