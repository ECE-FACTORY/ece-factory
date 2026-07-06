import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pkg from 'pg';
const { Pool } = pkg;
import { McpServerCore } from './server-core.js';
import { LiveFactoryReadPorts, type LiveReadSources } from './live-read-adapters.js';
import { handleRpc } from './server.js';
import { McpBridge, EXPOSED_TOOLS, type BridgeCallContext } from '../layer-5-action/mcp-bridge/mcp-bridge.js';
import { createDefaultToolRegistry } from '../layer-5-action/tool-registry/tool-registry.js';
import { registerFactoryReadTools } from '../layer-5-action/mcp-bridge/factory-read-tools.js';
import { registerDraftTools, type DraftPorts } from '../layer-5-action/mcp-bridge/draft-tools.js';
import { registerWriteTools, type WriteStores } from '../layer-5-action/mcp-bridge/write-tools.js';
import { registerExternalTools, registerForbiddenTools, type ExternalSystems } from '../layer-5-action/mcp-bridge/external-tools.js';
import { BridgeApprovalGate } from '../layer-5-action/mcp-bridge/tool-classes.js';
import { PostgresHashChainSink } from '../factory-shared/audit-engine/postgres-sink.js';
import { WriteAheadSequencer } from '../factory-shared/audit-engine/sequencer.js';
import { PermissionEngine } from '../layer-1-law/permission-engine/permission-engine.js';
import { RedactionEngine } from '../factory-shared/redaction-engine/redaction-engine.js';
import { ApprovalGate } from '../layer-1-law/approval-gate/approval-gate.js';
import { PostgresRiskRegisterStore } from '../factory-shared/risk-register/postgres-risk-store.js';
import { PostgresDomainRegistryStore } from '../factory-shared/domain-registry/postgres-domain-store.js';
import { PostgresProjectRegistryStore } from '../factory-shared/project-registry/postgres-project-store.js';
import { PostgresClientReadModel } from '../layer-5-action/mcp-bridge/postgres-client-readmodel.js';

// MCP Server entrypoint — end-to-end against REAL PostgreSQL. Proves the LIVE READ_ONLY tier returns real
// data through the full guard stack (audited + redacted), the server DB role is SELECT-only on the system of
// record, and write/external tiers still STOP on fakes (no live write/external this phase).

const cfg = { host: process.env.PGHOST ?? '127.0.0.1', port: Number(process.env.PGPORT ?? 55432), database: process.env.PGDATABASE ?? 'ece_audit_test' };
const appPool = new Pool({ ...cfg, user: 'ece_app' });    // the server role (SELECT-only on system of record)
const adminPool = new Pool({ ...cfg, user: 'postgres' });  // seeds the live store
const ORG = `orgMCP-${Date.now()}`;
const RISK_KEY = `RISK-MCP-${Date.now()}`;

// observable fakes for write/external — must NOT be reached (no live write/external this phase)
class WFakes implements WriteStores {
  calls = 0;
  private w = async (): Promise<never> => { this.calls++; throw new Error('unreached'); };
  recordReviewDecision = this.w; recordHumanSignoff = this.w; createOpenItem = this.w;
  recordApprovalGate = this.w; updateRiskStatus = this.w; recordWaveSignoff = this.w;
}
class XFakes implements ExternalSystems {
  calls = 0;
  private x = async (): Promise<never> => { this.calls++; throw new Error('unreached'); };
  createGithubRepo = this.x; openPullRequest = this.x; createTicket = this.x; updateCrmRecord = this.x; sendEmail = this.x; deployPackage = this.x; createMilestone = this.x; createLabel = this.x; createIssueBatch = this.x;
}
const draft = async (): Promise<unknown> => ({ note: 'fake' });
const DRAFTS: DraftPorts = { nextPrompt: draft, reviewDecision: draft, waveReport: draft, productPlan: draft, riskSummary: draft, openItemsSummary: draft, repoPlan: draft };

const wfakes = new WFakes();
const xfakes = new XFakes();
const registry = createDefaultToolRegistry();
registerFactoryReadTools(registry); registerDraftTools(registry); registerWriteTools(registry); registerExternalTools(registry); registerForbiddenTools(registry);
const sink = new PostgresHashChainSink(appPool, new RedactionEngine());
const sequencer = new WriteAheadSequencer(sink, new PermissionEngine(registry));
const liveSources: LiveReadSources = {
  toolRegistry: registry,
  riskStore: new PostgresRiskRegisterStore(appPool),
  domainStore: new PostgresDomainRegistryStore(appPool),
  projectStore: new PostgresProjectRegistryStore(appPool),
  auditReader: sink,
  doc: async (d: string) => ({ doc: d, content: 'live-doc-content' }),
};
// allowlist EXCLUDES linked* fields → proves redaction drops them from the live read
const redactor = new RedactionEngine(['key', 'severity', 'status', 'type', 'owner', 'title', 'registeredAtIso', 'recordId', 'doc', 'content', 'name', 'classification']);
const bridge = new McpBridge(registry, sequencer, new PostgresClientReadModel(appPool), redactor, {
  factoryPorts: new LiveFactoryReadPorts(liveSources), draftPorts: DRAFTS, writeStores: wfakes, externalSystems: xfakes,
  approvalGate: new BridgeApprovalGate(new ApprovalGate(), 'op_real'),
});
const core = new McpServerCore(bridge, registry);

function ctx(role = 'operator'): BridgeCallContext {
  return { principal: { user_id: 'op_real', email: 'op@ece.ae', role }, organization_id: ORG, session: { session_id: 's-mcp' }, environment: 'local', via: 'claude-code' };
}
const kinds = (rows: { kind: string }[], k: string) => rows.filter((r) => r.kind === k).length;

beforeAll(async () => {
  // seed a LIVE risk via the superuser (the server role only reads)
  await adminPool.query(
    `INSERT INTO risk_register (risk_key, title, type, owner, severity, status, linked_project)
     VALUES ($1,'live risk','security','ECE','high','open','SECRET-PROJECT')`, [RISK_KEY],
  );
});
afterAll(async () => { await appPool.end(); await adminPool.end(); });

describe('MCP Server — live READ_ONLY call returns real data, audited + redacted (real PostgreSQL)', () => {
  it('read_risk_register ⇒ real seeded risk, audited (intent+result), linked_project redacted out', async () => {
    const r = await core.callTool('read_risk_register', {}, ctx());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const outcome = r.outcome as { status: string; data: { key: string; severity?: unknown; linkedProject?: unknown }[] };
    expect(outcome.status).toBe('ok');
    const mine = outcome.data.find((x) => x.key === RISK_KEY)!;
    expect(mine.severity).toBe('high');                   // real live data
    expect(mine).not.toHaveProperty('linkedProject');     // redacted (not on the allowlist)
    expect(JSON.stringify(outcome.data)).not.toMatch(/SECRET-PROJECT/);
    const entries = await sink.readEntries(ORG);
    expect(kinds(entries, 'intent')).toBeGreaterThanOrEqual(1); // the governance read is itself audited
    expect(kinds(entries, 'result')).toBeGreaterThanOrEqual(1);
  });

  it('read_tool_registry ⇒ the live tool map (operator-permissioned), audited', async () => {
    const r = await core.callTool('read_tool_registry', {}, ctx('operator'));
    expect(r.ok && (r.outcome as { status: string }).status).toBe('ok');
  });
});

describe('MCP Server — DB role is SELECT-only on the system of record (read-only tier is structurally read-only live)', () => {
  it('the server role cannot write the system of record — denied at the DB layer', async () => {
    await expect(appPool.query(`INSERT INTO clients (client_id, organization_id, name) VALUES ('z','z','z')`)).rejects.toThrow(/permission denied/i);
  });
});

describe('MCP Server — write/external tiers still STOP on fakes (no live write/external)', () => {
  it('an internal write tool ⇒ STOP_FOR_APPROVAL; the fake write store is never reached', async () => {
    const r = await core.callTool('create_open_item', { payload: { item: 'x' } }, ctx());
    expect(r.ok && (r.outcome as { status: string }).status).toBe('STOP_FOR_APPROVAL');
    expect(wfakes.calls).toBe(0);
  });
  it('an external tool ⇒ STOP/refused; the fake external system is never reached', async () => {
    const r = await core.callTool('create_github_repo', { target: { system: 'github', targetId: 'ECE-FACTORY/x', effect: 'create', reversible: 'soft-only' } }, ctx());
    const status = r.ok ? (r.outcome as { status: string }).status : 'err';
    expect(['STOP_FOR_APPROVAL', 'refused']).toContain(status);
    expect(xfakes.calls).toBe(0);
  });
});

describe('MCP Server — JSON-RPC transport over the live core', () => {
  it('tools/list returns exactly the classified surface; tools/call performs a live read', async () => {
    const list = await handleRpc(core, ctx(), { jsonrpc: '2.0', id: 1, method: 'tools/list' }) as { result: { tools: unknown[] } };
    expect(list.result.tools).toHaveLength(EXPOSED_TOOLS.length);
    const call = await handleRpc(core, ctx(), { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'read_risk_register', arguments: {} } }) as { result: { content: { text: string }[] } };
    expect(call.result.content[0].text).toMatch(/"status":"ok"/);
  });
  it('an unknown JSON-RPC method ⇒ method-not-found error', async () => {
    const resp = await handleRpc(core, ctx(), { jsonrpc: '2.0', id: 3, method: 'no_such_method' }) as { error: { code: number } };
    expect(resp.error.code).toBe(-32601);
  });
});
