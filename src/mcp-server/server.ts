// MCP Server Entrypoint (Phase 9.0) — a runnable, dependency-free MCP server over stdio (JSON-RPC 2.0,
// newline-delimited), the standard Claude Code transport. Run: `npm run mcp:server` (Node v26 runs TS natively).
//
// It is a THIN transport adapter: it wires the proven McpBridge + the LIVE READ_ONLY adapters, then hands
// every tool call to McpServerCore, which delegates to the bridge's full guard stack. It adds NO guard logic.
//
// LIVE WIRING THIS PHASE: only the READ_ONLY tier points at real stores. The write/external/FORBIDDEN tiers
// stay on injected fakes (so driving them still STOPs/refuses exactly as proven). The DB role is SELECT-only
// on the system of record. No credentials are committed — all config comes from the environment at runtime.

import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import pkg from 'pg';
const { Pool } = pkg;

import { McpServerCore, type McpServerBridge } from './server-core.js';
import { LiveFactoryReadPorts, type LiveReadSources } from './live-read-adapters.js';
import { LiveWriteStores } from './live-write-adapters.js';
import { McpBridge } from '../features/mcp-bridge/mcp-bridge.js';
import { createDefaultToolRegistry } from '../features/tool-registry/tool-registry.js';
import { registerFactoryReadTools } from '../features/mcp-bridge/factory-read-tools.js';
import { registerDraftTools, type DraftPorts } from '../features/mcp-bridge/draft-tools.js';
import { registerWriteTools } from '../features/mcp-bridge/write-tools.js';
import { registerExternalTools, registerForbiddenTools, type ExternalSystems } from '../features/mcp-bridge/external-tools.js';
import { BridgeApprovalGate } from '../features/mcp-bridge/tool-classes.js';
import { PostgresHashChainSink } from '../features/audit-engine/postgres-sink.js';
import { WriteAheadSequencer } from '../features/audit-engine/sequencer.js';
import { PermissionEngine } from '../features/permission-engine/permission-engine.js';
import { RedactionEngine } from '../features/redaction-engine/redaction-engine.js';
import { ApprovalGate } from '../features/approval-gate/approval-gate.js';
import { PostgresRiskRegisterStore } from '../features/risk-register/postgres-risk-store.js';
import { PostgresDomainRegistryStore } from '../features/domain-registry/postgres-domain-store.js';
import { PostgresProjectRegistryStore } from '../features/project-registry/postgres-project-store.js';
import { PostgresClientReadModel } from '../features/mcp-bridge/postgres-client-readmodel.js';
import type { BridgeCallContext } from '../features/mcp-bridge/mcp-bridge.js';

export const SERVER_NAME = 'ece-factory';
export const SERVER_VERSION = '0.0.0';
export const PROTOCOL_VERSION = '2024-11-05';

// ── write/external stay on FAKES this phase (no live write/external wiring) ──
function fakeDraftPorts(): DraftPorts {
  const draft = async (): Promise<unknown> => ({ note: 'draft (server: drafts wired to fakes this phase)' });
  return { nextPrompt: draft, reviewDecision: draft, waveReport: draft, productPlan: draft, riskSummary: draft, openItemsSummary: draft, repoPlan: draft };
}
function fakeExternalSystems(): ExternalSystems {
  const x = async (): Promise<never> => { throw new Error('external systems are fakes this phase — no live external action'); };
  return { createGithubRepo: x, openPullRequest: x, createTicket: x, updateCrmRecord: x, sendEmail: x, deployPackage: x };
}

/** Live governance-doc reader — reads the real docs from disk (read-only). */
function docReaderFrom(repoRoot: string): (doc: string) => Promise<unknown> {
  const map: Record<string, string> = {
    factory_status: 'docs/WAVE_5_PROGRESS_CHECKPOINT.md',
    wave_status: 'docs/WAVE_5_PROGRESS_CHECKPOINT.md',
    module_status: 'docs/FEATURE_REGISTRY.md',
    open_gates: 'review/AUTOPILOT_REVIEW_LOG.md',
    review_log: 'review/AUTOPILOT_REVIEW_LOG.md',
    open_items: 'docs/OPEN_ITEMS.md',
    feature_registry: 'docs/FEATURE_REGISTRY.md',
  };
  return async (doc: string): Promise<unknown> => {
    const key = doc.split(':')[0];
    const rel = map[key];
    if (!rel) return { doc, available: false };
    try {
      const content = await readFile(path.join(repoRoot, rel), 'utf8');
      return { doc: key, source: rel, content: content.slice(0, 4000) };
    } catch {
      return { doc: key, source: rel, available: false };
    }
  };
}

export interface ServerEnv {
  pgHost: string; pgPort: number; pgDatabase: string; pgUser: string; pgWriteUser: string;
  principal: { user_id: string; email: string; role: string };
  organizationId: string;
  environment: 'local' | 'staging' | 'production';
  repoRoot: string;
}

export function envConfig(env: NodeJS.ProcessEnv, repoRoot: string): ServerEnv {
  const user_id = env.ECE_PRINCIPAL_USER_ID ?? '';
  if (!user_id || user_id.toLowerCase() === 'claude') {
    throw new Error('ECE_PRINCIPAL_USER_ID must be a real human (never "claude") — attribution is required');
  }
  return {
    pgHost: env.PGHOST ?? '127.0.0.1',
    pgPort: Number(env.PGPORT ?? 5432),
    pgDatabase: env.PGDATABASE ?? 'ece_audit',
    pgUser: env.ECE_DB_USER ?? 'ece_app', // SELECT-only role on the system of record (READ_ONLY tier)
    pgWriteUser: env.ECE_WRITE_DB_USER ?? 'ece_writer', // INSERT-append-only role on the internal-write targets
    principal: { user_id, email: env.ECE_PRINCIPAL_EMAIL ?? '', role: env.ECE_PRINCIPAL_ROLE ?? 'operator' },
    organizationId: env.ECE_ORG ?? 'org_default',
    environment: (env.ECE_ENV as ServerEnv['environment']) ?? 'local',
    repoRoot,
  };
}

/** Build the bridge (live reads + fake writes/externals) and the server core. No stdin involved — testable. */
export function buildServer(cfg: ServerEnv): { core: McpServerCore; ctx: BridgeCallContext; pool: InstanceType<typeof Pool>; writePool: InstanceType<typeof Pool> } {
  const pool = new Pool({ host: cfg.pgHost, port: cfg.pgPort, database: cfg.pgDatabase, user: cfg.pgUser });          // READ_ONLY tier + audit
  const writePool = new Pool({ host: cfg.pgHost, port: cfg.pgPort, database: cfg.pgDatabase, user: cfg.pgWriteUser }); // internal-write tier (append-INSERT only)

  const registry = createDefaultToolRegistry();
  registerFactoryReadTools(registry); registerDraftTools(registry); registerWriteTools(registry); registerExternalTools(registry); registerForbiddenTools(registry);

  const sink = new PostgresHashChainSink(pool, new RedactionEngine());
  const sequencer = new WriteAheadSequencer(sink, new PermissionEngine(registry));

  const liveSources: LiveReadSources = {
    toolRegistry: registry,
    riskStore: new PostgresRiskRegisterStore(pool),
    domainStore: new PostgresDomainRegistryStore(pool),
    projectStore: new PostgresProjectRegistryStore(pool),
    auditReader: sink,
    doc: docReaderFrom(cfg.repoRoot),
  };
  // Redactor allowlist for live governance reads (deny-by-default; sensitive payloads dropped).
  const redactor = new RedactionEngine([
    'doc', 'source', 'content', 'available', 'name', 'classification', 'key', 'severity', 'status', 'type',
    'owner', 'title', 'kind', 'seq', 'organization_id', 'project', 'registeredAtIso', 'recordId',
  ]);

  const bridge = new McpBridge(
    registry, sequencer, new PostgresClientReadModel(pool), redactor,
    {
      factoryPorts: new LiveFactoryReadPorts(liveSources), // LIVE reads
      writeStores: new LiveWriteStores(writePool),         // LIVE internal-write (append-only; token-gated by the bridge)
      draftPorts: fakeDraftPorts(), externalSystems: fakeExternalSystems(), // drafts + external stay on fakes
      approvalGate: new BridgeApprovalGate(new ApprovalGate(), cfg.principal.user_id),
    },
  );
  const core = new McpServerCore(bridge as McpServerBridge, registry);
  const ctx: BridgeCallContext = {
    principal: cfg.principal, organization_id: cfg.organizationId,
    session: { session_id: `mcp-${cfg.principal.user_id}`, connector_type: 'mcp', source_application: 'claude-code' },
    environment: cfg.environment, via: 'claude-code',
  };
  return { core, ctx, pool, writePool };
}

// ── JSON-RPC 2.0 over stdio (the MCP transport subset Claude Code uses) ──
export interface JsonRpcMessage { jsonrpc?: string; id?: number | string | null; method?: string; params?: Record<string, unknown>; }

export async function handleRpc(core: McpServerCore, ctx: BridgeCallContext, msg: JsonRpcMessage): Promise<object | null> {
  const id = msg.id ?? null;
  if (msg.method === 'initialize') {
    return { jsonrpc: '2.0', id, result: { protocolVersion: PROTOCOL_VERSION, capabilities: { tools: {} }, serverInfo: { name: SERVER_NAME, version: SERVER_VERSION } } };
  }
  if (msg.method === 'tools/list') {
    return { jsonrpc: '2.0', id, result: { tools: core.listTools().map((t) => ({ name: t.name, description: `[${t.toolClass}] ${t.purpose}`, inputSchema: { type: 'object' } })) } };
  }
  if (msg.method === 'tools/call') {
    const name = String(msg.params?.name ?? '');
    const args = (msg.params?.arguments as Record<string, unknown>) ?? {};
    const result = await core.callTool(name, args, ctx);
    return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(result) }] } };
  }
  if (id === null) return null; // a notification we don't handle — no response
  return { jsonrpc: '2.0', id, error: { code: -32601, message: `method not found: ${msg.method}` } };
}

export async function main(): Promise<void> {
  const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
  const cfg = envConfig(process.env, repoRoot);
  const { core, ctx } = buildServer(cfg);
  const rl = createInterface({ input: process.stdin });
  process.stderr.write(`[ece-factory mcp] up — ${core.listTools().length} tools, READ_ONLY + internal-write live (append-only, token-gated); externals on fakes\n`);
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let msg: JsonRpcMessage;
    try { msg = JSON.parse(trimmed) as JsonRpcMessage; } catch { continue; }
    const resp = await handleRpc(core, ctx, msg);
    if (resp) process.stdout.write(JSON.stringify(resp) + '\n');
  }
}

// Run main only when executed directly (not when imported by tests). The launcher (run.mjs) calls main()
// explicitly; this guard covers a hypothetical direct `node server.ts` once a TS-capable runtime is used.
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((e: unknown) => { process.stderr.write(`[ece-factory mcp] fatal: ${e instanceof Error ? e.message : String(e)}\n`); process.exit(1); });
}
