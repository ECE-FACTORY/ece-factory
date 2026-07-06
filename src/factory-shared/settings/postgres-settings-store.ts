// PostgresSettingsStore — append-only persistence of setting-change snapshots. A change is a new row; the
// current value is the latest snapshot. Append-only is enforced at the DB layer (migration 0009). Uses an
// injected pg Pool; imports nothing from other engines.

import type { Pool } from 'pg';
import type { SettingsStore, SettingRecord, SettingScope, SettingClassification, SettingType, SettingValue } from './settings.js';

interface Row {
  record_id: string;
  registered_at: Date | string;
  key: string;
  value: SettingValue;
  scope: SettingScope;
  scope_ref: string | null;
  classification: SettingClassification;
  value_type: SettingType;
  changed_by: string;
  reason: string | null;
}

function toRecord(r: Row): SettingRecord {
  return {
    recordId: r.record_id,
    changedAtIso: r.registered_at instanceof Date ? r.registered_at.toISOString() : String(r.registered_at),
    key: r.key, value: r.value, scope: r.scope, scopeRef: r.scope_ref,
    classification: r.classification, valueType: r.value_type, changedBy: r.changed_by, reason: r.reason,
  };
}

export class PostgresSettingsStore implements SettingsStore {
  constructor(private readonly pool: Pool) {}

  async append(record: Omit<SettingRecord, 'recordId' | 'changedAtIso'>): Promise<SettingRecord> {
    const r = await this.pool.query<Row>(
      `INSERT INTO settings (key, value, scope, scope_ref, classification, value_type, changed_by, reason)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [record.key, JSON.stringify(record.value), record.scope, record.scopeRef, record.classification, record.valueType, record.changedBy, record.reason],
    );
    return toRecord(r.rows[0]!);
  }

  async getLatest(key: string, scopeRef: string | null = null): Promise<SettingRecord | null> {
    const r = await this.pool.query<Row>(
      `SELECT * FROM settings WHERE key=$1 AND scope_ref IS NOT DISTINCT FROM $2 ORDER BY registered_at DESC, record_id DESC LIMIT 1`,
      [key, scopeRef],
    );
    return r.rows[0] ? toRecord(r.rows[0]) : null;
  }

  async history(key: string, scopeRef: string | null = null): Promise<SettingRecord[]> {
    const r = await this.pool.query<Row>(
      `SELECT * FROM settings WHERE key=$1 AND scope_ref IS NOT DISTINCT FROM $2 ORDER BY registered_at, record_id`,
      [key, scopeRef],
    );
    return r.rows.map(toRecord);
  }

  async list(): Promise<SettingRecord[]> {
    const r = await this.pool.query<Row>(
      `SELECT DISTINCT ON (key, scope_ref) * FROM settings ORDER BY key, scope_ref, registered_at DESC, record_id DESC`,
    );
    return r.rows.map(toRecord);
  }
}
