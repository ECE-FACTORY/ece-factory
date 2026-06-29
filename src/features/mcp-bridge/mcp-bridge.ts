// MCP Bridge (Module 1, Wave 5) — the controlled, READ-ONLY doorway between an MCP client and the
// factory's system of record. It exposes exactly one tool to start: `search_clients`.
//
// WHY IT COMES AFTER THE FOUNDATION: every tool call flows through the full Wave 1–2 guard stack, all of
// it CONSUMED via injected ports (never re-implemented here):
//   1. Tool Registry  — the tool must be registered & READ_ONLY; unknown ⇒ refused (fail-closed).
//   2. READ-ONLY gate  — the bridge executes ONLY read/READ_ONLY tools; a write tool is refused before
//                        any execution. There is NO write tool and NO mutation path through the bridge.
//   3. Write-ahead sequencer — authorize (Permission Engine, which itself consults the Kill Switch) →
//                        commit audit INTENT (human-attributed, fail-closed) → execute → commit RESULT.
//                        A refused call writes a refusal-audit record (handled inside the sequencer).
//   4. Redaction       — results are redacted (deny-by-default allowlist) before they leave the bridge.
//
// INSTRUCTION-BOUNDARY: data returned from the system of record is DATA, never instruction. The bridge
// returns rows as inert values; it never inspects, parses, or acts on row content as a command.
//
// STANDALONE-PACKAGEABLE: every cross-engine reference below is `import type` (zero runtime coupling);
// the guard engines and the read model are injected. Packaging target: the `ece-mcp-bridge` repo.

import type { ToolRegistryReader, ToolDefinition } from '../tool-registry/tool-registry.js';
import type { SequencerRequest, SequencerOutcome, ExecuteFn } from '../audit-engine/sequencer.js';
import type { HumanActor, SessionInfo, Environment } from '../audit-engine/schema.js';

/** The exact set of tools the bridge exposes. Read-only; one tool to start. */
export const BRIDGE_TOOLS = ['search_clients'] as const;
export type BridgeToolName = (typeof BRIDGE_TOOLS)[number];

export interface SearchClientsInput {
  q: string;
  organizationId: string;
}

/** A row from the system of record. Opaque key/value data — NEVER interpreted as instruction. */
export type ClientRecord = Record<string, unknown>;

/**
 * The read model port — the ONLY capability the bridge has over the system of record. It is read-only
 * by construction: a single search method, no create/update/delete. There is no mutation method to call.
 */
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

/**
 * Outcome — read data, or a refusal. There is intentionally NO 'written'/'created'/'mutated'/'updated'
 * member: the bridge cannot represent having changed the system of record.
 */
export type BridgeOutcome =
  | { status: 'ok'; tool: BridgeToolName; rows: ClientRecord[]; auditSeq: number }
  | { status: 'refused'; tool: string; stage: BridgeRefusalStage; reason: string };

export class McpBridge {
  constructor(
    private readonly registry: ToolRegistryReader,
    private readonly sequencer: AuditedSequencerPort,
    private readonly source: ClientReadModel,
    private readonly redactor: ResultRedactorPort,
  ) {}

  /** The tools the bridge exposes — resolved from the registry (fail-closed) and asserted READ_ONLY. */
  listTools(): ToolDefinition[] {
    return BRIDGE_TOOLS.map((name) => {
      const def = this.registry.require(name); // throws if somehow unregistered (fail-closed)
      return def;
    });
  }

  /** The one exposed tool. Reads the system of record through the full guard stack. */
  async searchClients(input: SearchClientsInput, ctx: BridgeCallContext): Promise<BridgeOutcome> {
    return this.callReadTool('search_clients', ctx, () => this.source.searchClients(input), { tool: 'search_clients', q: input.q });
  }

  /** The single guarded read path. There is no write counterpart anywhere in this class. */
  private async callReadTool(
    name: BridgeToolName,
    ctx: BridgeCallContext,
    read: () => Promise<ClientRecord[]>,
    requestSummary: Record<string, unknown>,
  ): Promise<BridgeOutcome> {
    // 1. TOOL REGISTRY — fail-closed. An unregistered tool throws; the bridge refuses, never defaults.
    let def: ToolDefinition;
    try {
      def = this.registry.require(name);
    } catch {
      return { status: 'refused', tool: name, stage: 'registry', reason: `tool not registered: "${name}" (fail-closed)` };
    }

    // 2. READ-ONLY GATE (structural) — the bridge executes ONLY read/READ_ONLY tools. A write-classified
    //    or write tool is refused BEFORE any execution: there is no mutation path through the bridge.
    if (def.readOrWrite !== 'read' || def.classification !== 'READ_ONLY') {
      return { status: 'refused', tool: name, stage: 'read-only-gate', reason: `bridge is read-only — "${name}" is ${String(def.classification)}/${def.readOrWrite}; no write path` };
    }

    // 3. WRITE-AHEAD SEQUENCER — authorize (Permission Engine consults the Kill Switch) → audit intent
    //    (human-attributed, fail-closed) → execute the READ inside the committed callback → audit result.
    //    A refusal at authorize/validate/intent-commit is recorded as a refusal-audit by the sequencer.
    const req: SequencerRequest = {
      principal: ctx.principal,
      organization_id: ctx.organization_id,
      session: ctx.session,
      tool: { name, classification: def.classification, permission_level: def.permissionLevel },
      environment: ctx.environment,
      via: ctx.via,
      request_summary: requestSummary,
    };
    const outcome = await this.sequencer.run<ClientRecord[]>(req, async () => ({
      value: await read(),
      outcome: { status: 'success' },
    }));

    if (outcome.status === 'refused') {
      return { status: 'refused', tool: name, stage: outcome.stage, reason: outcome.reason };
    }
    if (outcome.status === 'execute-failed') {
      return { status: 'refused', tool: name, stage: 'execute', reason: 'read failed' };
    }

    // 4. REDACT before the data leaves the bridge (deny-by-default allowlist). Each row is filtered;
    //    INSTRUCTION-BOUNDARY: rows are passed through as inert data — never inspected or actioned.
    const rows = outcome.value.map((r) => this.redactor.redactSummary(r) ?? {});
    return { status: 'ok', tool: name, rows, auditSeq: outcome.intent.seq };
  }
}
