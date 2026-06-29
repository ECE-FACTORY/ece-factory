import { describe, it, expect, afterAll } from 'vitest';
import pkg from 'pg';
const { Pool } = pkg;
import { McpBridge, type BridgeCallContext } from './mcp-bridge.js';
import { registerFactoryReadTools, type FactoryReadPorts } from './factory-read-tools.js';
import { PostgresHashChainSink } from '../audit-engine/postgres-sink.js';
import { WriteAheadSequencer } from '../audit-engine/sequencer.js';
import { PermissionEngine } from '../permission-engine/permission-engine.js';
import { createDefaultToolRegistry } from '../tool-registry/tool-registry.js';
import { RedactionEngine } from '../redaction-engine/redaction-engine.js';

// Factory Read Tools — end-to-end against REAL PostgreSQL with the REAL guard stack. Proves a governance-
// state read is itself an AUDITED read (intent+result in the chain) and is REDACTED, and that per-tool
// permissioning is enforced with a refusal-audit — all with NO "internal = safe" exemption.

const cfg = { host: process.env.PGHOST ?? '127.0.0.1', port: Number(process.env.PGPORT ?? 55432), database: process.env.PGDATABASE ?? 'ece_audit_test' };
const appPool = new Pool({ ...cfg, user: 'ece_app' });

const registry = createDefaultToolRegistry();
registerFactoryReadTools(registry);
const sink = new PostgresHashChainSink(appPool, new RedactionEngine());
const authorizer = new PermissionEngine(registry);
const sequencer = new WriteAheadSequencer(sink, authorizer);

const PORTS: FactoryReadPorts = {
  factoryStatus: async () => ({ phase: '8.1', waves_complete: 4 }),
  waveStatus: async () => [{ wave: 5, status: 'in-progress' }],
  moduleStatus: async () => [{ module: 1, status: 'built' }],
  openGates: async () => [{ gate: 'Phase 8.1', state: 'awaiting-human' }],
  reviewLog: async () => [{ phase: '8.0', decision: 'PASS' }],
  evidencePack: async () => ({ sections: ['identity'] }),
  openItems: async () => [{ id: 7 }],
  domainRegistry: async () => [{ name: 'Cloud', status: 'registered' }],
  projectRegistry: async () => [{ project: 'Sahab', status: 'In build' }],
  featureRegistry: async () => [{ feature: 'MCP Bridge', status: 'built' }],
  riskRegister: async () => [{ key: 'RISK-1', severity: 'high', status: 'open' }],
  productCreationPlan: async () => ({ status: 'PLAN-AWAITING-APPROVAL' }),
  repoBuildPlan: async () => ({ status: 'PLAN-AWAITING-APPROVAL' }),
  toolRegistry: async () => [{ name: 'search_clients', classification: 'READ_ONLY' }],
  auditSummary: async () => [{ seq: 1, kind: 'result', status: 'success', ssn: '999-99-9999' }],
};
const GOV_ALLOWLIST = ['phase', 'waves_complete', 'wave', 'status', 'module', 'gate', 'state', 'decision', 'seq', 'kind', 'name', 'project', 'feature', 'key', 'severity'];
const bridge = new McpBridge(registry, sequencer, { searchClients: async () => [] }, new RedactionEngine(GOV_ALLOWLIST), { factoryPorts: PORTS });

const ORG = `orgGov-${Date.now()}`;
function ctx(over: Partial<BridgeCallContext> = {}): BridgeCallContext {
  return { principal: { user_id: 'op_real', email: 'op@ece.ae', role: 'operator' }, organization_id: ORG, session: { session_id: 's-gov' }, environment: 'local', via: 'claude', ...over };
}
const kinds = (rows: { kind: string }[], k: string) => rows.filter((r) => r.kind === k).length;
afterAll(async () => { await appPool.end(); });

describe('Factory read tools — governance read is audited + redacted (real PostgreSQL)', () => {
  it('read_audit_summary ⇒ audited (intent+result) and sensitive payload redacted', async () => {
    const out = await bridge.readFactoryState('read_audit_summary', ctx());
    expect(out.status).toBe('ok');
    if (out.status !== 'ok') return;
    expect(JSON.stringify(out.data)).not.toMatch(/ssn|999-99-9999/); // redacted before leaving the bridge
    const entries = await sink.readEntries(ORG);
    expect(kinds(entries, 'intent')).toBe(1);   // the read of governance state is itself recorded
    expect(kinds(entries, 'result')).toBe(1);
  });
});

describe('Factory read tools — per-tool permissioning (real PostgreSQL)', () => {
  it('a user-role caller is REFUSED read_tool_registry and a refusal-audit is written', async () => {
    const ORG2 = `${ORG}-user`;
    const out = await bridge.readFactoryState('read_tool_registry', ctx({ organization_id: ORG2, principal: { user_id: 'u_real', email: 'u@ece.ae', role: 'user' } }));
    expect(out.status).toBe('refused');
    const entries = await sink.readEntries(ORG2);
    expect(kinds(entries, 'refusal')).toBe(1);
    expect(kinds(entries, 'intent')).toBe(0); // refused before any intent → no data path
  });
});
