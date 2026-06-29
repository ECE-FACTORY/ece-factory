import { describe, it, expect, afterAll } from 'vitest';
import pkg from 'pg';
const { Pool } = pkg;
import { McpServerCore } from './server-core.js';
import { LiveWriteStores } from './live-write-adapters.js';
import { McpBridge, type BridgeCallContext } from '../features/mcp-bridge/mcp-bridge.js';
import { createDefaultToolRegistry } from '../features/tool-registry/tool-registry.js';
import { registerFactoryReadTools, type FactoryReadPorts } from '../features/mcp-bridge/factory-read-tools.js';
import { registerDraftTools, type DraftPorts } from '../features/mcp-bridge/draft-tools.js';
import { registerWriteTools } from '../features/mcp-bridge/write-tools.js';
import { registerExternalTools, registerForbiddenTools, type ExternalSystems } from '../features/mcp-bridge/external-tools.js';
import { BridgeApprovalGate } from '../features/mcp-bridge/tool-classes.js';
import { PostgresHashChainSink } from '../features/audit-engine/postgres-sink.js';
import { WriteAheadSequencer } from '../features/audit-engine/sequencer.js';
import { PermissionEngine } from '../features/permission-engine/permission-engine.js';
import { RedactionEngine } from '../features/redaction-engine/redaction-engine.js';
import { ApprovalGate, type ActionDescriptor } from '../features/approval-gate/approval-gate.js';

// Phase 9.1 — the internal-write tier wired LIVE to real append-only stores. NO mocks on the write path:
// an approved write actually lands a row in the real table; no-token writes nothing; the Phase 8.3 token gate
// holds exactly as proven, now against the LIVE store. The external tier stays on fakes.

const cfg = { host: process.env.PGHOST ?? '127.0.0.1', port: Number(process.env.PGPORT ?? 55432), database: process.env.PGDATABASE ?? 'ece_audit_test' };
const appPool = new Pool({ ...cfg, user: 'ece_app' });       // READ_ONLY tier + audit (SELECT-only on system of record)
const writerPool = new Pool({ ...cfg, user: 'ece_writer' });  // internal-write tier (append-INSERT only)
const adminPool = new Pool({ ...cfg, user: 'postgres' });     // verifies the live rows / grants (bypasses RLS+grants)
afterAll(async () => { await appPool.end(); await writerPool.end(); await adminPool.end(); });

// External stays on a FAKE that must never be reached.
class XFakes implements ExternalSystems {
  calls = 0;
  private x = async (): Promise<never> => { this.calls++; throw new Error('unreached'); };
  createGithubRepo = this.x; openPullRequest = this.x; createTicket = this.x; updateCrmRecord = this.x; sendEmail = this.x; deployPackage = this.x;
}
const draft = async (): Promise<unknown> => ({ note: 'fake' });
const DRAFTS: DraftPorts = { nextPrompt: draft, reviewDecision: draft, waveReport: draft, productPlan: draft, riskSummary: draft, openItemsSummary: draft, repoPlan: draft };
const FACTORY: FactoryReadPorts = {
  factoryStatus: async () => ({}), waveStatus: async () => [], moduleStatus: async () => [], openGates: async () => [],
  reviewLog: async () => [], evidencePack: async () => ({}), openItems: async () => [], domainRegistry: async () => [],
  projectRegistry: async () => [], featureRegistry: async () => [], riskRegister: async () => [], productCreationPlan: async () => ({}),
  repoBuildPlan: async () => ({}), toolRegistry: async () => [], auditSummary: async () => [],
};

const registry = createDefaultToolRegistry();
registerFactoryReadTools(registry); registerDraftTools(registry); registerWriteTools(registry); registerExternalTools(registry); registerForbiddenTools(registry);
const xfakes = new XFakes();
const gate = new ApprovalGate();
const sink = new PostgresHashChainSink(appPool, new RedactionEngine());
const sequencer = new WriteAheadSequencer(sink, new PermissionEngine(registry));
const bridge = new McpBridge(registry, sequencer, { searchClients: async () => [] },
  new RedactionEngine(['record_id', 'registered_at', 'kind', 'risk_key', 'status']),
  { factoryPorts: FACTORY, draftPorts: DRAFTS, writeStores: new LiveWriteStores(writerPool), externalSystems: xfakes, approvalGate: new BridgeApprovalGate(gate, 'op_real') });
const core = new McpServerCore(bridge, registry);

const ORG = `orgLW-${Date.now()}`;
function ctx(role = 'operator', org = ORG): BridgeCallContext {
  return { principal: { user_id: 'op_real', email: 'op@ece.ae', role }, organization_id: org, session: { session_id: 's' }, environment: 'local', via: 'claude-code' };
}
function descriptor(tool: string, target: string | undefined, payload: Record<string, unknown>): ActionDescriptor {
  return { tool, target, after: payload, risk: 'WRITE_LOW_RISK', reversible: 'soft-only', requestedBy: { user_id: 'op', email: 'o@e', role: 'operator' } };
}
function approve(tool: string, target: string | undefined, payload: Record<string, unknown>): string {
  const q = gate.request(descriptor(tool, target, payload));
  gate.resolve({ actionId: q.actionId, approver: { user_id: 'human_boss', email: 'b@e', role: 'admin' }, decision: 'APPROVE', reason: 'reviewed' });
  return q.actionId;
}
const countOpenItems = async () => (await adminPool.query(`SELECT count(*)::int AS n FROM open_items`)).rows[0].n as number;
const kinds = (rows: { kind: string }[], k: string) => rows.filter((r) => r.kind === k).length;
async function call(name: string, args: Record<string, unknown>, c = ctx()) { const r = await core.callTool(name, args, c); return r.ok ? (r.outcome as { status: string }) : { status: 'core-error' }; }

describe('Phase 9.1 — approved write LANDS in the real append-only store (real PostgreSQL)', () => {
  it('record_review_decision with a valid token ⇒ WRITE-COMMITTED, row present in review_log_entries, audited', async () => {
    const payload = { verdict: 'PASS', actor: 'human_boss', stamp: ORG };
    const actionId = approve('record_review_decision', undefined, payload);
    const out = await call('record_review_decision', { approvalActionId: actionId, payload }, ctx());
    expect(out.status).toBe('WRITE-COMMITTED');
    const rows = await adminPool.query(`SELECT kind, payload FROM review_log_entries WHERE payload->>'stamp'=$1`, [ORG]);
    expect(rows.rowCount).toBe(1);                       // the mutation actually landed in the LIVE table
    expect(rows.rows[0].kind).toBe('review_decision');
    const audit = await sink.readEntries(ORG);
    expect(kinds(audit, 'intent')).toBeGreaterThanOrEqual(1); // audited (intent+result bracket the live write)
    expect(kinds(audit, 'result')).toBeGreaterThanOrEqual(1);
  });
});

describe('Phase 9.1 — no token ⇒ STOP, the real store is unchanged (the core)', () => {
  it('create_open_item with no token writes zero rows to open_items', async () => {
    const before = await countOpenItems();
    const out = await call('create_open_item', { payload: { item: 'x' } }, ctx());
    expect(out.status).toBe('STOP_FOR_APPROVAL');
    expect(await countOpenItems()).toBe(before);        // nothing written to the LIVE table
  });
});

describe('Phase 9.1 — single-use & per-action binding against the live store', () => {
  it('replaying a consumed token ⇒ refused, no second row', async () => {
    const before = await countOpenItems();
    const payload = { item: 'once', stamp: `${ORG}-su` };
    const actionId = approve('create_open_item', 'IT-1', payload);
    expect((await call('create_open_item', { approvalActionId: actionId, target: 'IT-1', payload }, ctx())).status).toBe('WRITE-COMMITTED');
    expect((await call('create_open_item', { approvalActionId: actionId, target: 'IT-1', payload }, ctx())).status).toBe('STOP_FOR_APPROVAL');
    expect(await countOpenItems()).toBe(before + 1);     // exactly one row, not two
  });
  it('a token for action A ⇒ refused for action B, no row', async () => {
    const before = await countOpenItems();
    const actionId = approve('create_open_item', 'IT-A', { item: 'A' });
    const out = await call('create_open_item', { approvalActionId: actionId, target: 'IT-B', payload: { item: 'B' } }, ctx());
    expect(out.status).toBe('STOP_FOR_APPROVAL');
    expect(await countOpenItems()).toBe(before);
  });
});

describe('Phase 9.1 — self-approval rejected & kill-beats-approval against the live store', () => {
  it('an approval granted by the calling agent is not honored (no row)', async () => {
    const selfGate = new ApprovalGate();
    const q = selfGate.request(descriptor('create_open_item', undefined, { item: 'self' }));
    selfGate.resolve({ actionId: q.actionId, approver: { user_id: 'op_real', email: 'o@e', role: 'admin' }, decision: 'APPROVE', reason: 'self' });
    const selfBridge = new McpBridge(registry, sequencer, { searchClients: async () => [] }, new RedactionEngine(['record_id']),
      { writeStores: new LiveWriteStores(writerPool), approvalGate: new BridgeApprovalGate(selfGate, 'op_real') }); // caller == approver
    const before = await countOpenItems();
    const r = await selfBridge.writeWithTool('create_open_item', ctx('operator', `${ORG}-self`), { approvalActionId: q.actionId, payload: { item: 'self' } });
    expect(r.status).toBe('STOP_FOR_APPROVAL');
    expect(await countOpenItems()).toBe(before);
  });
  it('kill beats approval — a kill-switched live write ⇒ REFUSE even with a valid token, no row', async () => {
    const { InMemoryKillSwitch } = await import('../features/kill-switch/kill-switch.js');
    const kill = new InMemoryKillSwitch();
    kill.activate({ type: 'tool', name: 'create_open_item' }, 'admin', 'freeze');
    const killBridge = new McpBridge(registry, new WriteAheadSequencer(sink, new PermissionEngine(registry, { killSwitch: kill })),
      { searchClients: async () => [] }, new RedactionEngine(['record_id']),
      { writeStores: new LiveWriteStores(writerPool), approvalGate: new BridgeApprovalGate(gate, 'op_real') });
    const actionId = approve('create_open_item', 'IT-K', { item: 'k' });
    const before = await countOpenItems();
    const r = await killBridge.writeWithTool('create_open_item', ctx('operator', `${ORG}-kill`), { approvalActionId: actionId, target: 'IT-K', payload: { item: 'k' } });
    expect(r.status).toBe('refused');
    expect(await countOpenItems()).toBe(before);
  });
});

describe('Phase 9.1 — append-only enforced at the DB layer on the live tables + the grant proof', () => {
  it('UPDATE/DELETE on a live write table are denied; two approved risk transitions ⇒ two snapshots', async () => {
    // append-only: the writer role cannot mutate
    await expect(writerPool.query(`UPDATE open_items SET target='x'`)).rejects.toThrow(/permission denied|append-only/i);
    await expect(writerPool.query(`DELETE FROM review_log_entries`)).rejects.toThrow(/permission denied|append-only/i);
    // two approved risk-status transitions append two snapshots (no overwrite)
    const key = `RISK-LW-${Date.now()}`;
    const base = { key, type: 'security', owner: 'ECE', severity: 'high' };
    const a1 = approve('update_risk_status', key, { ...base, status: 'mitigating' });
    expect((await call('update_risk_status', { approvalActionId: a1, target: key, payload: { ...base, status: 'mitigating' } }, ctx())).status).toBe('WRITE-COMMITTED');
    const a2 = approve('update_risk_status', key, { ...base, status: 'closed' });
    expect((await call('update_risk_status', { approvalActionId: a2, target: key, payload: { ...base, status: 'closed' } }, ctx())).status).toBe('WRITE-COMMITTED');
    const snaps = await adminPool.query(`SELECT status FROM risk_register WHERE risk_key=$1 ORDER BY registered_at`, [key]);
    expect(snaps.rows.map((r) => r.status)).toEqual(['mitigating', 'closed']);
  });
  it('ece_writer has INSERT but NOT UPDATE/DELETE/TRUNCATE on the target tables', async () => {
    const g = await adminPool.query<{ table_name: string; privilege_type: string }>(
      `SELECT table_name, privilege_type FROM information_schema.role_table_grants
        WHERE grantee='ece_writer' AND table_name IN ('review_log_entries','open_items','risk_register') ORDER BY table_name, privilege_type`,
    );
    const byTable: Record<string, string[]> = {};
    for (const r of g.rows) (byTable[r.table_name] ??= []).push(r.privilege_type);
    for (const t of ['review_log_entries', 'open_items', 'risk_register']) {
      expect(byTable[t]).toContain('INSERT');
      expect(byTable[t]).not.toContain('UPDATE');
      expect(byTable[t]).not.toContain('DELETE');
      expect(byTable[t]).not.toContain('TRUNCATE');
    }
    // ece_writer has NO grant on the system of record (clients)
    const onClients = await adminPool.query(`SELECT privilege_type FROM information_schema.role_table_grants WHERE grantee='ece_writer' AND table_name='clients'`);
    expect(onClients.rowCount).toBe(0);
  });
});

describe('Phase 9.1 — external tier still on fakes; FORBIDDEN refused (no live external this phase)', () => {
  it('an external tool ⇒ STOP/refused, the fake is never reached; a FORBIDDEN tool ⇒ refused', async () => {
    const ext = await call('create_github_repo', { target: { system: 'github', targetId: 'ECE-FACTORY/x', effect: 'create', reversible: 'soft-only' } }, ctx());
    expect(['STOP_FOR_APPROVAL', 'refused']).toContain(ext.status);
    expect(xfakes.calls).toBe(0);
    const forb = await call('force_delete_repo', {}, ctx());
    expect(forb.status).toBe('refused');
  });
});
