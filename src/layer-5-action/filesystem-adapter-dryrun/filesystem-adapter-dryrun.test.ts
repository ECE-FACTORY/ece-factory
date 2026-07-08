// Filesystem Adapter DRY-RUN — adapter-specific tests. The SHARED governance (fail-closed / audit-before-plan /
// attribution / intent-binding) is proven in governed-adapter.test.ts; here we assert the filesystem-specific
// PLAN SHAPE, that the adapter conforms to the contract via the REAL gate end-to-end, and — critically for a
// filesystem writer — that NO real fs mutation and NO node:fs import exist. NO filesystem is ever touched.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ApprovalGate } from '../../layer-1-law/approval-gate/approval-gate.js';
import { GovernedAdapter } from '../governed-adapter/governed-adapter.js';
import type { GovernedWriteContext, GovernedAuditRecorder } from '../governed-adapter/governed-adapter.js';
import {
  FilesystemAdapterDryRun,
  scaffoldPayload,
  FILESYSTEM_SCAFFOLD_TOOL,
  SANDBOX_PATH_PREFIX,
  type FilesystemScaffoldIntentDryRun,
} from './filesystem-adapter-dryrun.js';

// THROWAWAY sandbox path only — never a real ECE/product tree.
const SANDBOX_INTENT: FilesystemScaffoldIntentDryRun = {
  kind: 'filesystem-scaffold',
  approvedDecision: 'harvest-decision-legal-contract-ops',
  basePath: '/tmp/ece-dryrun-scaffold-a1b2',
  entries: [
    { path: 'src', kind: 'dir' },
    { path: 'src/index.ts', kind: 'file', contents: '// scaffold entrypoint\n' },
    { path: 'README.md', kind: 'file', contents: '# Scaffold\n' },
  ],
};
const CRED = { ref: 'sandbox-filesystem-credential-handle', scopes: ['fs:sandbox'] as const };

function silentAudit(): GovernedAuditRecorder {
  return { appendIntent() {}, appendResult() {}, appendRefusal() {} };
}

function approvedGate(intent: FilesystemScaffoldIntentDryRun = SANDBOX_INTENT) {
  const gate = new ApprovalGate();
  const b = new FilesystemAdapterDryRun(CRED).intentBinding(intent);
  const actionId = gate.request({
    tool: b.tool, target: b.target, after: scaffoldPayload(intent),
    risk: 'high', reversible: 'no', requestedBy: { user_id: 'orchestrator-agent' },
  }).actionId;
  gate.resolve({ actionId, approver: { user_id: 'alice', role: 'admin' }, decision: 'APPROVE', reason: 'sandbox scaffold approved' });
  return { gate, actionId };
}

function ctxFor(
  gate: ApprovalGate,
  approvalActionId: string,
  audit: GovernedAuditRecorder = silentAudit(),
  intent: FilesystemScaffoldIntentDryRun = SANDBOX_INTENT,
): GovernedWriteContext<FilesystemScaffoldIntentDryRun> {
  return {
    intent, approvalActionId, gate, caller: 'orchestrator-agent', audit,
    human: { user_id: 'alice', email: 'alice@example.com', role: 'admin' },
    organizationId: 'org_1', environment: 'local',
  };
}

describe('FilesystemAdapterDryRun — conforms to the contract and shapes the right filesystem plan', () => {
  it('is a GovernedAdapter (implements the contract, does not re-implement gating)', () => {
    expect(new FilesystemAdapterDryRun(CRED)).toBeInstanceOf(GovernedAdapter);
  });

  it('the binding tool is the scaffold tool and the target is the sandbox basePath', () => {
    const b = new FilesystemAdapterDryRun(CRED).intentBinding(SANDBOX_INTENT);
    expect(b.tool).toBe(FILESYSTEM_SCAFFOLD_TOOL);
    expect(b.target).toBe('/tmp/ece-dryrun-scaffold-a1b2');
    expect(b.target?.startsWith(SANDBOX_PATH_PREFIX)).toBe(true);
  });

  it('APPROVED ⇒ inert PlannedFilesystemWrite with the right tree (dir/file kinds + contents preserved)', async () => {
    const { gate, actionId } = approvedGate();
    const out = await new FilesystemAdapterDryRun(CRED).planWrite(ctxFor(gate, actionId));

    expect(out.ok).toBe(true);
    if (!out.ok) throw new Error('unreachable');
    const p = out.planned;
    expect(p.dryRun).toBe(true);
    expect(p.plannedOnly).toBe(true);
    expect(p.api).toBe('filesystem');
    expect(p.basePath).toBe('/tmp/ece-dryrun-scaffold-a1b2');
    expect(p.entries).toEqual([
      { path: 'src', kind: 'dir' },
      { path: 'src/index.ts', kind: 'file', contents: '// scaffold entrypoint\n' },
      { path: 'README.md', kind: 'file', contents: '# Scaffold\n' },
    ]);
  });

  it('APPROVED ⇒ the plan is bound to the consumed approval (id + intent fingerprint)', async () => {
    const { gate, actionId } = approvedGate();
    const out = await new FilesystemAdapterDryRun(CRED).planWrite(ctxFor(gate, actionId));
    expect(out.ok).toBe(true);
    if (!out.ok) throw new Error('unreachable');
    expect(out.planned.boundToApprovalId).toBe(out.approvalId);
    expect(out.planned.boundIntentHash).toBe(out.boundIntentHash);
  });

  it('NO approval ⇒ fail closed (STOP_FOR_APPROVAL), NO plan produced', async () => {
    const gate = new ApprovalGate(); // nothing requested/approved
    const out = await new FilesystemAdapterDryRun(CRED).planWrite(ctxFor(gate, 'no-such-action'));
    expect(out.ok).toBe(false);
    if (out.ok) throw new Error('unreachable');
    expect(out.status).toBe('STOP_FOR_APPROVAL');
    expect(out.planned).toBeNull();
  });

  it('NO approval ⇒ the refusal is audited (deny-by-default is recorded)', async () => {
    const refusals: unknown[] = [];
    const audit: GovernedAuditRecorder = {
      appendIntent() { throw new Error('must not audit an intent when there is no approval'); },
      appendResult() { throw new Error('must not audit a result when there is no approval'); },
      appendRefusal(entry) { refusals.push(entry); },
    };
    const gate = new ApprovalGate();
    const out = await new FilesystemAdapterDryRun(CRED).planWrite(ctxFor(gate, 'no-such-action', audit));
    expect(out.ok).toBe(false);
    expect(refusals).toHaveLength(1);
    expect(refusals[0]).toMatchObject({ tool: FILESYSTEM_SCAFFOLD_TOOL, stage: 'governed-adapter', decision: 'STOP_FOR_APPROVAL' });
  });

  it('APPROVED ⇒ audit-before-plan: the intent audit is appended BEFORE the result', async () => {
    const order: string[] = [];
    const audit: GovernedAuditRecorder = {
      appendIntent() { order.push('intent'); },
      appendResult() { order.push('result'); },
      appendRefusal() { order.push('refusal'); },
    };
    const { gate, actionId } = approvedGate();
    const out = await new FilesystemAdapterDryRun(CRED).planWrite(ctxFor(gate, actionId, audit));
    expect(out.ok).toBe(true);
    expect(order).toEqual(['intent', 'result']); // write-ahead audit, then the planned-only result
  });

  it('audit-before-plan is a HARD precondition: if the write-ahead audit throws, NO plan is produced', async () => {
    const audit: GovernedAuditRecorder = {
      appendIntent() { throw new Error('audit sink down'); },
      appendResult() {},
      appendRefusal() {},
    };
    const { gate, actionId } = approvedGate();
    const out = await new FilesystemAdapterDryRun(CRED).planWrite(ctxFor(gate, actionId, audit));
    expect(out.ok).toBe(false);
    if (out.ok) throw new Error('unreachable');
    expect(out.planned).toBeNull(); // a failed audit yields no plan — not a best-effort log
  });

  it('APPROVED ⇒ human attribution is recorded (the real approver, never "claude")', async () => {
    let captured: { approved_by?: string; human?: { user_id: string } } | undefined;
    const audit: GovernedAuditRecorder = {
      appendIntent(entry) { captured = { approved_by: entry.approval.approved_by, human: entry.human_actor }; },
      appendResult() {},
      appendRefusal() {},
    };
    const { gate, actionId } = approvedGate();
    const out = await new FilesystemAdapterDryRun(CRED).planWrite(ctxFor(gate, actionId, audit));
    expect(out.ok).toBe(true);
    if (!out.ok) throw new Error('unreachable');
    expect(captured?.approved_by).toBe('alice'); // attribution comes from what the REAL gate recorded
    expect(captured?.human?.user_id).toBe('alice');
    expect(out.approvedBy).toBe('alice');
  });

  it('intent-binding — an approval for sandbox path A cannot authorize a scaffold at path B', async () => {
    const intentA: FilesystemScaffoldIntentDryRun = { ...SANDBOX_INTENT, basePath: '/tmp/ece-dryrun-alpha' };
    const intentB: FilesystemScaffoldIntentDryRun = { ...SANDBOX_INTENT, basePath: '/tmp/ece-dryrun-beta' };
    const { gate, actionId } = approvedGate(intentA); // human approved path A only
    const out = await new FilesystemAdapterDryRun(CRED).planWrite(ctxFor(gate, actionId, silentAudit(), intentB));
    expect(out.ok).toBe(false); // the approval is bound to A; B is not authorized
    if (out.ok) throw new Error('unreachable');
    expect(out.status).toBe('STOP_FOR_APPROVAL');
    expect(out.planned).toBeNull();
  });
});

describe('FilesystemAdapterDryRun — NO real filesystem write exists (source inspection)', () => {
  const RAW = readFileSync(join(__dirname, 'filesystem-adapter-dryrun.ts'), 'utf8');
  // Strip comments so prose that NAMES the very calls it avoids cannot false-positive.
  const SRC = RAW.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  const REAL_FS_CALLS = [
    /\bwriteFile\s*\(/, /\bmkdir\s*\(/, /\brm\s*\(/, /\brmdir\s*\(/, /\bcp\s*\(/, /\brename\s*\(/,
    /\bappendFile\s*\(/, /\bunlink\s*\(/, /\bcreateWriteStream\s*\(/, /\bcopyFile\s*\(/,
  ];

  it('the adapter contains NO real filesystem-write call — planned data only', () => {
    for (const re of REAL_FS_CALLS) {
      expect({ pattern: String(re), hit: re.test(SRC) }).toEqual({ pattern: String(re), hit: false });
    }
  });

  it('the adapter imports NO node:fs (nor fs, nor node:fs/promises) — none at all', () => {
    expect(/from\s*['"]node:fs['"]/.test(SRC)).toBe(false);
    expect(/from\s*['"]node:fs\/promises['"]/.test(SRC)).toBe(false);
    expect(/from\s*['"]fs['"]/.test(SRC)).toBe(false);
    expect(/from\s*['"]fs\/promises['"]/.test(SRC)).toBe(false);
    expect(/require\(\s*['"](node:)?fs(\/promises)?['"]\s*\)/.test(SRC)).toBe(false);
  });

  it('the adapter mints nothing and depends on the CONTRACT, not the transport', () => {
    expect(/mintConsumedApproval/.test(SRC)).toBe(false);
    expect(/from\s*['"]\.\.\/governed-adapter\/governed-adapter\.js['"]/.test(SRC)).toBe(true);
    expect(/from\s*['"]\.\.\/mcp-bridge\//.test(SRC)).toBe(false);
  });
});
