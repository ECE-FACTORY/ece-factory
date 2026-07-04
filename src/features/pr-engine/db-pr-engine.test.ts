import { describe, it, expect, afterAll } from 'vitest';
import pkg from 'pg';
const { Pool } = pkg;
import { PrEngine, type PrOpenInput } from './pr-engine.js';
import { McpBridge, type BridgeCallContext } from '../mcp-bridge/mcp-bridge.js';
import { createDefaultToolRegistry } from '../tool-registry/tool-registry.js';
import { registerExternalTools, registerForbiddenTools, type ExternalSystems, type ExternalTarget } from '../mcp-bridge/external-tools.js';
import { registerDraftTools, type DraftPorts } from '../mcp-bridge/draft-tools.js';
import { BridgeApprovalGate } from '../mcp-bridge/tool-classes.js';
import { PostgresHashChainSink } from '../audit-engine/postgres-sink.js';
import { WriteAheadSequencer } from '../audit-engine/sequencer.js';
import { PermissionEngine } from '../permission-engine/permission-engine.js';
import { RedactionEngine } from '../redaction-engine/redaction-engine.js';
import { InMemoryKillSwitch } from '../kill-switch/kill-switch.js';
import { ApprovalGate, type ActionDescriptor } from '../approval-gate/approval-gate.js';

// PR Engine (Module 30) — real PostgreSQL audited path, REAL bridge gauntlet, FAKE external system (records
// what would happen; ZERO real calls). Proves drafting opens nothing, opening requires the full 8.4 gauntlet,
// and the external port is never reached on any refusal path.

const cfg = { host: process.env.PGHOST ?? '127.0.0.1', port: Number(process.env.PGPORT ?? 55432), database: process.env.PGDATABASE ?? 'ece_audit_test' };
const appPool = new Pool({ ...cfg, user: 'ece_app' });
const adminPool = new Pool({ ...cfg, user: 'postgres' }); // bypasses RLS to read the blast-radius audit summary
afterAll(async () => { await appPool.end(); await adminPool.end(); });

class FakeGitHub implements ExternalSystems {
  opened: ExternalTarget[] = [];
  async openPullRequest(t: ExternalTarget): Promise<{ ok: true }> { this.opened.push(t); return { ok: true }; }
  private nope = async (): Promise<never> => { throw new Error('not used'); };
  createGithubRepo = this.nope; createTicket = this.nope; updateCrmRecord = this.nope; sendEmail = this.nope; deployPackage = this.nope; createMilestone = this.nope; createLabel = this.nope; createIssueBatch = this.nope;
}
const drafted: string[] = [];
const DRAFTS: DraftPorts = {
  repoPlan: async () => { drafted.push('repoPlan'); return { proposed: true }; },
  nextPrompt: async () => ({}), reviewDecision: async () => ({}), waveReport: async () => ({}), productPlan: async () => ({}), riskSummary: async () => ({}), openItemsSummary: async () => ({}),
};

const toolReg = createDefaultToolRegistry();
registerDraftTools(toolReg); registerExternalTools(toolReg); registerForbiddenTools(toolReg);
const sink = new PostgresHashChainSink(appPool, new RedactionEngine(['tool', 'system', 'target_id', 'environment', 'reversibility', 'effect']));
const gate = new ApprovalGate();
const github = new FakeGitHub();
function buildBridge(kill?: InMemoryKillSwitch, g: ApprovalGate = gate, caller = 'op_real') {
  return new McpBridge(toolReg, new WriteAheadSequencer(sink, new PermissionEngine(toolReg, { killSwitch: kill })),
    { searchClients: async () => [] }, new RedactionEngine(['ok', 'pr']),
    { draftPorts: DRAFTS, externalSystems: github, approvalGate: new BridgeApprovalGate(g, caller) });
}
const engine = (kill?: InMemoryKillSwitch, g?: ApprovalGate, caller?: string) => new PrEngine(buildBridge(kill, g, caller), async (repo) => repo.startsWith('ECE-FACTORY/'));

function ctx(org: string): BridgeCallContext {
  return { principal: { user_id: 'op_real', email: 'o@e', role: 'operator' }, organization_id: org, session: { session_id: 's' }, environment: 'local', via: 'claude-code' };
}
const TARGET = { repo: 'ECE-FACTORY/x', branch: 'feature/y', base: 'main' };
function openInput(over: Partial<PrOpenInput> = {}): PrOpenInput { return { target: TARGET, title: 'Add the thing', body: 'Details', ...over }; }
// Build an approval descriptor that EXACTLY matches what the PR Engine constructs for open_pull_request.
function approve(g: ApprovalGate, t: { repo: string; branch: string; base: string; environment?: string }, title: string, body: string, approver = 'human_boss'): string {
  const targetId = `${t.repo}#${t.branch}->${t.base}`;
  const effect = `open PR on ${t.repo}: ${t.branch} -> ${t.base} — ${title}`;
  const d: ActionDescriptor = { tool: 'open_pull_request', target: targetId, after: { system: 'github', effect, environment: t.environment ?? null, payload: { title, body } }, risk: 'WRITE_MEDIUM_RISK', reversible: 'soft-only', requestedBy: { user_id: 'op_real', email: 'o@e', role: 'operator' } };
  const q = g.request(d);
  g.resolve({ actionId: q.actionId, approver: { user_id: approver, email: 'b@e', role: 'admin' }, decision: 'APPROVE', reason: 'reviewed' });
  return q.actionId;
}
const kinds = (rows: { kind: string }[], k: string) => rows.filter((r) => r.kind === k).length;

describe('PR Engine — drafting opens nothing (real bridge, fake external)', () => {
  it('draftPr ⇒ DRAFT-AWAITING-HUMAN-REVIEW; open_pull_request is never called', async () => {
    const before = github.opened.length;
    const out = await engine().draftPr({ target: TARGET, changeDescription: 'Add the thing' }, ctx(`prD-${Date.now()}`));
    expect(out.status).toBe('PR-DRAFT-AWAITING-HUMAN-REVIEW');
    expect(github.opened.length).toBe(before); // zero real opens
  });
});

describe('PR Engine — open with a specific-target human token opens once, blast-radius audited', () => {
  it('open_pull_request called once with the exact repo/branch/base; audit records the blast radius', async () => {
    const ORG = `prO-${Date.now()}`;
    const before = github.opened.length;
    const actionId = approve(gate, TARGET, 'Add the thing', 'Details');
    const out = await engine().openPr(openInput({ approvalActionId: actionId }), ctx(ORG));
    expect(out.status).toBe('PR-OPENED');
    expect(github.opened.length).toBe(before + 1);
    expect(github.opened[github.opened.length - 1].targetId).toBe('ECE-FACTORY/x#feature/y->main');
    const entries = await sink.readEntries(ORG);
    expect(kinds(entries, 'intent')).toBe(1);
    expect(kinds(entries, 'result')).toBe(1);
    const row = (await adminPool.query<{ request_summary: Record<string, unknown> }>(`SELECT request_summary FROM audit_intent WHERE organization_id=$1`, [ORG])).rows[0];
    expect(row.request_summary).toMatchObject({ system: 'github', target_id: 'ECE-FACTORY/x#feature/y->main', reversibility: 'soft-only' });
  });
});

describe('PR Engine — open without / wrong-target approval ⇒ refused, the external port is NEVER called (the core)', () => {
  it('no token ⇒ STOP, open_pull_request not called', async () => {
    const before = github.opened.length;
    const out = await engine().openPr(openInput(), ctx(`prN-${Date.now()}`));
    expect(out.status).toBe('STOP_FOR_APPROVAL');
    expect(github.opened.length).toBe(before);
  });
  it('a token for a DIFFERENT target ⇒ refused, open_pull_request not called', async () => {
    const before = github.opened.length;
    const actionId = approve(gate, { repo: 'ECE-FACTORY/x', branch: 'other-branch', base: 'main' }, 'Add the thing', 'Details'); // approved branch ≠ requested
    const out = await engine().openPr(openInput({ approvalActionId: actionId }), ctx(`prW-${Date.now()}`));
    expect(out.status).toBe('STOP_FOR_APPROVAL');
    expect(github.opened.length).toBe(before);
  });
});

describe('PR Engine — kill beats approval & self-approval rejected (inherited); unregistered repo refused', () => {
  it('kill-switched open_pull_request ⇒ refused even with a valid token, port not called', async () => {
    const kill = new InMemoryKillSwitch();
    kill.activate({ type: 'tool', name: 'open_pull_request' }, 'admin', 'freeze');
    const before = github.opened.length;
    const actionId = approve(gate, TARGET, 'Add the thing', 'Details');
    const out = await engine(kill).openPr(openInput({ approvalActionId: actionId }), ctx(`prK-${Date.now()}`));
    expect(out.status).toBe('refused');
    expect(github.opened.length).toBe(before);
  });
  it('self-approval (caller == approver) ⇒ STOP, port not called', async () => {
    const g = new ApprovalGate();
    const before = github.opened.length;
    const actionId = approve(g, TARGET, 'Add the thing', 'Details', 'op_real'); // approver == caller
    const out = await engine(undefined, g, 'op_real').openPr(openInput({ approvalActionId: actionId }), ctx(`prS-${Date.now()}`));
    expect(out.status).toBe('STOP_FOR_APPROVAL');
    expect(github.opened.length).toBe(before);
  });
  it('an unregistered repo ⇒ refused, port not called', async () => {
    const before = github.opened.length;
    const out = await engine().openPr(openInput({ target: { repo: 'someone-else/x', branch: 'b', base: 'main' } }), ctx(`prU-${Date.now()}`));
    expect(out.status).toBe('refused');
    expect(github.opened.length).toBe(before);
  });
});
