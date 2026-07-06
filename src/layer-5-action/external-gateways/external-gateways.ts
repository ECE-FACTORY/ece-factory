// External Gateways (Phase 9.3, OPEN_ITEM #9; extended with milestone/label/issue-batch) — the structural SOLE
// OWNERS of the eight non-PR external actions, exactly as the PR Engine (Module 30, Phase 8.8b) is the sole
// owner of `open_pull_request`.
//
// Each gateway holds its action's single, unforgeable, PER-ACTION `ExternalCapability` — granted once at
// construction by the bridge and held by NO other module. It exposes a narrow typed request seam; a consumer
// hands it an `ExternalActionRequest` and gets back an outcome, but has NO way to reach the external action
// itself (no bridge, no capability). Because the capability is unconstructible outside the bridge module and
// the generic `externalActionWithTool` refuses every external tool (encapsulated), the gateway is the ONLY
// module that can drive its action — sole authority BY CONSTRUCTION, not convention.
//
// NO new guard logic, NO privileged access: each gateway routes through the bridge's capability-gated method,
// which runs the UNCHANGED full Phase 8.4 gauntlet (specific-target token, no-bulk, production gate,
// kill-beats-approval, blast-radius audit). EXTERNAL STAYS ON FAKES this phase — real adapters are the
// separately-gated external-tier live wiring.
//
// STANDALONE-PACKAGEABLE: every cross-engine reference is `import type` (zero runtime coupling); the bridge is
// injected as a port. Each gateway depends only on the slice of the bridge it needs.

import type { BridgeCallContext, ExternalCapability, ExternalOutcome } from '../mcp-bridge/mcp-bridge.js';
import type { ExternalParams, ExternalTarget } from '../mcp-bridge/external-tools.js';
import { MAX_ISSUE_BATCH } from '../mcp-bridge/external-tools.js';

/** What a consumer hands a gateway: the exact external target, an optional payload, and the approval id. */
export interface ExternalActionRequest {
  target: ExternalTarget;
  payload?: Record<string, unknown>;
  /** The Approval Gate action id whose single-use, specific-target human approval authorizes THIS action. */
  approvalActionId?: string;
}

/**
 * A gateway's outcome — committed, withheld for approval, or refused. EXTERNAL-ACTION-COMMITTED is reachable
 * ONLY from the bridge's committed external action, which requires the full 8.4 gauntlet (consumed
 * specific-target human token). There is no committed variant a gateway can produce on its own.
 */
export type GatewayOutcome =
  | { status: 'EXTERNAL-ACTION-COMMITTED'; committed: unknown; approvalId: string; target: ExternalTarget }
  | { status: 'STOP_FOR_APPROVAL'; reason: string }
  | { status: 'refused'; reason: string };

function toGatewayOutcome(out: ExternalOutcome): GatewayOutcome {
  if (out.status === 'EXTERNAL-ACTION-COMMITTED') return { status: 'EXTERNAL-ACTION-COMMITTED', committed: out.committed, approvalId: out.approvalId, target: out.target };
  if (out.status === 'STOP_FOR_APPROVAL') return { status: 'STOP_FOR_APPROVAL', reason: out.reason };
  return { status: 'refused', reason: out.reason };
}

function toParams(request: ExternalActionRequest): ExternalParams {
  return { approvalActionId: request.approvalActionId, target: request.target, payload: request.payload };
}

// ── create_github_repo ───────────────────────────────────────────────────────────────────────────────────
export interface CreateGithubRepoBridge {
  grantCreateGithubRepoCapability(): ExternalCapability<'create_github_repo'>;
  createGithubRepo(capability: ExternalCapability<'create_github_repo'>, ctx: BridgeCallContext, params?: ExternalParams): Promise<ExternalOutcome>;
}
/** Sole owner of `create_github_repo`. */
export class RepoCreationGateway {
  private readonly capability: ExternalCapability<'create_github_repo'>;
  constructor(private readonly bridge: CreateGithubRepoBridge) { this.capability = bridge.grantCreateGithubRepoCapability(); }
  async createRepo(request: ExternalActionRequest, ctx: BridgeCallContext): Promise<GatewayOutcome> {
    return toGatewayOutcome(await this.bridge.createGithubRepo(this.capability, ctx, toParams(request)));
  }
}

// ── create_ticket ────────────────────────────────────────────────────────────────────────────────────────
export interface CreateTicketBridge {
  grantCreateTicketCapability(): ExternalCapability<'create_ticket'>;
  createTicket(capability: ExternalCapability<'create_ticket'>, ctx: BridgeCallContext, params?: ExternalParams): Promise<ExternalOutcome>;
}
/** Sole owner of `create_ticket`. */
export class TicketGateway {
  private readonly capability: ExternalCapability<'create_ticket'>;
  constructor(private readonly bridge: CreateTicketBridge) { this.capability = bridge.grantCreateTicketCapability(); }
  async createTicket(request: ExternalActionRequest, ctx: BridgeCallContext): Promise<GatewayOutcome> {
    return toGatewayOutcome(await this.bridge.createTicket(this.capability, ctx, toParams(request)));
  }
}

// ── update_crm_record ────────────────────────────────────────────────────────────────────────────────────
export interface UpdateCrmRecordBridge {
  grantUpdateCrmRecordCapability(): ExternalCapability<'update_crm_record'>;
  updateCrmRecord(capability: ExternalCapability<'update_crm_record'>, ctx: BridgeCallContext, params?: ExternalParams): Promise<ExternalOutcome>;
}
/** Sole owner of `update_crm_record`. */
export class CrmGateway {
  private readonly capability: ExternalCapability<'update_crm_record'>;
  constructor(private readonly bridge: UpdateCrmRecordBridge) { this.capability = bridge.grantUpdateCrmRecordCapability(); }
  async updateRecord(request: ExternalActionRequest, ctx: BridgeCallContext): Promise<GatewayOutcome> {
    return toGatewayOutcome(await this.bridge.updateCrmRecord(this.capability, ctx, toParams(request)));
  }
}

// ── send_email ───────────────────────────────────────────────────────────────────────────────────────────
export interface SendEmailBridge {
  grantSendEmailCapability(): ExternalCapability<'send_email'>;
  sendEmail(capability: ExternalCapability<'send_email'>, ctx: BridgeCallContext, params?: ExternalParams): Promise<ExternalOutcome>;
}
/** Sole owner of `send_email`. */
export class EmailGateway {
  private readonly capability: ExternalCapability<'send_email'>;
  constructor(private readonly bridge: SendEmailBridge) { this.capability = bridge.grantSendEmailCapability(); }
  async sendEmail(request: ExternalActionRequest, ctx: BridgeCallContext): Promise<GatewayOutcome> {
    return toGatewayOutcome(await this.bridge.sendEmail(this.capability, ctx, toParams(request)));
  }
}

// ── deploy_package ───────────────────────────────────────────────────────────────────────────────────────
export interface DeployPackageBridge {
  grantDeployPackageCapability(): ExternalCapability<'deploy_package'>;
  deployPackage(capability: ExternalCapability<'deploy_package'>, ctx: BridgeCallContext, params?: ExternalParams): Promise<ExternalOutcome>;
}
/** Sole owner of `deploy_package`. */
export class DeployGateway {
  private readonly capability: ExternalCapability<'deploy_package'>;
  constructor(private readonly bridge: DeployPackageBridge) { this.capability = bridge.grantDeployPackageCapability(); }
  async deploy(request: ExternalActionRequest, ctx: BridgeCallContext): Promise<GatewayOutcome> {
    return toGatewayOutcome(await this.bridge.deployPackage(this.capability, ctx, toParams(request)));
  }
}

// ── create_milestone ─────────────────────────────────────────────────────────────────────────────────────
export interface CreateMilestoneBridge {
  grantCreateMilestoneCapability(): ExternalCapability<'create_milestone'>;
  createMilestone(capability: ExternalCapability<'create_milestone'>, ctx: BridgeCallContext, params?: ExternalParams): Promise<ExternalOutcome>;
}
/** Sole owner of `create_milestone`. */
export class MilestoneGateway {
  private readonly capability: ExternalCapability<'create_milestone'>;
  constructor(private readonly bridge: CreateMilestoneBridge) { this.capability = bridge.grantCreateMilestoneCapability(); }
  async createMilestone(request: ExternalActionRequest, ctx: BridgeCallContext): Promise<GatewayOutcome> {
    return toGatewayOutcome(await this.bridge.createMilestone(this.capability, ctx, toParams(request)));
  }
}

// ── create_label ─────────────────────────────────────────────────────────────────────────────────────────
export interface CreateLabelBridge {
  grantCreateLabelCapability(): ExternalCapability<'create_label'>;
  createLabel(capability: ExternalCapability<'create_label'>, ctx: BridgeCallContext, params?: ExternalParams): Promise<ExternalOutcome>;
}
/** Sole owner of `create_label`. */
export class LabelGateway {
  private readonly capability: ExternalCapability<'create_label'>;
  constructor(private readonly bridge: CreateLabelBridge) { this.capability = bridge.grantCreateLabelCapability(); }
  async createLabel(request: ExternalActionRequest, ctx: BridgeCallContext): Promise<GatewayOutcome> {
    return toGatewayOutcome(await this.bridge.createLabel(this.capability, ctx, toParams(request)));
  }
}

// ── create_issue_batch (gated bulk — ONE content-bound, size-capped approval) ────────────────────────────
export interface CreateIssueBatchBridge {
  grantCreateIssueBatchCapability(): ExternalCapability<'create_issue_batch'>;
  createIssueBatch(capability: ExternalCapability<'create_issue_batch'>, ctx: BridgeCallContext, params?: ExternalParams): Promise<ExternalOutcome>;
}
/**
 * Sole owner of `create_issue_batch`. The batch is the reviewed unit: `request.payload.issues` is a FULLY
 * ENUMERATED list. The gateway fails fast on an empty or over-cap batch (≤ MAX_ISSUE_BATCH) BEFORE anything
 * reaches the gate — so an oversized batch can never become a pending action. The bounded, content-bound set
 * then runs the UNCHANGED gauntlet, where the per-action approval binds the exact enumerated payload.
 */
export class IssueBatchGateway {
  private readonly capability: ExternalCapability<'create_issue_batch'>;
  constructor(private readonly bridge: CreateIssueBatchBridge) { this.capability = bridge.grantCreateIssueBatchCapability(); }
  async createIssueBatch(request: ExternalActionRequest, ctx: BridgeCallContext): Promise<GatewayOutcome> {
    const issues = (request.payload as { issues?: unknown } | undefined)?.issues;
    if (!Array.isArray(issues) || issues.length === 0) {
      return { status: 'refused', reason: 'issue batch must enumerate at least one issue (payload.issues)' };
    }
    if (issues.length > MAX_ISSUE_BATCH) {
      return { status: 'refused', reason: `issue batch exceeds the hard cap of ${MAX_ISSUE_BATCH} (got ${issues.length}); split into separately-approved batches` };
    }
    return toGatewayOutcome(await this.bridge.createIssueBatch(this.capability, ctx, toParams(request)));
  }
}
