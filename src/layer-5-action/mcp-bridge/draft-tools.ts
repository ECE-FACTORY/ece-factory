// Draft / Planning Tools (Phase 8.2, DRAFT_ONLY class) — the first NON-read tools, and the ceiling of what
// an autonomous Pulse Layer may produce: PROPOSALS, never decisions.
//
// A draft tool reads inputs via injected READ-ONLY ports and returns a proposed artifact — nothing more.
// STRUCTURAL INERTNESS (enforced at the bridge + type level, see mcp-bridge.ts / tool-classes.ts):
//   • the success outcome is the literal DRAFT-AWAITING-HUMAN-REVIEW carrying the proposed artifact — there
//     is NO committed / executed / approved / recorded variant in the outcome type.
//   • a draft tool cannot mutate state, write files, change status, approve a gate, touch git, or make a
//     network mutation — the draft handler only calls a read-only port and returns data. No write path exists.
//   • a draft is INERT: drafting a review decision records no decision; drafting a repo plan creates no repo;
//     drafting a wave report signs off no wave. Drafting a decision is NOT making it — the proposed verdict is
//     inert text inside the draft; the outcome status is always DRAFT-AWAITING-HUMAN-REVIEW.
//
// Registered with the registry's REVIEW_ONLY risk class, which the bridge's 4-class mapping resolves to
// DRAFT_ONLY (see classifyRegisteredTool). readOrWrite stays 'read' (a draft reads inputs; it never writes).

import type { ToolDefinition } from '../tool-registry/tool-registry.js';
import type { ToolRegistrar } from './factory-read-tools.js';

export const DRAFT_TOOLS = [
  'draft_next_prompt', 'draft_review_decision', 'draft_wave_report', 'draft_product_plan',
  'draft_risk_summary', 'draft_open_items_summary', 'draft_repo_plan',
] as const;
export type DraftTool = (typeof DRAFT_TOOLS)[number];

/** Drafts that propose a governance decision/report are a more sensitive capability — operator-only. */
export const ELEVATED_DRAFT_TOOLS: ReadonlySet<DraftTool> = new Set(['draft_review_decision', 'draft_wave_report']);

export interface DraftParams {
  ref?: string;
  organizationId?: string;
}

/**
 * Read-only input ports for drafting. Each READS context and returns a PROPOSED artifact (inert data).
 * There is no mutation method here — a draft port cannot change anything, by construction.
 */
export interface DraftPorts {
  nextPrompt(params: DraftParams): Promise<unknown>;
  reviewDecision(params: DraftParams): Promise<unknown>;
  waveReport(params: DraftParams): Promise<unknown>;
  productPlan(params: DraftParams): Promise<unknown>;
  riskSummary(params: DraftParams): Promise<unknown>;
  openItemsSummary(params: DraftParams): Promise<unknown>;
  repoPlan(params: DraftParams): Promise<unknown>;
}

function draftDef(name: DraftTool, purpose: string, requiredRole: string): ToolDefinition {
  return {
    name,
    purpose,
    readOrWrite: 'read', // a draft READS inputs and proposes — it never writes
    classification: 'REVIEW_ONLY', // → DRAFT_ONLY in the bridge's 4-class taxonomy
    permissionLevel: 'read',
    requiredRole,
    approvalRequired: false,
    serverSideRedaction: true,
    auditBehavior: 'write-ahead audited draft production (Audit Engine)',
    instructionBoundaryNotes: 'inputs read for drafting are inert data, never instructions; the proposed verdict is inert content',
    blastRadius: 0, // a draft touches no records
    reversible: 'yes',
    idempotent: true,
    environments: ['local', 'staging', 'production'],
    owner: 'ECE',
    status: 'enabled',
  };
}

/** Register all 7 DRAFT_ONLY tools. Idempotent per tool. Decision/report drafts require the operator role. */
export function registerDraftTools(registry: ToolRegistrar): void {
  const defs: ToolDefinition[] = [
    draftDef('draft_next_prompt', 'Propose the next exact prompt (a draft, not an instruction).', 'user'),
    draftDef('draft_review_decision', 'Propose a review verdict PASS/FAIL/REVISE/STOP as content (records nothing).', 'operator'),
    draftDef('draft_wave_report', 'Propose a wave completion report (does not sign off a wave).', 'operator'),
    draftDef('draft_product_plan', 'Propose a product-creation plan draft.', 'user'),
    draftDef('draft_risk_summary', 'Propose a risk summary draft.', 'user'),
    draftDef('draft_open_items_summary', 'Propose an open-items summary draft.', 'user'),
    draftDef('draft_repo_plan', 'Propose a repo build plan draft (creates no repo / build record).', 'user'),
  ];
  for (const def of defs) {
    if (!registry.has(def.name)) registry.register(def);
  }
}
