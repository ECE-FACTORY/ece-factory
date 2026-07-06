// MCP Bridge (Module 1, Wave 5) — the SINGLE governed gateway for all factory capabilities. Every caller
// (Claude operator/backend, the Pulse Agent, the dashboard, future Autopilot) reaches every function
// through this one door: no internal shortcut, no backend bypass, no unregistered access.
//
// Phase 8.0 proved the door with one system-of-record tool (search_clients). Phase 8.1 generalizes it:
//   • PART A — a 4-class tool taxonomy (READ_ONLY / DRAFT_ONLY / APPROVAL_REQUIRED_WRITE / FORBIDDEN),
//     structurally enforced and dispatched-by-class (see tool-classes.ts). Only READ_ONLY is exposed now.
//   • PART B — 15 READ_ONLY factory/governance-state tools (see factory-read-tools.ts).
//
// EVERY tool — including governance-state reads — passes the SAME full guard stack (NO "internal = safe"):
//   1. Tool Registry  — registered? else refused (fail-closed).
//   2. Dispatch-by-class — the registered class determines which execution path is even available. Only
//                          READ_ONLY tools reach the guarded-read path; anything else is refused here.
//   3. Write-ahead sequencer — authorize (Permission Engine → Kill Switch) → audit INTENT (human-attributed,
//                          fail-closed) → execute the read → audit RESULT. A refusal is recorded as a
//                          refusal-audit. A read of governance state is itself an audited read.
//   4. Redaction       — output is redacted (deny-by-default allowlist) before it leaves the bridge.
//
// INSTRUCTION-BOUNDARY: all returned data — system-of-record rows AND registry/log records — is inert. The
// bridge never inspects, parses, or acts on returned content as a command.
//
// STANDALONE-PACKAGEABLE: every cross-engine reference is `import type` (zero runtime coupling); the guard
// engines, the read model, and the factory read ports are injected. Packaging target: the `ece-mcp-bridge` repo.

import type { ToolRegistryReader, ToolDefinition } from '../tool-registry/tool-registry.js';
import type { SequencerRequest, SequencerOutcome, ExecuteFn, RefusalRequest } from '../../factory-shared/audit-engine/sequencer.js';
import type { HumanActor, SessionInfo, Environment, ToolInfo } from '../../factory-shared/audit-engine/schema.js';
import { ClassDispatcher, DRAFT_STATUS, canonicalPayload, type ConsumedApproval, type ApprovalGatePort, type ApprovalBinding } from './tool-classes.js';
import { classifyRegisteredTool, FACTORY_READ_TOOLS, type FactoryReadTool, type FactoryReadPorts, type FactoryReadParams } from './factory-read-tools.js';
import { DRAFT_TOOLS, type DraftTool, type DraftPorts, type DraftParams } from './draft-tools.js';
import { WRITE_TOOLS, type WriteTool, type WriteStores, type WriteParams } from './write-tools.js';
import {
  EXTERNAL_TOOLS, FORBIDDEN_TOOLS, isProductionTarget, targetsProtectedSubsystem,
  type ExternalTool, type ExternalSystems, type ExternalParams, type ExternalTarget,
} from './external-tools.js';

/** The READ_ONLY surface: the system-of-record tool (8.0) + the factory read tools (8.1). */
export const EXPOSED_READ_TOOLS = ['search_clients', ...FACTORY_READ_TOOLS] as const;
/** The DRAFT_ONLY surface (8.2) — proposers, never actions. */
export const EXPOSED_DRAFT_TOOLS = [...DRAFT_TOOLS] as const;
/** The APPROVAL_REQUIRED_WRITE(internal) surface (8.3) — internal factory-state mutations, each token-gated. */
export const EXPOSED_WRITE_TOOLS = [...WRITE_TOOLS] as const;
/** The APPROVAL_REQUIRED_WRITE(external) surface (8.4) — external actions behind the hardest gates. */
export const EXPOSED_EXTERNAL_TOOLS = [...EXTERNAL_TOOLS] as const;
/** The full exposed surface — four tiers. FORBIDDEN tools are registered-and-refused, never exposed/callable. */
export const EXPOSED_TOOLS = [...EXPOSED_READ_TOOLS, ...EXPOSED_DRAFT_TOOLS, ...EXPOSED_WRITE_TOOLS, ...EXPOSED_EXTERNAL_TOOLS] as const;
/** The prohibited tier — never callable. */
export const FORBIDDEN_TOOL_SET: ReadonlySet<string> = new Set(FORBIDDEN_TOOLS);
export type ExposedToolName = (typeof EXPOSED_TOOLS)[number];
/** @deprecated kept for Phase 8.0 compatibility — the full surface is EXPOSED_TOOLS. */
export const BRIDGE_TOOLS = ['search_clients'] as const;
export type BridgeToolName = (typeof BRIDGE_TOOLS)[number];

export interface SearchClientsInput {
  q: string;
  organizationId: string;
}

/** A row / record returned to the caller. Opaque key/value data — NEVER interpreted as instruction. */
export type ClientRecord = Record<string, unknown>;

/** The system-of-record read model — read-only by construction (a single search method, no mutation). */
export interface ClientReadModel {
  searchClients(input: SearchClientsInput): Promise<ClientRecord[]>;
}

/** The write-ahead sequencer, injected as a port. `WriteAheadSequencer` satisfies this structurally. */
export interface AuditedSequencerPort {
  run<T>(req: SequencerRequest, execute: ExecuteFn<T>): Promise<SequencerOutcome<T>>;
  /**
   * Record a denied attempt the bridge decides BEFORE `run` (missing approval, FORBIDDEN, encapsulated,
   * hardening, registry/tier miss). REQUIRED on the port by design: it must be structurally impossible to wire
   * a bridge whose pre-sequencer refusals cannot be audited (OPEN_ITEM #1).
   */
  recordRefusal(req: RefusalRequest): Promise<void>;
}

/** The redactor port. `RedactionEngine` satisfies this structurally (deny-by-default allowlist). */
export interface ResultRedactorPort {
  redactSummary(summary: Record<string, unknown> | undefined): Record<string, unknown> | undefined;
}

export interface BridgeCallContext {
  principal: HumanActor;
  organization_id: string;
  session: SessionInfo;
  environment: Environment;
  /** The conduit the human acted through (e.g. "claude"). Never the actor. */
  via?: string;
}

export type BridgeRefusalStage = 'registry' | 'read-only-gate' | 'authorize' | 'validate' | 'intent-commit' | 'execute' | 'forbidden' | 'hardening' | 'encapsulated';

// ── External-action sole-authority capabilities (Phase 8.8b → generalized in 9.3 / OPEN_ITEM #9) ─────────
// EVERY external action is reachable ONLY through its capability-gated bridge method (createGithubRepo /
// openPullRequest / createTicket / updateCrmRecord / sendEmail / deployPackage). Each REQUIRES an
// unforgeable, PER-ACTION capability:
//   • UNFORGEABLE — the brand key is a module-private `unique symbol`; an `ExternalCapability` cannot be
//     constructed or even named outside this module (exactly like the approval token's unforgeability).
//   • PER-ACTION — the phantom tool-name parameter `N` makes the nine capability types MUTUALLY
//     non-assignable, so a `send_email` capability cannot be passed where `create_ticket` is required
//     (binding proven at the TYPE level; also re-checked at RUNTIME by the capability's brand value).
// The generic `externalActionWithTool` REFUSES all nine (stage `encapsulated`) — closing the "any module
// holding the bridge could call them" bypass. This is an encapsulation/visibility seam, NOT a new gate: each
// capability method runs the UNCHANGED full Phase 8.4 gauntlet (`runExternalAction`). Sole holders: the PR
// Engine (open_pull_request) and the eight per-action external gateways, each granted its single capability at
// the composition root — exactly one owner per action (8.8b's structural sole authority, now for all 9).
declare const EXTERNAL_CAP: unique symbol;
export interface ExternalCapability<N extends ExternalTool> { readonly [EXTERNAL_CAP]: N }
const EXTERNAL_CAP_BRAND: typeof EXTERNAL_CAP = Symbol('externalCapability') as unknown as typeof EXTERNAL_CAP;
function mintExternalCapability<N extends ExternalTool>(name: N): ExternalCapability<N> {
  return { [EXTERNAL_CAP_BRAND]: name } as ExternalCapability<N>;
}
/** All nine external actions are capability-encapsulated — the generic path can assemble NONE of them. */
const ENCAPSULATED_EXTERNAL_TOOLS: ReadonlySet<ExternalTool> = new Set(EXTERNAL_TOOLS);
/** @deprecated Phase 8.8b name retained — the PR-open capability is `ExternalCapability<'open_pull_request'>`. */
export type OpenPrCapability = ExternalCapability<'open_pull_request'>;

/** Outcome of a system-of-record read — data, or a refusal. No write variant exists. */
export type BridgeOutcome =
  | { status: 'ok'; tool: 'search_clients'; rows: ClientRecord[]; auditSeq: number }
  | { status: 'refused'; tool: string; stage: BridgeRefusalStage; reason: string };

/** Outcome of a factory/governance-state read — data, or a refusal. No write variant exists. */
export type FactoryReadOutcome =
  | { status: 'ok'; tool: FactoryReadTool; data: unknown; auditSeq: number }
  | { status: 'refused'; tool: string; stage: BridgeRefusalStage; reason: string };

/**
 * Outcome of a draft/planning tool — a PROPOSED artifact, or a refusal. There is intentionally NO
 * 'committed'/'executed'/'approved'/'recorded' member: a draft cannot represent having acted. The success
 * status is the single literal DRAFT-AWAITING-HUMAN-REVIEW.
 */
export type DraftOutcome =
  | { status: typeof DRAFT_STATUS; tool: DraftTool; draft: unknown; auditSeq: number }
  | { status: 'refused'; tool: string; stage: BridgeRefusalStage; reason: string };

/**
 * Outcome of an APPROVAL_REQUIRED_WRITE tool. Success is WRITE-COMMITTED — the genuine committed state — but
 * it is reachable ONLY from the dispatcher's executed branch, which requires a consumed ConsumedApproval
 * token. No approval ⇒ STOP_FOR_APPROVAL (nothing written). A refused/killed path ⇒ refused. There is no
 * committed state reachable without a consumed human token.
 */
export type WriteOutcome =
  | { status: 'WRITE-COMMITTED'; tool: WriteTool; committed: unknown; approvalId: string; auditSeq: number }
  | { status: 'STOP_FOR_APPROVAL'; tool: WriteTool; reason: string }
  | { status: 'refused'; tool: string; stage: BridgeRefusalStage; reason: string };

/**
 * Outcome of an EXTERNAL action. Success is EXTERNAL-ACTION-COMMITTED — reachable ONLY via the consumed
 * ConsumedApproval token AND the external hardening gauntlet (specific target, no bulk, production gate,
 * untargetable kill/audit). Missing/non-specific approval ⇒ STOP_FOR_APPROVAL. FORBIDDEN/killed/unauthorized
 * ⇒ refused. There is no external commit reachable without the full gauntlet.
 */
export type ExternalOutcome =
  | { status: 'EXTERNAL-ACTION-COMMITTED'; tool: ExternalTool; committed: unknown; approvalId: string; target: ExternalTarget; auditSeq: number }
  | { status: 'STOP_FOR_APPROVAL'; tool: ExternalTool; reason: string }
  | { status: 'refused'; tool: string; stage: BridgeRefusalStage; reason: string };

/** Internal flat result of a guarded, class-dispatched production (read or draft). */
type GuardedValue<T> = { ok: true; value: T; auditSeq: number } | { ok: false; stage: BridgeRefusalStage; reason: string };

export interface McpBridgeOptions {
  factoryPorts?: FactoryReadPorts;
  draftPorts?: DraftPorts;
  writeStores?: WriteStores;
  externalSystems?: ExternalSystems;
  /** The Approval Gate the bridge pre-checks and the dispatcher consumes for APPROVAL_REQUIRED_WRITE. */
  approvalGate?: ApprovalGatePort;
}

export class McpBridge {
  private readonly dispatcher: ClassDispatcher;
  private readonly factoryPorts?: FactoryReadPorts;
  private readonly draftPorts?: DraftPorts;
  private readonly writeStores?: WriteStores;
  private readonly externalSystems?: ExternalSystems;
  private readonly approvalGate?: ApprovalGatePort;

  constructor(
    private readonly registry: ToolRegistryReader,
    private readonly sequencer: AuditedSequencerPort,
    private readonly source: ClientReadModel,
    private readonly redactor: ResultRedactorPort,
    opts: McpBridgeOptions = {},
  ) {
    this.factoryPorts = opts.factoryPorts;
    this.draftPorts = opts.draftPorts;
    this.writeStores = opts.writeStores;
    this.externalSystems = opts.externalSystems;
    this.approvalGate = opts.approvalGate;
    this.dispatcher = new ClassDispatcher(opts.approvalGate);
  }

  // ── OPEN_ITEM #1 — refusal-audit choke point ────────────────────────────────────────────────────────────
  // A denied attempt the bridge decides BEFORE the write-ahead sequencer runs (a missing approval ⇒
  // STOP_FOR_APPROVAL; a FORBIDDEN / encapsulated / hardening / registry / wrong-tier refusal) commits no
  // intent and was therefore previously invisible to audit ("who tried what they weren't allowed to"). Every
  // public entrypoint routes its outcome through here so such a denial is recorded as a distinct refusal entry.
  // Refusals the SEQUENCER owns (authorize/kill, validate, intent-commit, execute) are already audited inside
  // `run`, so their stages are skipped here — no double entry. Fail-soft: see `recordRefusal`.
  private static readonly BRIDGE_REFUSAL_STAGES: ReadonlySet<BridgeRefusalStage> =
    new Set<BridgeRefusalStage>(['registry', 'read-only-gate', 'forbidden', 'hardening', 'encapsulated']);

  private async auditBridgeRefusal<O extends { status: string }>(name: string, ctx: BridgeCallContext, outcome: O): Promise<O> {
    if (outcome.status === 'STOP_FOR_APPROVAL') {
      await this.sequencer.recordRefusal(this.refusalRequest(name, ctx, 'approval', 'STOP_FOR_APPROVAL', (outcome as { reason?: string }).reason));
    } else if (outcome.status === 'refused') {
      const stage = (outcome as unknown as { stage: BridgeRefusalStage }).stage;
      if (McpBridge.BRIDGE_REFUSAL_STAGES.has(stage)) {
        await this.sequencer.recordRefusal(this.refusalRequest(name, ctx, stage, 'REFUSE', (outcome as { reason?: string }).reason));
      }
    }
    return outcome;
  }

  private refusalRequest(name: string, ctx: BridgeCallContext, stage: string, decision: 'REFUSE' | 'STOP_FOR_APPROVAL', reason?: string): RefusalRequest {
    // Best-effort tool classification: a registered tool carries its class; an unregistered/misconfigured one
    // is recorded by name alone (the attempt is still audited).
    const def = this.registry.has(name) ? this.registry.require(name) : undefined;
    const tool: ToolInfo = def ? { name, classification: def.classification, permission_level: def.permissionLevel } : { name };
    return {
      principal: ctx.principal, // the real human — never "claude"
      organization_id: ctx.organization_id,
      session: ctx.session,
      tool,
      environment: ctx.environment,
      via: ctx.via,
      stage,
      decision,
      reason,
    };
  }

  /** The READ_ONLY tools the bridge exposes (those registered) — fail-closed via the registry. */
  listTools(): ToolDefinition[] {
    return EXPOSED_TOOLS.filter((n) => this.registry.has(n)).map((n) => this.registry.require(n));
  }

  /** Phase 8.0 — the system-of-record read tool. */
  async searchClients(input: SearchClientsInput, ctx: BridgeCallContext): Promise<BridgeOutcome> {
    return this.auditBridgeRefusal('search_clients', ctx, await this.searchClientsImpl(input, ctx));
  }
  private async searchClientsImpl(input: SearchClientsInput, ctx: BridgeCallContext): Promise<BridgeOutcome> {
    const g = await this.guardedDispatch<ClientRecord[]>(
      'READ_ONLY', 'search_clients', ctx,
      () => this.source.searchClients(input),
      { tool: 'search_clients', q: input.q },
    );
    if (!g.ok) return { status: 'refused', tool: 'search_clients', stage: g.stage, reason: g.reason };
    return { status: 'ok', tool: 'search_clients', rows: g.value, auditSeq: g.auditSeq };
  }

  /** Phase 8.1 — a factory/governance-state read tool. Same full guard stack; no internal exemption. */
  async readFactoryState(name: FactoryReadTool, ctx: BridgeCallContext, params: FactoryReadParams = {}): Promise<FactoryReadOutcome> {
    return this.auditBridgeRefusal(name, ctx, await this.readFactoryStateImpl(name, ctx, params));
  }
  private async readFactoryStateImpl(name: FactoryReadTool, ctx: BridgeCallContext, params: FactoryReadParams = {}): Promise<FactoryReadOutcome> {
    if (!this.factoryPorts) return { status: 'refused', tool: name, stage: 'registry', reason: 'factory read ports not configured' };
    const summary: Record<string, unknown> = params.ref ? { tool: name, ref: params.ref } : { tool: name };
    const g = await this.guardedDispatch<unknown>('READ_ONLY', name, ctx, () => this.readFromPort(name, params), summary);
    if (!g.ok) return { status: 'refused', tool: name, stage: g.stage, reason: g.reason };
    return { status: 'ok', tool: name, data: g.value, auditSeq: g.auditSeq };
  }

  /**
   * Phase 8.2 — a DRAFT_ONLY draft/planning tool. Produces an inert proposed artifact; the outcome status is
   * always DRAFT-AWAITING-HUMAN-REVIEW. Same full guard stack; the draft handler has no write/mutation path.
   */
  async draftWithTool(name: DraftTool, ctx: BridgeCallContext, params: DraftParams = {}): Promise<DraftOutcome> {
    return this.auditBridgeRefusal(name, ctx, await this.draftWithToolImpl(name, ctx, params));
  }
  private async draftWithToolImpl(name: DraftTool, ctx: BridgeCallContext, params: DraftParams = {}): Promise<DraftOutcome> {
    if (!this.draftPorts) return { status: 'refused', tool: name, stage: 'registry', reason: 'draft ports not configured' };
    const summary: Record<string, unknown> = params.ref ? { tool: name, ref: params.ref } : { tool: name };
    const g = await this.guardedDispatch<unknown>('DRAFT_ONLY', name, ctx, () => this.produceDraft(name, params), summary);
    if (!g.ok) return { status: 'refused', tool: name, stage: g.stage, reason: g.reason };
    // The proposed artifact is wrapped in the draft literal — NOT committed, recorded, or acted on.
    return { status: DRAFT_STATUS, tool: name, draft: g.value, auditSeq: g.auditSeq };
  }

  /**
   * Phase 8.3 — an APPROVAL_REQUIRED_WRITE internal-state mutation. It commits ONLY with a single-use,
   * per-action, human-approved, unforgeable ConsumedApproval token. No token ⇒ STOP_FOR_APPROVAL (nothing
   * written). The mutation runs inside the committed audit callback (intent before, result after).
   */
  async writeWithTool(name: WriteTool, ctx: BridgeCallContext, params: WriteParams = {}): Promise<WriteOutcome> {
    return this.auditBridgeRefusal(name, ctx, await this.writeWithToolImpl(name, ctx, params));
  }
  private async writeWithToolImpl(name: WriteTool, ctx: BridgeCallContext, params: WriteParams = {}): Promise<WriteOutcome> {
    if (!this.writeStores) return { status: 'refused', tool: name, stage: 'registry', reason: 'write stores not configured' };
    // 1. TOOL REGISTRY — fail-closed.
    let def: ToolDefinition;
    try {
      def = this.registry.require(name);
    } catch {
      return { status: 'refused', tool: name, stage: 'registry', reason: `tool not registered: "${name}" (fail-closed)` };
    }
    // 2. DISPATCH-BY-CLASS — this entrypoint serves ONLY APPROVAL_REQUIRED_WRITE tools.
    const toolClass = classifyRegisteredTool(def);
    if (toolClass !== 'APPROVAL_REQUIRED_WRITE') {
      return { status: 'refused', tool: name, stage: 'read-only-gate', reason: `"${name}" is ${toolClass}; not an approval-gated write` };
    }
    const binding = { tool: name, target: params.target, payloadJson: canonicalPayload(params.payload) };
    // 3. APPROVAL PRE-CHECK (non-consuming): no single-use, per-action human approval ⇒ STOP, nothing written.
    //    The token is only CONSUMED later, inside the committed callback, after authorize (kill) passes —
    //    so a killed/unauthorized write refuses with the token preserved (kill beats approval).
    if (!this.approvalGate || !params.approvalActionId || !this.approvalGate.isApprovedForAction(params.approvalActionId, binding)) {
      return { status: 'STOP_FOR_APPROVAL', tool: name, reason: 'no single-use, per-action human approval for this action — write withheld (deny-by-default)' };
    }
    // 4. GUARD STACK + audit-bracketed mutation.
    const g = await this.runGuardedApprovedAction(name, def, ctx, params.approvalActionId, binding,
      { tool: name, target: params.target }, (token) => this.performInternalWrite(name, params, token));
    if (!g.ok) return { status: 'refused', tool: name, stage: g.stage, reason: g.reason };
    return { status: 'WRITE-COMMITTED', tool: name, committed: g.value.committed, approvalId: g.value.approvalId, auditSeq: g.auditSeq };
  }

  /**
   * Phase 8.4 — an EXTERNAL action (acts on a system OUTSIDE the factory). Every Phase 8.3 guarantee PLUS
   * external hardening: the approval must bind the EXACT target + effect; no bulk; production gate; the kill
   * switch and audit are untargetable; blast-radius (system/id/env/reversibility) recorded in the audit intent.
   * A FORBIDDEN tool is refused before any approval. Commits ONLY via the consumed-token + hardening gauntlet.
   */
  async externalActionWithTool(name: ExternalTool, ctx: BridgeCallContext, params: ExternalParams = {}): Promise<ExternalOutcome> {
    return this.auditBridgeRefusal(name, ctx, await this.externalActionWithToolImpl(name, ctx, params));
  }
  private async externalActionWithToolImpl(name: ExternalTool, ctx: BridgeCallContext, params: ExternalParams = {}): Promise<ExternalOutcome> {
    // SOLE-AUTHORITY (8.8b generalized in 9.3 / #9): EVERY external action is capability-encapsulated behind
    // its owning module (PR Engine / per-action gateway). The generic path can assemble NONE of them — use the
    // capability-gated method (createGithubRepo / openPullRequest / createTicket / updateCrmRecord / sendEmail
    // / deployPackage / createMilestone / createLabel / createIssueBatch). This closes the bypass for all nine.
    if (ENCAPSULATED_EXTERNAL_TOOLS.has(name)) {
      return { status: 'refused', tool: name, stage: 'encapsulated', reason: `"${name}" is reachable only through its capability-holding owner (encapsulated); the generic external path cannot assemble it` };
    }
    // A non-external name routed here (e.g. a FORBIDDEN tool) still fails closed inside runExternalAction.
    return this.runExternalAction(name, ctx, params);
  }

  // ── Capability minters — one per external action. Each mints that action's single, unforgeable, PER-ACTION
  //    capability. The sole holder is the action's owning module (PR Engine / per-action gateway), to which it
  //    is granted at the composition root. (8.8b's `grantPrOpenCapability` generalized to all nine.) ──
  grantCreateGithubRepoCapability(): ExternalCapability<'create_github_repo'> { return mintExternalCapability('create_github_repo'); }
  grantOpenPullRequestCapability(): ExternalCapability<'open_pull_request'> { return mintExternalCapability('open_pull_request'); }
  grantCreateTicketCapability(): ExternalCapability<'create_ticket'> { return mintExternalCapability('create_ticket'); }
  grantUpdateCrmRecordCapability(): ExternalCapability<'update_crm_record'> { return mintExternalCapability('update_crm_record'); }
  grantSendEmailCapability(): ExternalCapability<'send_email'> { return mintExternalCapability('send_email'); }
  grantDeployPackageCapability(): ExternalCapability<'deploy_package'> { return mintExternalCapability('deploy_package'); }
  grantCreateMilestoneCapability(): ExternalCapability<'create_milestone'> { return mintExternalCapability('create_milestone'); }
  grantCreateLabelCapability(): ExternalCapability<'create_label'> { return mintExternalCapability('create_label'); }
  grantCreateIssueBatchCapability(): ExternalCapability<'create_issue_batch'> { return mintExternalCapability('create_issue_batch'); }
  /** @deprecated Phase 8.8b name retained for the PR Engine — aliases `grantOpenPullRequestCapability`. */
  grantPrOpenCapability(): OpenPrCapability { return mintExternalCapability('open_pull_request'); }

  // ── Capability-gated external actions — the ONLY path that assembles + runs each external action. Holding
  //    the unforgeable, per-action capability IS the authority to assemble it; no other module can construct
  //    the capability, so no other module can drive that action. Each runs the UNCHANGED full 8.4 gauntlet. ──
  createGithubRepo(capability: ExternalCapability<'create_github_repo'>, ctx: BridgeCallContext, params: ExternalParams = {}): Promise<ExternalOutcome> {
    return this.runEncapsulatedExternal('create_github_repo', capability, ctx, params);
  }
  /** Phase 8.8b — the PR Engine's sole open path. The gauntlet is the UNCHANGED full Phase 8.4 path. */
  openPullRequest(capability: OpenPrCapability, ctx: BridgeCallContext, params: ExternalParams = {}): Promise<ExternalOutcome> {
    return this.runEncapsulatedExternal('open_pull_request', capability, ctx, params);
  }
  createTicket(capability: ExternalCapability<'create_ticket'>, ctx: BridgeCallContext, params: ExternalParams = {}): Promise<ExternalOutcome> {
    return this.runEncapsulatedExternal('create_ticket', capability, ctx, params);
  }
  updateCrmRecord(capability: ExternalCapability<'update_crm_record'>, ctx: BridgeCallContext, params: ExternalParams = {}): Promise<ExternalOutcome> {
    return this.runEncapsulatedExternal('update_crm_record', capability, ctx, params);
  }
  sendEmail(capability: ExternalCapability<'send_email'>, ctx: BridgeCallContext, params: ExternalParams = {}): Promise<ExternalOutcome> {
    return this.runEncapsulatedExternal('send_email', capability, ctx, params);
  }
  deployPackage(capability: ExternalCapability<'deploy_package'>, ctx: BridgeCallContext, params: ExternalParams = {}): Promise<ExternalOutcome> {
    return this.runEncapsulatedExternal('deploy_package', capability, ctx, params);
  }
  createMilestone(capability: ExternalCapability<'create_milestone'>, ctx: BridgeCallContext, params: ExternalParams = {}): Promise<ExternalOutcome> {
    return this.runEncapsulatedExternal('create_milestone', capability, ctx, params);
  }
  createLabel(capability: ExternalCapability<'create_label'>, ctx: BridgeCallContext, params: ExternalParams = {}): Promise<ExternalOutcome> {
    return this.runEncapsulatedExternal('create_label', capability, ctx, params);
  }
  /** Gated bulk — ONE action carrying a bounded, content-bound enumerated issue list. Runs the UNCHANGED
   *  8.4 gauntlet; the per-action approval binds `params.payload` (the enumerated issues) — so an approved
   *  batch cannot be swapped/extended/altered after approval (content mismatch ⇒ withheld). */
  createIssueBatch(capability: ExternalCapability<'create_issue_batch'>, ctx: BridgeCallContext, params: ExternalParams = {}): Promise<ExternalOutcome> {
    return this.runEncapsulatedExternal('create_issue_batch', capability, ctx, params);
  }

  /**
   * The shared sole-authority runner. UNREACHABLE without a capability — the public methods require it as a
   * typed argument and the constructor (`mintExternalCapability`) is module-private. Defense-in-depth: the
   * capability's RUNTIME brand must match the action — the type system already binds them per-action; this
   * also rejects a deliberately cast/mis-minted capability (one action's capability cannot drive another).
   * The gauntlet it then runs is the UNCHANGED full Phase 8.4 path (`runExternalAction`).
   */
  private async runEncapsulatedExternal<N extends ExternalTool>(name: N, capability: ExternalCapability<N>, ctx: BridgeCallContext, params: ExternalParams): Promise<ExternalOutcome> {
    if ((capability as unknown as Record<symbol, unknown> | null | undefined)?.[EXTERNAL_CAP_BRAND] !== name) {
      return this.auditBridgeRefusal(name, ctx, { status: 'refused', tool: name, stage: 'encapsulated', reason: `capability does not authorize "${name}" (per-action binding)` });
    }
    return this.auditBridgeRefusal(name, ctx, await this.runExternalAction(name, ctx, params));
  }

  private async runExternalAction(name: ExternalTool, ctx: BridgeCallContext, params: ExternalParams = {}): Promise<ExternalOutcome> {
    if (!this.externalSystems) return { status: 'refused', tool: name, stage: 'registry', reason: 'external systems not configured' };
    // 1. TOOL REGISTRY — fail-closed.
    let def: ToolDefinition;
    try {
      def = this.registry.require(name);
    } catch {
      return { status: 'refused', tool: name, stage: 'registry', reason: `tool not registered: "${name}" (fail-closed)` };
    }
    // 2. FORBIDDEN tier — never callable; refused BEFORE any approval is even considered.
    const toolClass = classifyRegisteredTool(def);
    if (FORBIDDEN_TOOL_SET.has(name) || toolClass === 'FORBIDDEN') {
      return { status: 'refused', tool: name, stage: 'forbidden', reason: `"${name}" is FORBIDDEN — never callable (no token, no human, nothing unlocks it)` };
    }
    if (toolClass !== 'APPROVAL_REQUIRED_WRITE') {
      return { status: 'refused', tool: name, stage: 'read-only-gate', reason: `"${name}" is ${toolClass}; not an approval-gated external action` };
    }
    // 3. EXTERNAL HARDENING (deny-by-default, before approval) —
    //    (a) the kill switch and audit can NEVER be the target of an external action.
    if (targetsProtectedSubsystem(params.target)) {
      return { status: 'refused', tool: name, stage: 'forbidden', reason: 'the kill switch and audit log can never be the target of an external action' };
    }
    //    (b) no bulk — exactly one target per approved action.
    if (params.targets && params.targets.length !== 1) {
      return { status: 'refused', tool: name, stage: 'hardening', reason: 'bulk/multi-target external action refused — one approval authorizes one external effect' };
    }
    const target = params.target ?? (params.targets && params.targets.length === 1 ? params.targets[0] : undefined);
    //    (c) the approval must name a SPECIFIC target + effect — vague/target-less ⇒ refused.
    if (!target || !target.system?.trim() || !target.targetId?.trim() || !target.effect?.trim()) {
      return { status: 'refused', tool: name, stage: 'hardening', reason: 'external action refused — a specific target (system + id) and effect are required (deny-by-default)' };
    }
    // 4. Per-action binding includes the exact external target + effect + environment, so an approval for one
    //    target/effect/env cannot authorize a different one. Production targets thus require a production-scoped approval.
    const binding: ApprovalBinding = {
      tool: name,
      target: target.targetId,
      payloadJson: canonicalPayload({ system: target.system, effect: target.effect, environment: target.environment ?? null, payload: params.payload ?? null }),
    };
    // 5. APPROVAL PRE-CHECK (non-consuming): no specific-target human approval ⇒ STOP, external port NEVER called.
    if (!this.approvalGate || !params.approvalActionId || !this.approvalGate.isApprovedForAction(params.approvalActionId, binding)) {
      const extra = isProductionTarget(target) ? ' (a production target requires an approval explicitly scoped to production)' : '';
      return { status: 'STOP_FOR_APPROVAL', tool: name, reason: `no single-use, specific-target human approval for this external action — withheld${extra}` };
    }
    // 6. GUARD STACK + audit-bracketed external action. The audit intent records the BLAST RADIUS.
    const summary: Record<string, unknown> = {
      tool: name, system: target.system, target_id: target.targetId,
      environment: target.environment ?? ctx.environment, reversibility: target.reversible, effect: target.effect,
    };
    const g = await this.runGuardedApprovedAction(name, def, ctx, params.approvalActionId, binding, summary,
      (token) => this.performExternal(name, target, params.payload, token));
    if (!g.ok) return { status: 'refused', tool: name, stage: g.stage, reason: g.reason };
    return { status: 'EXTERNAL-ACTION-COMMITTED', tool: name, committed: g.value.committed, approvalId: g.value.approvalId, target, auditSeq: g.auditSeq };
  }

  // ── the shared guarded approved action: authorize (Permission → Kill Switch; kill beats approval) → audit
  //    intent → consume the single-use token + perform inside the committed callback → audit result → redact. ──
  private async runGuardedApprovedAction(
    name: WriteTool | ExternalTool,
    def: ToolDefinition,
    ctx: BridgeCallContext,
    actionId: string | undefined,
    binding: ApprovalBinding,
    summary: Record<string, unknown>,
    perform: (token: ConsumedApproval) => Promise<unknown>,
  ): Promise<GuardedValue<{ committed: unknown; approvalId: string }>> {
    const req: SequencerRequest = {
      principal: ctx.principal,
      organization_id: ctx.organization_id,
      session: ctx.session,
      tool: { name, classification: def.classification, permission_level: def.permissionLevel },
      environment: ctx.environment,
      via: ctx.via,
      request_summary: summary, // BLAST RADIUS for external actions (system/target_id/environment/reversibility)
    };
    const outcome = await this.sequencer.run<{ committed: unknown; approvalId: string }>(req, async () => {
      // authorize (Permission + Kill) has passed; the intent is durable. NOW consume the per-action token —
      // the action is UNREACHABLE without the ConsumedApproval the dispatcher mints here.
      const d = await this.dispatcher.dispatch<never, never, { record: unknown; approvalId: string }>('APPROVAL_REQUIRED_WRITE', {
        approvalWrite: (token: ConsumedApproval) => perform(token).then((record) => ({ record, approvalId: token.approvalId })),
      }, { tool: name, approvalActionId: actionId, approvalBinding: binding });
      if (d.status !== 'executed') throw new Error(`approval consumption failed: ${d.status}`); // do NOT act
      return { value: { committed: d.result.record, approvalId: d.result.approvalId }, outcome: { status: 'success' } };
    });
    if (outcome.status === 'refused') return { ok: false, stage: outcome.stage, reason: outcome.reason }; // authorize/kill
    if (outcome.status === 'execute-failed') return { ok: false, stage: 'execute', reason: 'action withheld — approval not consumable' };
    return { ok: true, value: { committed: this.redactValue(outcome.value.committed), approvalId: outcome.value.approvalId }, auditSeq: outcome.intent.seq };
  }

  /** Route to the matching append-only write store. The token proves a consumed human approval. */
  private performInternalWrite(name: WriteTool, params: WriteParams, _token: ConsumedApproval): Promise<unknown> {
    const s = this.writeStores!;
    switch (name) {
      case 'record_review_decision': return s.recordReviewDecision(params);
      case 'record_human_signoff': return s.recordHumanSignoff(params);
      case 'create_open_item': return s.createOpenItem(params);
      case 'record_approval_gate': return s.recordApprovalGate(params);
      case 'update_risk_status': return s.updateRiskStatus(params);
      case 'record_wave_signoff': return s.recordWaveSignoff(params);
    }
  }

  /** Route to the matching external system (one target). The token proves a consumed, specific-target approval. */
  private performExternal(name: ExternalTool, target: ExternalTarget, payload: Record<string, unknown> | undefined, _token: ConsumedApproval): Promise<unknown> {
    const x = this.externalSystems!;
    switch (name) {
      case 'create_github_repo': return x.createGithubRepo(target, payload);
      case 'open_pull_request': return x.openPullRequest(target, payload);
      case 'create_ticket': return x.createTicket(target, payload);
      case 'update_crm_record': return x.updateCrmRecord(target, payload);
      case 'send_email': return x.sendEmail(target, payload);
      case 'deploy_package': return x.deployPackage(target, payload);
      case 'create_milestone': return x.createMilestone(target, payload);
      case 'create_label': return x.createLabel(target, payload);
      case 'create_issue_batch': return x.createIssueBatch(target, payload);
    }
  }

  // ── the single guarded, class-dispatched production path. `expectedClass` is the ONLY handler slot
  //    offered, so dispatch-by-class refuses any tool whose registered class differs (no tier leakage). ──
  private async guardedDispatch<T>(
    expectedClass: 'READ_ONLY' | 'DRAFT_ONLY',
    name: ExposedToolName,
    ctx: BridgeCallContext,
    produce: () => Promise<T>,
    summary: Record<string, unknown>,
  ): Promise<GuardedValue<T>> {
    // 1. TOOL REGISTRY — fail-closed.
    let def: ToolDefinition;
    try {
      def = this.registry.require(name);
    } catch {
      return { ok: false, stage: 'registry', reason: `tool not registered: "${name}" (fail-closed)` };
    }

    // 2. DISPATCH-BY-CLASS — the registered class selects the path. We offer ONLY the handler slot for
    //    `expectedClass`; a tool of any other class hits a missing handler and is refused here. A DRAFT_ONLY
    //    tool can never reach a write path, and a READ_ONLY tool can never reach the draft path.
    const toolClass = classifyRegisteredTool(def);
    const run = () => this.runGuarded<T>(name, def, ctx, produce, summary);
    const d = expectedClass === 'READ_ONLY'
      ? await this.dispatcher.dispatch<GuardedValue<T>, never, never>(toolClass, { readOnly: run })
      : await this.dispatcher.dispatch<never, GuardedValue<T>, never>(toolClass, { draftOnly: run });

    if (expectedClass === 'READ_ONLY' && d.status === 'ok') return d.data;
    if (expectedClass === 'DRAFT_ONLY' && d.status === DRAFT_STATUS) return d.draft;
    // Wrong tier for this entrypoint (or FORBIDDEN/no-handler) → refuse before any side effect.
    const detail = d.status === 'refused' ? d.reason : d.status;
    return { ok: false, stage: 'read-only-gate', reason: `"${name}" is ${toolClass}; not exposed via the ${expectedClass} path (${detail})` };
  }

  // ── the guard stack: authorize (Permission → Kill Switch) → audit intent → execute produce → audit result → redact ──
  private async runGuarded<T>(
    name: ExposedToolName,
    def: ToolDefinition,
    ctx: BridgeCallContext,
    produce: () => Promise<T>,
    summary: Record<string, unknown>,
  ): Promise<GuardedValue<T>> {
    const req: SequencerRequest = {
      principal: ctx.principal,
      organization_id: ctx.organization_id,
      session: ctx.session,
      tool: { name, classification: def.classification, permission_level: def.permissionLevel },
      environment: ctx.environment,
      via: ctx.via,
      request_summary: summary,
    };
    const outcome = await this.sequencer.run<T>(req, async () => ({ value: await produce(), outcome: { status: 'success' } }));
    if (outcome.status === 'refused') return { ok: false, stage: outcome.stage, reason: outcome.reason };
    if (outcome.status === 'execute-failed') return { ok: false, stage: 'execute', reason: 'production failed' };
    // REDACT before data leaves the bridge. INSTRUCTION-BOUNDARY: returned content (read row OR draft) is inert.
    return { ok: true, value: this.redactValue(outcome.value) as T, auditSeq: outcome.intent.seq };
  }

  /** Apply the deny-by-default allowlist to every object in the result (rows, records, nested). */
  private redactValue(v: unknown): unknown {
    if (Array.isArray(v)) return v.map((x) => this.redactValue(x));
    if (v && typeof v === 'object') return this.redactor.redactSummary(v as Record<string, unknown>) ?? {};
    return v; // primitive — no keys to redact
  }

  private readFromPort(name: FactoryReadTool, p: FactoryReadParams): Promise<unknown> {
    const f = this.factoryPorts!;
    switch (name) {
      case 'read_factory_status': return f.factoryStatus();
      case 'read_wave_status': return f.waveStatus();
      case 'read_module_status': return f.moduleStatus();
      case 'read_open_gates': return f.openGates();
      case 'read_review_log': return f.reviewLog();
      case 'read_evidence_pack': return f.evidencePack(p);
      case 'read_open_items': return f.openItems();
      case 'read_domain_registry': return f.domainRegistry();
      case 'read_project_registry': return f.projectRegistry();
      case 'read_feature_registry': return f.featureRegistry();
      case 'read_risk_register': return f.riskRegister();
      case 'read_product_creation_plan': return f.productCreationPlan(p);
      case 'read_repo_build_plan': return f.repoBuildPlan(p);
      case 'read_tool_registry': return f.toolRegistry();
      case 'read_audit_summary': return f.auditSummary(p);
    }
  }

  /** Produce a draft via the matching read-only draft port. No method here mutates anything. */
  private produceDraft(name: DraftTool, p: DraftParams): Promise<unknown> {
    const d = this.draftPorts!;
    switch (name) {
      case 'draft_next_prompt': return d.nextPrompt(p);
      case 'draft_review_decision': return d.reviewDecision(p);
      case 'draft_wave_report': return d.waveReport(p);
      case 'draft_product_plan': return d.productPlan(p);
      case 'draft_risk_summary': return d.riskSummary(p);
      case 'draft_open_items_summary': return d.openItemsSummary(p);
      case 'draft_repo_plan': return d.repoPlan(p);
    }
  }
}
