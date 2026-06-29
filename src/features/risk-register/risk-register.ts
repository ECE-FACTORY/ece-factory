// Risk Register (Module 31) — risks across the factory/products (blueprint §31).
//
// DENY-BY-DEFAULT: a risk missing type/owner/severity/status ⇒ rejected; an invalid type/severity/status
// ⇒ rejected. OPEN-RISK SURFACER (the core): an unmitigated high/critical OPEN risk is surfaced as
// BLOCKING — the register actively exposes its dangerous open risks, never just stores them in a list
// where they can be forgotten.
//
// Persistence is append-only (a high/critical risk must not be quietly closed off the books).
// STANDALONE-PACKAGEABLE: imports NOTHING from any other engine.

export const RISK_TYPES = [
  'license', 'air-gap', 'white-label', 'security', 'MCP', 'audit', 'verification', 'dependency',
  'upstream-abandonment', 'human-approval', 'production', 'sensitive-data', 'architecture', 'integration',
] as const;
export type RiskType = (typeof RISK_TYPES)[number];
export type Severity = 'low' | 'medium' | 'high' | 'critical';
export type RiskStatus = 'open' | 'mitigating' | 'accepted' | 'closed';

const SEVERITIES = new Set<string>(['low', 'medium', 'high', 'critical']);
const STATUSES = new Set<string>(['open', 'mitigating', 'accepted', 'closed']);

export interface RiskInput {
  key: string; // stable identifier for the risk
  title?: string;
  type: RiskType;
  owner: string;
  severity: Severity;
  mitigation?: string;
  status: RiskStatus;
  linkedProject?: string;
  linkedRepo?: string;
  linkedDecision?: string;
  linkedEvidence?: string;
}

export interface RiskRecord {
  recordId?: string;
  registeredAtIso: string;
  key: string;
  title: string | null;
  type: RiskType;
  owner: string;
  severity: Severity;
  mitigation: string | null;
  status: RiskStatus;
  linkedProject: string | null;
  linkedRepo: string | null;
  linkedDecision: string | null;
  linkedEvidence: string | null;
}

export interface RiskRegisterStore {
  put(record: RiskRecord): Promise<RiskRecord>;
  getLatest(key: string): Promise<RiskRecord | null>;
  history(key: string): Promise<RiskRecord[]>;
  list(): Promise<RiskRecord[]>; // latest snapshot per risk
}

export class RiskValidationError extends Error {
  constructor(public readonly errors: string[]) {
    super(`invalid risk:\n- ${errors.join('\n- ')}`);
    this.name = 'RiskValidationError';
  }
}

/** The core surfacer: unmitigated high/critical OPEN risks are blocking — never buried. */
export function surfaceBlockingRisks(risks: RiskRecord[]): RiskRecord[] {
  return (risks ?? []).filter((r) => (r.severity === 'high' || r.severity === 'critical') && r.status === 'open');
}
export function hasBlockingRisks(risks: RiskRecord[]): boolean {
  return surfaceBlockingRisks(risks).length > 0;
}

export class RiskRegister {
  constructor(private readonly now: () => number = () => Date.now()) {}

  validate(input: RiskInput): { ok: true } | { ok: false; errors: string[] } {
    const errors: string[] = [];
    if (!input?.key?.trim()) errors.push('key is required');
    if (!input?.owner?.trim()) errors.push('owner is required');
    if (!(RISK_TYPES as readonly string[]).includes(input?.type)) errors.push(`type must be one of the §31 risk types (got: ${String(input?.type)})`);
    if (!SEVERITIES.has(input?.severity)) errors.push('severity must be one of low | medium | high | critical');
    if (!STATUSES.has(input?.status)) errors.push('status must be one of open | mitigating | accepted | closed');
    return errors.length === 0 ? { ok: true } : { ok: false, errors };
  }

  private toRecord(input: RiskInput): RiskRecord {
    return {
      registeredAtIso: new Date(this.now()).toISOString(),
      key: input.key, title: input.title ?? null, type: input.type, owner: input.owner, severity: input.severity,
      mitigation: input.mitigation ?? null, status: input.status,
      linkedProject: input.linkedProject ?? null, linkedRepo: input.linkedRepo ?? null,
      linkedDecision: input.linkedDecision ?? null, linkedEvidence: input.linkedEvidence ?? null,
    };
  }

  async register(store: RiskRegisterStore, input: RiskInput): Promise<RiskRecord> {
    const v = this.validate(input);
    if (!v.ok) throw new RiskValidationError(v.errors);
    return store.put(this.toRecord(input));
  }

  /** Status transition as a new append-only snapshot. */
  async transitionStatus(store: RiskRegisterStore, key: string, newStatus: RiskStatus, mitigation?: string): Promise<RiskRecord> {
    if (!STATUSES.has(newStatus)) throw new RiskValidationError([`invalid status: ${String(newStatus)}`]);
    const latest = await store.getLatest(key);
    if (!latest) throw new RiskValidationError([`risk "${key}" is not registered`]);
    return store.put({ ...latest, recordId: undefined, registeredAtIso: new Date(this.now()).toISOString(), status: newStatus, mitigation: mitigation ?? latest.mitigation });
  }
}
