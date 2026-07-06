import { describe, it, expect } from 'vitest';
import { LiveGitHubMilestoneAdapter } from './live-github-milestone-adapter.js';
import { LiveGitHubLabelAdapter } from './live-github-label-adapter.js';
import { LiveGitHubIssueBatchAdapter } from './live-github-issue-batch-adapter.js';
import { buildTierStatusReport, type TierWiring } from './tier-status.js';
import { McpBridge, type BridgeCallContext, type AuditedSequencerPort } from '../layer-5-action/mcp-bridge/mcp-bridge.js';
import { registerExternalTools, registerForbiddenTools, MAX_ISSUE_BATCH, type ExternalSystems, type ExternalTarget } from '../layer-5-action/mcp-bridge/external-tools.js';
import { MilestoneGateway, LabelGateway, IssueBatchGateway } from '../layer-5-action/external-gateways/external-gateways.js';
import { BridgeApprovalGate } from '../layer-5-action/mcp-bridge/tool-classes.js';
import { createDefaultToolRegistry } from '../layer-5-action/tool-registry/tool-registry.js';
import { PermissionEngine } from '../layer-1-law/permission-engine/permission-engine.js';
import { RedactionEngine } from '../factory-shared/redaction-engine/redaction-engine.js';
import { ApprovalGate, type ActionDescriptor } from '../layer-1-law/approval-gate/approval-gate.js';
import type { Authorizer, SequencerRequest, SequencerOutcome, ExecuteFn, CommittedIntent, RefusalRequest } from '../factory-shared/audit-engine/sequencer.js';

// Factory capability — create_milestone / create_label (single-item, exactly like create_ticket) and
// create_issue_batch (GATED BULK: ONE content-bound, size-capped approval) wired LIVE behind the UNCHANGED gate.
// NO real network: a mock fetch is injected; assertions prove the real API is reached ONLY via the owning
// gateway + capability + the full 8.4 gauntlet, NEVER without a consumed human approval, that the approval binds
// the SPECIFIC repo (milestone/label) and the EXACT enumerated content (batch), and that the batch is size-capped.

const SECRET = 'ghp_TESTONLYsecretvalue000000000000000000';
function mockFetch(makeBody?: (url: string, n: number) => Record<string, unknown>) {
  const calls: string[] = [];
  const impl = (async (url: string) => {
    const n = calls.push(String(url));
    return { ok: true, status: 201, json: async () => (makeBody ? makeBody(String(url), n) : { number: n, name: 'x', html_url: `https://github.com/x/${n}`, url: `https://api.github.com/x/${n}` }), text: async () => '' };
  }) as unknown as typeof fetch;
  return { impl, calls };
}
function failingFetch(failIndex: number) {
  const calls: string[] = [];
  const impl = (async (url: string) => {
    const n = calls.push(String(url));
    if (n - 1 === failIndex) return { ok: false, status: 422, json: async () => ({}), text: async () => '{"message":"Validation Failed"}' };
    return { ok: true, status: 201, json: async () => ({ number: n, html_url: `https://github.com/x/${n}` }), text: async () => '' };
  }) as unknown as typeof fetch;
  return { impl, calls };
}

function liveSystems(over: Partial<ExternalSystems>): ExternalSystems {
  const nope = async (): Promise<never> => { throw new Error('fake this phase'); };
  return { createGithubRepo: nope, openPullRequest: nope, createTicket: nope, updateCrmRecord: nope, sendEmail: nope, deployPackage: nope, createMilestone: nope, createLabel: nope, createIssueBatch: nope, ...over };
}

class FakeSequencer implements AuditedSequencerPort {
  private seq = 0;
  constructor(private readonly authorizer: Authorizer) {}
  async recordRefusal(_r: RefusalRequest): Promise<void> {}
  async run<T>(req: SequencerRequest, execute: ExecuteFn<T>): Promise<SequencerOutcome<T>> {
    const d = await this.authorizer.authorize({ human_actor: req.principal, organization_id: req.organization_id, tool: req.tool, environment: req.environment, connector: req.session.connector_id });
    if (d.decision !== 'ALLOW') return { status: 'refused', stage: 'authorize', reason: d.reason ?? d.decision };
    const seq = ++this.seq; const committed = { intent_id: `i${seq}`, organization_id: req.organization_id, seq } as unknown as CommittedIntent;
    try { const r = await execute(committed); return { status: 'completed', value: r.value, intent: committed, result: { seq, entry_hash: `h${seq}` } }; }
    catch (e) { return { status: 'execute-failed', intent: committed, result: { seq, entry_hash: `h${seq}` }, error: e }; }
  }
}
function ctx(): BridgeCallContext { return { principal: { user_id: 'admin1', email: 'a@ece.ae', role: 'admin' }, organization_id: 'orgLW', session: { session_id: 's' }, environment: 'local', via: 'claude' }; }
function build(systems: ExternalSystems) {
  const registry = createDefaultToolRegistry(); registerExternalTools(registry); registerForbiddenTools(registry);
  const gate = new ApprovalGate();
  const bridge = new McpBridge(registry, new FakeSequencer(new PermissionEngine(registry)), { searchClients: async () => [] }, new RedactionEngine(['created', 'apiCalled', 'repo', 'milestone', 'label', 'requested', 'createdCount', 'failed', 'failedCount', 'partial', 'index', 'title', 'error']), { externalSystems: systems, approvalGate: new BridgeApprovalGate(gate, 'claude') });
  return { bridge, gate };
}
/** Mint a specific-target human approval whose descriptor binds tool + repo + the EXACT payload. */
function approve(gate: ApprovalGate, tool: string, target: ExternalTarget, payload?: Record<string, unknown>): string {
  const d: ActionDescriptor = { tool, target: target.targetId, after: { system: target.system, effect: target.effect, environment: target.environment ?? null, payload: payload ?? null }, risk: 'WRITE_MEDIUM_RISK', reversible: target.reversible, requestedBy: { user_id: 'admin1', email: 'a@ece.ae', role: 'admin' } };
  const q = gate.request(d);
  gate.resolve({ actionId: q.actionId, approver: { user_id: 'boss', email: 'b@e', role: 'admin' }, decision: 'APPROVE', reason: 'ok' });
  return q.actionId;
}

// ── create_milestone (single-item) ───────────────────────────────────────────────────────────────────────
const MS = (slug: string): ExternalTarget => ({ system: 'github', targetId: slug, effect: `create milestone in ${slug}`, reversible: 'soft-only' });
describe('create_milestone — live GitHub Milestones reached ONLY via MilestoneGateway + capability + 8.4 gauntlet', () => {
  it('with a consumed human approval ⇒ commits and calls the real milestones API exactly once', async () => {
    const { impl, calls } = mockFetch();
    const { bridge, gate } = build(liveSystems({ createMilestone: (t, p) => new LiveGitHubMilestoneAdapter({ token: SECRET, fetchImpl: impl }).createMilestone(t, p) }));
    const t = MS('ECE-FACTORY/repoA');
    const out = await new MilestoneGateway(bridge).createMilestone({ target: t, approvalActionId: approve(gate, 'create_milestone', t) }, ctx());
    expect(out.status).toBe('EXTERNAL-ACTION-COMMITTED');
    expect(calls).toEqual(['https://api.github.com/repos/ECE-FACTORY/repoA/milestones']);
  });
  it('with NO approval ⇒ STOP; the real API is NEVER called', async () => {
    const { impl, calls } = mockFetch();
    const { bridge } = build(liveSystems({ createMilestone: (t, p) => new LiveGitHubMilestoneAdapter({ token: SECRET, fetchImpl: impl }).createMilestone(t, p) }));
    const out = await new MilestoneGateway(bridge).createMilestone({ target: MS('ECE-FACTORY/repoA') }, ctx());
    expect(out.status).toBe('STOP_FOR_APPROVAL');
    expect(calls).toHaveLength(0);
  });
  it('per-action binding: an approval for repoA is WITHHELD for repoB; API never called', async () => {
    const { impl, calls } = mockFetch();
    const { bridge, gate } = build(liveSystems({ createMilestone: (t, p) => new LiveGitHubMilestoneAdapter({ token: SECRET, fetchImpl: impl }).createMilestone(t, p) }));
    const idA = approve(gate, 'create_milestone', MS('ECE-FACTORY/repoA'));
    const out = await new MilestoneGateway(bridge).createMilestone({ target: MS('ECE-FACTORY/repoB'), approvalActionId: idA }, ctx());
    expect(out.status).toBe('STOP_FOR_APPROVAL');
    expect(calls).toHaveLength(0);
  });
  it('sole-authority unchanged: the generic external path REFUSES create_milestone (encapsulated); API never called', async () => {
    const { impl, calls } = mockFetch();
    const { bridge } = build(liveSystems({ createMilestone: (t, p) => new LiveGitHubMilestoneAdapter({ token: SECRET, fetchImpl: impl }).createMilestone(t, p) }));
    const out = await bridge.externalActionWithTool('create_milestone', ctx(), { target: MS('ECE-FACTORY/repoA') });
    expect(out.status).toBe('refused');
    if (out.status === 'refused') expect(out.stage).toBe('encapsulated');
    expect(calls).toHaveLength(0);
  });
});

// ── create_label (single-item) ───────────────────────────────────────────────────────────────────────────
const LB = (slug: string): ExternalTarget => ({ system: 'github', targetId: slug, effect: `create label in ${slug}`, reversible: 'soft-only' });
describe('create_label — live GitHub Labels reached ONLY via LabelGateway + capability + 8.4 gauntlet', () => {
  it('with a consumed human approval ⇒ commits and calls the real labels API exactly once', async () => {
    const { impl, calls } = mockFetch();
    const { bridge, gate } = build(liveSystems({ createLabel: (t, p) => new LiveGitHubLabelAdapter({ token: SECRET, fetchImpl: impl }).createLabel(t, p) }));
    const t = LB('ECE-FACTORY/repoA');
    const out = await new LabelGateway(bridge).createLabel({ target: t, payload: { name: 'bug', color: 'ff0000' }, approvalActionId: approve(gate, 'create_label', t, { name: 'bug', color: 'ff0000' }) }, ctx());
    expect(out.status).toBe('EXTERNAL-ACTION-COMMITTED');
    expect(calls).toEqual(['https://api.github.com/repos/ECE-FACTORY/repoA/labels']);
  });
  it('with NO approval ⇒ STOP; the real API is NEVER called', async () => {
    const { impl, calls } = mockFetch();
    const { bridge } = build(liveSystems({ createLabel: (t, p) => new LiveGitHubLabelAdapter({ token: SECRET, fetchImpl: impl }).createLabel(t, p) }));
    const out = await new LabelGateway(bridge).createLabel({ target: LB('ECE-FACTORY/repoA') }, ctx());
    expect(out.status).toBe('STOP_FOR_APPROVAL');
    expect(calls).toHaveLength(0);
  });
  it('sole-authority unchanged: the generic external path REFUSES create_label (encapsulated); API never called', async () => {
    const { impl, calls } = mockFetch();
    const { bridge } = build(liveSystems({ createLabel: (t, p) => new LiveGitHubLabelAdapter({ token: SECRET, fetchImpl: impl }).createLabel(t, p) }));
    const out = await bridge.externalActionWithTool('create_label', ctx(), { target: LB('ECE-FACTORY/repoA') });
    expect(out.status).toBe('refused');
    if (out.status === 'refused') expect(out.stage).toBe('encapsulated');
    expect(calls).toHaveLength(0);
  });
});

// ── create_issue_batch (GATED BULK — content-bound + size-capped) ─────────────────────────────────────────
const BT = (slug: string): ExternalTarget => ({ system: 'github', targetId: slug, effect: `create issue batch in ${slug}`, reversible: 'soft-only' });
const BATCH_A = { issues: [{ title: 'A1' }, { title: 'A2' }, { title: 'A3' }] };
const BATCH_B = { issues: [{ title: 'B1' }, { title: 'B2' }] };
function batchBridge() {
  const { impl, calls } = mockFetch();
  const { bridge, gate } = build(liveSystems({ createIssueBatch: (t, p) => new LiveGitHubIssueBatchAdapter({ token: SECRET, fetchImpl: impl }).createIssueBatch(t, p) }));
  return { bridge, gate, calls };
}
describe('create_issue_batch — ONE content-bound, size-capped approval; per-item POST only after approval', () => {
  it('with a consumed approval bound to the EXACT list ⇒ commits; the real issues API is called once PER enumerated issue', async () => {
    const { bridge, gate, calls } = batchBridge();
    const t = BT('ECE-FACTORY/repoA');
    const out = await new IssueBatchGateway(bridge).createIssueBatch({ target: t, payload: BATCH_A, approvalActionId: approve(gate, 'create_issue_batch', t, BATCH_A) }, ctx());
    expect(out.status).toBe('EXTERNAL-ACTION-COMMITTED');
    expect(calls).toEqual(Array(3).fill('https://api.github.com/repos/ECE-FACTORY/repoA/issues')); // one POST per issue, no more
  });
  it('with NO approval ⇒ STOP; NOT ONE issue is created', async () => {
    const { bridge, calls } = batchBridge();
    const out = await new IssueBatchGateway(bridge).createIssueBatch({ target: BT('ECE-FACTORY/repoA'), payload: BATCH_A }, ctx());
    expect(out.status).toBe('STOP_FOR_APPROVAL');
    expect(calls).toHaveLength(0);
  });
  it('content-binding: an approval for batch A CANNOT execute batch B (different enumerated content); API never called', async () => {
    const { bridge, gate, calls } = batchBridge();
    const t = BT('ECE-FACTORY/repoA');
    const idA = approve(gate, 'create_issue_batch', t, BATCH_A);
    const out = await new IssueBatchGateway(bridge).createIssueBatch({ target: t, payload: BATCH_B, approvalActionId: idA }, ctx());
    expect(out.status).toBe('STOP_FOR_APPROVAL'); // bound to A's content — B is a different action
    expect(calls).toHaveLength(0);
  });
  it('altering the batch AFTER approval (append one issue) invalidates it; API never called', async () => {
    const { bridge, gate, calls } = batchBridge();
    const t = BT('ECE-FACTORY/repoA');
    const idA = approve(gate, 'create_issue_batch', t, BATCH_A);
    const altered = { issues: [...BATCH_A.issues, { title: 'A4-sneaked-in' }] };
    const out = await new IssueBatchGateway(bridge).createIssueBatch({ target: t, payload: altered, approvalActionId: idA }, ctx());
    expect(out.status).toBe('STOP_FOR_APPROVAL');
    expect(calls).toHaveLength(0);
  });
  it(`the hard cap is enforced at the gateway BEFORE the gate: a batch of ${MAX_ISSUE_BATCH + 1} is refused; nothing is enqueued or called`, async () => {
    const { bridge, gate, calls } = batchBridge();
    const t = BT('ECE-FACTORY/repoA');
    const tooBig = { issues: Array.from({ length: MAX_ISSUE_BATCH + 1 }, (_v, i) => ({ title: `X${i}` })) };
    // even WITH an approval for the oversized content, the gateway refuses it before the gauntlet runs.
    const out = await new IssueBatchGateway(bridge).createIssueBatch({ target: t, payload: tooBig, approvalActionId: approve(gate, 'create_issue_batch', t, tooBig) }, ctx());
    expect(out.status).toBe('refused');
    if (out.status === 'refused') expect(out.reason).toMatch(/hard cap/i);
    expect(calls).toHaveLength(0);
  });
  it('an empty / non-enumerated batch is refused; API never called', async () => {
    const { bridge, calls } = batchBridge();
    const out = await new IssueBatchGateway(bridge).createIssueBatch({ target: BT('ECE-FACTORY/repoA'), payload: { issues: [] } }, ctx());
    expect(out.status).toBe('refused');
    if (out.status === 'refused') expect(out.reason).toMatch(/enumerate/i);
    expect(calls).toHaveLength(0);
  });
  it('sole-authority unchanged: the generic external path REFUSES create_issue_batch (encapsulated); API never called', async () => {
    const { bridge, calls } = batchBridge();
    const out = await bridge.externalActionWithTool('create_issue_batch', ctx(), { target: BT('ECE-FACTORY/repoA'), payload: BATCH_A });
    expect(out.status).toBe('refused');
    if (out.status === 'refused') expect(out.stage).toBe('encapsulated');
    expect(calls).toHaveLength(0);
  });
  it('partial failure is reported CLEARLY: item #2 fails ⇒ the other two are created and the failure is surfaced', async () => {
    const { impl, calls } = failingFetch(1); // second POST (index 1) fails
    const { bridge, gate } = build(liveSystems({ createIssueBatch: (t, p) => new LiveGitHubIssueBatchAdapter({ token: SECRET, fetchImpl: impl }).createIssueBatch(t, p) }));
    const t = BT('ECE-FACTORY/repoA');
    const out = await new IssueBatchGateway(bridge).createIssueBatch({ target: t, payload: BATCH_A, approvalActionId: approve(gate, 'create_issue_batch', t, BATCH_A) }, ctx());
    expect(out.status).toBe('EXTERNAL-ACTION-COMMITTED');
    expect(calls).toHaveLength(3); // all three attempted, in order
    if (out.status === 'EXTERNAL-ACTION-COMMITTED') {
      const c = out.committed as { createdCount: number; failedCount: number; partial: boolean; failed: Array<{ index: number }> };
      expect(c).toMatchObject({ createdCount: 2, failedCount: 1, partial: true });
      expect(c.failed[0].index).toBe(1);
    }
  });
});

// ── the live adapters LOUD-FAIL on an unset token (never a silent fake fallback) ──────────────────────────
describe('live adapters — an unset ECE_GITHUB_TOKEN is a LOUD constructor failure, never a silent fake', () => {
  it('each adapter throws (naming the env var, NOT any value) when the token is empty', () => {
    for (const make of [() => new LiveGitHubMilestoneAdapter({ token: '' }), () => new LiveGitHubLabelAdapter({ token: '  ' }), () => new LiveGitHubIssueBatchAdapter({ token: '' })]) {
      expect(make).toThrow(/ECE_GITHUB_TOKEN is not set/);
    }
  });
});

// ── tier-status reports the three new actions HONESTLY (a fake is never live) ─────────────────────────────
describe('tier-status — create_milestone / create_label / create_issue_batch reported per-action from the real instance', () => {
  const base: TierWiring = { readRole: 'ece_app', writeRole: 'ece_writer', toolCounts: { read_only: 16, draft_only: 7, internal_write: 6, external: 9, forbidden: 6 } };
  const fake = { createGithubRepo: async () => ({}) };
  it('live milestone/label/batch + fake others ⇒ those three live, others fake, aggregate partial', async () => {
    const r = await buildTierStatusReport({ ...base, externalAdapters: {
      create_milestone: new LiveGitHubMilestoneAdapter({ token: SECRET, fetchImpl: mockFetch().impl }),
      create_label: new LiveGitHubLabelAdapter({ token: SECRET, fetchImpl: mockFetch().impl }),
      create_issue_batch: new LiveGitHubIssueBatchAdapter({ token: SECRET, fetchImpl: mockFetch().impl }),
      create_github_repo: fake, create_ticket: fake, open_pull_request: fake, update_crm_record: fake, send_email: fake, deploy_package: fake,
    } });
    expect(r.externalByAction.create_milestone).toBe('live');
    expect(r.externalByAction.create_label).toBe('live');
    expect(r.externalByAction.create_issue_batch).toBe('live');
    expect(r.externalByAction.send_email).toBe('fake');
    expect(r.tiers.external).toBe('partial');
  });
  it('a fake in the create_issue_batch slot is reported fake — it cannot claim live', async () => {
    const r = await buildTierStatusReport({ ...base, externalAdapters: { create_issue_batch: fake } });
    expect(r.externalByAction.create_issue_batch).toBe('fake');
  });
});
