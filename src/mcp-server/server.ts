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
import { buildTierStatusReport, makeDbProbe, type TierStatusReport, type ExternalAction } from './tier-status.js';
import { LiveGitHubRepoAdapter } from './live-github-adapter.js';
import { LiveGitHubIssueAdapter } from './live-github-issue-adapter.js';
import { McpBridge, EXPOSED_READ_TOOLS, EXPOSED_DRAFT_TOOLS, EXPOSED_WRITE_TOOLS, EXPOSED_EXTERNAL_TOOLS } from '../features/mcp-bridge/mcp-bridge.js';
import { FORBIDDEN_TOOLS } from '../features/mcp-bridge/external-tools.js';
import { createDefaultToolRegistry } from '../features/tool-registry/tool-registry.js';
import { registerFactoryReadTools } from '../features/mcp-bridge/factory-read-tools.js';
import { registerDraftTools, type DraftPorts } from '../features/mcp-bridge/draft-tools.js';
import { registerWriteTools } from '../features/mcp-bridge/write-tools.js';
import { registerExternalTools, registerForbiddenTools, type ExternalSystems } from '../features/mcp-bridge/external-tools.js';
import { RepoCreationGateway, TicketGateway, CrmGateway, EmailGateway, DeployGateway } from '../features/external-gateways/external-gateways.js';
import { DecisionConsole } from '../features/decision-console/decision-console.js';
import { DecisionConsoleServer } from './decision-console-server.js';
import type { ActionProposer, ApprovedActionCommitter } from './decision-console-server.js';
import type { ExternalTarget } from '../features/mcp-bridge/external-tools.js';
import type { ExternalActionRequest } from '../features/external-gateways/external-gateways.js';
import { PostgresConsoleAudit, StopEnqueuer, EnqueueingServerCore, observingGatewayCall, type CallableCore, type GatewayCall } from './decision-console-wiring.js';
import { PolicyEngine } from '../features/policy-engine/policy-engine.js';
import { DEFAULT_POLICY_SET } from '../features/policy-engine/example-rules.js';
import { PolicyGatedSeat, PostgresPolicyAudit } from './policy-console-wiring.js';

/** The composition-root external gateways, wrapped so a STOP_FOR_APPROVAL auto-enqueues into the Console. */
export interface EnqueuingExternalGateways {
  createRepo: GatewayCall; createTicket: GatewayCall; updateRecord: GatewayCall; sendEmail: GatewayCall; deploy: GatewayCall;
}
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

/**
 * Phase 9.4 — external live wiring, GitHub ONLY. `create_github_repo` may go live behind an explicit operator
 * opt-in (`ECE_GITHUB_LIVE=1`); the other five external actions STAY ON FAKES. The live adapter throws LOUDLY
 * if `ECE_GITHUB_TOKEN` is unset — never a silent fake fallback. The gate is UNCHANGED: this only swaps the
 * adapter the bridge delegates to behind the Phase 8.4 gauntlet + the Phase 9.3 sole-authority capability.
 * Returns the composite the bridge uses AND the per-action adapter instances (so tier-status reports honestly).
 */
function buildExternalWiring(env: NodeJS.ProcessEnv): { externalSystems: ExternalSystems; externalAdapters: Record<ExternalAction, object> } {
  const fake = fakeExternalSystems();
  const githubLive = env.ECE_GITHUB_LIVE === '1';
  const dryRun = env.ECE_GITHUB_DRYRUN === '1';
  // Each live adapter owns EXACTLY one action (narrow type) — it cannot be misused for any other action. Both
  // throw LOUDLY if the token is unset (no silent fake fallback). Opt-in via ECE_GITHUB_LIVE.
  const github: Pick<ExternalSystems, 'createGithubRepo'> = githubLive
    ? new LiveGitHubRepoAdapter({ token: env.ECE_GITHUB_TOKEN ?? '', dryRun })
    : fake;
  const issues: Pick<ExternalSystems, 'createTicket'> = githubLive
    ? new LiveGitHubIssueAdapter({ token: env.ECE_GITHUB_TOKEN ?? '', dryRun })
    : fake;
  const externalAdapters: Record<ExternalAction, object> = {
    create_github_repo: github, create_ticket: issues, open_pull_request: fake,
    update_crm_record: fake, send_email: fake, deploy_package: fake,
  };
  // The composite the bridge calls: the four remaining actions stay exactly on the fakes; ONLY
  // create_github_repo and create_ticket are overridden to route to their (live|fake) adapters. Gate unchanged.
  const externalSystems: ExternalSystems = {
    ...fake,
    createGithubRepo: (t, p) => github.createGithubRepo(t, p),
    createTicket: (t, p) => issues.createTicket(t, p),
  };
  return { externalSystems, externalAdapters };
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
export interface ExternalGateways {
  repoCreation: RepoCreationGateway; ticket: TicketGateway; crm: CrmGateway; email: EmailGateway; deploy: DeployGateway;
}
export function buildServer(cfg: ServerEnv): { core: CallableCore; ctx: BridgeCallContext; pool: InstanceType<typeof Pool>; writePool: InstanceType<typeof Pool>; tierStatus: () => Promise<TierStatusReport>; externalGateways: ExternalGateways; enqueuingGateways: EnqueuingExternalGateways; decisionConsole: DecisionConsole; consoleServer: DecisionConsoleServer } {
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

  // Injected ports are hoisted so the tier-status reporter inspects the REAL objects that are wired.
  const factoryPorts = new LiveFactoryReadPorts(liveSources); // LIVE reads
  const writeStores = new LiveWriteStores(writePool);         // LIVE internal-write (append-only; token-gated)
  const draftPorts = fakeDraftPorts();                        // drafts on fakes
  const { externalSystems, externalAdapters } = buildExternalWiring(process.env); // create_github_repo may be LIVE; other 5 fake

  // Hoisted so the Decision Console shares the EXACT ApprovalGate the bridge consumes — the Console is the
  // legitimate SOURCE of the same single-use human token the gauntlet requires (Piece 1); nothing here changes
  // the gauntlet or the gate's semantics.
  const approvalGate = new ApprovalGate();
  const bridge = new McpBridge(
    registry, sequencer, new PostgresClientReadModel(pool), redactor,
    { factoryPorts, writeStores, draftPorts, externalSystems, approvalGate: new BridgeApprovalGate(approvalGate, cfg.principal.user_id) },
  );
  // Piece 1b — Decision Console live: Console audit → real Postgres sink; a STOP_FOR_APPROVAL OBSERVED at the
  // transport wrapper auto-enqueues (observation-only — the wrapper returns the inner outcome verbatim).
  const decisionConsole = new DecisionConsole(approvalGate, new PostgresConsoleAudit(sink, cfg.organizationId, cfg.environment));
  const stopEnqueuer = new StopEnqueuer(decisionConsole); // shared: internal-write (callTool) + external (gateways)
  const core: CallableCore = new EnqueueingServerCore(new McpServerCore(bridge as McpServerBridge, registry), stopEnqueuer);
  // SOLE AUTHORITY (8.8b generalized, #9): grant each external action's SINGLE capability to exactly one
  // owning gateway, here at the composition root. No other caller can construct a capability, and the generic
  // external path refuses every external tool — so each external action has exactly one structural owner.
  // External stays on fakes this phase (the gateways route to the injected fake `externalSystems`).
  const externalGateways: ExternalGateways = {
    repoCreation: new RepoCreationGateway(bridge), ticket: new TicketGateway(bridge), crm: new CrmGateway(bridge),
    email: new EmailGateway(bridge), deploy: new DeployGateway(bridge),
  };
  // Piece 1c — external-action auto-enqueue: wrap each gateway call so a STOP_FOR_APPROVAL auto-enqueues into
  // the SAME Console queue (observation-only; the gateway's outcome is returned verbatim). Gateways unedited.
  const enqueuingGateways: EnqueuingExternalGateways = {
    createRepo: observingGatewayCall('create_github_repo', (r, c) => externalGateways.repoCreation.createRepo(r, c), stopEnqueuer),
    createTicket: observingGatewayCall('create_ticket', (r, c) => externalGateways.ticket.createTicket(r, c), stopEnqueuer),
    updateRecord: observingGatewayCall('update_crm_record', (r, c) => externalGateways.crm.updateRecord(r, c), stopEnqueuer),
    sendEmail: observingGatewayCall('send_email', (r, c) => externalGateways.email.sendEmail(r, c), stopEnqueuer),
    deploy: observingGatewayCall('deploy_package', (r, c) => externalGateways.deploy.deploy(r, c), stopEnqueuer),
  };
  const ctx: BridgeCallContext = {
    principal: cfg.principal, organization_id: cfg.organizationId,
    session: { session_id: `mcp-${cfg.principal.user_id}`, connector_type: 'mcp', source_application: 'claude-code' },
    environment: cfg.environment, via: 'claude-code',
  };

  // ── Wave 6 Piece 1d — PROPOSE surface (Design 2, strict) + commit-on-approve, composition-root/transport only ──
  // The propose surface INITIATES an external action into the already-built enqueuing gateway (→ unchanged 8.4
  // gauntlet → STOP → auto-enqueue) and returns the pending id. It is driven under the conduit IDENTITY
  // ('claude-code') so the gate's separation-of-duties structurally bars it as an approver (requester ==
  // proposingCaller == 'claude-code'); a real operator must approve. It carries the REAL server principal's ROLE
  // (cfg.principal.role) — the permission engine's role gate is UNCHANGED, so an admin-tier action still requires
  // an admin-configured principal to even be proposed. It has NO approvalActionId (Design 2) and holds NO gate:
  // it cannot approve, mint, bypass, or commit — the human token minted at approval is the sole authority to commit.
  const proposerCtx: BridgeCallContext = { ...ctx, principal: { user_id: 'claude-code', email: '', role: cfg.principal.role }, via: 'claude-code' };
  const gatewayByTool: Record<string, GatewayCall> = {
    create_github_repo: enqueuingGateways.createRepo, create_ticket: enqueuingGateways.createTicket,
    update_crm_record: enqueuingGateways.updateRecord, send_email: enqueuingGateways.sendEmail, deploy_package: enqueuingGateways.deploy,
  };
  // Remembers the EXACT proposed request (never an approvalActionId) per pending id, so the operator's later
  // APPROVE can re-drive the identical action. Populated only on a STOP+enqueue; the map cannot mint or approve.
  const proposed = new Map<string, { tool: string; request: ExternalActionRequest }>();
  const listPending = decisionConsole.listPending.bind(decisionConsole); // read-only binding — NOT the console object
  const proposer: ActionProposer = {
    async propose(input) {
      const call = gatewayByTool[input.tool];
      if (!call) return { status: 'refused', reason: `unknown or non-external tool "${input.tool}"` };
      const request: ExternalActionRequest = { target: input.target as ExternalTarget, payload: input.payload as Record<string, unknown> | undefined }; // NO approvalActionId
      const out = await call(request, proposerCtx); // first drive: no token → STOP → observing wrapper auto-enqueues
      if (out.status !== 'STOP_FOR_APPROVAL') return { status: out.status, reason: 'reason' in out ? out.reason : undefined };
      const pendingActionId = listPending().find((it) => it.tool === input.tool && it.target === request.target?.targetId)?.actionId;
      if (pendingActionId) proposed.set(pendingActionId, { tool: input.tool, request });
      return { status: out.status, pendingActionId };
    },
  };
  // Commit-on-approve seam: invoked by DecisionConsoleServer ONLY after a genuine operator mint. Re-drives the
  // remembered request WITH the now-minted per-action token (approvalActionId=actionId) through the SAME gateway →
  // the unchanged gauntlet consumes the token → commit. If the action wasn't a proposed external one, no-op.
  const committer: ApprovedActionCommitter = {
    async commit(actionId) {
      const entry = proposed.get(actionId);
      if (!entry) return undefined;
      const call = gatewayByTool[entry.tool];
      if (!call) return undefined;
      const out = await call({ ...entry.request, approvalActionId: actionId }, proposerCtx);
      if (out.status === 'EXTERNAL-ACTION-COMMITTED') proposed.delete(actionId); // single-use bookkeeping (gate also enforces)
      return { status: out.status, committed: out.status === 'EXTERNAL-ACTION-COMMITTED' ? out.committed : undefined, reason: 'reason' in out ? out.reason : undefined };
    },
  };
  // Wave 6 Piece 2 — the Console reads through the POLICY-GATED seat: each pending item carries its advisory
  // policy read, and a HARD violation is withheld at the seat (no mint) WITHOUT touching the gate. The Policy
  // Engine only informs + adds a Console-layer constraint; it cannot approve/commit/weaken any guard.
  const policyEngine = new PolicyEngine(DEFAULT_POLICY_SET);
  const policySeat = new PolicyGatedSeat(decisionConsole, policyEngine, new PostgresPolicyAudit(sink, cfg.organizationId, cfg.environment));
  const consoleServer = new DecisionConsoleServer(policySeat, { proposer, committer, proposeToken: process.env.ECE_PROPOSE_TOKEN });
  // Tier-status reporter — derives each tier's backing from the REAL injected objects; read-only DB probe.
  const tierStatus = (): Promise<TierStatusReport> => buildTierStatusReport({
    factoryPorts, draftPorts, writeStores, externalSystems, externalAdapters,
    readRole: cfg.pgUser, writeRole: cfg.pgWriteUser,
    toolCounts: {
      read_only: EXPOSED_READ_TOOLS.length, draft_only: EXPOSED_DRAFT_TOOLS.length,
      internal_write: EXPOSED_WRITE_TOOLS.length, external: EXPOSED_EXTERNAL_TOOLS.length, forbidden: FORBIDDEN_TOOLS.length,
    },
  }, makeDbProbe(pool));
  return { core, ctx, pool, writePool, tierStatus, externalGateways, enqueuingGateways, decisionConsole, consoleServer };
}

// ── JSON-RPC 2.0 over stdio (the MCP transport subset Claude Code uses) ──
export interface JsonRpcMessage { jsonrpc?: string; id?: number | string | null; method?: string; params?: Record<string, unknown>; }

export async function handleRpc(core: CallableCore, ctx: BridgeCallContext, msg: JsonRpcMessage, tierStatus?: () => Promise<TierStatusReport>): Promise<object | null> {
  const id = msg.id ?? null;
  if (msg.method === 'health') {
    // Observational tier-status — no tool call, no side effect, no secrets (role names/booleans/counts only).
    const report = tierStatus ? await tierStatus() : { error: 'tier-status not available' };
    return { jsonrpc: '2.0', id, result: report };
  }
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

/** Operational `npm run mcp:healthz` — build from env, print the tier-status report (no secrets), close pools. */
export async function printHealth(): Promise<void> {
  const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
  const cfg = envConfig(process.env, repoRoot);
  const { pool, writePool, tierStatus } = buildServer(cfg);
  const report = await tierStatus();
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  await pool.end(); await writePool.end();
}

/**
 * Report-only summary of the ACTUAL per-action external wiring (same source `/healthz` derives from): which
 * external actions are live vs fake. Derived from the real injected adapters (never a label), so it can never
 * claim live when fake or fake when live. Changes NO wiring/gate/adapter — startup-banner honesty only.
 */
export function describeExternalWiring(externalByAction: Record<ExternalAction, string>): string {
  const actions = Object.keys(externalByAction) as ExternalAction[];
  const live = actions.filter((a) => externalByAction[a] === 'live');
  const fake = actions.filter((a) => externalByAction[a] !== 'live');
  const parts = [live.length ? `live: ${live.join(', ')}` : 'live: none'];
  if (fake.length) parts.push(`fake: ${fake.join(', ')}`);
  return parts.join(' · ');
}

export async function main(): Promise<void> {
  const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
  const cfg = envConfig(process.env, repoRoot);
  const { core, ctx, tierStatus, consoleServer } = buildServer(cfg);
  // Piece 1b — start the local operator seat (Decision Console UI) when a port is configured. Auto-enqueued
  // pending actions surface here for a real human to APPROVE/REFUSE (the operator identity is the login).
  if (process.env.ECE_CONSOLE_PORT) {
    consoleServer.listen(Number(process.env.ECE_CONSOLE_PORT));
    process.stderr.write(`[ece-factory mcp] decision console UI on :${process.env.ECE_CONSOLE_PORT}\n`);
  }
  const rl = createInterface({ input: process.stdin });
  const externalWiring = describeExternalWiring((await tierStatus()).externalByAction); // honest per-action live/fake
  process.stderr.write(`[ece-factory mcp] up — ${core.listTools().length} tools, READ_ONLY + internal-write live (append-only, token-gated); external — ${externalWiring}\n`);
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let msg: JsonRpcMessage;
    try { msg = JSON.parse(trimmed) as JsonRpcMessage; } catch { continue; }
    const resp = await handleRpc(core, ctx, msg, tierStatus);
    if (resp) process.stdout.write(JSON.stringify(resp) + '\n');
  }
}

// Run main only when executed directly (not when imported by tests). The launcher (run.mjs) calls main()
// explicitly; this guard covers a hypothetical direct `node server.ts` once a TS-capable runtime is used.
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((e: unknown) => { process.stderr.write(`[ece-factory mcp] fatal: ${e instanceof Error ? e.message : String(e)}\n`); process.exit(1); });
}
