import { describe, it, expect, afterAll } from 'vitest';
import pkg from 'pg';
const { Pool } = pkg;
import { AutopilotRunner } from './autopilot.js';
import { McpBridge, type BridgeCallContext } from '../mcp-bridge/mcp-bridge.js';
import { registerFactoryReadTools, type FactoryReadPorts } from '../mcp-bridge/factory-read-tools.js';
import { registerDraftTools, type DraftPorts } from '../mcp-bridge/draft-tools.js';
import { registerWriteTools, type WriteStores, type WriteRecord } from '../mcp-bridge/write-tools.js';
import { registerExternalTools, type ExternalSystems, type ExternalTarget } from '../mcp-bridge/external-tools.js';
import { BridgeApprovalGate } from '../mcp-bridge/tool-classes.js';
import { PostgresHashChainSink } from '../audit-engine/postgres-sink.js';
import { WriteAheadSequencer } from '../audit-engine/sequencer.js';
import { PermissionEngine } from '../permission-engine/permission-engine.js';
import { createDefaultToolRegistry } from '../tool-registry/tool-registry.js';
import { RedactionEngine } from '../redaction-engine/redaction-engine.js';
import { ApprovalGate } from '../approval-gate/approval-gate.js';

// Autopilot Runner — end-to-end against REAL PostgreSQL. Autopilot drives a REAL McpBridge (full four-tier
// surface). Proves: its reads/drafts go through the AUDITED bridge (no bypass), and that across an autonomous
// run NO write/external store is touched and NO approval is created — it only reads and proposes.

const cfg = { host: process.env.PGHOST ?? '127.0.0.1', port: Number(process.env.PGPORT ?? 55432), database: process.env.PGDATABASE ?? 'ece_audit_test' };
const appPool = new Pool({ ...cfg, user: 'ece_app' });
afterAll(async () => { await appPool.end(); });

const FACTORY: FactoryReadPorts = {
  factoryStatus: async () => ({ nextAction: 'Phase 8.6: next governed module', consequential: true }),
  waveStatus: async () => [{ wave: 5, status: 'in-progress' }],
  moduleStatus: async () => [],
  openGates: async () => [], // no blocking gate → Autopilot will read + propose
  reviewLog: async () => [{ phase: '8.5', decision: 'PASS' }],
  evidencePack: async () => ({}),
  openItems: async () => [{ id: 7 }],
  domainRegistry: async () => [],
  projectRegistry: async () => [],
  featureRegistry: async () => [],
  riskRegister: async () => [{ key: 'RISK-1', severity: 'high', status: 'open' }],
  productCreationPlan: async () => ({}),
  repoBuildPlan: async () => ({}),
  toolRegistry: async () => [],
  auditSummary: async () => [],
};
const DRAFTS: DraftPorts = {
  nextPrompt: async (p) => ({ proposedFor: p.ref ?? null, body: 'proposed next prompt' }),
  reviewDecision: async () => ({ proposedVerdict: 'PASS' }),
  waveReport: async () => ({}), productPlan: async () => ({}), riskSummary: async () => ({}),
  openItemsSummary: async () => ({}), repoPlan: async () => ({}),
};

// Observable write/external stores — must remain UNTOUCHED across an Autopilot run.
class WStores implements WriteStores {
  records: WriteRecord[] = [];
  private mk(): WriteRecord { const r = { recordId: 'x' }; this.records.push(r); return r; }
  async recordReviewDecision() { return this.mk(); } async recordHumanSignoff() { return this.mk(); }
  async createOpenItem() { return this.mk(); } async recordApprovalGate() { return this.mk(); }
  async updateRiskStatus() { return this.mk(); } async recordWaveSignoff() { return this.mk(); }
}
class XSystems implements ExternalSystems {
  calls = 0;
  private rec() { this.calls++; return Promise.resolve({ ok: true }); }
  createGithubRepo(_t: ExternalTarget) { return this.rec(); } openPullRequest() { return this.rec(); }
  createTicket() { return this.rec(); } updateCrmRecord() { return this.rec(); }
  sendEmail() { return this.rec(); } deployPackage() { return this.rec(); } createMilestone() { return this.rec(); } createLabel() { return this.rec(); } createIssueBatch() { return this.rec(); }
}

const kinds = (rows: { kind: string }[], k: string) => rows.filter((r) => r.kind === k).length;

function makeBridge() {
  const registry = createDefaultToolRegistry();
  registerFactoryReadTools(registry); registerDraftTools(registry); registerWriteTools(registry); registerExternalTools(registry);
  const sink = new PostgresHashChainSink(appPool, new RedactionEngine(['tool', 'target']));
  const sequencer = new WriteAheadSequencer(sink, new PermissionEngine(registry));
  const wstores = new WStores(); const xsystems = new XSystems();
  // bridge redactor keeps the fields Autopilot's decision needs (nextAction/consequential/gate/state) + draft fields
  const redactor = new RedactionEngine(['nextAction', 'consequential', 'gate', 'state', 'proposedFor', 'body', 'wave', 'status', 'phase', 'decision', 'id', 'key', 'severity']);
  const bridge = new McpBridge(registry, sequencer, { searchClients: async () => [] }, redactor, {
    factoryPorts: FACTORY, draftPorts: DRAFTS, writeStores: wstores, externalSystems: xsystems, approvalGate: new BridgeApprovalGate(new ApprovalGate(), 'autopilot'),
  });
  return { bridge, sink, wstores, xsystems };
}

describe('Autopilot — reads/drafts audited through the bridge, no consequential effect (real PostgreSQL)', () => {
  it('an Autopilot run ⇒ AWAITING-APPROVAL; every read/draft is audited; write/external untouched', async () => {
    const ORG = `orgAP-${Date.now()}`;
    const { bridge, sink, wstores, xsystems } = makeBridge();
    const ctx: BridgeCallContext = { principal: { user_id: 'op_real', email: 'op@ece.ae', role: 'operator' }, organization_id: ORG, session: { session_id: 's-ap' }, environment: 'local', via: 'autopilot' };
    const out = await new AutopilotRunner(bridge).run(ctx);

    expect(out.status).toBe('AUTOPILOT-PROPOSED-AWAITING-APPROVAL'); // proposed, never executed
    // every read (5) + draft (1) went through the AUDITED bridge path — no bypass
    const entries = await sink.readEntries(ORG);
    expect(kinds(entries, 'intent')).toBe(6);
    expect(kinds(entries, 'result')).toBe(6);
    // NO consequential effect: write stores empty, external systems never called, no approval
    expect(wstores.records).toHaveLength(0);
    expect(xsystems.calls).toBe(0);
  });
});
