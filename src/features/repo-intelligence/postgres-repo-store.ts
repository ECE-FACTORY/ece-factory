// PostgresRepoIntelligenceStore — append-only persistence of evaluation records (Module 9 memory).
// Uses an injected pg Pool. The append-only guarantee is enforced at the DB layer (0003 migration).

import type { Pool } from 'pg';
import type {
  RepoIntelligenceStore,
  RepoEvaluationRecord,
  RepoIdentity,
  MaturitySignals,
  AirGapSuitability,
  WhiteLabelFit,
  Verdict,
  Eligibility,
  LicenseDecision,
} from './repo-intelligence.js';

interface Row {
  record_id: string;
  evaluated_at: Date | string;
  host: string;
  owner: string;
  name: string;
  license_detected: string;
  license_decision: LicenseDecision;
  eligibility: Eligibility;
  provenance_verified: boolean;
  maturity: MaturitySignals | null;
  air_gap: AirGapSuitability | null;
  white_label: WhiteLabelFit | null;
  architecture_fit_notes: string | null;
  prior_verdict: Verdict | null;
  readme: string | null;
  description: string | null;
}

function toRecord(r: Row): RepoEvaluationRecord {
  return {
    recordId: r.record_id,
    evaluatedAtIso: r.evaluated_at instanceof Date ? r.evaluated_at.toISOString() : String(r.evaluated_at),
    identity: { host: r.host, owner: r.owner, name: r.name },
    licenseDetected: r.license_detected,
    licenseDecision: r.license_decision,
    eligibility: r.eligibility,
    provenanceVerified: r.provenance_verified,
    maturity: r.maturity,
    airGapSuitability: r.air_gap ?? 'unknown',
    whiteLabelFit: r.white_label ?? 'unknown',
    architectureFitNotes: r.architecture_fit_notes,
    priorVerdict: r.prior_verdict,
    readme: r.readme,
    description: r.description,
    status: 'recorded',
  };
}

export class PostgresRepoIntelligenceStore implements RepoIntelligenceStore {
  constructor(private readonly pool: Pool) {}

  async put(record: RepoEvaluationRecord): Promise<RepoEvaluationRecord> {
    const r = await this.pool.query<Row>(
      `INSERT INTO repo_evaluation
         (host, owner, name, license_detected, license_decision, eligibility, provenance_verified,
          maturity, air_gap, white_label, architecture_fit_notes, prior_verdict, readme, description, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'recorded')
       RETURNING *`,
      [
        record.identity.host, record.identity.owner, record.identity.name,
        record.licenseDetected, record.licenseDecision, record.eligibility, record.provenanceVerified,
        record.maturity === null ? null : JSON.stringify(record.maturity),
        record.airGapSuitability, record.whiteLabelFit, record.architectureFitNotes,
        record.priorVerdict, record.readme, record.description,
      ],
    );
    return toRecord(r.rows[0]!);
  }

  async getLatest(identity: RepoIdentity): Promise<RepoEvaluationRecord | null> {
    const r = await this.pool.query<Row>(
      `SELECT * FROM repo_evaluation WHERE host=$1 AND owner=$2 AND name=$3 ORDER BY evaluated_at DESC, record_id DESC LIMIT 1`,
      [identity.host, identity.owner, identity.name],
    );
    return r.rows[0] ? toRecord(r.rows[0]) : null;
  }

  async list(): Promise<RepoEvaluationRecord[]> {
    const r = await this.pool.query<Row>(`SELECT * FROM repo_evaluation ORDER BY evaluated_at`);
    return r.rows.map(toRecord);
  }
}
