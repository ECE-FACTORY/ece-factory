// PostgresFieldDefinitionStore — append-only persistence of field-definition snapshots. A definition/change
// is a new row; the current definition is the latest snapshot. Append-only enforced at the DB layer
// (migration 0010). Injected pg Pool; imports nothing from other engines.

import type { Pool } from 'pg';
import type { FieldDefinitionStore, FieldDefinitionRecord, FieldDataType, FieldTarget, FieldSensitivity, FieldConstraints, FieldDefaultValue } from './field-creation.js';

interface Row {
  record_id: string;
  registered_at: Date | string;
  key: string;
  label: string;
  data_type: FieldDataType;
  target: FieldTarget;
  target_ref: string;
  required: boolean;
  field_default: FieldDefaultValue | null;
  constraints: FieldConstraints;
  sensitivity: FieldSensitivity;
  changed_by: string;
  reason: string | null;
}

function toRecord(r: Row): FieldDefinitionRecord {
  return {
    recordId: r.record_id,
    changedAtIso: r.registered_at instanceof Date ? r.registered_at.toISOString() : String(r.registered_at),
    key: r.key, label: r.label, dataType: r.data_type, target: r.target, targetRef: r.target_ref,
    required: r.required, default: r.field_default, constraints: r.constraints ?? {}, sensitivity: r.sensitivity,
    changedBy: r.changed_by, reason: r.reason,
  };
}

export class PostgresFieldDefinitionStore implements FieldDefinitionStore {
  constructor(private readonly pool: Pool) {}

  async append(record: Omit<FieldDefinitionRecord, 'recordId' | 'changedAtIso'>): Promise<FieldDefinitionRecord> {
    const r = await this.pool.query<Row>(
      `INSERT INTO field_definitions (key, label, data_type, target, target_ref, required, field_default, constraints, sensitivity, changed_by, reason)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [record.key, record.label, record.dataType, record.target, record.targetRef, record.required,
        record.default === null ? null : JSON.stringify(record.default), JSON.stringify(record.constraints),
        record.sensitivity, record.changedBy, record.reason],
    );
    return toRecord(r.rows[0]!);
  }

  async getLatest(target: FieldTarget, targetRef: string, key: string): Promise<FieldDefinitionRecord | null> {
    const r = await this.pool.query<Row>(
      `SELECT * FROM field_definitions WHERE target=$1 AND target_ref=$2 AND key=$3 ORDER BY registered_at DESC, record_id DESC LIMIT 1`,
      [target, targetRef, key],
    );
    return r.rows[0] ? toRecord(r.rows[0]) : null;
  }

  async history(target: FieldTarget, targetRef: string, key: string): Promise<FieldDefinitionRecord[]> {
    const r = await this.pool.query<Row>(
      `SELECT * FROM field_definitions WHERE target=$1 AND target_ref=$2 AND key=$3 ORDER BY registered_at, record_id`,
      [target, targetRef, key],
    );
    return r.rows.map(toRecord);
  }

  async list(target: FieldTarget, targetRef: string): Promise<FieldDefinitionRecord[]> {
    const r = await this.pool.query<Row>(
      `SELECT DISTINCT ON (key) * FROM field_definitions WHERE target=$1 AND target_ref=$2 ORDER BY key, registered_at DESC, record_id DESC`,
      [target, targetRef],
    );
    return r.rows.map(toRecord);
  }
}
