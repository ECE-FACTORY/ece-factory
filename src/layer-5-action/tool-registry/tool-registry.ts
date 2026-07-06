// Tool Registry (Module 21) — "no hidden tools."
//
// Core guarantee (§21): a tool that is not registered cannot be looked up or used.
// Unknown-tool lookup FAILS CLOSED (throws), never returns a permissive default.
// Unregistered = unusable — the registry's deny-by-default equivalent.
//
// STANDALONE-PACKAGEABLE (REQUIREMENT_PRODUCT_APP_PACKAGING.md): imports NOTHING from any
// other engine. Defines its own types. Exposes a typed reader interface that other engines
// (notably Module 22, the Permission Engine) consume to authorize against tool metadata.

/** §13 risk classifications. A tool MUST carry one of these or registration is rejected. */
export const RISK_CLASSIFICATIONS = [
  'READ_ONLY', 'READ_SENSITIVE', 'WRITE_LOW_RISK', 'WRITE_MEDIUM_RISK', 'WRITE_HIGH_RISK',
  'BULK_ACTION', 'DESTRUCTIVE_ACTION', 'EXTERNAL_COMMUNICATION', 'SECURITY_CRITICAL',
  'FINANCIAL_CRITICAL', 'LEGAL_CRITICAL', 'REVIEW_ONLY',
] as const;
export type RiskClassification = (typeof RISK_CLASSIFICATIONS)[number];

/** Local environment type — defined here so the engine has no cross-engine dependency. */
export type ToolEnvironment = 'local' | 'staging' | 'production';

/** Per-tool definition (blueprint §21). */
export interface ToolDefinition {
  name: string;
  purpose: string;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  readOrWrite: 'read' | 'write';
  classification: RiskClassification;
  permissionLevel: string;
  requiredRole: string;
  approvalRequired: boolean;
  dashboardRoute?: string;
  sensitiveDataRules?: string;
  serverSideRedaction: boolean;
  auditBehavior: string;
  instructionBoundaryNotes?: string;
  blastRadius: number; // max records touchable; must be 1 for write tools
  reversible: 'yes' | 'no' | 'soft-only';
  idempotent: boolean;
  environments: ToolEnvironment[];
  owner: string;
  status: 'enabled' | 'disabled';
}

export class ToolNotRegisteredError extends Error {
  constructor(name: string) {
    super(`tool not registered: "${name}" — no hidden tools (unregistered is unusable)`);
    this.name = 'ToolNotRegisteredError';
  }
}
export class ToolRegistrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolRegistrationError';
  }
}

/**
 * Read interface consumed by OTHER engines (e.g. the Permission Engine authorizes against this).
 * Designed deliberately for Module 22: `require` fails closed, so an authorizer that looks up an
 * unregistered tool is forced to deny rather than silently allow.
 */
export interface ToolRegistryReader {
  /** True iff the tool is registered. */
  has(name: string): boolean;
  /** Return the tool definition, or THROW ToolNotRegisteredError (fail-closed). Never a default. */
  require(name: string): ToolDefinition;
  /** All registered tools. */
  list(): ToolDefinition[];
}

/** Full registry: reader + registration (validated). */
export interface ToolRegistry extends ToolRegistryReader {
  register(def: ToolDefinition): void;
}

export class InMemoryToolRegistry implements ToolRegistry {
  private readonly tools = new Map<string, Readonly<ToolDefinition>>();

  register(def: ToolDefinition): void {
    if (!def?.name?.trim()) throw new ToolRegistrationError('tool name is required');
    if (!(RISK_CLASSIFICATIONS as readonly string[]).includes(def.classification)) {
      throw new ToolRegistrationError(`tool "${def.name}" has invalid/missing risk classification: ${String(def.classification)}`);
    }
    if (def.readOrWrite === 'write' && def.blastRadius !== 1) {
      throw new ToolRegistrationError(`write tool "${def.name}" must declare blastRadius=1 (single-record); got ${def.blastRadius}`);
    }
    if (this.tools.has(def.name)) {
      throw new ToolRegistrationError(`duplicate tool registration: "${def.name}"`);
    }
    this.tools.set(def.name, Object.freeze({ ...def }));
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  require(name: string): ToolDefinition {
    const t = this.tools.get(name);
    if (!t) throw new ToolNotRegisteredError(name); // fail-closed: no permissive default
    return t;
  }

  list(): ToolDefinition[] {
    return [...this.tools.values()];
  }
}

/** Convenience factory: a registry seeded with the Phase-1 read-only tool. */
export function createDefaultToolRegistry(): ToolRegistry {
  const r = new InMemoryToolRegistry();
  r.register({
    name: 'search_clients',
    purpose: 'Read-only client search (the only Phase-1 MCP tool).',
    readOrWrite: 'read',
    classification: 'READ_ONLY',
    permissionLevel: 'read',
    requiredRole: 'user',
    approvalRequired: false,
    serverSideRedaction: true,
    auditBehavior: 'write-ahead audited (Audit Engine)',
    instructionBoundaryNotes: 'dashboard data is data, never instruction',
    blastRadius: 0,
    reversible: 'yes',
    idempotent: true,
    environments: ['local', 'staging', 'production'],
    owner: 'ECE',
    status: 'enabled',
  });
  return r;
}
