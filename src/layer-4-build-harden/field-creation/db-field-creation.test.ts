import { describe, it, expect, afterAll } from 'vitest';
import pkg from 'pg';
const { Pool } = pkg;
import { FieldCreationService, FieldCreationError, type FieldDefinitionInput } from './field-creation.js';
import { PostgresFieldDefinitionStore } from './postgres-field-store.js';
import { McpBridge, type BridgeCallContext } from '../../layer-5-action/mcp-bridge/mcp-bridge.js';
import { createDefaultToolRegistry } from '../../layer-5-action/tool-registry/tool-registry.js';
import { registerWriteTools, type WriteStores, type WriteParams, type WriteRecord } from '../../layer-5-action/mcp-bridge/write-tools.js';
import { BridgeApprovalGate } from '../../layer-5-action/mcp-bridge/tool-classes.js';
import { PostgresHashChainSink } from '../../factory-shared/audit-engine/postgres-sink.js';
import { WriteAheadSequencer } from '../../factory-shared/audit-engine/sequencer.js';
import { PermissionEngine } from '../../layer-1-law/permission-engine/permission-engine.js';
import { RedactionEngine } from '../../factory-shared/redaction-engine/redaction-engine.js';
import { InMemoryKillSwitch } from '../../layer-1-law/kill-switch/kill-switch.js';
import { ApprovalGate, type ActionDescriptor } from '../../layer-1-law/approval-gate/approval-gate.js';

// Field Creation (Module 20) — real PostgreSQL. The append-only store, the registered-target check, and the
// token-gate INHERITANCE: a field create routed through the bridge's APPROVAL_REQUIRED_WRITE path lands a
// snapshot ONLY with a valid token.

const cfg = { host: process.env.PGHOST ?? '127.0.0.1', port: Number(process.env.PGPORT ?? 55432), database: process.env.PGDATABASE ?? 'ece_audit_test' };
const appPool = new Pool({ ...cfg, user: 'ece_app' });
afterAll(async () => { await appPool.end(); });

const registered = new Set<string>(); // (target:targetRef) that are "registered"
const lookup = async (target: string, ref: string) => registered.has(`${target}:${ref}`);
const service = new FieldCreationService(lookup);
const store = new PostgresFieldDefinitionStore(appPool);
const countFields = async () => (await appPool.query('SELECT count(*)::int AS n FROM field_definitions')).rows[0].n as number;

function field(over: Partial<FieldDefinitionInput> = {}): FieldDefinitionInput {
  return { key: 'priority', label: 'Priority', dataType: 'enum', target: 'project', targetRef: 'Sahab', changedBy: 'human_boss', constraints: { enumValues: ['low', 'high'] }, ...over };
}

describe('Field Creation — read returns the current (latest-snapshot) definition; append-only history', () => {
  it('create then change ⇒ two snapshots, read returns the latest; UPDATE/DELETE denied', async () => {
    registered.add('project:Sahab');
    const key = `f_${Date.now()}`;
    await service.create(store, field({ key, label: 'V1' }));
    await service.change(store, field({ key, label: 'V2', constraints: { enumValues: ['low', 'high', 'critical'] } }));
    expect((await service.read(store, 'project', 'Sahab', key))!.label).toBe('V2');
    expect((await store.history('project', 'Sahab', key)).map((h) => h.label)).toEqual(['V1', 'V2']);
    await expect(appPool.query(`UPDATE field_definitions SET label='x' WHERE key=$1`, [key])).rejects.toThrow(/permission denied|append-only/i);
    await expect(appPool.query(`DELETE FROM field_definitions WHERE key=$1`, [key])).rejects.toThrow(/permission denied|append-only/i);
  });
});

describe('Field Creation — deny-by-default against the live store', () => {
  it('a duplicate key on the same target ⇒ rejected (no silent overwrite)', async () => {
    registered.add('project:Sahab');
    const key = `dup_${Date.now()}`;
    await service.create(store, field({ key }));
    const before = await countFields();
    await expect(service.create(store, field({ key }))).rejects.toThrow(FieldCreationError);
    expect(await countFields()).toBe(before);
  });
  it('a field on an UNREGISTERED target ⇒ rejected, nothing written', async () => {
    const before = await countFields();
    await expect(service.create(store, field({ key: `u_${Date.now()}`, targetRef: 'NotRegistered' }))).rejects.toThrow(/unregistered target/);
    expect(await countFields()).toBe(before);
  });
  it('an inert-violating definition (executable constraint) ⇒ rejected, nothing written', async () => {
    registered.add('project:Sahab');
    const before = await countFields();
    await expect(service.create(store, field({ key: `bad_${Date.now()}`, dataType: 'string', constraints: { regex: "'; DROP TABLE x; --" } }))).rejects.toThrow(FieldCreationError);
    expect(await countFields()).toBe(before);
  });
});

// ── Token-gate inheritance: route a field create through the bridge's APPROVAL_REQUIRED_WRITE path. ──
class FieldBackedWriteStore implements WriteStores {
  constructor(private readonly svc: FieldCreationService, private readonly st: PostgresFieldDefinitionStore) {}
  private async apply(p: WriteParams): Promise<WriteRecord> {
    const rec = await this.svc.create(this.st, (p.payload as unknown as FieldDefinitionInput));
    return { recordId: rec.recordId, key: rec.key, label: rec.label };
  }
  recordReviewDecision = (p: WriteParams) => this.apply(p);
  recordHumanSignoff = (p: WriteParams) => this.apply(p);
  createOpenItem = (p: WriteParams) => this.apply(p); // vehicle tool for this proof
  recordApprovalGate = (p: WriteParams) => this.apply(p);
  updateRiskStatus = (p: WriteParams) => this.apply(p);
  recordWaveSignoff = (p: WriteParams) => this.apply(p);
}

const toolReg = createDefaultToolRegistry();
registerWriteTools(toolReg);
const sink = new PostgresHashChainSink(appPool, new RedactionEngine());
const gate = new ApprovalGate();
const fieldWriteStore = new FieldBackedWriteStore(service, store);
function bridgeWith(kill?: InMemoryKillSwitch, g: ApprovalGate = gate, caller = 'op_real') {
  return new McpBridge(toolReg, new WriteAheadSequencer(sink, new PermissionEngine(toolReg, { killSwitch: kill })),
    { searchClients: async () => [] }, new RedactionEngine(['recordId', 'key', 'label']),
    { writeStores: fieldWriteStore, approvalGate: new BridgeApprovalGate(g, caller) });
}
function ctx(): BridgeCallContext {
  return { principal: { user_id: 'op_real', email: 'o@e', role: 'operator' }, organization_id: `orgFLD-${Date.now()}`, session: { session_id: 's' }, environment: 'local', via: 'claude-code' };
}
function approve(g: ApprovalGate, target: string, payload: Record<string, unknown>, approver = 'human_boss'): string {
  const d: ActionDescriptor = { tool: 'create_open_item', target, after: payload, risk: 'WRITE_LOW_RISK', reversible: 'soft-only', requestedBy: { user_id: 'op_real', email: 'o@e', role: 'operator' } };
  const q = g.request(d);
  g.resolve({ actionId: q.actionId, approver: { user_id: approver, email: 'b@e', role: 'admin' }, decision: 'APPROVE', reason: 'ok' });
  return q.actionId;
}

describe('Field Creation — create is an APPROVAL_REQUIRED_WRITE: no token ⇒ STOP, token ⇒ committed snapshot', () => {
  it('no token ⇒ STOP_FOR_APPROVAL, the field store is unchanged', async () => {
    registered.add('project:Sahab');
    const before = await countFields();
    const payload = field({ key: `nt_${Date.now()}` }) as unknown as Record<string, unknown>;
    const out = await bridgeWith().writeWithTool('create_open_item', ctx(), { payload });
    expect(out.status).toBe('STOP_FOR_APPROVAL');
    expect(await countFields()).toBe(before);
  });
  it('valid single-use human token ⇒ WRITE-COMMITTED, a new field snapshot is appended', async () => {
    registered.add('project:Sahab');
    const before = await countFields();
    const key = `wt_${Date.now()}`;
    const payload = field({ key }) as unknown as Record<string, unknown>;
    const actionId = approve(gate, 'f', payload);
    const out = await bridgeWith().writeWithTool('create_open_item', ctx(), { approvalActionId: actionId, target: 'f', payload });
    expect(out.status).toBe('WRITE-COMMITTED');
    expect(await countFields()).toBe(before + 1);
    expect((await service.read(store, 'project', 'Sahab', key))!.label).toBe('Priority');
  });
  it('self-approval ⇒ STOP, no snapshot; kill beats approval ⇒ REFUSE, no snapshot', async () => {
    registered.add('project:Sahab');
    // self-approval
    const g = new ApprovalGate();
    const p1 = field({ key: `sa_${Date.now()}` }) as unknown as Record<string, unknown>;
    const a1 = approve(g, 'f1', p1, 'op_real'); // approver == caller
    const before1 = await countFields();
    expect((await bridgeWith(undefined, g, 'op_real').writeWithTool('create_open_item', ctx(), { approvalActionId: a1, target: 'f1', payload: p1 })).status).toBe('STOP_FOR_APPROVAL');
    expect(await countFields()).toBe(before1);
    // kill beats approval
    const kill = new InMemoryKillSwitch();
    kill.activate({ type: 'tool', name: 'create_open_item' }, 'admin', 'freeze');
    const p2 = field({ key: `kl_${Date.now()}` }) as unknown as Record<string, unknown>;
    const a2 = approve(gate, 'f2', p2);
    const before2 = await countFields();
    expect((await bridgeWith(kill).writeWithTool('create_open_item', ctx(), { approvalActionId: a2, target: 'f2', payload: p2 })).status).toBe('refused');
    expect(await countFields()).toBe(before2);
  });
});
