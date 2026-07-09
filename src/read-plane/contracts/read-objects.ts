// The read objects the Factory State API returns (Design §2.2). Operational STATUS fields are `provenanced(...)`
// — never bare. Parsed report CONTENT (scores/candidates) is descriptive and is wrapped as a unit at the API
// boundary (one report-file provenance), since every field of one report shares the same file + sha256.

import { z } from 'zod';
import { provenanced } from './provenance.js';
import { DecisionBadge, EvidenceBadge, LawBadge, CapabilityBadge, LicenseDecisionBadge, ScoreBandBadge, ProductModeBadge } from './badges.js';

// ── Parsed harvest-report content (descriptive; wrapped in provenance at the ReportAdapter boundary) ─────────
export const DimensionSignal = z.object({
  dimension: z.string(),          // e.g. 'maintainability', 'air-gap'
  value: z.string(),              // e.g. 'maintainable', 'unknown'
  confidence: EvidenceBadge,      // meas → measured · part → partial · n/m → not-mechanizable
  delta: z.number(),              // the enrichment contribution (+N)
});
export type DimensionSignal = z.infer<typeof DimensionSignal>;

export const Candidate = z.object({
  identity: z.object({ host: z.string(), owner: z.string(), name: z.string() }),
  repoUrl: z.string(),
  license: z.object({ detected: z.string(), decision: LicenseDecisionBadge, disagreement: z.boolean() }),
  eligibility: z.enum(['eligible', 'not-eligible', 'needs-review']),
  score: z.object({ total: z.number(), band: ScoreBandBadge }),
  dimensions: z.array(DimensionSignal),
});
export type Candidate = z.infer<typeof Candidate>;

/** The evidence split the report already structures — facts vs measured vs judgment vs unknown vs human-required. */
export const EvidenceBuckets = z.object({
  facts: z.array(z.string()),        // license / eligibility / identity observations
  measured: z.array(DimensionSignal),   // confidence 'measured'
  judgments: z.array(DimensionSignal),  // confidence 'partial' (bounded)
  unknowns: z.array(DimensionSignal),   // confidence 'not-mechanizable'
  humanRequired: z.array(z.string()),   // HUMAN APPROVAL REQUIRED lines
});
export type EvidenceBuckets = z.infer<typeof EvidenceBuckets>;

export const SubDomainResult = z.object({
  key: z.string(),
  title: z.string(),
  query: z.string(),
  decision: DecisionBadge,
  spine: Candidate.nullable(),
  candidates: z.array(Candidate),
  unmeasured: z.array(z.string()),
  evidence: z.array(z.string()),
  buckets: EvidenceBuckets,
});
export type SubDomainResult = z.infer<typeof SubDomainResult>;

export const HarvestReport = z.object({
  domain: z.string(),
  productMode: ProductModeBadge,
  generatedAtIso: z.string(),
  sourceFile: z.string(),
  contentSha256: z.string(),
  status: z.literal('STOP-AWAITING-HUMAN-APPROVAL'),
  subDomains: z.array(SubDomainResult),
  parseIssues: z.array(z.string()),   // parse-inconsistency flags — surfaced, never reconciled
});
export type HarvestReport = z.infer<typeof HarvestReport>;

/** A report descriptor for the list endpoint. */
export const Run = z.object({
  domain: z.string(),
  productMode: ProductModeBadge,
  reportPath: z.string(),
  generatedAtIso: z.string(),
  verdicts: z.object({ FORK: z.number(), EXTEND: z.number(), BUILD: z.number(), 'NEEDS-ASSESSMENT': z.number() }),
});
export type Run = z.infer<typeof Run>;

// ── Operational state objects — every field `provenanced(...)` ──────────────────────────────────────────────
export const GitLogEntry = z.object({ sha: z.string(), subject: z.string(), author: z.string(), iso: z.string() });
export type GitLogEntry = z.infer<typeof GitLogEntry>;

export const GitStateSchema = z.object({
  head: provenanced(z.string()),
  branch: provenanced(z.string()),
  dirty: provenanced(z.boolean()),
  recent: provenanced(z.array(GitLogEntry)),
});
export type GitState = z.infer<typeof GitStateSchema>;

export const Prohibition = z.object({ id: z.string(), title: z.string(), status: LawBadge });
export type Prohibition = z.infer<typeof Prohibition>;

export const LawTestRunSchema = z.object({
  suite: z.string(),                          // descriptive label (which suites)
  prohibitions: provenanced(z.array(Prohibition)),
  passed: provenanced(z.number()),
  failed: provenanced(z.number()),
});
export type LawTestRun = z.infer<typeof LawTestRunSchema>;

export const TestSuiteRunSchema = z.object({
  total: provenanced(z.number()),
  passed: provenanced(z.number()),
  failed: provenanced(z.number()),
  skipped: provenanced(z.number()),
  failing: provenanced(z.array(z.object({ file: z.string(), name: z.string() }))),
  dirty: provenanced(z.boolean()),
});
export type TestSuiteRun = z.infer<typeof TestSuiteRunSchema>;

export const CapabilityStateSchema = z.object({
  sandboxJailPrefix: provenanced(z.string()),
  toolClasses: provenanced(z.array(z.string())),
  writeTools: provenanced(z.array(z.string())),
  seamTools: provenanced(z.array(z.string())),
  confirmToken: provenanced(z.string()),
  mintPrivacy: provenanced(z.object({ status: CapabilityBadge, proof: z.string() })),
});
export type CapabilityState = z.infer<typeof CapabilityStateSchema>;

/** Store snapshot shape (present branch): chain length + the last record's payload (null when empty). */
export const StoreSnapshot = z.object({ count: z.number(), latest: z.unknown().nullable() });
export type StoreSnapshot = z.infer<typeof StoreSnapshot>;

/** A read-view of one evidence-index record (a light mirror — the read plane does not import factory-persistence). */
export const EvidenceEntry = z.object({ kind: z.string(), ref: z.string(), sha256: z.string().optional(), usedBy: z.array(z.string()), atIso: z.string() });
export type EvidenceEntry = z.infer<typeof EvidenceEntry>;
export const EvidenceIndexSchema = provenanced(z.array(EvidenceEntry));
export type EvidenceIndex = z.infer<typeof EvidenceIndexSchema>;

export const StoreStateSchema = z.object({
  approvals: provenanced(StoreSnapshot),
  audit: provenanced(StoreSnapshot),
  executions: provenanced(StoreSnapshot),
});
export type StoreState = z.infer<typeof StoreStateSchema>;

// ── The response envelope — pins the whole response to a commit ─────────────────────────────────────────────
export const EnvelopeMeta = z.object({ apiVersion: z.string(), head: z.string(), generatedAt: z.string() });
export type EnvelopeMeta = z.infer<typeof EnvelopeMeta>;

export function envelope<T extends z.ZodTypeAny>(data: T) {
  return z.object({ data, meta: EnvelopeMeta });
}
export type FactoryStateEnvelope<T> = { data: T; meta: EnvelopeMeta };
