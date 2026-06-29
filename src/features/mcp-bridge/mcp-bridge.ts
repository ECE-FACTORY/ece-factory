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
import type { SequencerRequest, SequencerOutcome, ExecuteFn } from '../audit-engine/sequencer.js';
import type { HumanActor, SessionInfo, Environment } from '../audit-engine/schema.js';
import { ClassDispatcher, DRAFT_STATUS, type ApprovalGatePort } from './tool-classes.js';
import { classifyRegisteredTool, FACTORY_READ_TOOLS, type FactoryReadTool, type FactoryReadPorts, type FactoryReadParams } from './factory-read-tools.js';
import { DRAFT_TOOLS, type DraftTool, type DraftPorts, type DraftParams } from './draft-tools.js';

/** The READ_ONLY surface: the system-of-record tool (8.0) + the factory read tools (8.1). */
export const EXPOSED_READ_TOOLS = ['search_clients', ...FACTORY_READ_TOOLS] as const;
/** The DRAFT_ONLY surface (8.2) — proposers, never actions. */
export const EXPOSED_DRAFT_TOOLS = [...DRAFT_TOOLS] as const;
/** The full exposed surface — READ_ONLY + DRAFT_ONLY only (no write/external tool this phase). */
export const EXPOSED_TOOLS = [...EXPOSED_READ_TOOLS, ...EXPOSED_DRAFT_TOOLS] as const;
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

export type BridgeRefusalStage = 'registry' | 'read-only-gate' | 'authorize' | 'validate' | 'intent-commit' | 'execute';

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

/** Internal flat result of a guarded, class-dispatched production (read or draft). */
type GuardedValue<T> = { ok: true; value: T; auditSeq: number } | { ok: false; stage: BridgeRefusalStage; reason: string };

export interface McpBridgeOptions {
  factoryPorts?: FactoryReadPorts;
  draftPorts?: DraftPorts;
  /** Reserved: the Approval Gate the dispatcher consults for APPROVAL_REQUIRED_WRITE (no write tool exposed yet). */
  approvalGate?: ApprovalGatePort;
}

export class McpBridge {
  private readonly dispatcher: ClassDispatcher;
  private readonly factoryPorts?: FactoryReadPorts;
  private readonly draftPorts?: DraftPorts;

  constructor(
    private readonly registry: ToolRegistryReader,
    private readonly sequencer: AuditedSequencerPort,
    private readonly source: ClientReadModel,
    private readonly redactor: ResultRedactorPort,
    opts: McpBridgeOptions = {},
  ) {
    this.factoryPorts = opts.factoryPorts;
    this.draftPorts = opts.draftPorts;
    this.dispatcher = new ClassDispatcher(opts.approvalGate);
  }

  /** The READ_ONLY tools the bridge exposes (those registered) — fail-closed via the registry. */
  listTools(): ToolDefinition[] {
    return EXPOSED_TOOLS.filter((n) => this.registry.has(n)).map((n) => this.registry.require(n));
  }

  /** Phase 8.0 — the system-of-record read tool. */
  async searchClients(input: SearchClientsInput, ctx: BridgeCallContext): Promise<BridgeOutcome> {
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
    if (!this.draftPorts) return { status: 'refused', tool: name, stage: 'registry', reason: 'draft ports not configured' };
    const summary: Record<string, unknown> = params.ref ? { tool: name, ref: params.ref } : { tool: name };
    const g = await this.guardedDispatch<unknown>('DRAFT_ONLY', name, ctx, () => this.produceDraft(name, params), summary);
    if (!g.ok) return { status: 'refused', tool: name, stage: g.stage, reason: g.reason };
    // The proposed artifact is wrapped in the draft literal — NOT committed, recorded, or acted on.
    return { status: DRAFT_STATUS, tool: name, draft: g.value, auditSeq: g.auditSeq };
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
