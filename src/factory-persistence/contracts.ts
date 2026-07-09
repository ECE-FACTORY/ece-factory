// M3 payload schemas — the typed events the emitters persist (Design §1/§2). Additive to the M2 read-plane
// contracts; reuses the M2 badge unions where they align (decision, license, mode) so the read plane can render
// stored records with the same chips. No change to any M2 schema.

import { z } from 'zod';
import { DecisionBadge, LicenseDecisionBadge, ProductModeBadge } from '../read-plane/contracts/index.js';

/** approvals.jsonl — the gate/seam approval lifecycle. */
export const ApprovalEvent = z.object({
  event: z.enum(['requested', 'approved', 'rejected', 'expired', 'consumed']),
  actionId: z.string(),
  approvalId: z.string().optional(),        // present once minted/consumed
  tool: z.string(),
  target: z.string().optional(),
  boundIntentHash: z.string().optional(),
  approver: z.string().optional(),          // the real human — never 'claude'
  reason: z.string().optional(),
  atIso: z.string(),
});
export type ApprovalEvent = z.infer<typeof ApprovalEvent>;

/** audit.jsonl — every factory event (a broad, open-ended kind + a correlation id where one exists). */
export const AuditEvent = z.object({
  event: z.string(),                        // 'enqueued' | 'approved' | 'refused' | 'decision-assembled' | 'plan-created' | 'planned-write' | 'files-written' | 'persist-failure' | …
  actionId: z.string().optional(),
  approvalId: z.string().optional(),
  tool: z.string().optional(),
  productMode: ProductModeBadge.optional(),
  decision: DecisionBadge.optional(),
  detail: z.string().optional(),
  atIso: z.string(),
});
export type AuditEvent = z.infer<typeof AuditEvent>;

/** executions.jsonl — one real sandbox run + the file-hash manifest (sha256 of each written file, post-write). */
export const ExecutionRecord = z.object({
  status: z.enum(['written', 'refused', 'error']),
  basePath: z.string(),
  approvalId: z.string().optional(),
  boundIntentHash: z.string().optional(),
  created: z.array(z.object({ path: z.string(), kind: z.enum(['dir', 'file']) })),
  manifest: z.array(z.object({ path: z.string(), sha256: z.string() })),  // files only
  reason: z.string().optional(),
  atIso: z.string(),
});
export type ExecutionRecord = z.infer<typeof ExecutionRecord>;

/** evidence-index.jsonl — evidence refs with content hashes + used-by links (feeds the future lineage graph). */
export const EvidenceRef = z.object({
  kind: z.enum(['report', 'decision', 'build-plan', 'execution-manifest', 'license']),
  ref: z.string(),                          // a path, an approvalId, a repo url, …
  sha256: z.string().optional(),
  license: LicenseDecisionBadge.optional(),
  usedBy: z.array(z.string()),              // ids/refs that consumed this evidence
  atIso: z.string(),
});
export type EvidenceRef = z.infer<typeof EvidenceRef>;
