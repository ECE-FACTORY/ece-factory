// Field Creation (Module 20, Wave 5) — governed custom-field definitions on a target (domain/project/product).
//
// Reading a field is READ_ONLY; CREATING/CHANGING a field is an APPROVAL_REQUIRED_WRITE (the Phase 8.3
// single-use/per-action/human-approved/unforgeable token gate, applied by the bridge). A field definition is
// governed state, not an escape hatch.
//
// THE CORE GUARANTEE — A FIELD DEFINITION IS INERT DECLARATIVE DATA. It is a name, a type, and declarative
// constraints — it contains NO executable behavior: no code, no eval, no callback, no SQL fragment, no
// template that gets executed. Constraints are a CLOSED declarative vocabulary (min/max/regex/enumValues/
// length); anything else is rejected. A `default` must be a scalar value, never a structured/executable
// object. (A label/key/default that merely *reads like* a command is inert — stored and displayed as data,
// never actioned: the instruction-boundary.)
//
// REDACTION FLOOR — a field may declare itself SENSITIVE (redaction-eligible), but NO field definition can
// opt out of, or weaken, the Redaction Engine. Opt-out keys are unrepresentable and refused (mirrors the
// Settings guard-floor; a field is not a side-channel around redaction).
//
// STANDALONE-PACKAGEABLE: imports nothing from other engines; the approval gate, the store, and the target
// lookup are injected ports.

export const FIELD_DATA_TYPES = ['string', 'number', 'boolean', 'date', 'enum', 'text'] as const;
export type FieldDataType = (typeof FIELD_DATA_TYPES)[number];

export const FIELD_TARGETS = ['domain', 'project', 'product'] as const;
export type FieldTarget = (typeof FIELD_TARGETS)[number];

export const FIELD_SENSITIVITIES = ['NORMAL', 'SENSITIVE'] as const;
export type FieldSensitivity = (typeof FIELD_SENSITIVITIES)[number];

export type FieldDefaultValue = string | number | boolean;

/** The CLOSED declarative constraint vocabulary. No other key is permitted — constraints are not code. */
export interface FieldConstraints {
  min?: number;
  max?: number;
  minLength?: number;
  maxLength?: number;
  regex?: string;        // a declarative pattern string (bounded; validated as a compilable RegExp), never executed as code
  enumValues?: string[]; // for enum fields
}
const ALLOWED_CONSTRAINT_KEYS = new Set(['min', 'max', 'minLength', 'maxLength', 'regex', 'enumValues']);
/** Keys that would attempt to smuggle behavior or opt out of redaction — never allowed on a field definition. */
const FORBIDDEN_DEFINITION_KEYS = /^(eval|code|script|exec|callback|fn|expr|expression|template|sql|query|command|run|neverredact|noredact|redact|skipredaction|redactionexempt|exposealways|plaintext|exempt)$/i;
/** Markers of executable / SQL / script content inside a constraint string. */
const EXECUTABLE_MARKER_RE = /(\beval\b|\bfunction\s*\(|=>|\$\{|<script|<\/script|;\s*--|\bdrop\s+table\b|\bunion\s+select\b|\binsert\s+into\b|\bdelete\s+from\b|\bselect\b[\s\S]*\bfrom\b|`)/i;
const MAX_REGEX_LEN = 200;
const MAX_LABEL_LEN = 200;

export interface FieldDefinitionInput {
  key: string;
  label: string;
  dataType: FieldDataType;
  target: FieldTarget;
  targetRef: string; // the registered domain/project/product id
  required?: boolean;
  default?: FieldDefaultValue;
  constraints?: FieldConstraints;
  sensitivity?: FieldSensitivity;
  changedBy: string; // a real human — never "claude"
  reason?: string;
}

export interface FieldDefinitionRecord {
  recordId?: string;
  changedAtIso: string;
  key: string;
  label: string;
  dataType: FieldDataType;
  target: FieldTarget;
  targetRef: string;
  required: boolean;
  default: FieldDefaultValue | null;
  constraints: FieldConstraints;
  sensitivity: FieldSensitivity;
  changedBy: string;
  reason: string | null;
}

/** Append-only store — a definition/change is a new snapshot; UPDATE/DELETE/TRUNCATE denied at the DB layer. */
export interface FieldDefinitionStore {
  append(record: Omit<FieldDefinitionRecord, 'recordId' | 'changedAtIso'>): Promise<FieldDefinitionRecord>;
  getLatest(target: FieldTarget, targetRef: string, key: string): Promise<FieldDefinitionRecord | null>;
  history(target: FieldTarget, targetRef: string, key: string): Promise<FieldDefinitionRecord[]>;
  list(target: FieldTarget, targetRef: string): Promise<FieldDefinitionRecord[]>; // latest per key on the target
}

/** Injected: is this (target, targetRef) a registered domain/project/product? (Consumes the registries by use.) */
export type TargetLookup = (target: FieldTarget, targetRef: string) => Promise<boolean>;

export class FieldCreationError extends Error {
  constructor(message: string) { super(message); this.name = 'FieldCreationError'; }
}

export type ValidateResult = { ok: true } | { ok: false; reason: string };

/** Validate a proposed field definition — deny-by-default + the inertness core + the redaction floor. */
export function validateFieldDefinition(input: FieldDefinitionInput): ValidateResult {
  // attribution
  if (!input?.changedBy?.trim() || input.changedBy.trim().toLowerCase() === 'claude') {
    return { ok: false, reason: 'a field change must be attributed to a real human (never "claude")' };
  }
  // REDACTION FLOOR + inertness: no opt-out / executable keys anywhere on the raw input.
  for (const k of Object.keys(input as unknown as Record<string, unknown>)) {
    if (FORBIDDEN_DEFINITION_KEYS.test(k)) {
      return { ok: false, reason: `refused: "${k}" is not a permitted field-definition key (a field cannot carry executable behavior or opt out of redaction)` };
    }
  }
  // deny-by-default: key/label/target/type
  if (!input.key?.trim()) return { ok: false, reason: 'field key is required' };
  if (!input.label?.trim()) return { ok: false, reason: 'field label is required' };
  if (input.label.length > MAX_LABEL_LEN) return { ok: false, reason: 'field label too long' };
  if (!(FIELD_DATA_TYPES as readonly string[]).includes(input.dataType)) return { ok: false, reason: `unknown/invalid data type "${String(input.dataType)}"` };
  if (!(FIELD_TARGETS as readonly string[]).includes(input.target)) return { ok: false, reason: `unknown/invalid target "${String(input.target)}"` };
  if (!input.targetRef?.trim()) return { ok: false, reason: 'targetRef is required' };
  if (input.sensitivity !== undefined && !(FIELD_SENSITIVITIES as readonly string[]).includes(input.sensitivity)) {
    return { ok: false, reason: `invalid sensitivity "${String(input.sensitivity)}" (only NORMAL or SENSITIVE)` };
  }
  // default must be an INERT scalar matching the type — never a structured/executable object.
  if (input.default !== undefined && input.default !== null) {
    const t = typeof input.default;
    if (t !== 'string' && t !== 'number' && t !== 'boolean') {
      return { ok: false, reason: 'refused: a field default must be a scalar value (no structured/executable content)' };
    }
  }
  // constraints: a CLOSED declarative vocabulary — never arbitrary code.
  const cr = validateConstraints(input.constraints);
  if (!cr.ok) return cr;
  return { ok: true };
}

function validateConstraints(c: FieldConstraints | undefined): ValidateResult {
  if (c === undefined) return { ok: true };
  if (typeof c !== 'object' || Array.isArray(c) || typeof c === 'function') {
    return { ok: false, reason: 'refused: constraints must be a declarative object (not code)' };
  }
  for (const k of Object.keys(c)) {
    if (!ALLOWED_CONSTRAINT_KEYS.has(k)) {
      return { ok: false, reason: `refused: "${k}" is not a permitted constraint — constraints are a fixed declarative vocabulary (min/max/minLength/maxLength/regex/enumValues), not arbitrary code` };
    }
  }
  const rec = c as Record<string, unknown>;
  for (const numKey of ['min', 'max', 'minLength', 'maxLength']) {
    if (rec[numKey] !== undefined && typeof rec[numKey] !== 'number') return { ok: false, reason: `constraint "${numKey}" must be a number` };
  }
  if (c.enumValues !== undefined) {
    if (!Array.isArray(c.enumValues) || c.enumValues.length === 0 || c.enumValues.length > 1000) return { ok: false, reason: 'constraint "enumValues" must be a non-empty bounded string array' };
    for (const v of c.enumValues) {
      if (typeof v !== 'string') return { ok: false, reason: 'enumValues entries must be strings' };
      if (EXECUTABLE_MARKER_RE.test(v)) return { ok: false, reason: 'refused: an enum value carries executable/SQL/script content (constraints are inert data)' };
    }
  }
  if (c.regex !== undefined) {
    if (typeof c.regex !== 'string') return { ok: false, reason: 'constraint "regex" must be a string pattern' };
    if (c.regex.length > MAX_REGEX_LEN) return { ok: false, reason: 'constraint "regex" exceeds the bounded length' };
    if (EXECUTABLE_MARKER_RE.test(c.regex)) return { ok: false, reason: 'refused: the "regex" constraint carries executable/SQL/script content — constraints are a fixed declarative vocabulary, not code' };
    try { new RegExp(c.regex); } catch { return { ok: false, reason: 'constraint "regex" is not a valid pattern' }; }
  }
  return { ok: true };
}

/** A SENSITIVE field is redaction-eligible; NORMAL is the default. There is no value that exempts redaction. */
export function isRedactionEligible(record: { sensitivity: FieldSensitivity }): boolean {
  return record.sensitivity === 'SENSITIVE';
}

function toRecord(input: FieldDefinitionInput): Omit<FieldDefinitionRecord, 'recordId' | 'changedAtIso'> {
  return {
    key: input.key, label: input.label, dataType: input.dataType, target: input.target, targetRef: input.targetRef,
    required: input.required ?? false, default: input.default ?? null, constraints: input.constraints ?? {},
    sensitivity: input.sensitivity ?? 'NORMAL', changedBy: input.changedBy, reason: input.reason ?? null,
  };
}

export class FieldCreationService {
  constructor(private readonly targetLookup: TargetLookup) {}

  tierForRead(): 'READ_ONLY' { return 'READ_ONLY'; }
  tierForChange(): 'APPROVAL_REQUIRED_WRITE' { return 'APPROVAL_REQUIRED_WRITE'; }

  /** READ_ONLY — the current (latest-snapshot) definition for a field, or null if undefined. */
  read(store: FieldDefinitionStore, target: FieldTarget, targetRef: string, key: string): Promise<FieldDefinitionRecord | null> {
    return store.getLatest(target, targetRef, key);
  }

  /** Create a NEW field (rejects a duplicate key on the same target). The perform of an APPROVAL_REQUIRED_WRITE. */
  async create(store: FieldDefinitionStore, input: FieldDefinitionInput): Promise<FieldDefinitionRecord> {
    await this.assertValid(input);
    const existing = await store.getLatest(input.target, input.targetRef, input.key);
    if (existing) throw new FieldCreationError(`a field "${input.key}" already exists on ${input.target} "${input.targetRef}" (duplicate — not silently overwritten)`);
    return store.append(toRecord(input));
  }

  /** Change an EXISTING field — a new append-only snapshot (history preserved). */
  async change(store: FieldDefinitionStore, input: FieldDefinitionInput): Promise<FieldDefinitionRecord> {
    await this.assertValid(input);
    const existing = await store.getLatest(input.target, input.targetRef, input.key);
    if (!existing) throw new FieldCreationError(`no field "${input.key}" on ${input.target} "${input.targetRef}" to change`);
    return store.append(toRecord(input));
  }

  private async assertValid(input: FieldDefinitionInput): Promise<void> {
    const v = validateFieldDefinition(input);
    if (!v.ok) throw new FieldCreationError(v.reason);
    const registered = await this.targetLookup(input.target, input.targetRef);
    if (!registered) throw new FieldCreationError(`unregistered target — ${input.target} "${input.targetRef}" is not registered (a field can only be defined on a registered target)`);
  }
}
