import { describe, it, expect } from 'vitest';
import { McpServerCore, type McpServerBridge } from './server-core.js';
import { EXPOSED_TOOLS, type BridgeCallContext, type BridgeOutcome, type FactoryReadOutcome, type DraftOutcome, type WriteOutcome, type ExternalOutcome } from '../features/mcp-bridge/mcp-bridge.js';
import { DRAFT_STATUS } from '../features/mcp-bridge/tool-classes.js';
import { FORBIDDEN_TOOLS } from '../features/mcp-bridge/external-tools.js';
import { createDefaultToolRegistry } from '../features/tool-registry/tool-registry.js';
import { registerFactoryReadTools } from '../features/mcp-bridge/factory-read-tools.js';
import { registerDraftTools } from '../features/mcp-bridge/draft-tools.js';
import { registerWriteTools } from '../features/mcp-bridge/write-tools.js';
import { registerExternalTools, registerForbiddenTools } from '../features/mcp-bridge/external-tools.js';

// MCP Server Core — pure-logic. Proves it exposes EXACTLY the classified surface and routes each call to
// the correct bridge method BY CLASS, adding NO guard logic (a fake bridge records which method was hit).

class FakeBridge implements McpServerBridge {
  hits: string[] = [];
  async searchClients(): Promise<BridgeOutcome> { this.hits.push('searchClients'); return { status: 'ok', tool: 'search_clients', rows: [], auditSeq: 1 }; }
  async readFactoryState(name: string): Promise<FactoryReadOutcome> {
    this.hits.push(`read:${name}`);
    // mimic the bridge's fail-closed on unregistered
    return name.startsWith('read_') || name === 'search_clients'
      ? { status: 'ok', tool: name as never, data: { live: true }, auditSeq: 1 }
      : { status: 'refused', tool: name, stage: 'registry', reason: 'tool not registered (fail-closed)' };
  }
  async draftWithTool(name: string): Promise<DraftOutcome> { this.hits.push(`draft:${name}`); return { status: DRAFT_STATUS, tool: name as never, draft: {}, auditSeq: 1 }; }
  async writeWithTool(name: string): Promise<WriteOutcome> { this.hits.push(`write:${name}`); return { status: 'STOP_FOR_APPROVAL', tool: name as never, reason: 'no token (fake)' }; }
  async externalActionWithTool(name: string): Promise<ExternalOutcome> {
    this.hits.push(`external:${name}`);
    return (FORBIDDEN_TOOLS as readonly string[]).includes(name)
      ? { status: 'refused', tool: name, stage: 'forbidden', reason: 'FORBIDDEN — never callable' }
      : { status: 'STOP_FOR_APPROVAL', tool: name as never, reason: 'no token (fake)' };
  }
}

function ctx(): BridgeCallContext {
  return { principal: { user_id: 'op', email: 'op@ece.ae', role: 'operator' }, organization_id: 'orgA', session: { session_id: 's' }, environment: 'local', via: 'claude-code' };
}
function build() {
  const registry = createDefaultToolRegistry();
  registerFactoryReadTools(registry); registerDraftTools(registry); registerWriteTools(registry); registerExternalTools(registry); registerForbiddenTools(registry);
  const bridge = new FakeBridge();
  return { core: new McpServerCore(bridge, registry), bridge, registry };
}

describe('MCP Server Core — exposes exactly the classified surface', () => {
  it('lists exactly the 35 EXPOSED_TOOLS in the four tiers; no FORBIDDEN, no unknown', () => {
    const { core, registry } = build();
    const tools = core.listTools();
    expect(tools).toHaveLength(EXPOSED_TOOLS.length); // 16 + 7 + 6 + 6 = 35
    expect(tools.map((t) => t.name).sort()).toEqual([...EXPOSED_TOOLS].sort());
    const classes = new Set(tools.map((t) => t.toolClass));
    expect([...classes].sort()).toEqual(['APPROVAL_REQUIRED_WRITE', 'DRAFT_ONLY', 'READ_ONLY']);
    // FORBIDDEN tools are registered but NOT exposed
    for (const f of FORBIDDEN_TOOLS) expect(tools.find((t) => t.name === f)).toBeUndefined();
    void registry;
  });
});

describe('MCP Server Core — routes by class, no guard logic (delegates to the bridge)', () => {
  it('a READ_ONLY tool ⇒ readFactoryState; search_clients ⇒ searchClients', async () => {
    const { core, bridge } = build();
    await core.callTool('read_factory_status', {}, ctx());
    await core.callTool('search_clients', { q: 'x' }, ctx());
    expect(bridge.hits).toContain('read:read_factory_status');
    expect(bridge.hits).toContain('searchClients');
  });
  it('a DRAFT_ONLY tool ⇒ draftWithTool', async () => {
    const { core, bridge } = build();
    const r = await core.callTool('draft_next_prompt', {}, ctx());
    expect(bridge.hits).toContain('draft:draft_next_prompt');
    expect(r.ok && (r.outcome as { status: string }).status).toBe(DRAFT_STATUS);
  });
  it('an internal write tool ⇒ writeWithTool and STOPs on the fake (no live write)', async () => {
    const { core, bridge } = build();
    const r = await core.callTool('create_open_item', { payload: { item: 'x' } }, ctx());
    expect(bridge.hits).toContain('write:create_open_item');
    expect(r.ok && (r.outcome as { status: string }).status).toBe('STOP_FOR_APPROVAL');
  });
  it('an external tool ⇒ externalActionWithTool and STOPs on the fake (no live external)', async () => {
    const { core, bridge } = build();
    const r = await core.callTool('create_github_repo', {}, ctx());
    expect(bridge.hits).toContain('external:create_github_repo');
    expect(r.ok && (r.outcome as { status: string }).status).toBe('STOP_FOR_APPROVAL');
  });
  it('a FORBIDDEN tool ⇒ delegated and refused (never exposed, never callable)', async () => {
    const { core } = build();
    const r = await core.callTool('force_delete_repo', {}, ctx());
    expect(r.ok && (r.outcome as { status: string; stage?: string }).status).toBe('refused');
  });
  it('an unregistered tool ⇒ refused (fail-closed, delegated to the bridge read path)', async () => {
    const { core } = build();
    const r = await core.callTool('totally_unknown_tool', {}, ctx());
    expect(r.ok && (r.outcome as { status: string }).status).toBe('refused');
  });
});
