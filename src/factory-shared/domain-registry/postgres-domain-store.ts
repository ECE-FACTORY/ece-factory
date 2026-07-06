// PostgresDomainRegistryStore — append-only persistence of domain registrations / status snapshots.
// Uses an injected pg Pool; append-only enforced at the DB layer (0004 migration).

import type { Pool } from 'pg';
import type {
  DomainRegistryStore,
  DomainRecord,
  SovereigntyRequirement,
  AirGapRequirement,
  ArabicFirstRequirement,
  RiskLevel,
  DomainStatus,
} from './domain-registry.js';

interface Row {
  record_id: string;
  registered_at: Date | string;
  name: string;
  business_objective: string;
  sovereignty: SovereigntyRequirement;
  air_gap: AirGapRequirement;
  arabic_first: ArabicFirstRequirement;
  owner: string;
  risk_level: RiskLevel;
  status: DomainStatus;
  sub_domains: string[] | null;
  target_clients: string[] | null;
  linked_harvest_ref: string | null;
  linked_project_refs: string[] | null;
}

function toRecord(r: Row): DomainRecord {
  return {
    recordId: r.record_id,
    registeredAtIso: r.registered_at instanceof Date ? r.registered_at.toISOString() : String(r.registered_at),
    name: r.name,
    businessObjective: r.business_objective,
    sovereignty: r.sovereignty,
    airGap: r.air_gap,
    arabicFirst: r.arabic_first,
    owner: r.owner,
    riskLevel: r.risk_level,
    status: r.status,
    subDomains: r.sub_domains ?? [],
    targetClients: r.target_clients ?? [],
    linkedHarvestRef: r.linked_harvest_ref,
    linkedProjectRefs: r.linked_project_refs ?? [],
  };
}

export class PostgresDomainRegistryStore implements DomainRegistryStore {
  constructor(private readonly pool: Pool) {}

  async put(record: DomainRecord): Promise<DomainRecord> {
    const r = await this.pool.query<Row>(
      `INSERT INTO domain_registration
         (name, business_objective, sovereignty, air_gap, arabic_first, owner, risk_level, status, sub_domains, target_clients, linked_harvest_ref, linked_project_refs)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [
        record.name, record.businessObjective, record.sovereignty, record.airGap, record.arabicFirst,
        record.owner, record.riskLevel, record.status,
        JSON.stringify(record.subDomains), JSON.stringify(record.targetClients),
        record.linkedHarvestRef, JSON.stringify(record.linkedProjectRefs),
      ],
    );
    return toRecord(r.rows[0]!);
  }

  async getLatest(name: string): Promise<DomainRecord | null> {
    const r = await this.pool.query<Row>(
      `SELECT * FROM domain_registration WHERE name=$1 ORDER BY registered_at DESC, record_id DESC LIMIT 1`,
      [name],
    );
    return r.rows[0] ? toRecord(r.rows[0]) : null;
  }

  async history(name: string): Promise<DomainRecord[]> {
    const r = await this.pool.query<Row>(`SELECT * FROM domain_registration WHERE name=$1 ORDER BY registered_at, record_id`, [name]);
    return r.rows.map(toRecord);
  }

  async list(): Promise<DomainRecord[]> {
    const r = await this.pool.query<Row>(`SELECT DISTINCT ON (name) * FROM domain_registration ORDER BY name, registered_at DESC, record_id DESC`);
    return r.rows.map(toRecord);
  }
}
