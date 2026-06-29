import { describe, it, expect, afterAll } from 'vitest';
import pkg from 'pg';
const { Pool } = pkg;
import { McpBridge, type BridgeCallContext } from './mcp-bridge.js';
import { registerDraftTools, type DraftPorts } from './draft-tools.js';
import { registerFactoryReadTools } from './factory-read-tools.js';
import { DRAFT_STATUS } from './tool-classes.js';
import { PostgresHashChainSink } from '../audit-engine/postgres-sink.js';
import { WriteAheadSequencer } from '../audit-engine/sequencer.js';
import { PermissionEngine } from '../permission-engine/permission-engine.js';
import { createDefaultToolRegistry } from '../tool-registry/tool-registry.js';
import { RedactionEngine } from '../redaction-engine/redaction-engine.js';

// Draft tools — end-to-end against REAL PostgreSQL with the REAL guard stack. Proves: a draft production is
// itself an AUDITED event (intent+result) and is REDACTED; per-tool permissioning writes a refusal-audit;
// and drafting is INERT at the DB layer (the bridge role stays SELECT-only; no row is written by drafting).

const cfg = { host: process.env.PGHOST ?? '127.0.0.1', port: Number(process.env.PGPORT ?? 55432), database: process.env.PGDATABASE ?? 'ece_audit_test' };
const appPool = new Pool({ ...cfg, user: 'ece_app' });

const registry = createDefaultToolRegistry();
registerFactoryReadTools(registry);
registerDraftTools(registry);
const sink = new PostgresHashChainSink(appPool, new RedactionEngine());
const sequencer = new WriteAheadSequencer(sink, new PermissionEngine(registry));

const PORTS: DraftPorts = {
  nextPrompt: async () => ({ proposedPrompt: 'next' }),
  reviewDecision: async () => ({ proposedVerdict: 'PASS', rationale: 'green' }),
  waveReport: async () => ({ wave: 5, proposedSignOff: 'recommend-sign-off' }),
  productPlan: async () => ({ status: 'PLAN-AWAITING-APPROVAL' }),
  riskSummary: async () => ({ open: 1, ssn: '999-99-9999' }), // sensitive field to prove redaction
  openItemsSummary: async () => ({ items: [7] }),
  repoPlan: async () => ({ repo: 'sahab' }),
};
const ALLOW = ['proposedPrompt', 'proposedVerdict', 'rationale', 'wave', 'proposedSignOff', 'status', 'open', 'items', 'repo'];
const bridge = new McpBridge(registry, sequencer, { searchClients: async () => [] }, new RedactionEngine(ALLOW), { draftPorts: PORTS });

const ORG = `orgDraft-${Date.now()}`;
function ctx(over: Partial<BridgeCallContext> = {}): BridgeCallContext {
  return { principal: { user_id: 'op_real', email: 'op@ece.ae', role: 'operator' }, organization_id: ORG, session: { session_id: 's-draft' }, environment: 'local', via: 'claude', ...over };
}
const kinds = (rows: { kind: string }[], k: string) => rows.filter((r) => r.kind === k).length;
afterAll(async () => { await appPool.end(); });

describe('Draft tools — draft production is audited + redacted (real PostgreSQL)', () => {
  it('draft_review_decision ⇒ DRAFT status, audited (intent+result), proposes PASS as inert content', async () => {
    const out = await bridge.draftWithTool('draft_review_decision', ctx());
    expect(out.status).toBe(DRAFT_STATUS); // never PASS — the outcome has no authority
    const entries = await sink.readEntries(ORG);
    expect(kinds(entries, 'intent')).toBe(1);
    expect(kinds(entries, 'result')).toBe(1);
  });

  it('draft_risk_summary redacts its sensitive field before return', async () => {
    const out = await bridge.draftWithTool('draft_risk_summary', ctx({ organization_id: `${ORG}-rs` }));
    expect(out.status).toBe(DRAFT_STATUS);
    expect(JSON.stringify(out)).not.toMatch(/ssn|999-99-9999/);
  });
});

describe('Draft tools — per-tool permissioning (real PostgreSQL)', () => {
  it('a user-role caller is REFUSED draft_review_decision and a refusal-audit is written', async () => {
    const ORG2 = `${ORG}-user`;
    const out = await bridge.draftWithTool('draft_review_decision', ctx({ organization_id: ORG2, principal: { user_id: 'u_real', email: 'u@ece.ae', role: 'user' } }));
    expect(out.status).toBe('refused');
    const entries = await sink.readEntries(ORG2);
    expect(kinds(entries, 'refusal')).toBe(1);
    expect(kinds(entries, 'intent')).toBe(0);
  });
});

describe('Draft tools — INERT at the DB layer (drafting writes nothing to the system of record)', () => {
  it('the client count is unchanged by drafting, and the bridge role still cannot write', async () => {
    const before = (await appPool.query('SELECT count(*)::int AS n FROM clients')).rows[0].n as number;
    await bridge.draftWithTool('draft_repo_plan', ctx({ organization_id: `${ORG}-inert` }));
    const after = (await appPool.query('SELECT count(*)::int AS n FROM clients')).rows[0].n as number;
    expect(after).toBe(before); // drafting created no system-of-record row
    await expect(appPool.query(`INSERT INTO clients (client_id, organization_id, name) VALUES ('z','z','z')`)).rejects.toThrow(/permission denied/i);
  });
});
