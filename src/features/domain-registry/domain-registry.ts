// Domain Registry (Module 4) — the typed registry of the domains the factory processes (§4.1).
//
// VALIDATION / DENY-BY-DEFAULT: a domain missing a required field (no business objective, no
// sovereignty/air-gap/Arabic-first classification) is REJECTED, never stored half-formed. "Unknown"
// is not a valid sovereignty/air-gap state for a sovereign-market domain — it must be explicitly set.
//
// Persistence is append-only (institutional memory; the history of what was registered when cannot be
// silently rewritten). STANDALONE-PACKAGEABLE: imports NOTHING from any other engine.

export type SovereigntyRequirement = 'sovereign' | 'non-sovereign';
export type AirGapRequirement = 'required' | 'optional' | 'not-required';
export type ArabicFirstRequirement = 'required' | 'optional' | 'not-required';
export type RiskLevel = 'low' | 'medium' | 'high';
export type DomainStatus = 'idea' | 'registered' | 'harvesting' | 'in-build' | 'productized' | 'live' | 'deprecated';

export const DOMAIN_STATUSES: readonly DomainStatus[] = ['idea', 'registered', 'harvesting', 'in-build', 'productized', 'live', 'deprecated'];

export interface DomainInput {
  name: string;
  businessObjective: string;
  sovereignty: SovereigntyRequirement;
  airGap: AirGapRequirement;
  arabicFirst: ArabicFirstRequirement;
  owner: string;
  riskLevel: RiskLevel;
  status?: DomainStatus; // defaults to 'registered'
  subDomains?: string[];
  targetClients?: string[];
  linkedHarvestRef?: string;
  linkedProjectRefs?: string[];
}

export interface DomainRecord {
  recordId?: string;
  registeredAtIso: string;
  name: string;
  businessObjective: string;
  sovereignty: SovereigntyRequirement;
  airGap: AirGapRequirement;
  arabicFirst: ArabicFirstRequirement;
  owner: string;
  riskLevel: RiskLevel;
  status: DomainStatus;
  subDomains: string[];
  targetClients: string[];
  linkedHarvestRef: string | null;
  linkedProjectRefs: string[];
}

export interface DomainRegistryStore {
  put(record: DomainRecord): Promise<DomainRecord>;
  getLatest(name: string): Promise<DomainRecord | null>;
  history(name: string): Promise<DomainRecord[]>;
  list(): Promise<DomainRecord[]>; // latest snapshot per domain
}

export class DomainValidationError extends Error {
  constructor(public readonly errors: string[]) {
    super(`invalid domain registration:\n- ${errors.join('\n- ')}`);
    this.name = 'DomainValidationError';
  }
}

/** Exactly what the Project Registry / Product Creation engines consume from a domain. */
export interface DomainSummary {
  name: string;
  sovereignty: SovereigntyRequirement;
  airGap: AirGapRequirement;
  arabicFirst: ArabicFirstRequirement;
  status: DomainStatus;
  subDomains: string[];
}
export function domainSummary(r: DomainRecord): DomainSummary {
  return { name: r.name, sovereignty: r.sovereignty, airGap: r.airGap, arabicFirst: r.arabicFirst, status: r.status, subDomains: r.subDomains };
}

const SOVEREIGNTY = new Set<string>(['sovereign', 'non-sovereign']);
const AIRGAP = new Set<string>(['required', 'optional', 'not-required']);
const RISK = new Set<string>(['low', 'medium', 'high']);

export class DomainRegistry {
  constructor(private readonly now: () => number = () => Date.now()) {}

  /** Pure validation — deny-by-default on any missing/invalid required field. */
  validate(input: DomainInput): { ok: true } | { ok: false; errors: string[] } {
    const errors: string[] = [];
    if (!input?.name?.trim()) errors.push('name is required');
    if (!input?.businessObjective?.trim()) errors.push('businessObjective is required');
    if (!SOVEREIGNTY.has(input?.sovereignty)) errors.push('sovereignty must be explicitly set (sovereign | non-sovereign) — unknown is not valid');
    if (!AIRGAP.has(input?.airGap)) errors.push('airGap must be explicitly set (required | optional | not-required)');
    if (!AIRGAP.has(input?.arabicFirst)) errors.push('arabicFirst must be explicitly set (required | optional | not-required)');
    if (!input?.owner?.trim()) errors.push('owner is required');
    if (!RISK.has(input?.riskLevel)) errors.push('riskLevel must be one of low | medium | high');
    if (input?.status !== undefined && !(DOMAIN_STATUSES as readonly string[]).includes(input.status)) errors.push(`invalid status: ${String(input.status)}`);
    return errors.length === 0 ? { ok: true } : { ok: false, errors };
  }

  private toRecord(input: DomainInput, status: DomainStatus): DomainRecord {
    return {
      registeredAtIso: new Date(this.now()).toISOString(),
      name: input.name,
      businessObjective: input.businessObjective,
      sovereignty: input.sovereignty,
      airGap: input.airGap,
      arabicFirst: input.arabicFirst,
      owner: input.owner,
      riskLevel: input.riskLevel,
      status,
      subDomains: input.subDomains ?? [],
      targetClients: input.targetClients ?? [],
      linkedHarvestRef: input.linkedHarvestRef ?? null,
      linkedProjectRefs: input.linkedProjectRefs ?? [],
    };
  }

  /** Validate and persist (append-only). Rejects (throws) a half-formed domain — nothing is stored. */
  async register(store: DomainRegistryStore, input: DomainInput): Promise<DomainRecord> {
    const v = this.validate(input);
    if (!v.ok) throw new DomainValidationError(v.errors);
    return store.put(this.toRecord(input, input.status ?? 'registered'));
  }

  /** Record a status transition as a NEW append-only snapshot (history preserved). */
  async transitionStatus(store: DomainRegistryStore, name: string, newStatus: DomainStatus): Promise<DomainRecord> {
    if (!(DOMAIN_STATUSES as readonly string[]).includes(newStatus)) throw new DomainValidationError([`invalid status: ${String(newStatus)}`]);
    const latest = await store.getLatest(name);
    if (!latest) throw new DomainValidationError([`domain "${name}" is not registered`]);
    const next: DomainRecord = { ...latest, recordId: undefined, registeredAtIso: new Date(this.now()).toISOString(), status: newStatus };
    return store.put(next);
  }
}
