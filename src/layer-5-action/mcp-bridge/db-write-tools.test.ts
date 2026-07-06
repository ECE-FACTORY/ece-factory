import { describe, it, expect, afterAll } from 'vitest';
import pkg from 'pg';
const { Pool } = pkg;
import { McpBridge, type BridgeCallContext } from './mcp-bridge.js';
import { registerWriteTools, type WriteStores, type WriteParams, type WriteRecord } from './write-tools.js';
import { BridgeApprovalGate } from './tool-classes.js';
import { PostgresHashChainSink } from '../../factory-shared/audit-engine/postgres-sink.js';
import { WriteAheadSequencer } from '../../factory-shared/audit-engine/sequencer.js';
import { PermissionEngine } from '../../layer-1-law/permission-engine/permission-engine.js';
import { createDefaultToolRegistry } from '../tool-registry/tool-registry.js';
import { RedactionEngine } from '../../factory-shared/redaction-engine/redaction-engine.js';
import { InMemoryKillSwitch } from '../../layer-1-law/kill-switch/kill-switch.js';
import { ApprovalGate, type ActionDescriptor } from '../../layer-1-law/approval-gate/approval-gate.js';

// Approval-gated write tools — end-to-end against REAL PostgreSQL with the REAL guard stack. Proves the
// mutation is bracketed by write-ahead audit (intent before, result after), that no-approval leaves the
// store untouched (the denied attempt recorded as a refusal-audit — OPEN_ITEM #1), and that kill beats a valid
// approval — no mocks on the guard path.

const cfg = { host: process.env.PGHOST ?? '127.0.0.1', port: Number(process.env.PGPORT ?? 55432), database: process.env.PGDATABASE ?? 'ece_audit_test' };
const appPool = new Pool({ ...cfg, user: 'ece_app' });

// Observable append-only store (in-memory — the write target; the audit path is the real DB).
class Stores implements WriteStores {
  records: WriteRecord[] = [];
  private n = 0;
  private snap(p: WriteParams): WriteRecord { const r = { recordId: `r${++this.n}`, ...(p.payload ?? {}) }; this.records.push(r); return r; }
  async recordReviewDecision(p: WriteParams) { return this.snap(p); }
  async recordHumanSignoff(p: WriteParams) { return this.snap(p); }
  async createOpenItem(p: WriteParams) { return this.snap(p); }
  async recordApprovalGate(p: WriteParams) { return this.snap(p); }
  async updateRiskStatus(p: WriteParams) { return this.snap(p); }
  async recordWaveSignoff(p: WriteParams) { return this.snap(p); }
}

function descriptor(tool: string, payload: Record<string, unknown>): ActionDescriptor {
  return { tool, after: payload, risk: 'WRITE_LOW_RISK', reversible: 'soft-only', requestedBy: { user_id: 'op', email: 'op@ece.ae', role: 'operator' } };
}
const kinds = (rows: { kind: string }[], k: string) => rows.filter((r) => r.kind === k).length;
afterAll(async () => { await appPool.end(); });

function make(kill?: InMemoryKillSwitch) {
  const registry = createDefaultToolRegistry();
  registerWriteTools(registry);
  const sink = new PostgresHashChainSink(appPool, new RedactionEngine());
  const sequencer = new WriteAheadSequencer(sink, new PermissionEngine(registry, { killSwitch: kill }));
  const gate = new ApprovalGate();
  const stores = new Stores();
  const bridge = new McpBridge(registry, sequencer, { searchClients: async () => [] }, new RedactionEngine(['recordId', 'verdict', 'note']), { writeStores: stores, approvalGate: new BridgeApprovalGate(gate, 'claude') });
  return { bridge, gate, stores, sink };
}
function approve(gate: ApprovalGate, tool: string, payload: Record<string, unknown>): string {
  const q = gate.request(descriptor(tool, payload));
  gate.resolve({ actionId: q.actionId, approver: { user_id: 'human_boss', email: 'b@e', role: 'admin' }, decision: 'APPROVE', reason: 'ok' });
  return q.actionId;
}

describe('Write tools — approved write commits once, audit-bracketed (real PostgreSQL)', () => {
  it('record_review_decision ⇒ WRITE-COMMITTED, intent before + result after, mutation landed', async () => {
    const ORG = `orgW-${Date.now()}-a`;
    const { bridge, gate, stores, sink } = make();
    const payload = { verdict: 'PASS', note: 'green' };
    const actionId = approve(gate, 'record_review_decision', payload);
    const out = await bridge.writeWithTool('record_review_decision', { principal: { user_id: 'op', email: 'op@ece.ae', role: 'operator' }, organization_id: ORG, session: { session_id: 's' }, environment: 'local', via: 'claude' } as BridgeCallContext, { approvalActionId: actionId, payload });
    expect(out.status).toBe('WRITE-COMMITTED');
    expect(stores.records).toHaveLength(1);
    const entries = await sink.readEntries(ORG);
    expect(kinds(entries, 'intent')).toBe(1); // intent BEFORE
    expect(kinds(entries, 'result')).toBe(1); // result AFTER → mutation bracketed by audit
  });
});

describe('Write tools — no approval leaves the store untouched, refusal audited (real PostgreSQL)', () => {
  it('a write with no token ⇒ STOP_FOR_APPROVAL, nothing written, the denied attempt IS audited (OPEN_ITEM #1)', async () => {
    const ORG = `orgW-${Date.now()}-b`;
    const { bridge, stores, sink } = make();
    const out = await bridge.writeWithTool('create_open_item', { principal: { user_id: 'op', email: 'op@ece.ae', role: 'operator' }, organization_id: ORG, session: { session_id: 's' }, environment: 'local', via: 'claude' } as BridgeCallContext, { payload: { item: 'x' } });
    expect(out.status).toBe('STOP_FOR_APPROVAL');
    expect(stores.records).toHaveLength(0);
    const entries = await sink.readEntries(ORG);
    expect(kinds(entries, 'intent')).toBe(0);   // write withheld pre-flight — no intent (so never an orphan)
    expect(kinds(entries, 'result')).toBe(0);   // ...and no result
    expect(kinds(entries, 'refusal')).toBe(1);  // ...but the denied attempt is recorded as a distinct refusal
  });
});

describe('Write tools — single-use replay refused (real PostgreSQL)', () => {
  it('replaying a consumed token ⇒ withheld, no second mutation', async () => {
    const ORG = `orgW-${Date.now()}-c`;
    const { bridge, gate, stores } = make();
    const c: BridgeCallContext = { principal: { user_id: 'op', email: 'op@ece.ae', role: 'operator' }, organization_id: ORG, session: { session_id: 's' }, environment: 'local', via: 'claude' };
    const payload = { verdict: 'PASS' };
    const actionId = approve(gate, 'record_review_decision', payload);
    expect((await bridge.writeWithTool('record_review_decision', c, { approvalActionId: actionId, payload })).status).toBe('WRITE-COMMITTED');
    expect((await bridge.writeWithTool('record_review_decision', c, { approvalActionId: actionId, payload })).status).toBe('STOP_FOR_APPROVAL');
    expect(stores.records).toHaveLength(1); // exactly one mutation
  });
});

describe('Write tools — kill beats approval (real PostgreSQL)', () => {
  it('a kill-switched write ⇒ REFUSE even with a valid token; no mutation, refusal-audit written', async () => {
    const ORG = `orgW-${Date.now()}-d`;
    const kill = new InMemoryKillSwitch();
    kill.activate({ type: 'tool', name: 'record_review_decision' }, 'admin', 'freeze');
    const { bridge, gate, stores, sink } = make(kill);
    const payload = { verdict: 'PASS' };
    const actionId = approve(gate, 'record_review_decision', payload);
    const out = await bridge.writeWithTool('record_review_decision', { principal: { user_id: 'op', email: 'op@ece.ae', role: 'operator' }, organization_id: ORG, session: { session_id: 's' }, environment: 'local', via: 'claude' } as BridgeCallContext, { approvalActionId: actionId, payload });
    expect(out.status).toBe('refused');
    expect(stores.records).toHaveLength(0);
    expect(kinds(await sink.readEntries(ORG), 'refusal')).toBe(1); // refusal-audit; kill beats approval
  });
});
