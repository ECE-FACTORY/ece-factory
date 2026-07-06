import { describe, it, expect } from 'vitest';
import { LiveGitHubIssueAdapter } from './live-github-issue-adapter.js';
import { LiveGitHubRepoAdapter } from './live-github-adapter.js';
import { buildTierStatusReport, type TierWiring } from './tier-status.js';
import { McpBridge, type BridgeCallContext, type AuditedSequencerPort } from '../layer-5-action/mcp-bridge/mcp-bridge.js';
import { registerExternalTools, registerForbiddenTools, type ExternalSystems, type ExternalTarget } from '../layer-5-action/mcp-bridge/external-tools.js';
import { TicketGateway } from '../layer-5-action/external-gateways/external-gateways.js';
import { BridgeApprovalGate } from '../layer-5-action/mcp-bridge/tool-classes.js';
import { createDefaultToolRegistry } from '../layer-5-action/tool-registry/tool-registry.js';
import { PermissionEngine } from '../layer-1-law/permission-engine/permission-engine.js';
import { RedactionEngine } from '../factory-shared/redaction-engine/redaction-engine.js';
import { ApprovalGate, type ActionDescriptor } from '../layer-1-law/approval-gate/approval-gate.js';
import type { Authorizer, SequencerRequest, SequencerOutcome, ExecuteFn, CommittedIntent, RefusalRequest } from '../factory-shared/audit-engine/sequencer.js';

// Phase 9.5 — create_ticket wired LIVE (GitHub Issues) behind the UNCHANGED gate. NO real network: a mock
// fetch is injected; assertions prove the real API is reached ONLY via TicketGateway + capability + the full
// 8.4 gauntlet, NEVER without a consumed human approval, and that the approval binds the SPECIFIC repo.

const SECRET = 'ghp_TESTONLYsecretvalue000000000000000000';
function mockFetch() {
  const calls: string[] = [];
  const impl = (async (url: string) => { calls.push(String(url)); return { ok: true, status: 201, json: async () => ({ number: 7, html_url: 'https://github.com/ECE-PLATFORMS/repoA/issues/7' }), text: async () => '' }; }) as unknown as typeof fetch;
  return { impl, calls };
}
// composite the composition root builds: create_ticket → live issue adapter; the rest → throwing fakes.
function liveExternalSystems(issues: LiveGitHubIssueAdapter): ExternalSystems {
  const nope = async (): Promise<never> => { throw new Error('fake this phase'); };
  return { createGithubRepo: nope, openPullRequest: nope, createTicket: (t, p) => issues.createTicket(t, p), updateCrmRecord: nope, sendEmail: nope, deployPackage: nope, createMilestone: nope, createLabel: nope, createIssueBatch: nope };
}
class FakeSequencer implements AuditedSequencerPort {
  refusals = 0; private seq = 0;
  constructor(private readonly authorizer: Authorizer) {}
  async recordRefusal(_r: RefusalRequest): Promise<void> { this.refusals++; }
  async run<T>(req: SequencerRequest, execute: ExecuteFn<T>): Promise<SequencerOutcome<T>> {
    const d = await this.authorizer.authorize({ human_actor: req.principal, organization_id: req.organization_id, tool: req.tool, environment: req.environment, connector: req.session.connector_id });
    if (d.decision !== 'ALLOW') return { status: 'refused', stage: 'authorize', reason: d.reason ?? d.decision };
    const seq = ++this.seq; const committed = { intent_id: `i${seq}`, organization_id: req.organization_id, seq } as unknown as CommittedIntent;
    try { const r = await execute(committed); return { status: 'completed', value: r.value, intent: committed, result: { seq, entry_hash: `h${seq}` } }; }
    catch (e) { return { status: 'execute-failed', intent: committed, result: { seq, entry_hash: `h${seq}` }, error: e }; }
  }
}
function ctx(): BridgeCallContext { return { principal: { user_id: 'admin1', email: 'a@ece.ae', role: 'admin' }, organization_id: 'orgLW', session: { session_id: 's' }, environment: 'local', via: 'claude' }; }
function repoTarget(slug: string): ExternalTarget { return { system: 'tickets', targetId: slug, effect: `create issue in ${slug}`, reversible: 'soft-only' }; }
function build(issues: LiveGitHubIssueAdapter) {
  const registry = createDefaultToolRegistry(); registerExternalTools(registry); registerForbiddenTools(registry);
  const gate = new ApprovalGate();
  const bridge = new McpBridge(registry, new FakeSequencer(new PermissionEngine(registry)), { searchClients: async () => [] }, new RedactionEngine(['created', 'repo', 'apiCalled', 'issue']), { externalSystems: liveExternalSystems(issues), approvalGate: new BridgeApprovalGate(gate, 'claude') });
  return { bridge, gate };
}
function approveTicket(gate: ApprovalGate, slug: string, payload?: Record<string, unknown>): string {
  const t = repoTarget(slug);
  const d: ActionDescriptor = { tool: 'create_ticket', target: t.targetId, after: { system: t.system, effect: t.effect, environment: null, payload: payload ?? null }, risk: 'WRITE_MEDIUM_RISK', reversible: t.reversible, requestedBy: { user_id: 'admin1', email: 'a@ece.ae', role: 'admin' } };
  const q = gate.request(d);
  gate.resolve({ actionId: q.actionId, approver: { user_id: 'boss', email: 'b@e', role: 'admin' }, decision: 'APPROVE', reason: 'ok' });
  return q.actionId;
}

describe('Phase 9.5 — live GitHub Issues reached ONLY via gateway + capability + the unchanged 8.4 gauntlet', () => {
  it('with a consumed human approval ⇒ the gateway commits and the real API is called exactly once', async () => {
    const { impl, calls } = mockFetch();
    const { bridge, gate } = build(new LiveGitHubIssueAdapter({ token: SECRET, fetchImpl: impl }));
    const gateway = new TicketGateway(bridge);
    const out = await gateway.createTicket({ target: repoTarget('ECE-PLATFORMS/repoA'), approvalActionId: approveTicket(gate, 'ECE-PLATFORMS/repoA') }, ctx());
    expect(out.status).toBe('EXTERNAL-ACTION-COMMITTED');
    expect(calls).toEqual(['https://api.github.com/repos/ECE-PLATFORMS/repoA/issues']);
  });

  it('with NO approval ⇒ STOP, the real GitHub API is NEVER called', async () => {
    const { impl, calls } = mockFetch();
    const { bridge } = build(new LiveGitHubIssueAdapter({ token: SECRET, fetchImpl: impl }));
    const out = await new TicketGateway(bridge).createTicket({ target: repoTarget('ECE-PLATFORMS/repoA') }, ctx());
    expect(out.status).toBe('STOP_FOR_APPROVAL');
    expect(calls).toHaveLength(0);
  });

  it('per-action binding includes the target repo: an approval for repo A is WITHHELD for repo B; API never called', async () => {
    const { impl, calls } = mockFetch();
    const { bridge, gate } = build(new LiveGitHubIssueAdapter({ token: SECRET, fetchImpl: impl }));
    const gateway = new TicketGateway(bridge);
    const approvalForA = approveTicket(gate, 'ECE-PLATFORMS/repoA');
    const out = await gateway.createTicket({ target: repoTarget('ECE-PLATFORMS/repoB'), approvalActionId: approvalForA }, ctx());
    expect(out.status).toBe('STOP_FOR_APPROVAL'); // bound to repoA — cannot create an issue in repoB
    expect(calls).toHaveLength(0);
  });

  it('sole-authority unchanged: the generic external path still REFUSES create_ticket (encapsulated), API never called', async () => {
    const { impl, calls } = mockFetch();
    const { bridge } = build(new LiveGitHubIssueAdapter({ token: SECRET, fetchImpl: impl }));
    const out = await bridge.externalActionWithTool('create_ticket', ctx(), { target: repoTarget('ECE-PLATFORMS/repoA') });
    expect(out.status).toBe('refused');
    if (out.status === 'refused') expect(out.stage).toBe('encapsulated');
    expect(calls).toHaveLength(0);
  });
});

describe('Phase 9.5 — tier-status reports create_ticket honestly (a fake is never live)', () => {
  const base: TierWiring = { readRole: 'ece_app', writeRole: 'ece_writer', toolCounts: { read_only: 16, draft_only: 7, internal_write: 6, external: 9, forbidden: 6 } };
  const fake = { createGithubRepo: async () => ({}) };
  it('live create_github_repo + live create_ticket + fake others ⇒ both live, aggregate partial', async () => {
    const repo = new LiveGitHubRepoAdapter({ token: SECRET, fetchImpl: mockFetch().impl });
    const issues = new LiveGitHubIssueAdapter({ token: SECRET, fetchImpl: mockFetch().impl });
    const r = await buildTierStatusReport({ ...base, externalAdapters: { create_github_repo: repo, create_ticket: issues, open_pull_request: fake, update_crm_record: fake, send_email: fake, deploy_package: fake } });
    expect(r.externalByAction.create_github_repo).toBe('live');
    expect(r.externalByAction.create_ticket).toBe('live');
    expect(r.externalByAction.open_pull_request).toBe('fake');
    expect(r.externalByAction.send_email).toBe('fake');
    expect(r.tiers.external).toBe('partial');
  });
  it('a fake in the create_ticket slot is reported fake — it cannot claim live', async () => {
    const r = await buildTierStatusReport({ ...base, externalAdapters: { create_ticket: fake } });
    expect(r.externalByAction.create_ticket).toBe('fake');
  });
});

// OPT-IN real-API test — SKIPPED by default; runs ONLY with ECE_LIVE_GITHUB_TEST=1 + ECE_GITHUB_TOKEN +
// ECE_GITHUB_TEST_REPO ("owner/repo"). Creates a disposable issue via the real API; prints it for manual
// closing (no auto-close — closing/deleting is a gated action the human performs). Default suite: no network.
const LIVE = process.env.ECE_LIVE_GITHUB_TEST === '1' && !!process.env.ECE_GITHUB_TOKEN && !!process.env.ECE_GITHUB_TEST_REPO;
describe.skipIf(!LIVE)('Phase 9.5 — OPT-IN live GitHub Issue test (real issue; human-initiated)', () => {
  it('creates a disposable issue via the real path and reports it for manual closing', async () => {
    const repo = String(process.env.ECE_GITHUB_TEST_REPO);
    const title = `ece-livewire-test-ticket-${Date.now()}`;
    const adapter = new LiveGitHubIssueAdapter({ token: String(process.env.ECE_GITHUB_TOKEN) });
    const out = await adapter.createTicket(repoTarget(repo), { title, body: 'ECE Factory live-wiring opt-in test — safe to close.' });
    expect(out).toMatchObject({ created: true, apiCalled: true });
    process.stdout.write(`\n[opt-in live test] CREATED issue ${String(out.htmlUrl)} — CLOSE IT MANUALLY when done.\n`);
  });
});
