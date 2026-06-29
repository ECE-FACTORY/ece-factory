// Permission Engine (Module 22) — the real Authorizer (replaces the AllowAllAuthorizer stub).
//
// Returns ALLOW / REFUSE / STOP_FOR_APPROVAL, DENY-BY-DEFAULT: anything not explicitly
// resolvable to ALLOW is REFUSE. Decides from the tool's registry entry (fail-closed on an
// unregistered tool), the principal's role vs the tool's requiredRole, environment availability,
// the tool's approvalRequired, and classification-driven escalation.
//
// STANDALONE-PACKAGEABLE (REQUIREMENT_PRODUCT_APP_PACKAGING.md): the only cross-engine references
// are `import type` (the Authorizer seam + the ToolRegistryReader interface) — type-only, erased at
// compile time, so the runtime artifact has ZERO coupling to other engines.

import type { Authorizer, AuthorizationRequest, AuthorizationDecision } from '../audit-engine/sequencer.js';
import type { ToolRegistryReader, ToolDefinition, RiskClassification } from '../tool-registry/tool-registry.js';

/** Classifications that always require human approval (escalate to STOP_FOR_APPROVAL). */
const APPROVAL_CLASSIFICATIONS: ReadonlySet<RiskClassification> = new Set<RiskClassification>([
  'WRITE_HIGH_RISK', 'BULK_ACTION', 'DESTRUCTIVE_ACTION',
  'SECURITY_CRITICAL', 'FINANCIAL_CRITICAL', 'LEGAL_CRITICAL', 'EXTERNAL_COMMUNICATION',
]);

/** Default role hierarchy (higher rank = more authority). Unknown roles rank 0. */
const DEFAULT_ROLE_RANK: Readonly<Record<string, number>> = { user: 1, auditor: 1, operator: 2, admin: 3 };

export interface PermissionEngineOptions {
  roleRank?: Record<string, number>;
}

export class PermissionEngine implements Authorizer {
  private readonly roleRank: Record<string, number>;

  constructor(
    private readonly registry: ToolRegistryReader,
    opts?: PermissionEngineOptions,
  ) {
    this.roleRank = opts?.roleRank ?? DEFAULT_ROLE_RANK;
  }

  private rank(role: string | undefined): number {
    if (!role) return 0;
    return this.roleRank[role] ?? 0; // unknown principal role → 0 (insufficient for anything ≥1)
  }

  private requiredRank(role: string): number {
    return this.roleRank[role] ?? Number.POSITIVE_INFINITY; // unknown required role → impossible (deny-by-default)
  }

  async authorize(req: AuthorizationRequest): Promise<AuthorizationDecision> {
    const name = req.tool?.name;
    if (!name) return { decision: 'REFUSE', reason: 'missing tool name' };

    // Fail-closed lookup: an unregistered tool can never be authorized (no hidden tools).
    let def: ToolDefinition;
    try {
      def = this.registry.require(name);
    } catch {
      return { decision: 'REFUSE', reason: `tool not registered: "${name}" (fail-closed)` };
    }

    if (def.status === 'disabled') {
      return { decision: 'REFUSE', reason: `tool "${name}" is disabled` };
    }
    if (!(def.environments as readonly string[]).includes(req.environment)) {
      return { decision: 'REFUSE', reason: `tool "${name}" not available in environment "${req.environment}"` };
    }
    if (this.rank(req.human_actor?.role) < this.requiredRank(def.requiredRole)) {
      return { decision: 'REFUSE', reason: `insufficient role: "${req.human_actor?.role}" < required "${def.requiredRole}"` };
    }
    if (def.approvalRequired) {
      return { decision: 'STOP_FOR_APPROVAL', reason: `tool "${name}" requires human approval` };
    }
    if (APPROVAL_CLASSIFICATIONS.has(def.classification)) {
      return { decision: 'STOP_FOR_APPROVAL', reason: `classification ${def.classification} requires human approval` };
    }

    // Explicitly resolved: registered, enabled, in-environment, sufficient role, non-critical, no approval.
    return { decision: 'ALLOW' };
  }
}
