// Project Registry (Module 5) — every project repo in the org (blueprint §5 / §5.4 status vocabulary).
//
// DENY-BY-DEFAULT: a project missing required fields ⇒ rejected; a project must reference a REGISTERED
// domain (resolved via an injected DomainLookup). HARVEST-BEFORE-BUILD GATE: no project enters "In build"
// unless its harvestApprovalStatus is "approved" — the doctrine enforced at the registry, structurally.
//
// Persistence is append-only (the record of what was registered when, and the build gate, cannot be
// silently rewritten). STANDALONE-PACKAGEABLE: the only cross-engine reference is `import type` (the
// Domain Registry summary); the domain lookup is injected.

import type { DomainSummary } from '../domain-registry/domain-registry.js';

export type ProjectStatus =
  | 'Phase 0 inspection' | 'Phase 1 build' | 'Harvest pending' | 'Harvest approved'
  | 'In build' | 'In review' | 'Live' | 'Paused' | 'Deprecated';
export type HarvestApprovalStatus = 'not-started' | 'pending' | 'approved' | 'rejected';

export const PROJECT_STATUSES: readonly ProjectStatus[] = [
  'Phase 0 inspection', 'Phase 1 build', 'Harvest pending', 'Harvest approved', 'In build', 'In review', 'Live', 'Paused', 'Deprecated',
];
const HARVEST_STATUSES = new Set<string>(['not-started', 'pending', 'approved', 'rejected']);

export interface ProjectInput {
  project: string;
  repo: string;
  domain: string; // must reference a registered domain
  purpose: string;
  owner: string;
  stack: string;
  deployment: string;
  status?: ProjectStatus; // defaults to 'Phase 0 inspection'
  maturity?: string;
  openRisks?: string[];
  lastReviewDecision?: string;
  nextGate?: string;
  harvestApprovalStatus: HarvestApprovalStatus;
}

export interface ProjectRecord {
  recordId?: string;
  registeredAtIso: string;
  project: string;
  repo: string;
  domain: string;
  purpose: string;
  owner: string;
  stack: string;
  deployment: string;
  status: ProjectStatus;
  maturity: string | null;
  openRisks: string[];
  lastReviewDecision: string | null;
  nextGate: string | null;
  harvestApprovalStatus: HarvestApprovalStatus;
}

/** Injected: resolve a domain name to its summary, or null if not registered. */
export type DomainLookup = (name: string) => Promise<DomainSummary | null>;

export interface ProjectRegistryStore {
  put(record: ProjectRecord): Promise<ProjectRecord>;
  getLatest(project: string): Promise<ProjectRecord | null>;
  history(project: string): Promise<ProjectRecord[]>;
  list(): Promise<ProjectRecord[]>;
}

export class ProjectValidationError extends Error {
  constructor(public readonly errors: string[]) {
    super(`invalid project registration:\n- ${errors.join('\n- ')}`);
    this.name = 'ProjectValidationError';
  }
}

export interface GateView {
  project: string;
  currentPhase: ProjectStatus;
  harvestApprovalStatus: HarvestApprovalStatus;
  clearedToBuild: boolean;
  reason: string;
}

export function gateView(r: ProjectRecord): GateView {
  const cleared = r.harvestApprovalStatus === 'approved';
  return {
    project: r.project,
    currentPhase: r.status,
    harvestApprovalStatus: r.harvestApprovalStatus,
    clearedToBuild: cleared,
    reason: cleared ? 'harvest approved — cleared to build' : `not cleared to build — harvest approval is "${r.harvestApprovalStatus}" (no build without an approved Harvest Report)`,
  };
}

export class ProjectRegistry {
  constructor(private readonly now: () => number = () => Date.now()) {}

  /** Pure field/status/gate validation (deny-by-default). Does NOT check the domain (async, see register). */
  validate(input: ProjectInput): { ok: true } | { ok: false; errors: string[] } {
    const errors: string[] = [];
    for (const f of ['project', 'repo', 'domain', 'purpose', 'owner', 'stack', 'deployment'] as const) {
      if (!input?.[f]?.toString().trim()) errors.push(`${f} is required`);
    }
    if (!HARVEST_STATUSES.has(input?.harvestApprovalStatus)) errors.push('harvestApprovalStatus must be one of not-started | pending | approved | rejected');
    const status = input?.status ?? 'Phase 0 inspection';
    if (!(PROJECT_STATUSES as readonly string[]).includes(status)) errors.push(`invalid status: ${String(input?.status)}`);
    // Harvest-before-build gate at registration time.
    if (status === 'In build' && input?.harvestApprovalStatus !== 'approved') {
      errors.push('cannot register/transition to "In build" without harvestApprovalStatus = "approved" (harvest-before-build)');
    }
    return errors.length === 0 ? { ok: true } : { ok: false, errors };
  }

  private toRecord(input: ProjectInput, status: ProjectStatus): ProjectRecord {
    return {
      registeredAtIso: new Date(this.now()).toISOString(),
      project: input.project, repo: input.repo, domain: input.domain, purpose: input.purpose,
      owner: input.owner, stack: input.stack, deployment: input.deployment, status,
      maturity: input.maturity ?? null, openRisks: input.openRisks ?? [],
      lastReviewDecision: input.lastReviewDecision ?? null, nextGate: input.nextGate ?? null,
      harvestApprovalStatus: input.harvestApprovalStatus,
    };
  }

  /** Validate (incl. domain-registered check) and persist append-only. Rejects half-formed projects. */
  async register(store: ProjectRegistryStore, lookup: DomainLookup, input: ProjectInput): Promise<ProjectRecord> {
    const v = this.validate(input);
    if (!v.ok) throw new ProjectValidationError(v.errors);
    const domain = await lookup(input.domain);
    if (!domain) throw new ProjectValidationError([`domain "${input.domain}" is not a registered domain`]);
    return store.put(this.toRecord(input, input.status ?? 'Phase 0 inspection'));
  }

  /** Transition status as a new append-only snapshot. Blocks "In build" without harvest approval. */
  async transitionStatus(store: ProjectRegistryStore, project: string, newStatus: ProjectStatus): Promise<ProjectRecord> {
    if (!(PROJECT_STATUSES as readonly string[]).includes(newStatus)) throw new ProjectValidationError([`invalid status: ${String(newStatus)}`]);
    const latest = await store.getLatest(project);
    if (!latest) throw new ProjectValidationError([`project "${project}" is not registered`]);
    if (newStatus === 'In build' && latest.harvestApprovalStatus !== 'approved') {
      throw new ProjectValidationError(['cannot transition to "In build" without an approved Harvest Report (harvest-before-build)']);
    }
    return store.put({ ...latest, recordId: undefined, registeredAtIso: new Date(this.now()).toISOString(), status: newStatus });
  }

  /** Record a harvest-approval change as a new append-only snapshot. */
  async setHarvestApproval(store: ProjectRegistryStore, project: string, harvestApprovalStatus: HarvestApprovalStatus): Promise<ProjectRecord> {
    if (!HARVEST_STATUSES.has(harvestApprovalStatus)) throw new ProjectValidationError([`invalid harvestApprovalStatus: ${String(harvestApprovalStatus)}`]);
    const latest = await store.getLatest(project);
    if (!latest) throw new ProjectValidationError([`project "${project}" is not registered`]);
    const status: ProjectStatus = harvestApprovalStatus === 'approved' && latest.status === 'Harvest pending' ? 'Harvest approved' : latest.status;
    return store.put({ ...latest, recordId: undefined, registeredAtIso: new Date(this.now()).toISOString(), harvestApprovalStatus, status });
  }
}
