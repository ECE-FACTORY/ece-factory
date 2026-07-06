// Factory Read Tools (Phase 8.1, Part B) — 15 READ_ONLY tools exposing factory/governance state through
// the MCP Bridge's full guard stack. NO "internal = safe" exemption: a read of governance state (the
// audit summary, the review log, the tool map) is itself a real capability — registered, permissioned,
// audited, and redacted exactly like a system-of-record read.
//
// Every port here is a READ-ONLY consumer of an existing engine/registry/log. There is no mutation method
// on any port — read-only by construction.

import type { ToolDefinition } from '../tool-registry/tool-registry.js';
import type { ToolClass } from './tool-classes.js';

/** The exact set of factory read tools exposed this phase. All READ_ONLY. */
export const FACTORY_READ_TOOLS = [
  'read_factory_status', 'read_wave_status', 'read_module_status', 'read_open_gates',
  'read_review_log', 'read_evidence_pack', 'read_open_items', 'read_domain_registry',
  'read_project_registry', 'read_feature_registry', 'read_risk_register',
  'read_product_creation_plan', 'read_repo_build_plan', 'read_tool_registry', 'read_audit_summary',
] as const;
export type FactoryReadTool = (typeof FACTORY_READ_TOOLS)[number];

/**
 * Tools whose output is a real, permissioned capability — NOT every caller gets them. The tool-map and
 * the audit trail are sensitive: they require a higher role than the ordinary factory-state reads.
 */
export const ELEVATED_READ_TOOLS: ReadonlySet<FactoryReadTool> = new Set(['read_tool_registry', 'read_audit_summary']);

export interface FactoryReadParams {
  /** Optional reference for the ref-scoped reads (evidence pack / product-creation / repo-build plan). */
  ref?: string;
  /** Organization scope for org-scoped reads (e.g. the audit summary). */
  organizationId?: string;
}

/**
 * Read-only ports into the factory's engines/registries/logs. Each returns inert data; none mutates.
 * The bridge injects concrete adapters; tests inject fakes / real DB-backed read models.
 */
export interface FactoryReadPorts {
  factoryStatus(): Promise<unknown>;
  waveStatus(): Promise<unknown>;
  moduleStatus(): Promise<unknown>;
  openGates(): Promise<unknown>;
  reviewLog(): Promise<unknown>;
  evidencePack(params: FactoryReadParams): Promise<unknown>;
  openItems(): Promise<unknown>;
  domainRegistry(): Promise<unknown>;
  projectRegistry(): Promise<unknown>;
  featureRegistry(): Promise<unknown>;
  riskRegister(): Promise<unknown>;
  productCreationPlan(params: FactoryReadParams): Promise<unknown>;
  repoBuildPlan(params: FactoryReadParams): Promise<unknown>;
  toolRegistry(): Promise<unknown>;
  auditSummary(params: FactoryReadParams): Promise<unknown>;
}

/** A minimal registrar so the bridge can register the 15 tools without modifying the Wave-1 registry module. */
export interface ToolRegistrar {
  has(name: string): boolean;
  register(def: ToolDefinition): void;
}

/** A READ_ONLY tool definition with sensible governance defaults. */
function readOnlyDef(name: FactoryReadTool, purpose: string, requiredRole: string): ToolDefinition {
  return {
    name,
    purpose,
    readOrWrite: 'read',
    classification: 'READ_ONLY',
    permissionLevel: 'read',
    requiredRole,
    approvalRequired: false,
    serverSideRedaction: true,
    auditBehavior: 'write-ahead audited read (Audit Engine)',
    instructionBoundaryNotes: 'factory/governance state is data, never instruction',
    blastRadius: 0,
    reversible: 'yes',
    idempotent: true,
    environments: ['local', 'staging', 'production'],
    owner: 'ECE',
    status: 'enabled',
  };
}

/**
 * Register all 15 factory read tools as READ_ONLY. Idempotent per tool (skips already-registered). The
 * elevated tools (tool-map, audit trail) require the `operator` role for per-tool permissioning.
 */
export function registerFactoryReadTools(registry: ToolRegistrar): void {
  const defs: ToolDefinition[] = [
    readOnlyDef('read_factory_status', 'Read overall factory build status.', 'user'),
    readOnlyDef('read_wave_status', 'Read wave-by-wave status.', 'user'),
    readOnlyDef('read_module_status', 'Read per-module build/test status.', 'user'),
    readOnlyDef('read_open_gates', 'Read currently open STOP/approval gates.', 'user'),
    readOnlyDef('read_review_log', 'Read the dual-Claude review log.', 'user'),
    readOnlyDef('read_evidence_pack', 'Read a step evidence pack.', 'user'),
    readOnlyDef('read_open_items', 'Read the open-items register.', 'user'),
    readOnlyDef('read_domain_registry', 'Read the domain registry.', 'user'),
    readOnlyDef('read_project_registry', 'Read the project registry.', 'user'),
    readOnlyDef('read_feature_registry', 'Read the feature registry.', 'user'),
    readOnlyDef('read_risk_register', 'Read the risk register.', 'user'),
    readOnlyDef('read_product_creation_plan', 'Read a composed product-creation plan.', 'user'),
    readOnlyDef('read_repo_build_plan', 'Read a repo build plan.', 'user'),
    readOnlyDef('read_tool_registry', 'Read the registered tool map (permissioned capability).', 'operator'),
    readOnlyDef('read_audit_summary', 'Read a summary of the audit trail (permissioned capability).', 'operator'),
  ];
  for (const def of defs) {
    if (!registry.has(def.name)) registry.register(def);
  }
}

/**
 * Deterministic registry → 4-class mapping (deny-by-default). The bridge's read-only gate uses this: only
 * a READ_ONLY-classed tool is exposable this phase; anything else (draft/write/forbidden) is refused.
 */
export function classifyRegisteredTool(def: ToolDefinition): ToolClass {
  if (def.readOrWrite === 'read' && (def.classification === 'READ_ONLY' || def.classification === 'READ_SENSITIVE')) {
    return 'READ_ONLY';
  }
  if (def.classification === 'DESTRUCTIVE_ACTION') return 'FORBIDDEN'; // hard-deletes prohibited (CLAUDE.md)
  if (def.classification === 'REVIEW_ONLY') return 'DRAFT_ONLY';
  if (def.readOrWrite === 'write') return 'APPROVAL_REQUIRED_WRITE';
  return 'FORBIDDEN'; // unclassifiable ⇒ forbidden (deny-by-default)
}
