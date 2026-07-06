// External-Action Tools (Phase 8.4, the hardest gates) — the first tools that act on systems OUTSIDE the
// factory (git/GitHub, CRM, email, deploy). They are APPROVAL_REQUIRED_WRITE but FLAGGED external: because
// the blast radius leaves the factory, they carry every Phase 8.3 guarantee PLUS external-action hardening
// (exact-target+effect approval, no bulk, production gate, blast-radius in the audit record). Real wiring is
// a deployment concern downstream of the human gate — here the external systems are INJECTED PORTS.
//
// The FORBIDDEN tier activates here: prohibited actions are never callable — refused before any approval is
// even considered. The kill switch and the audit log can never be the target of an external action.

import type { ToolDefinition } from '../tool-registry/tool-registry.js';
import type { ToolRegistrar } from './factory-read-tools.js';

export const EXTERNAL_TOOLS = [
  'create_github_repo', 'open_pull_request', 'create_ticket', 'update_crm_record', 'send_email', 'deploy_package',
  'create_milestone', 'create_label', 'create_issue_batch',
] as const;
export type ExternalTool = (typeof EXTERNAL_TOOLS)[number];

/** FORBIDDEN tier — irreversible/prohibited actions. NEVER callable; refused before any approval. */
export const FORBIDDEN_TOOLS = [
  'force_delete_repo', 'rewrite_git_history', 'mass_delete', 'disable_audit', 'disable_kill_switch', 'bulk_export_pii',
] as const;
export type ForbiddenTool = (typeof FORBIDDEN_TOOLS)[number];

/** Deploy / repo-creation are the highest-authority external acts — admin-only (per-tool permissioning). */
export const ELEVATED_EXTERNAL_TOOLS: ReadonlySet<ExternalTool> = new Set(['deploy_package', 'create_github_repo']);

/** The precise external target + the specific effect the human approves. Vague/target-less ⇒ refused. */
export interface ExternalTarget {
  system: string; // 'github' | 'crm' | 'email' | 'deploy' | 'tickets' …
  targetId: string; // the exact target: repo "ECE-FACTORY/x", email addr, package id, ticket key …
  environment?: string; // 'dev' | 'staging' | 'production'
  effect: string; // human-readable specific effect, e.g. "create repo ECE-FACTORY/x private"
  reversible: 'yes' | 'no' | 'soft-only';
}

export interface ExternalParams {
  approvalActionId?: string;
  target?: ExternalTarget;
  payload?: Record<string, unknown>;
  /** If present, a multi-target request — BULK ⇒ refused (one approval = one external effect). */
  targets?: ExternalTarget[];
}

/** A record of what the external port did (or, in tests, would have done). */
export type ExternalResult = Record<string, unknown>;

/**
 * Injected external systems. In tests these are fakes that RECORD what would have happened (no real side
 * effects). Each acts on EXACTLY ONE target. No method deletes or rewrites history — destruction is FORBIDDEN.
 */
export interface ExternalSystems {
  createGithubRepo(target: ExternalTarget, payload?: Record<string, unknown>): Promise<ExternalResult>;
  openPullRequest(target: ExternalTarget, payload?: Record<string, unknown>): Promise<ExternalResult>;
  createTicket(target: ExternalTarget, payload?: Record<string, unknown>): Promise<ExternalResult>;
  updateCrmRecord(target: ExternalTarget, payload?: Record<string, unknown>): Promise<ExternalResult>;
  sendEmail(target: ExternalTarget, payload?: Record<string, unknown>): Promise<ExternalResult>;
  deployPackage(target: ExternalTarget, payload?: Record<string, unknown>): Promise<ExternalResult>;
  createMilestone(target: ExternalTarget, payload?: Record<string, unknown>): Promise<ExternalResult>;
  createLabel(target: ExternalTarget, payload?: Record<string, unknown>): Promise<ExternalResult>;
  /** Gated bulk: `payload.issues` is a FULLY-ENUMERATED, bounded, content-bound list (one approval = exactly this set). */
  createIssueBatch(target: ExternalTarget, payload?: Record<string, unknown>): Promise<ExternalResult>;
}

/** Hard cap on a single content-bound issue batch — a batch cannot be an unbounded bulk vector. */
export const MAX_ISSUE_BATCH = 15;

/** Production/sensitive environments require the approval to name them explicitly. */
export const PRODUCTION_ENVIRONMENTS: ReadonlySet<string> = new Set(['production', 'prod', 'sensitive']);
export function isProductionTarget(target?: ExternalTarget): boolean {
  return !!target?.environment && PRODUCTION_ENVIRONMENTS.has(target.environment.toLowerCase());
}

/** The kill switch and the audit log can NEVER be the target of an external action. */
export function targetsProtectedSubsystem(target?: ExternalTarget): boolean {
  if (!target) return false;
  const hay = `${target.system} ${target.targetId} ${target.effect}`.toLowerCase();
  return /audit|kill[\s_-]?switch/.test(hay);
}

function externalDef(name: ExternalTool, purpose: string, requiredRole: string): ToolDefinition {
  return {
    name,
    purpose,
    readOrWrite: 'write', // → APPROVAL_REQUIRED_WRITE; flagged external via the EXTERNAL_TOOLS set
    classification: 'WRITE_MEDIUM_RISK',
    permissionLevel: 'write',
    requiredRole,
    approvalRequired: false, // the single-use ConsumedApproval token is the gate (per-action, enforced at dispatch)
    serverSideRedaction: true,
    auditBehavior: 'write-ahead audited external action (blast-radius recorded: system/id/env/reversibility)',
    instructionBoundaryNotes: 'payload is inert; the action requires a specific-target, human-approved token',
    blastRadius: 1, // exactly one external target per approved action — no bulk
    reversible: 'soft-only',
    idempotent: false,
    environments: ['local', 'staging', 'production'],
    owner: 'ECE',
    status: 'enabled',
  };
}

function forbiddenDef(name: ForbiddenTool, purpose: string): ToolDefinition {
  return {
    name,
    purpose: `FORBIDDEN — ${purpose}`,
    readOrWrite: 'write',
    classification: 'DESTRUCTIVE_ACTION', // → FORBIDDEN in the bridge's 4-class taxonomy
    permissionLevel: 'forbidden',
    requiredRole: 'nobody',
    approvalRequired: true,
    serverSideRedaction: true,
    auditBehavior: 'never executes — refused before any approval',
    blastRadius: 1,
    reversible: 'no',
    idempotent: false,
    environments: ['local', 'staging', 'production'],
    owner: 'ECE',
    status: 'enabled',
  };
}

/** Register the 9 external-action tools. Deploy/repo-creation are admin-only. Idempotent per tool. */
export function registerExternalTools(registry: ToolRegistrar): void {
  const defs: ToolDefinition[] = [
    externalDef('create_github_repo', 'Create a GitHub repository (one repo).', 'admin'),
    externalDef('open_pull_request', 'Open a pull request (one PR).', 'operator'),
    externalDef('create_ticket', 'Create a ticket (one ticket).', 'operator'),
    externalDef('update_crm_record', 'Update one CRM record.', 'operator'),
    externalDef('send_email', 'Send one email.', 'operator'),
    externalDef('deploy_package', 'Deploy one package to one environment.', 'admin'),
    externalDef('create_milestone', 'Create one milestone in one repo.', 'operator'),
    externalDef('create_label', 'Create one label in one repo.', 'operator'),
    externalDef('create_issue_batch', 'Create a bounded, content-bound batch of issues in one repo (one approval = exactly this enumerated set).', 'operator'),
  ];
  for (const def of defs) if (!registry.has(def.name)) registry.register(def);
}

/** Register the FORBIDDEN tools so they are classified (and surfaced as) FORBIDDEN — never callable. */
export function registerForbiddenTools(registry: ToolRegistrar): void {
  const defs: ToolDefinition[] = [
    forbiddenDef('force_delete_repo', 'force-delete a repository'),
    forbiddenDef('rewrite_git_history', 'rewrite git history'),
    forbiddenDef('mass_delete', 'mass/bulk delete'),
    forbiddenDef('disable_audit', 'disable the audit log'),
    forbiddenDef('disable_kill_switch', 'disable the kill switch'),
    forbiddenDef('bulk_export_pii', 'bulk-export PII'),
  ];
  for (const def of defs) if (!registry.has(def.name)) registry.register(def);
}
