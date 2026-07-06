// MCP Server Core (Phase 9.0, Part 1) — the transport-agnostic heart of the MCP server entrypoint.
//
// It is a PURE TRANSPORT ADAPTER over the proven McpBridge: it lists the classified tool surface and
// routes each incoming tool call to the correct bridge method BY CLASS. It adds NO guard logic — every
// call flows through the bridge's proven Registry → dispatch-by-class → Permission → Kill Switch →
// write-ahead Audit → Redaction stack. The core decides only WHICH bridge method to call, never WHETHER.
//
// This file is part of the composition-root/entrypoint layer (not a standalone engine), so it may import
// concrete bridge constants/classifier — but the bridge itself is consumed via a port (import type) so the
// core is unit-testable with a fake bridge.

import type { ToolRegistryReader, ToolDefinition } from '../layer-5-action/tool-registry/tool-registry.js';
import type {
  BridgeCallContext, BridgeOutcome, FactoryReadOutcome, DraftOutcome, WriteOutcome, ExternalOutcome,
} from '../layer-5-action/mcp-bridge/mcp-bridge.js';
import { EXPOSED_TOOLS, EXPOSED_EXTERNAL_TOOLS, FORBIDDEN_TOOL_SET } from '../layer-5-action/mcp-bridge/mcp-bridge.js';
import { classifyRegisteredTool } from '../layer-5-action/mcp-bridge/factory-read-tools.js';
import type { FactoryReadTool, FactoryReadParams } from '../layer-5-action/mcp-bridge/factory-read-tools.js';
import type { DraftTool, DraftParams } from '../layer-5-action/mcp-bridge/draft-tools.js';
import type { WriteTool, WriteParams } from '../layer-5-action/mcp-bridge/write-tools.js';
import type { ExternalTool, ExternalParams } from '../layer-5-action/mcp-bridge/external-tools.js';
import type { ToolClass } from '../layer-5-action/mcp-bridge/tool-classes.js';

/** The slice of the bridge the server delegates to. `McpBridge` satisfies this structurally. */
export interface McpServerBridge {
  searchClients(input: { q: string; organizationId: string }, ctx: BridgeCallContext): Promise<BridgeOutcome>;
  readFactoryState(name: FactoryReadTool, ctx: BridgeCallContext, params?: FactoryReadParams): Promise<FactoryReadOutcome>;
  draftWithTool(name: DraftTool, ctx: BridgeCallContext, params?: DraftParams): Promise<DraftOutcome>;
  writeWithTool(name: WriteTool, ctx: BridgeCallContext, params?: WriteParams): Promise<WriteOutcome>;
  externalActionWithTool(name: ExternalTool, ctx: BridgeCallContext, params?: ExternalParams): Promise<ExternalOutcome>;
}

export interface McpToolDescriptor {
  name: string;
  toolClass: ToolClass;
  purpose: string;
}

export type McpCallResult =
  | { ok: true; tool: string; outcome: unknown }
  | { ok: false; tool: string; error: string };

export class McpServerCore {
  constructor(
    private readonly bridge: McpServerBridge,
    private readonly registry: ToolRegistryReader,
  ) {}

  /** The classified surface — exactly the EXPOSED_TOOLS that are registered (FORBIDDEN are not exposed). */
  listTools(): McpToolDescriptor[] {
    return EXPOSED_TOOLS.filter((n) => this.registry.has(n)).map((n) => {
      const def = this.registry.require(n);
      return { name: n, toolClass: classifyRegisteredTool(def), purpose: def.purpose };
    });
  }

  /** Route a tool call to the matching bridge method BY CLASS. No guard logic — the bridge guards. */
  async callTool(name: string, args: Record<string, unknown>, ctx: BridgeCallContext): Promise<McpCallResult> {
    // Unregistered ⇒ delegate to a bridge read, which fails closed at the registry (refusal stays in the bridge).
    if (!this.registry.has(name)) {
      const outcome = await this.bridge.readFactoryState(name as FactoryReadTool, ctx);
      return { ok: true, tool: name, outcome };
    }
    const def: ToolDefinition = this.registry.require(name);
    const toolClass = classifyRegisteredTool(def);

    switch (toolClass) {
      case 'READ_ONLY': {
        const outcome = name === 'search_clients'
          ? await this.bridge.searchClients({ q: String(args.q ?? ''), organizationId: String(args.organizationId ?? ctx.organization_id) }, ctx)
          : await this.bridge.readFactoryState(name as FactoryReadTool, ctx, args as FactoryReadParams);
        return { ok: true, tool: name, outcome };
      }
      case 'DRAFT_ONLY': {
        const outcome = await this.bridge.draftWithTool(name as DraftTool, ctx, args as DraftParams);
        return { ok: true, tool: name, outcome };
      }
      case 'APPROVAL_REQUIRED_WRITE': {
        // external vs internal — both still guarded by the bridge; external/write stay on fakes this phase.
        const outcome = (EXPOSED_EXTERNAL_TOOLS as readonly string[]).includes(name)
          ? await this.bridge.externalActionWithTool(name as ExternalTool, ctx, args as ExternalParams)
          : await this.bridge.writeWithTool(name as WriteTool, ctx, args as WriteParams);
        return { ok: true, tool: name, outcome };
      }
      case 'FORBIDDEN':
      default: {
        // FORBIDDEN names route to the bridge's external entrypoint, which refuses them (refusal owned by the bridge).
        const outcome = await this.bridge.externalActionWithTool(name as ExternalTool, ctx, args as ExternalParams);
        return { ok: true, tool: name, outcome };
      }
    }
  }

  /** True iff the name is a FORBIDDEN tool (registered-and-refused; never exposed/listed). */
  isForbidden(name: string): boolean {
    return FORBIDDEN_TOOL_SET.has(name);
  }
}
