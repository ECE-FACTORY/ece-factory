// Settings (Module 25, Wave 5) — governed factory configuration state.
//
// Reading a setting is a READ_ONLY capability; CHANGING a setting is an APPROVAL_REQUIRED_WRITE (the
// Phase 8.3 single-use/per-action/human-approved/unforgeable token gate, applied by the bridge when wired).
// Settings are NOT an escape hatch around any gate.
//
// THE HARD FLOOR (the core): no setting may disable, bypass, or weaken the Tool Registry, Permission Engine,
// Kill Switch, Audit Engine, Redaction Engine, or the approval-token requirement, nor make a FORBIDDEN tool
// callable. Such keys are UNREPRESENTABLE — they are simply not in the registry (deny-by-default rejects
// them). As defence-in-depth, any change whose (key, value) would cross into a guarantee-weakening state is
// refused by `crossesGuardFloor`, even for a registered SECURITY_CRITICAL key. This mirrors the Phase 8.4
// rule that the kill switch and audit can never be targeted — settings are not a side-channel.
//
// STANDALONE-PACKAGEABLE: imports nothing from other engines; the approval gate + store are injected ports.

export const SETTING_TYPES = ['boolean', 'string', 'number', 'enum'] as const;
export type SettingType = (typeof SETTING_TYPES)[number];

export const SETTING_SCOPES = ['factory-wide', 'per-domain', 'per-project'] as const;
export type SettingScope = (typeof SETTING_SCOPES)[number];

export const SETTING_CLASSIFICATIONS = ['OPERATIONAL', 'SECURITY_CRITICAL'] as const;
export type SettingClassification = (typeof SETTING_CLASSIFICATIONS)[number];

export type SettingValue = boolean | string | number;

export interface SettingDefinition {
  key: string;
  type: SettingType;
  scope: SettingScope;
  classification: SettingClassification;
  default: SettingValue;
  /** For enum/constrained keys — the only permissible values. */
  allowedValues?: SettingValue[];
  /** SECURITY_CRITICAL floor: returns true iff the value is SAFE (does not cross into a weakening state). */
  floor?: (value: SettingValue) => boolean;
  description?: string;
}

/** A persisted setting change — a new append-only snapshot. The current value is the latest snapshot. */
export interface SettingChangeInput {
  key: string;
  value: SettingValue;
  scopeRef?: string | null; // domain/project id for scoped settings; null for factory-wide
  changedBy: string; // the real human — never "claude"
  reason?: string;
}
export interface SettingRecord {
  recordId?: string;
  changedAtIso: string;
  key: string;
  value: SettingValue;
  scope: SettingScope;
  scopeRef: string | null;
  classification: SettingClassification;
  valueType: SettingType;
  changedBy: string;
  reason: string | null;
}

/** Append-only store — a change is a new snapshot; UPDATE/DELETE/TRUNCATE denied at the DB layer. */
export interface SettingsStore {
  append(record: Omit<SettingRecord, 'recordId' | 'changedAtIso'>): Promise<SettingRecord>;
  getLatest(key: string, scopeRef?: string | null): Promise<SettingRecord | null>;
  history(key: string, scopeRef?: string | null): Promise<SettingRecord[]>;
  list(): Promise<SettingRecord[]>; // latest snapshot per (key, scopeRef)
}

export class SettingsError extends Error {
  constructor(message: string) { super(message); this.name = 'SettingsError'; }
}

/**
 * Guard subsystems no setting may weaken. Any change naming one of these and crossing into a disabling value
 * is refused — regardless of whether the key is registered. (audit/redaction/kill-switch/permission/approval/
 * tool-registry/forbidden.) This is the structural floor.
 */
const GUARD_KEY_RE = /(^|[._-])(audit|redaction|kill[_\s-]?switch|permission|permissions|approval|approvals|tool[_\s-]?registry|forbidden)([._-]|$)/i;
const DISABLING_WORD_RE = /^(off|false|no|none|disable|disabled|bypass|skip|never|0)$/i;

export function crossesGuardFloor(key: string, value: SettingValue): boolean {
  if (!GUARD_KEY_RE.test(key)) return false; // doesn't target a guard subsystem
  // It targets a guard. Crossing into a disabling/weakening value is refused:
  if (value === false) return true;
  if (value === 0) return true; // e.g. audit retention 0, approval window 0
  if (typeof value === 'string' && DISABLING_WORD_RE.test(value.trim())) return true;
  // (false / 0 / disabling-words are already caught above — a "require/enforce/enabled" knob turned off
  //  hits those cases. No further check needed.)
  return false;
}

export type ValidateResult = { ok: true; def: SettingDefinition } | { ok: false; reason: string };

export class SettingsRegistry {
  private readonly defs: Map<string, SettingDefinition>;
  constructor(definitions: SettingDefinition[]) {
    this.defs = new Map(definitions.map((d) => [d.key, Object.freeze({ ...d })]));
  }
  get(key: string): SettingDefinition | undefined { return this.defs.get(key); }
  list(): SettingDefinition[] { return [...this.defs.values()]; }
  has(key: string): boolean { return this.defs.has(key); }

  /** The tier a change to this key flows through — always an APPROVAL_REQUIRED_WRITE (a change is a write). */
  tierForChange(): 'APPROVAL_REQUIRED_WRITE' { return 'APPROVAL_REQUIRED_WRITE'; }
  /** The tier a read flows through — always READ_ONLY. */
  tierForRead(): 'READ_ONLY' { return 'READ_ONLY'; }

  /** Deny-by-default validation of a proposed change. */
  validate(key: string, value: SettingValue): ValidateResult {
    const def = this.defs.get(key);
    if (!def) return { ok: false, reason: `unknown setting key "${key}" — settings are not silently created (deny-by-default)` };
    if (!typeMatches(def.type, value)) return { ok: false, reason: `invalid value for "${key}": expected ${def.type}, got ${typeof value}` };
    if (def.allowedValues && !def.allowedValues.includes(value)) {
      return { ok: false, reason: `invalid value for "${key}": ${JSON.stringify(value)} is not an allowed value` };
    }
    // THE HARD FLOOR — no setting may weaken a guard guarantee.
    if (crossesGuardFloor(key, value)) {
      return { ok: false, reason: `refused: no setting may disable/weaken a guard guarantee (audit/redaction/kill-switch/permission/approval) — "${key}"=${JSON.stringify(value)}` };
    }
    if (def.floor && !def.floor(value)) {
      return { ok: false, reason: `refused: "${key}"=${JSON.stringify(value)} would cross the security floor for this SECURITY_CRITICAL setting` };
    }
    return { ok: true, def };
  }
}

function typeMatches(type: SettingType, value: SettingValue): boolean {
  switch (type) {
    case 'boolean': return typeof value === 'boolean';
    case 'number': return typeof value === 'number' && Number.isFinite(value);
    case 'string':
    case 'enum': return typeof value === 'string';
  }
}

/** Ties the registry + the append-only store. `read` is READ_ONLY; `change` is the perform of an APPROVAL_REQUIRED_WRITE. */
export class SettingsService {
  constructor(private readonly registry: SettingsRegistry) {}

  /** READ_ONLY — the current value (latest snapshot), or the registered default if never changed. */
  async read(store: SettingsStore, key: string, scopeRef: string | null = null): Promise<{ key: string; value: SettingValue; classification: SettingClassification; isDefault: boolean }> {
    const def = this.registry.get(key);
    if (!def) throw new SettingsError(`unknown setting key "${key}" (deny-by-default)`);
    const latest = await store.getLatest(key, scopeRef);
    return latest
      ? { key, value: latest.value, classification: def.classification, isDefault: false }
      : { key, value: def.default, classification: def.classification, isDefault: true };
  }

  /**
   * The perform of an APPROVAL_REQUIRED_WRITE setting change — validates (deny-by-default + the guard floor)
   * then appends a new snapshot. The token gate is the bridge's; by the time this runs a valid single-use
   * human token has been consumed. Invalid/guard-weakening changes are rejected and NOTHING is appended.
   */
  async change(store: SettingsStore, input: SettingChangeInput): Promise<SettingRecord> {
    if (!input.changedBy?.trim() || input.changedBy.trim().toLowerCase() === 'claude') {
      throw new SettingsError('a setting change must be attributed to a real human (never "claude")');
    }
    const v = this.registry.validate(input.key, input.value);
    if (!v.ok) throw new SettingsError(v.reason);
    return store.append({
      key: input.key,
      value: input.value,
      scope: v.def.scope,
      scopeRef: input.scopeRef ?? null,
      classification: v.def.classification,
      valueType: v.def.type,
      changedBy: input.changedBy,
      reason: input.reason ?? null,
    });
  }

  registryRef(): SettingsRegistry { return this.registry; }
}

/**
 * The default factory settings registry. Note what is DELIBERATELY ABSENT: there is no `audit.enabled`,
 * `redaction.enabled`, `kill_switch.enabled`, `approval.required`, `permission.enforce`, or any
 * `tool.<x>.forbidden` key — disabling a guard is unrepresentable. SECURITY_CRITICAL keys that exist are
 * floored so they cannot cross into a weakening value (e.g. audit retention can be tuned but never 0;
 * redaction strictness can be tuned but never "off").
 */
export const DEFAULT_FACTORY_SETTINGS: SettingDefinition[] = [
  { key: 'harvest.min_score', type: 'number', scope: 'factory-wide', classification: 'OPERATIONAL', default: 70, description: 'Minimum harvest score to consider a candidate.' },
  { key: 'autopilot.max_steps', type: 'number', scope: 'factory-wide', classification: 'OPERATIONAL', default: 32, floor: (v) => typeof v === 'number' && v > 0, description: 'Bound on an Autopilot run.' },
  { key: 'reporting.timezone', type: 'string', scope: 'factory-wide', classification: 'OPERATIONAL', default: 'Asia/Dubai', description: 'Timezone for reports.' },
  { key: 'project.default_environment', type: 'enum', scope: 'per-project', classification: 'OPERATIONAL', default: 'local', allowedValues: ['local', 'staging', 'production'], description: 'Default environment for a project.' },
  // SECURITY_CRITICAL — gated AND floored; tunable WITHIN the guarantee, never across it:
  { key: 'audit.retention_days', type: 'number', scope: 'factory-wide', classification: 'SECURITY_CRITICAL', default: 365, floor: (v) => typeof v === 'number' && v >= 1, description: 'Audit retention; cannot be 0 (auditing cannot be turned off).' },
  { key: 'redaction.mode', type: 'enum', scope: 'factory-wide', classification: 'SECURITY_CRITICAL', default: 'standard', allowedValues: ['standard', 'strict'], description: 'Redaction strictness; "off" is not an allowed value.' },
  { key: 'approval.window_minutes', type: 'number', scope: 'factory-wide', classification: 'SECURITY_CRITICAL', default: 60, floor: (v) => typeof v === 'number' && v > 0, description: 'Approval window; cannot be 0 (approval cannot be disabled).' },
];
