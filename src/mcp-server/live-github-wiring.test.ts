import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LiveGitHubRepoAdapter } from './live-github-adapter.js';
import { buildTierStatusReport, type TierWiring } from './tier-status.js';
import { McpBridge, type BridgeCallContext, type AuditedSequencerPort } from '../layer-5-action/mcp-bridge/mcp-bridge.js';
import { registerExternalTools, registerForbiddenTools, type ExternalSystems, type ExternalTarget } from '../layer-5-action/mcp-bridge/external-tools.js';
import { RepoCreationGateway } from '../layer-5-action/external-gateways/external-gateways.js';
import { BridgeApprovalGate } from '../layer-5-action/mcp-bridge/tool-classes.js';
import { createDefaultToolRegistry } from '../layer-5-action/tool-registry/tool-registry.js';
import { PermissionEngine } from '../layer-1-law/permission-engine/permission-engine.js';
import { RedactionEngine } from '../factory-shared/redaction-engine/redaction-engine.js';
import { ApprovalGate, type ActionDescriptor } from '../layer-1-law/approval-gate/approval-gate.js';
import type { Authorizer, SequencerRequest, SequencerOutcome, ExecuteFn, CommittedIntent, RefusalRequest } from '../factory-shared/audit-engine/sequencer.js';

// Phase 9.4 — create_github_repo wired LIVE behind the UNCHANGED gate. NO real network: a mock fetch is
// injected into the live adapter; assertions prove the real API is reached ONLY through the gateway +
// capability + the full 8.4 gauntlet, and NEVER without a consumed human approval.

const SECRET = 'ghp_TESTONLYsecretvalue000000000000000000';
function mockFetch() {
  const calls: string[] = [];
  const impl = (async (url: string) => { calls.push(String(url)); return { ok: true, status: 201, json: async () => ({ full_name: 'ECE-FACTORY/livewire', id: 7, html_url: 'https://github.com/ECE-FACTORY/livewire', private: true }), text: async () => '' }; }) as unknown as typeof fetch;
  return { impl, calls };
}
// the composite the composition root builds: create_github_repo → live adapter; the other five → throwing fake.
function liveExternalSystems(github: LiveGitHubRepoAdapter): ExternalSystems {
  const nope = async (): Promise<never> => { throw new Error('fake this phase'); };
  return { createGithubRepo: (t, p) => github.createGithubRepo(t, p), openPullRequest: nope, createTicket: nope, updateCrmRecord: nope, sendEmail: nope, deployPackage: nope, createMilestone: nope, createLabel: nope, createIssueBatch: nope };
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
const T: ExternalTarget = { system: 'github', targetId: 'ECE-FACTORY/livewire', effect: 'create repo ECE-FACTORY/livewire private', reversible: 'soft-only' };
function build(github: LiveGitHubRepoAdapter) {
  const registry = createDefaultToolRegistry(); registerExternalTools(registry); registerForbiddenTools(registry);
  const gate = new ApprovalGate();
  const bridge = new McpBridge(registry, new FakeSequencer(new PermissionEngine(registry)), { searchClients: async () => [] }, new RedactionEngine(['created', 'repo', 'apiCalled', 'id']), { externalSystems: liveExternalSystems(github), approvalGate: new BridgeApprovalGate(gate, 'claude') });
  return { bridge, gate };
}
function approve(gate: ApprovalGate): string {
  const d: ActionDescriptor = { tool: 'create_github_repo', target: T.targetId, after: { system: T.system, effect: T.effect, environment: null, payload: null }, risk: 'WRITE_MEDIUM_RISK', reversible: T.reversible, requestedBy: { user_id: 'admin1', email: 'a@ece.ae', role: 'admin' } };
  const q = gate.request(d);
  gate.resolve({ actionId: q.actionId, approver: { user_id: 'boss', email: 'b@e', role: 'admin' }, decision: 'APPROVE', reason: 'ok' });
  return q.actionId;
}

describe('Phase 9.4 — the live GitHub API is reached ONLY through gateway + capability + the unchanged 8.4 gauntlet', () => {
  it('with a consumed human approval ⇒ the gateway commits and the real API is called exactly once', async () => {
    const { impl, calls } = mockFetch();
    const { bridge, gate } = build(new LiveGitHubRepoAdapter({ token: SECRET, fetchImpl: impl }));
    const gateway = new RepoCreationGateway(bridge);
    const out = await gateway.createRepo({ target: T, approvalActionId: approve(gate) }, ctx());
    expect(out.status).toBe('EXTERNAL-ACTION-COMMITTED');
    expect(calls).toEqual(['https://api.github.com/orgs/ECE-FACTORY/repos']); // the real API, once
  });

  it('with NO approval ⇒ STOP, the real GitHub API is NEVER called', async () => {
    const { impl, calls } = mockFetch();
    const { bridge } = build(new LiveGitHubRepoAdapter({ token: SECRET, fetchImpl: impl }));
    const gateway = new RepoCreationGateway(bridge);
    const out = await gateway.createRepo({ target: T }, ctx());
    expect(out.status).toBe('STOP_FOR_APPROVAL');
    expect(calls).toHaveLength(0); // the live wiring did NOT touch GitHub without a token
  });

  it('sole-authority unchanged: the generic external path still REFUSES create_github_repo (encapsulated), API never called', async () => {
    const { impl, calls } = mockFetch();
    const { bridge } = build(new LiveGitHubRepoAdapter({ token: SECRET, fetchImpl: impl }));
    const out = await bridge.externalActionWithTool('create_github_repo', ctx(), { target: T });
    expect(out.status).toBe('refused');
    if (out.status === 'refused') expect(out.stage).toBe('encapsulated');
    expect(calls).toHaveLength(0);
  });
});

describe('Phase 9.4 — tier-status reports the external tier HONESTLY per-action (a fake is never live)', () => {
  const base: TierWiring = { readRole: 'ece_app', writeRole: 'ece_writer', toolCounts: { read_only: 16, draft_only: 7, internal_write: 6, external: 9, forbidden: 6 } };
  const fake = { createGithubRepo: async () => ({}) };
  it('live create_github_repo + fake others ⇒ create_github_repo: live, others: fake, aggregate: partial', async () => {
    const github = new LiveGitHubRepoAdapter({ token: SECRET, fetchImpl: mockFetch().impl });
    const r = await buildTierStatusReport({ ...base, externalAdapters: { create_github_repo: github, open_pull_request: fake, create_ticket: fake, update_crm_record: fake, send_email: fake, deploy_package: fake } });
    expect(r.externalByAction.create_github_repo).toBe('live');
    expect(r.externalByAction.send_email).toBe('fake');
    expect(r.tiers.external).toBe('partial');
  });
  it('all-fake external ⇒ every action fake, aggregate fake (unchanged 9.2 behavior)', async () => {
    const r = await buildTierStatusReport({ ...base, externalSystems: fake });
    expect(r.tiers.external).toBe('fake');
    expect(Object.values(r.externalByAction).every((v) => v === 'fake')).toBe(true);
  });
  it('a fake in the create_github_repo slot is reported fake — it cannot claim live', async () => {
    const r = await buildTierStatusReport({ ...base, externalAdapters: { create_github_repo: fake } });
    expect(r.externalByAction.create_github_repo).toBe('fake'); // derived from instanceof, not a label
  });
});

describe('Phase 9.4 — credential safety: no GitHub token literal in committed PRODUCTION files; .env gitignored', () => {
  it('no production (non-test) file contains a GitHub token pattern', () => {
    const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
    const tokenPat = /gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}/;
    const offenders: string[] = [];
    const scan = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        if (name === 'node_modules' || name === '.git') continue;
        const p = path.join(dir, name);
        if (statSync(p).isDirectory()) { scan(p); continue; }
        if (!/\.(ts|mjs|js|json|sql|sh|md)$/.test(p)) continue;
        if (p.endsWith('.test.ts')) continue; // test fixtures legitimately hold CLEARLY-FAKE placeholders
        if (tokenPat.test(readFileSync(p, 'utf8'))) offenders.push(path.relative(repoRoot, p));
      }
    };
    scan(path.join(repoRoot, 'src'));
    for (const d of ['infra', 'scripts']) { const dp = path.join(repoRoot, d); if (statSync(dp).isDirectory()) scan(dp); }
    expect(offenders).toEqual([]); // env-only — the token never lands in a committed production file
  });
  it('.env and .env.* are gitignored', () => {
    const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
    const gi = readFileSync(path.join(repoRoot, '.gitignore'), 'utf8');
    expect(gi).toMatch(/^\.env$/m);
    expect(gi).toMatch(/^\.env\.\*$/m);
  });
});
