// Build Chain Orchestrator — tests. Proves the FIRST end-to-end composition of the three proven pieces is safe:
//   • Phase A (planOnly) runs the full chain to a PlannedFilesystemWrite with NO real write (asserted on disk).
//   • Phase A fail-closes when the scaffold gate is absent (plannedWrite null; nothing on disk).
//   • Phase B (execute) WITHOUT the human confirm ⇒ REFUSES, nothing written.
//   • Phase B with an INVALID / "claude" confirm ⇒ REFUSES, nothing written.
//   • Phase B WITHOUT a valid approval (missing, or a genuine token bound to a DIFFERENT action) ⇒ REFUSES.
//   • Phase B with BOTH a genuine approval AND a valid confirm ⇒ REAL files are created in a /tmp/ece-dryrun-
//     sandbox (asserted on disk), then cleaned up.
//   • The orchestrator imports no node:fs and mints nothing (source inspection).
// A MINIMAL THROWAWAY decision drives the end-to-end test — not a real product. Every real dir is removed in afterEach.

import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, readFileSync, statSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { ApprovalGate } from '../../layer-1-law/approval-gate/approval-gate.js';
// TEST-ONLY: to obtain a GENUINE ConsumedApproval we drive the REAL gate + dispatcher. The orchestrator source
// itself does none of this — asserted by inspection below.
import { BridgeApprovalGate, ClassDispatcher, canonicalPayload, type ConsumedApproval } from '../../layer-5-action/mcp-bridge/tool-classes.js';
import {
  FilesystemAdapterDryRun,
  scaffoldPayload,
  type FilesystemScaffoldIntentDryRun,
} from '../../layer-5-action/filesystem-adapter-dryrun/filesystem-adapter-dryrun.js';
import type { ApprovalBinding, GovernedAuditRecorder, ScopedCredentialRef } from '../../layer-5-action/governed-adapter/governed-adapter.js';
import type { ExecuteContext, FilesystemExecutorAudit } from '../../layer-5-action/filesystem-executor/filesystem-executor.js';
import type { SubDomainResult, GradedCandidate } from '../../layer-3-harvest/harvest-orchestrator/harvest-orchestrator.js';
import {
  buildPlanFor,
  toScaffoldIntent,
  type ApprovedBuildDecision,
  type ScaffoldGrant,
  type BuildPlannerInput,
} from '../build-planner/build-planner.js';
import {
  BuildChainOrchestrator,
  EXECUTE_CONFIRM_TOKEN,
  type HumanExecuteConfirm,
} from './build-chain-orchestrator.js';

const CRED: ScopedCredentialRef = { ref: 'sandbox-filesystem-credential-handle', scopes: ['fs:sandbox'] };
const DOMAIN = 'Throwaway E2E Domain';

function silentAudit(): GovernedAuditRecorder {
  return { appendIntent() {}, appendResult() {}, appendRefusal() {} };
}

// ── unique-sandbox bookkeeping (cleaned up in afterEach) ────────────────────────────────────────────────
let counter = 0;
const toClean: string[] = [];
function uniqueName(): { owner: string; name: string } {
  return { owner: 'ece', name: `orch-e2e-${process.pid}-${++counter}` };
}
afterEach(() => {
  while (toClean.length) {
    const p = toClean.pop()!;
    try { rmSync(p, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});

// ── a MINIMAL THROWAWAY FORK decision (a real SubDomainResult shape, unique identity ⇒ unique jail path) ──
function throwawaySpine(owner: string, name: string): GradedCandidate {
  return {
    repoUrl: `https://github.com/${owner}/${name}`,
    identity: { host: 'github.com', owner, name },
    record: {
      evaluatedAtIso: '2026-07-08T00:00:00.000Z',
      identity: { host: 'github.com', owner, name },
      licenseDetected: 'MIT',
      licenseDecision: 'ACCEPT',
      eligibility: 'eligible',
      provenanceVerified: true,
      maturity: { stars: 100, lastCommitIso: '2026-07-01T00:00:00.000Z', contributors: 5 },
      airGapSuitability: 'yes',
      whiteLabelFit: 'moderate',
      architectureFitNotes: 'Throwaway fork target for the orchestrator end-to-end test.',
      priorVerdict: 'FORK',
      readme: null,
      description: 'A minimal throwaway repo used only to drive the build-chain orchestrator test.',
      status: 'recorded',
    },
    score: {
      subScores: [{ dimension: 'license', score: 20, max: 20, evidence: 'MIT on allowlist', flagged: false }],
      total: 78,
      rejected: false,
      band: 'acceptable',
      flags: [],
    },
    licenseOneLine: 'Permission is hereby granted, free of charge, to any person obtaining a copy...',
    licenseVerified: true,
    licenseDisagreement: false,
    rawLicenseText: 'MIT License\n\nPermission is hereby granted...',
    notes: [],
    enrichment: { applied: false, status: 'NONE', totalBefore: 78, totalAfter: 78, bandBefore: 'acceptable', bandAfter: 'acceptable', dimensions: [] },
  };
}

function throwawayDecision(owner: string, name: string): SubDomainResult {
  const spine = throwawaySpine(owner, name);
  return {
    subDomain: { key: 'throwaway-e2e', title: 'Throwaway E2E Sub-Domain', query: 'throwaway e2e orchestrator' },
    candidates: [spine],
    spine,
    decision: 'FORK',
    decisionEvidence: [`spine: ${owner}/${name} — throwaway, score 78/100`],
  };
}

// ── a GENUINE gate-minted ConsumedApproval for the BUILD DECISION (proves the seam token cannot be fabricated) ──
async function realBuildApproval(approver = 'alice', caller = 'orchestrator-agent'): Promise<ConsumedApproval> {
  const gate = new ApprovalGate();
  const binding = { tool: 'approve_build_decision', target: `${DOMAIN}/throwaway-e2e`, payloadJson: canonicalPayload({ decision: 'FORK' }) };
  const actionId = gate.request({
    tool: binding.tool, target: binding.target, after: { decision: 'FORK' },
    risk: 'high', reversible: 'no', requestedBy: { user_id: caller },
  }).actionId;
  gate.resolve({ actionId, approver: { user_id: approver, role: 'admin' }, decision: 'APPROVE', reason: 'build decision approved' });
  const dispatcher = new ClassDispatcher(new BridgeApprovalGate(gate, caller));
  let token: ConsumedApproval | undefined;
  await dispatcher.dispatch<never, never, ConsumedApproval>(
    'APPROVAL_REQUIRED_WRITE',
    { approvalWrite: async (a) => { token = a; return a; } },
    { approvalActionId: actionId, approvalBinding: binding, tool: binding.tool },
  );
  if (!token) throw new Error('failed to obtain a real build ConsumedApproval');
  return token;
}

async function approvedDecision(owner: string, name: string): Promise<ApprovedBuildDecision> {
  return {
    decision: throwawayDecision(owner, name),
    approval: await realBuildApproval(),
    approvedBy: 'alice',
    sourceReport: { domain: DOMAIN, generatedAtIso: '2026-07-08T12:00:00.000Z' },
  };
}

// The SCAFFOLD-planning intent + its exact approval binding (identical to what build-planner computes internally).
function scaffoldIntentFor(approved: ApprovedBuildDecision): { intent: FilesystemScaffoldIntentDryRun; binding: ApprovalBinding } {
  const plan = buildPlanFor(approved);
  const decisionRef = `${approved.sourceReport.domain}/${approved.decision.subDomain.key}`;
  const intent = toScaffoldIntent(plan, decisionRef);
  const binding = new FilesystemAdapterDryRun(CRED).intentBinding(intent);
  return { intent, binding };
}

// A Phase-A input whose scaffold gate is (optionally) human-approved. Returns the gate + action so Phase B can
// re-materialize the SAME approval (the executor binds the plan to the scaffold-planning approval's id).
function planInput(
  approved: ApprovedBuildDecision,
  opts: { approveScaffold: boolean },
): { input: BuildPlannerInput; scaffoldGate: ApprovalGate; scaffoldActionId: string; binding: ApprovalBinding } {
  const { intent, binding } = scaffoldIntentFor(approved);
  const gate = new ApprovalGate();
  let actionId = 'no-such-action';
  if (opts.approveScaffold) {
    actionId = gate.request({
      tool: binding.tool, target: binding.target, after: scaffoldPayload(intent),
      risk: 'high', reversible: 'no', requestedBy: { user_id: 'orchestrator-agent' },
    }).actionId;
    gate.resolve({ actionId, approver: { user_id: 'alice', role: 'admin' }, decision: 'APPROVE', reason: 'sandbox scaffold approved' });
  }
  const scaffoldGrant: ScaffoldGrant = {
    approvalActionId: actionId, gate, caller: 'orchestrator-agent', audit: silentAudit(),
    human: { user_id: 'alice', email: 'alice@example.com', role: 'admin' },
    organizationId: 'org_1', environment: 'local',
  };
  return { input: { approved, scaffoldGrant, credential: CRED }, scaffoldGate: gate, scaffoldActionId: actionId, binding };
}

// Re-materialize a GENUINE ConsumedApproval for an already-approved gate action (fresh dispatcher; single-use is
// per-BridgeApprovalGate-instance while the ApprovalGate action stays 'approved'). Yields the SAME approvalId,
// which is exactly plannedWrite.boundToApprovalId — the token Phase B must present.
async function approvalForExecute(gate: ApprovalGate, actionId: string, binding: ApprovalBinding): Promise<ConsumedApproval> {
  const dispatcher = new ClassDispatcher(new BridgeApprovalGate(gate, 'orchestrator-agent'));
  let token: ConsumedApproval | undefined;
  await dispatcher.dispatch<never, never, ConsumedApproval>(
    'APPROVAL_REQUIRED_WRITE',
    { approvalWrite: async (a) => { token = a; return a; } },
    { approvalActionId: actionId, approvalBinding: binding, tool: binding.tool },
  );
  if (!token) throw new Error('failed to re-materialize the execute approval');
  return token;
}

function execCtx(): ExecuteContext {
  const audit: FilesystemExecutorAudit = { appendIntent() {}, appendResult() {}, appendRefusal() {} };
  return { audit, human: { user_id: 'alice', email: 'alice@example.com', role: 'admin' }, organizationId: 'org_1', environment: 'local' };
}

const GOOD_CONFIRM: HumanExecuteConfirm = { token: EXECUTE_CONFIRM_TOKEN, confirmedBy: 'alice' };

describe('BuildChainOrchestrator — Phase A plans the full chain, writing NOTHING', () => {
  it('planOnly runs ApprovedBuildDecision → BuildPlan → PlannedFilesystemWrite with NO real write on disk', async () => {
    const { owner, name } = uniqueName();
    const approved = await approvedDecision(owner, name);
    const base = buildPlanFor(approved).sandbox.basePath;
    toClean.push(base);
    expect(existsSync(base)).toBe(false); // pre-condition

    const { input } = planInput(approved, { approveScaffold: true });
    const out = await new BuildChainOrchestrator().planOnly(input);

    expect(out.scaffold.ok).toBe(true);
    expect(out.plannedWrite).not.toBeNull();
    expect(out.buildPlan.kind).toBe('build-plan');
    expect(out.plannedWrite!.dryRun).toBe(true);
    expect(out.plannedWrite!.plannedOnly).toBe(true);
    expect(out.plannedWrite!.basePath).toBe(base);

    // The exact target paths are surfaced for human inspection — and correspond to the planned tree.
    expect(out.targetPaths.length).toBe(out.plannedWrite!.entries.length);
    const abs = out.targetPaths.map((t) => t.absPath);
    expect(abs).toContain(join(base, 'README.md'));
    expect(abs).toContain(join(base, 'src/index.ts'));

    // THE KEY ASSERTION: Phase A wrote NOTHING to disk.
    expect(existsSync(base)).toBe(false);
    expect(existsSync(join(base, 'README.md'))).toBe(false);
  });

  it('planOnly fail-closes when the scaffold gate is absent: plannedWrite null, no target paths, nothing on disk', async () => {
    const { owner, name } = uniqueName();
    const approved = await approvedDecision(owner, name);
    const base = buildPlanFor(approved).sandbox.basePath;
    toClean.push(base);

    const { input } = planInput(approved, { approveScaffold: false });
    const out = await new BuildChainOrchestrator().planOnly(input);

    expect(out.scaffold.ok).toBe(false);
    if (out.scaffold.ok) throw new Error('unreachable');
    expect(out.scaffold.status).toBe('STOP_FOR_APPROVAL');
    expect(out.plannedWrite).toBeNull();
    expect(out.targetPaths).toEqual([]);
    // The BuildPlan is still emitted (pure data); only the gated scaffold + any write are withheld.
    expect(out.buildPlan.kind).toBe('build-plan');
    expect(existsSync(base)).toBe(false);
  });
});

describe('BuildChainOrchestrator — Phase B is doubly gated (approval AND explicit human confirm)', () => {
  async function plannedFor(): Promise<{
    orch: BuildChainOrchestrator; plannedWrite: NonNullable<Awaited<ReturnType<BuildChainOrchestrator['planOnly']>>['plannedWrite']>;
    base: string; approval: ConsumedApproval;
  }> {
    const { owner, name } = uniqueName();
    const approved = await approvedDecision(owner, name);
    const base = buildPlanFor(approved).sandbox.basePath;
    toClean.push(base);
    const { input, scaffoldGate, scaffoldActionId, binding } = planInput(approved, { approveScaffold: true });
    const orch = new BuildChainOrchestrator();
    const out = await orch.planOnly(input);
    expect(out.plannedWrite).not.toBeNull();
    const approval = await approvalForExecute(scaffoldGate, scaffoldActionId, binding);
    // Sanity: the re-materialized approval is exactly the one the plan is bound to.
    expect(approval.approvalId).toBe(out.plannedWrite!.boundToApprovalId);
    return { orch, plannedWrite: out.plannedWrite!, base, approval };
  }

  it('execute WITHOUT the human confirm ⇒ REFUSED, nothing written', async () => {
    const { orch, plannedWrite, base, approval } = await plannedFor();
    const out = await orch.execute(plannedWrite, approval, undefined, execCtx());
    expect(out.ok).toBe(false);
    if (out.ok) throw new Error('unreachable');
    expect(out.status).toBe('refused');
    expect(out.reason).toMatch(/confirm/i);
    expect(existsSync(base)).toBe(false);
  });

  it('execute with an INVALID confirm token ⇒ REFUSED, nothing written', async () => {
    const { orch, plannedWrite, base, approval } = await plannedFor();
    const out = await orch.execute(plannedWrite, approval, { token: 'not-the-token', confirmedBy: 'alice' }, execCtx());
    expect(out.ok).toBe(false);
    expect(existsSync(base)).toBe(false);
  });

  it('execute with a confirm attributed to "claude" ⇒ REFUSED (never the AI), nothing written', async () => {
    const { orch, plannedWrite, base, approval } = await plannedFor();
    const out = await orch.execute(plannedWrite, approval, { token: EXECUTE_CONFIRM_TOKEN, confirmedBy: 'claude' }, execCtx());
    expect(out.ok).toBe(false);
    if (out.ok) throw new Error('unreachable');
    expect(out.reason).toMatch(/claude/i);
    expect(existsSync(base)).toBe(false);
  });

  it('execute WITHOUT any approval (valid confirm only) ⇒ REFUSED, nothing written', async () => {
    const { orch, plannedWrite, base } = await plannedFor();
    const out = await orch.execute(plannedWrite, undefined, GOOD_CONFIRM, execCtx());
    expect(out.ok).toBe(false);
    if (out.ok) throw new Error('unreachable');
    expect(out.reason).toMatch(/approval/i);
    expect(existsSync(base)).toBe(false);
  });

  it('execute with a genuine approval bound to a DIFFERENT action (valid confirm) ⇒ REFUSED by the executor, nothing written', async () => {
    const { orch, plannedWrite, base } = await plannedFor();
    // A genuine token, but for an unrelated approved action ⇒ approvalId ≠ plan.boundToApprovalId.
    const otherGate = new ApprovalGate();
    const otherBinding = { tool: 'approve_build_decision', target: 'unrelated/action', payloadJson: canonicalPayload({ x: 1 }) };
    const otherAction = otherGate.request({ tool: otherBinding.tool, target: otherBinding.target, after: { x: 1 }, risk: 'high', reversible: 'no', requestedBy: { user_id: 'orchestrator-agent' } }).actionId;
    otherGate.resolve({ actionId: otherAction, approver: { user_id: 'alice', role: 'admin' }, decision: 'APPROVE', reason: 'unrelated' });
    const wrongApproval = await approvalForExecute(otherGate, otherAction, otherBinding);

    const out = await orch.execute(plannedWrite, wrongApproval, GOOD_CONFIRM, execCtx());
    expect(out.ok).toBe(false);
    if (out.ok) throw new Error('unreachable');
    expect(out.status).toBe('refused');
    expect(existsSync(base)).toBe(false);
  });

  it('execute with BOTH a genuine approval AND a valid confirm ⇒ REAL files created in the jail (asserted, then cleaned up)', async () => {
    const { orch, plannedWrite, base, approval } = await plannedFor();
    expect(base.startsWith('/tmp/ece-dryrun-')).toBe(true); // jailed

    const out = await orch.execute(plannedWrite, approval, GOOD_CONFIRM, execCtx());

    expect(out.ok).toBe(true);
    if (!out.ok) throw new Error('unreachable');
    expect(out.status).toBe('written');
    // REAL files exist on disk.
    expect(existsSync(base)).toBe(true);
    expect(readFileSync(join(base, 'README.md'), 'utf8')).toContain('FORK of');
    expect(statSync(join(base, 'src')).isDirectory()).toBe(true);
    expect(existsSync(join(base, 'src/index.ts'))).toBe(true);
    expect(existsSync(join(base, 'ece.manifest.json'))).toBe(true);
  });
});

describe('BuildChainOrchestrator — imports no node:fs and mints nothing (source inspection)', () => {
  const RAW = readFileSync(join(__dirname, 'build-chain-orchestrator.ts'), 'utf8');
  // Strip comments so prose naming the very things it avoids cannot false-positive.
  const SRC = RAW.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

  it('imports NO node:fs (nor fs, nor node:fs/promises) — only the executor touches disk', () => {
    expect(/from\s*['"]node:fs(\/promises)?['"]/.test(SRC)).toBe(false);
    expect(/from\s*['"]fs(\/promises)?['"]/.test(SRC)).toBe(false);
    expect(/require\(\s*['"](node:)?fs(\/promises)?['"]\s*\)/.test(SRC)).toBe(false);
  });

  it('mints NOTHING — no token/capability mint of any kind', () => {
    expect(/\bmintConsumedApproval\b/.test(SRC)).toBe(false);
    expect(/\bmintExternalCapability\b/.test(SRC)).toBe(false);
    expect(/\bmint[A-Za-z]*\s*\(/.test(SRC)).toBe(false);
    // Never CONSTRUCTS a passing confirm — it only compares against the token, never assigns it into a `token:` field.
    expect(/token:\s*EXECUTE_CONFIRM_TOKEN/.test(SRC)).toBe(false);
  });

  it('composes the three proven modules and calls the executor as the sole write path', () => {
    expect(/from\s*['"]\.\.\/build-planner\/build-planner\.js['"]/.test(RAW)).toBe(true);
    expect(/from\s*['"]\.\.\/\.\.\/layer-5-action\/filesystem-adapter-dryrun\/filesystem-adapter-dryrun\.js['"]/.test(RAW)).toBe(true);
    expect(/from\s*['"]\.\.\/\.\.\/layer-5-action\/filesystem-executor\/filesystem-executor\.js['"]/.test(RAW)).toBe(true);
    expect(/\bexecuteFilesystemPlan\s*\(/.test(SRC)).toBe(true);
    // The sole executor call is confirm-gated: the confirm check precedes it.
    expect(SRC.indexOf('EXECUTE_CONFIRM_TOKEN')).toBeLessThan(SRC.indexOf('executeFilesystemPlan('));
    expect((SRC.match(/executeFilesystemPlan\s*\(/g) ?? []).length).toBe(1);
  });
});
