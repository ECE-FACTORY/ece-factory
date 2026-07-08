// GitHub Adapter DRY-RUN — adapter-specific tests. The SHARED governance (fail-closed / audit-before-plan /
// attribution / intent-binding) is proven in governed-adapter.test.ts; here we assert only the GitHub-specific
// PLAN SHAPE and that the adapter conforms to the contract via the REAL gate end-to-end. NO network exists.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ApprovalGate } from '../../layer-1-law/approval-gate/approval-gate.js';
import { GovernedAdapter } from '../governed-adapter/governed-adapter.js';
import type { GovernedWriteContext, GovernedAuditRecorder } from '../governed-adapter/governed-adapter.js';
import {
  GithubAdapterDryRun,
  forkPayload,
  GITHUB_FORK_TOOL,
  type GithubForkIntentDryRun,
} from './github-adapter-dryrun.js';

// THROWAWAY sandbox target only — never a real ECE/product repo.
const SANDBOX_INTENT: GithubForkIntentDryRun = {
  kind: 'github-fork',
  sourceOwner: 'sandbox-source-owner',
  sourceRepo: 'throwaway-dryrun-repo',
  targetNamespace: 'ece-dryrun-sandbox',
  targetRepo: 'throwaway-dryrun-repo',
};
const CRED = { ref: 'sandbox-github-credential-handle', scopes: ['public_repo'] as const };

function silentAudit(): GovernedAuditRecorder {
  return { appendIntent() {}, appendResult() {}, appendRefusal() {} };
}

function approvedGate(intent: GithubForkIntentDryRun = SANDBOX_INTENT) {
  const gate = new ApprovalGate();
  const b = new GithubAdapterDryRun(CRED).intentBinding(intent);
  const actionId = gate.request({
    tool: b.tool, target: b.target, after: forkPayload(intent),
    risk: 'high', reversible: 'no', requestedBy: { user_id: 'orchestrator-agent' },
  }).actionId;
  gate.resolve({ actionId, approver: { user_id: 'alice', role: 'admin' }, decision: 'APPROVE', reason: 'sandbox fork approved' });
  return { gate, actionId };
}

function ctxFor(gate: ApprovalGate, approvalActionId: string): GovernedWriteContext<GithubForkIntentDryRun> {
  return {
    intent: SANDBOX_INTENT, approvalActionId, gate, caller: 'orchestrator-agent', audit: silentAudit(),
    human: { user_id: 'alice', email: 'alice@example.com', role: 'admin' },
    organizationId: 'org_1', environment: 'local',
  };
}

describe('GithubAdapterDryRun — conforms to the contract and shapes the right GitHub plan', () => {
  it('is a GovernedAdapter (implements the contract, does not re-implement gating)', () => {
    expect(new GithubAdapterDryRun(CRED)).toBeInstanceOf(GovernedAdapter);
  });

  it('APPROVED ⇒ inert POST /forks descriptor with the right shape, plus an inert read-only preflight GET', async () => {
    const { gate, actionId } = approvedGate();
    const out = await new GithubAdapterDryRun(CRED).planWrite(ctxFor(gate, actionId));

    expect(out.ok).toBe(true);
    if (!out.ok) throw new Error('unreachable');
    const p = out.planned;
    expect(p.dryRun).toBe(true);
    expect(p.plannedOnly).toBe(true);
    expect(p.api).toBe('github');
    expect(p.method).toBe('POST');
    expect(p.endpoint).toBe('/repos/sandbox-source-owner/throwaway-dryrun-repo/forks');
    expect(p.payload).toEqual({ organization: 'ece-dryrun-sandbox', name: 'throwaway-dryrun-repo' });
    // Inert read-only existence verify the executor would run FIRST (a GET descriptor — never fetched).
    expect(p.preflight).toEqual({
      method: 'GET',
      endpoint: '/repos/ece-dryrun-sandbox/throwaway-dryrun-repo',
      purpose: 'existence check — would confirm the target does not already exist before the fork',
    });
    expect(p.boundToApprovalId).toBe(out.approvalId);
    expect(p.boundIntentHash).toBe(out.boundIntentHash);
  });

  it('targetRepo defaults to the source repo name when omitted', async () => {
    const intent: GithubForkIntentDryRun = { kind: 'github-fork', sourceOwner: 'o', sourceRepo: 'r', targetNamespace: 'ns' };
    const gate = new ApprovalGate();
    const b = new GithubAdapterDryRun(CRED).intentBinding(intent);
    const actionId = gate.request({ tool: b.tool, target: b.target, after: forkPayload(intent), risk: 'high', reversible: 'no', requestedBy: { user_id: 'orchestrator-agent' } }).actionId;
    gate.resolve({ actionId, approver: { user_id: 'alice' }, decision: 'APPROVE', reason: 'ok' });
    const out = await new GithubAdapterDryRun(CRED).planWrite({
      intent, approvalActionId: actionId, gate, caller: 'orchestrator-agent', audit: silentAudit(),
      human: { user_id: 'alice' }, organizationId: 'org_1', environment: 'local',
    });
    expect(out.ok).toBe(true);
    if (!out.ok) throw new Error('unreachable');
    expect(out.planned.payload).toEqual({ organization: 'ns' }); // no name when targetRepo omitted
    expect(out.planned.preflight.endpoint).toBe('/repos/ns/r'); // preflight falls back to source repo name
  });

  it('the binding tool is the fork tool and target is source owner/repo', () => {
    const b = new GithubAdapterDryRun(CRED).intentBinding(SANDBOX_INTENT);
    expect(b.tool).toBe(GITHUB_FORK_TOOL);
    expect(b.target).toBe('sandbox-source-owner/throwaway-dryrun-repo');
  });
});

describe('GithubAdapterDryRun — NO real GitHub write exists (source inspection)', () => {
  const RAW = readFileSync(join(__dirname, 'github-adapter-dryrun.ts'), 'utf8');
  const SRC = RAW.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  const REAL_WRITE_CALLS = [
    /\bfetch\s*\(/, /\baxios\b/, /XMLHttpRequest/, /from\s+['"]node:https?['"]/, /from\s+['"]https?['"]/,
    /\.request\s*\(/, /octokit/i, /createGithubRepo\s*\(/, /openPullRequest\s*\(/, /\.createFork\s*\(/,
  ];
  it('the adapter contains NO real-write call — planned descriptors only', () => {
    for (const re of REAL_WRITE_CALLS) {
      expect({ pattern: String(re), hit: re.test(SRC) }).toEqual({ pattern: String(re), hit: false });
    }
  });
  it('the adapter mints nothing and depends on the CONTRACT, not the transport', () => {
    expect(/mintConsumedApproval/.test(SRC)).toBe(false);
    // It imports from the governed-adapter contract, not directly from the mcp-bridge transport.
    expect(/from\s*['"]\.\.\/governed-adapter\/governed-adapter\.js['"]/.test(SRC)).toBe(true);
    expect(/from\s*['"]\.\.\/mcp-bridge\//.test(SRC)).toBe(false);
  });
});
