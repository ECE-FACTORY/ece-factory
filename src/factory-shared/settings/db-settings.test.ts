import { describe, it, expect, afterAll } from 'vitest';
import pkg from 'pg';
const { Pool } = pkg;
import { SettingsRegistry, SettingsService, SettingsError, DEFAULT_FACTORY_SETTINGS } from './settings.js';
import { PostgresSettingsStore } from './postgres-settings-store.js';
import { McpBridge, type BridgeCallContext } from '../../layer-5-action/mcp-bridge/mcp-bridge.js';
import { createDefaultToolRegistry } from '../../layer-5-action/tool-registry/tool-registry.js';
import { registerWriteTools, type WriteStores, type WriteParams, type WriteRecord } from '../../layer-5-action/mcp-bridge/write-tools.js';
import { BridgeApprovalGate } from '../../layer-5-action/mcp-bridge/tool-classes.js';
import { PostgresHashChainSink } from '../audit-engine/postgres-sink.js';
import { WriteAheadSequencer } from '../audit-engine/sequencer.js';
import { PermissionEngine } from '../../layer-1-law/permission-engine/permission-engine.js';
import { RedactionEngine } from '../redaction-engine/redaction-engine.js';
import { InMemoryKillSwitch } from '../../layer-1-law/kill-switch/kill-switch.js';
import { ApprovalGate, type ActionDescriptor } from '../../layer-1-law/approval-gate/approval-gate.js';

// Settings (Module 25) — real PostgreSQL. The append-only store, and the token-gate INHERITANCE: a setting
// change routed through the bridge's APPROVAL_REQUIRED_WRITE path lands a snapshot ONLY with a valid token.

const cfg = { host: process.env.PGHOST ?? '127.0.0.1', port: Number(process.env.PGPORT ?? 55432), database: process.env.PGDATABASE ?? 'ece_audit_test' };
const appPool = new Pool({ ...cfg, user: 'ece_app' });
afterAll(async () => { await appPool.end(); });

const registry = new SettingsRegistry(DEFAULT_FACTORY_SETTINGS);
const service = new SettingsService(registry);
const store = new PostgresSettingsStore(appPool);
const countSettings = async () => (await appPool.query('SELECT count(*)::int AS n FROM settings')).rows[0].n as number;

describe('Settings — read returns the current (latest-snapshot) value, else the default', () => {
  it('read before any change ⇒ default; after a change ⇒ the latest snapshot', async () => {
    const before = await service.read(store, 'harvest.min_score');
    expect(before.isDefault).toBe(true);
    expect(before.value).toBe(70);
    await service.change(store, { key: 'harvest.min_score', value: 85, changedBy: 'human_boss', reason: 'tighten' });
    const after = await service.read(store, 'harvest.min_score');
    expect(after.isDefault).toBe(false);
    expect(after.value).toBe(85);
  });
});

describe('Settings — append-only (real PostgreSQL)', () => {
  it('two changes ⇒ two snapshots (history preserved); UPDATE/DELETE denied at the DB layer', async () => {
    await service.change(store, { key: 'autopilot.max_steps', value: 16, changedBy: 'human_boss' });
    await service.change(store, { key: 'autopilot.max_steps', value: 24, changedBy: 'human_boss' });
    const hist = await store.history('autopilot.max_steps');
    expect(hist.map((h) => h.value)).toEqual([16, 24]);
    expect((await service.read(store, 'autopilot.max_steps')).value).toBe(24);
    await expect(appPool.query(`UPDATE settings SET value='0' WHERE key='autopilot.max_steps'`)).rejects.toThrow(/permission denied|append-only/i);
    await expect(appPool.query(`DELETE FROM settings WHERE key='autopilot.max_steps'`)).rejects.toThrow(/permission denied|append-only/i);
  });
});

describe('Settings — a guard-disabling change is refused (nothing written)', () => {
  it('cannot turn audit retention to 0 / redaction off / an unknown guard key', async () => {
    const before = await countSettings();
    await expect(service.change(store, { key: 'audit.retention_days', value: 0, changedBy: 'human_boss' })).rejects.toThrow(SettingsError);
    await expect(service.change(store, { key: 'redaction.mode', value: 'off', changedBy: 'human_boss' })).rejects.toThrow(SettingsError);
    await expect(service.change(store, { key: 'audit.enabled', value: false, changedBy: 'human_boss' })).rejects.toThrow(SettingsError);
    await expect(service.change(store, { key: 'approval.window_minutes', value: 0, changedBy: 'human_boss' })).rejects.toThrow(SettingsError);
    expect(await countSettings()).toBe(before); // nothing appended
  });
  it('a SECURITY_CRITICAL change WITHIN the guarantee commits (gated, but allowed)', async () => {
    await service.change(store, { key: 'audit.retention_days', value: 730, changedBy: 'human_boss', reason: 'longer retention' });
    expect((await service.read(store, 'audit.retention_days')).value).toBe(730);
  });
});

// ── Token-gate inheritance: route a settings change through the bridge's APPROVAL_REQUIRED_WRITE path. ──
class SettingsBackedWriteStore implements WriteStores {
  constructor(private readonly svc: SettingsService, private readonly st: PostgresSettingsStore) {}
  private async apply(p: WriteParams): Promise<WriteRecord> {
    const pl = p.payload ?? {};
    const rec = await this.svc.change(this.st, { key: String(pl.key), value: pl.value as never, changedBy: String(pl.changedBy ?? 'human_boss'), reason: 'via bridge APPROVAL_REQUIRED_WRITE' });
    return { recordId: rec.recordId, key: rec.key, value: rec.value };
  }
  recordReviewDecision = (p: WriteParams) => this.apply(p);
  recordHumanSignoff = (p: WriteParams) => this.apply(p);
  createOpenItem = (p: WriteParams) => this.apply(p); // the vehicle tool for this proof
  recordApprovalGate = (p: WriteParams) => this.apply(p);
  updateRiskStatus = (p: WriteParams) => this.apply(p);
  recordWaveSignoff = (p: WriteParams) => this.apply(p);
}

const toolReg = createDefaultToolRegistry();
registerWriteTools(toolReg);
const sink = new PostgresHashChainSink(appPool, new RedactionEngine());
const gate = new ApprovalGate();
const settingsWriteStore = new SettingsBackedWriteStore(service, store);
function bridgeWith(kill?: InMemoryKillSwitch, g: ApprovalGate = gate, caller = 'op_real') {
  return new McpBridge(toolReg, new WriteAheadSequencer(sink, new PermissionEngine(toolReg, { killSwitch: kill })),
    { searchClients: async () => [] }, new RedactionEngine(['recordId', 'key', 'value']),
    { writeStores: settingsWriteStore, approvalGate: new BridgeApprovalGate(g, caller) });
}
function ctx(role = 'operator'): BridgeCallContext {
  return { principal: { user_id: 'op_real', email: 'o@e', role }, organization_id: `orgSET-${Date.now()}`, session: { session_id: 's' }, environment: 'local', via: 'claude-code' };
}
function approve(g: ApprovalGate, target: string, payload: Record<string, unknown>, approver = 'human_boss'): string {
  const d: ActionDescriptor = { tool: 'create_open_item', target, after: payload, risk: 'WRITE_LOW_RISK', reversible: 'soft-only', requestedBy: { user_id: 'op_real', email: 'o@e', role: 'operator' } };
  const q = g.request(d);
  g.resolve({ actionId: q.actionId, approver: { user_id: approver, email: 'b@e', role: 'admin' }, decision: 'APPROVE', reason: 'ok' });
  return q.actionId;
}

describe('Settings — change is an APPROVAL_REQUIRED_WRITE: no token ⇒ STOP, token ⇒ committed snapshot', () => {
  it('no token ⇒ STOP_FOR_APPROVAL, the settings store is unchanged', async () => {
    const before = await countSettings();
    const out = await bridgeWith().writeWithTool('create_open_item', ctx(), { payload: { key: 'reporting.timezone', value: 'UTC' } });
    expect(out.status).toBe('STOP_FOR_APPROVAL');
    expect(await countSettings()).toBe(before);
  });
  it('valid single-use human token ⇒ WRITE-COMMITTED, a new settings snapshot is appended', async () => {
    const before = await countSettings();
    const payload = { key: 'reporting.timezone', value: 'UTC', changedBy: 'human_boss' };
    const actionId = approve(gate, 'tz', payload);
    const out = await bridgeWith().writeWithTool('create_open_item', ctx(), { approvalActionId: actionId, target: 'tz', payload });
    expect(out.status).toBe('WRITE-COMMITTED');
    expect(await countSettings()).toBe(before + 1);
    expect((await service.read(store, 'reporting.timezone')).value).toBe('UTC');
  });
});

describe('Settings — self-approval rejected & kill beats approval (a change inherits the gate)', () => {
  it('self-approval ⇒ STOP, no snapshot', async () => {
    const g = new ApprovalGate();
    const payload = { key: 'reporting.timezone', value: 'Asia/Riyadh', changedBy: 'op_real' };
    const actionId = approve(g, 'tz2', payload, 'op_real'); // approver == caller
    const before = await countSettings();
    const out = await bridgeWith(undefined, g, 'op_real').writeWithTool('create_open_item', ctx(), { approvalActionId: actionId, target: 'tz2', payload });
    expect(out.status).toBe('STOP_FOR_APPROVAL');
    expect(await countSettings()).toBe(before);
  });
  it('kill beats approval ⇒ REFUSE, no snapshot', async () => {
    const kill = new InMemoryKillSwitch();
    kill.activate({ type: 'tool', name: 'create_open_item' }, 'admin', 'freeze');
    const payload = { key: 'reporting.timezone', value: 'Asia/Dubai', changedBy: 'human_boss' };
    const actionId = approve(gate, 'tz3', payload);
    const before = await countSettings();
    const out = await bridgeWith(kill).writeWithTool('create_open_item', ctx(), { approvalActionId: actionId, target: 'tz3', payload });
    expect(out.status).toBe('refused');
    expect(await countSettings()).toBe(before);
  });
});
