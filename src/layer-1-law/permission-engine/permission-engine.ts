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

import type { Authorizer, AuthorizationRequest, AuthorizationDecision } from '../../factory-shared/audit-engine/sequencer.js';
import type { ToolRegistryReader, ToolDefinition, RiskClassification } from '../../layer-5-action/tool-registry/tool-registry.js';
import type { KillSwitchReader } from '../kill-switch/kill-switch.js';

/** Default reader used when no kill switch is injected: nothing is ever killed. */
const NEVER_KILLED: KillSwitchReader = { isKilled: () => false, reason: () => null };

/** Classifications that always require human approval (escalate to STOP_FOR_APPROVAL). */
const APPROVAL_CLASSIFICATIONS: ReadonlySet<RiskClassification> = new Set<RiskClassification>([
  'WRITE_HIGH_RISK', 'BULK_ACTION', 'DESTRUCTIVE_ACTION',
  'SECURITY_CRITICAL', 'FINANCIAL_CRITICAL', 'LEGAL_CRITICAL', 'EXTERNAL_COMMUNICATION',
]);

/** Default role hierarchy (higher rank = more authority). Unknown roles rank 0. */
const DEFAULT_ROLE_RANK: Readonly<Record<string, number>> = { user: 1, auditor: 1, operator: 2, admin: 3 };

export interface PermissionEngineOptions {
  roleRank?: Record<string, number>;
  /** Emergency control. Consulted at the TOP of every decision; a killed scope ⇒ REFUSE. */
  killSwitch?: KillSwitchReader;
}

export class PermissionEngine implements Authorizer {
  private readonly roleRank: Record<string, number>;
  private readonly killSwitch: KillSwitchReader;

  constructor(
    private readonly registry: ToolRegistryReader,
    opts?: PermissionEngineOptions,
  ) {
    this.roleRank = opts?.roleRank ?? DEFAULT_ROLE_RANK;
    this.killSwitch = opts?.killSwitch ?? NEVER_KILLED;
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

    // KILL SWITCH — emergency control, checked at the TOP (kill beats role/approval/ALLOW).
    // Scopes that need no tool metadata (bridge/autopilot/environment/tool/connector) are evaluated
    // first — before the registry lookup — so an emergency stop disables even unregistered tools.
    const earlyKill = this.killSwitch.reason({ toolName: name, environment: req.environment, connector: req.connector, autopilot: req.autopilot });
    if (earlyKill) return { decision: 'REFUSE', reason: `kill switch: ${earlyKill}` };

    // Fail-closed lookup: an unregistered tool can never be authorized (no hidden tools).
    let def: ToolDefinition;
    try {
      def = this.registry.require(name);
    } catch {
      return { decision: 'REFUSE', reason: `tool not registered: "${name}" (fail-closed)` };
    }

    // all-writes scope needs readOrWrite — still checked BEFORE any role/approval/ALLOW decision.
    const writeKill = this.killSwitch.reason({ toolName: name, readOrWrite: def.readOrWrite, environment: req.environment, connector: req.connector, autopilot: req.autopilot });
    if (writeKill) return { decision: 'REFUSE', reason: `kill switch: ${writeKill}` };

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
