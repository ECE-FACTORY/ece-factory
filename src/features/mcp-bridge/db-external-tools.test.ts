import { describe, it, expect, afterAll } from 'vitest';
import pkg from 'pg';
const { Pool } = pkg;
import { McpBridge, type BridgeCallContext } from './mcp-bridge.js';
import { registerExternalTools, registerForbiddenTools, type ExternalSystems, type ExternalTarget } from './external-tools.js';
import { BridgeApprovalGate } from './tool-classes.js';
import { PostgresHashChainSink } from '../audit-engine/postgres-sink.js';
import { WriteAheadSequencer } from '../audit-engine/sequencer.js';
import { PermissionEngine } from '../permission-engine/permission-engine.js';
import { createDefaultToolRegistry } from '../tool-registry/tool-registry.js';
import { RedactionEngine } from '../redaction-engine/redaction-engine.js';
import { InMemoryKillSwitch } from '../kill-switch/kill-switch.js';
import { ApprovalGate, type ActionDescriptor } from '../approval-gate/approval-gate.js';

// External-action tools — end-to-end against REAL PostgreSQL. NO real external side effects (the external
// systems are fakes). Proves the external action is audit-bracketed with the BLAST RADIUS recorded (system /
// target id / environment / reversibility), that no-approval touches neither store nor audit nor the external
// world, and that kill beats a valid approval.

const cfg = { host: process.env.PGHOST ?? '127.0.0.1', port: Number(process.env.PGPORT ?? 55432), database: process.env.PGDATABASE ?? 'ece_audit_test' };
const appPool = new Pool({ ...cfg, user: 'ece_app' });
const adminPool = new Pool({ ...cfg, user: 'postgres' }); // superuser — bypasses per-org RLS for raw inspection

class FakeExternals implements ExternalSystems {
  calls: string[] = [];
  private rec(tool: string, t: ExternalTarget) { this.calls.push(`${tool}:${t.targetId}`); return Promise.resolve({ ok: true }); }
  createGithubRepo(t: ExternalTarget) { return this.rec('create_github_repo', t); }
  openPullRequest(t: ExternalTarget) { return this.rec('open_pull_request', t); }
  createTicket(t: ExternalTarget) { return this.rec('create_ticket', t); }
  updateCrmRecord(t: ExternalTarget) { return this.rec('update_crm_record', t); }
  sendEmail(t: ExternalTarget) { return this.rec('send_email', t); }
  deployPackage(t: ExternalTarget) { return this.rec('deploy_package', t); }
}

function descriptor(tool: string, t: ExternalTarget): ActionDescriptor {
  return { tool, target: t.targetId, after: { system: t.system, effect: t.effect, environment: t.environment ?? null, payload: null }, risk: 'WRITE_MEDIUM_RISK', reversible: t.reversible, requestedBy: { user_id: 'admin1', email: 'a@e', role: 'admin' } };
}
const kinds = (rows: { kind: string }[], k: string) => rows.filter((r) => r.kind === k).length;
afterAll(async () => { await appPool.end(); await adminPool.end(); });

function make(kill?: InMemoryKillSwitch) {
  const registry = createDefaultToolRegistry();
  registerExternalTools(registry); registerForbiddenTools(registry);
  // allowlist retains the blast-radius fields in the redacted audit summary
  const sink = new PostgresHashChainSink(appPool, new RedactionEngine(['tool', 'system', 'target_id', 'environment', 'reversibility', 'effect']));
  const sequencer = new WriteAheadSequencer(sink, new PermissionEngine(registry, { killSwitch: kill }));
  const gate = new ApprovalGate();
  const externals = new FakeExternals();
  const bridge = new McpBridge(registry, sequencer, { searchClients: async () => [] }, new RedactionEngine(['ok']), { externalSystems: externals, approvalGate: new BridgeApprovalGate(gate, 'claude') });
  return { bridge, gate, externals, sink };
}
function approve(gate: ApprovalGate, tool: string, t: ExternalTarget): string {
  const q = gate.request(descriptor(tool, t));
  gate.resolve({ actionId: q.actionId, approver: { user_id: 'human_boss', email: 'b@e', role: 'admin' }, decision: 'APPROVE', reason: 'ok' });
  return q.actionId;
}
function actor(ORG: string): BridgeCallContext {
  return { principal: { user_id: 'admin1', email: 'a@ece.ae', role: 'admin' }, organization_id: ORG, session: { session_id: 's' }, environment: 'local', via: 'claude' };
}

describe('External tools — committed + blast-radius audited (real PostgreSQL)', () => {
  it('create_github_repo ⇒ EXTERNAL-ACTION-COMMITTED, intent(before)+result(after), audit names system/id/env/reversibility', async () => {
    const ORG = `orgX-${Date.now()}-a`;
    const { bridge, gate, externals, sink } = make();
    const t: ExternalTarget = { system: 'github', targetId: 'ECE-FACTORY/x', environment: 'dev', effect: 'create repo ECE-FACTORY/x private', reversible: 'soft-only' };
    const actionId = approve(gate, 'create_github_repo', t);
    const out = await bridge.externalActionWithTool('create_github_repo', actor(ORG), { approvalActionId: actionId, target: t });
    expect(out.status).toBe('EXTERNAL-ACTION-COMMITTED');
    expect(externals.calls).toEqual(['create_github_repo:ECE-FACTORY/x']);
    const entries = await sink.readEntries(ORG);
    expect(kinds(entries, 'intent')).toBe(1);
    expect(kinds(entries, 'result')).toBe(1);
    // the audit intent records the blast radius
    const row = (await adminPool.query<{ request_summary: Record<string, unknown> }>(`SELECT request_summary FROM audit_intent WHERE organization_id=$1`, [ORG])).rows[0];
    expect(row.request_summary).toMatchObject({ system: 'github', target_id: 'ECE-FACTORY/x', environment: 'dev', reversibility: 'soft-only' });
  });
});

describe('External tools — no approval leaves store + external world untouched; attempt audited (real PostgreSQL)', () => {
  it('no token ⇒ STOP_FOR_APPROVAL; zero external calls, the denied attempt IS audited (OPEN_ITEM #1)', async () => {
    const ORG = `orgX-${Date.now()}-b`;
    const { bridge, externals, sink } = make();
    const t: ExternalTarget = { system: 'email', targetId: 'a@x.com', effect: 'email a@x.com subject hi', reversible: 'no' };
    const out = await bridge.externalActionWithTool('send_email', actor(ORG), { target: t });
    expect(out.status).toBe('STOP_FOR_APPROVAL');
    expect(externals.calls).toHaveLength(0);
    const entries = await sink.readEntries(ORG);
    expect(kinds(entries, 'intent')).toBe(0);   // external port never reached — no intent
    expect(kinds(entries, 'result')).toBe(0);
    expect(kinds(entries, 'refusal')).toBe(1);  // ...but the denied attempt is recorded as a distinct refusal
  });
});

describe('External tools — kill beats approval (real PostgreSQL)', () => {
  it('a kill-switched external action ⇒ REFUSE even with a valid token; port not called, refusal-audit written', async () => {
    const ORG = `orgX-${Date.now()}-d`;
    const kill = new InMemoryKillSwitch();
    kill.activate({ type: 'tool', name: 'create_github_repo' }, 'admin', 'freeze');
    const { bridge, gate, externals, sink } = make(kill);
    const t: ExternalTarget = { system: 'github', targetId: 'ECE-FACTORY/x', effect: 'create repo ECE-FACTORY/x', reversible: 'soft-only' };
    const actionId = approve(gate, 'create_github_repo', t);
    const out = await bridge.externalActionWithTool('create_github_repo', actor(ORG), { approvalActionId: actionId, target: t });
    expect(out.status).toBe('refused');
    expect(externals.calls).toHaveLength(0);
    expect(kinds(await sink.readEntries(ORG), 'refusal')).toBe(1);
  });
});
