// UNCOMMITTED EXERCISE DRIVER — Subscription Exercise B, Phase B: the human clears the SECOND gate (scaffold-write)
// and gives the explicit execute confirm; the SOLE jailed writer materializes the Medusa skeleton into the
// /tmp/ece-dryrun- sandbox. Two distinct human gates (both operator=bitez) + one confirm token. Writes to disk
// (sandbox only) and DOES NOT clean up — the human inspects + hashes afterward. Re-runnable (clears its jail path).

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { ApprovalGate } from '../../src/layer-1-law/approval-gate/approval-gate.js';
import { DecisionConsole, InMemoryConsoleAudit } from '../../src/layer-2-command/decision-console/decision-console.js';
import { scoreCandidate } from '../../src/layer-3-harvest/scoring-engine/scoring-engine.js';
import type { ScoringCandidate } from '../../src/layer-3-harvest/scoring-engine/scoring-engine.js';
import type { GradedCandidate, HarvestReport, SubDomainResult } from '../../src/layer-3-harvest/harvest-orchestrator/harvest-orchestrator.js';
import type { RepoEvaluationRecord } from '../../src/layer-3-harvest/repo-intelligence/repo-intelligence.js';
import { SubscriptionDecisionSeam } from '../../src/layer-2-command/subscription-decision-seam/subscription-decision-seam.js';
import { buildPlanFor, toScaffoldIntent, type ApprovedBuildDecision, type ScaffoldGrant, type BuildPlannerInput } from '../../src/layer-4-build-harden/build-planner/build-planner.js';
import { BuildChainOrchestrator, EXECUTE_CONFIRM_TOKEN, type HumanExecuteConfirm } from '../../src/layer-4-build-harden/build-chain-orchestrator/build-chain-orchestrator.js';
import { FilesystemAdapterDryRun, scaffoldPayload } from '../../src/layer-5-action/filesystem-adapter-dryrun/filesystem-adapter-dryrun.js';
import { BridgeApprovalGate, ClassDispatcher } from '../../src/layer-5-action/mcp-bridge/tool-classes.js';
import type { ConsumedApproval, ApprovalBinding } from '../../src/layer-5-action/mcp-bridge/tool-classes.js';
import type { ExecuteContext, FilesystemExecutorAudit } from '../../src/layer-5-action/filesystem-executor/filesystem-executor.js';
import type { ScopedCredentialRef, GovernedAuditRecorder } from '../../src/layer-5-action/governed-adapter/governed-adapter.js';

const log = (...a: unknown[]) => console.log(...a); // eslint-disable-line no-console
const CRED: ScopedCredentialRef = { ref: 'sandbox-filesystem-credential-handle', scopes: ['fs:sandbox'] };
const silentGov = (): GovernedAuditRecorder => ({ appendIntent() {}, appendResult() {}, appendRefusal() {} });
const OPERATOR = { user_id: 'bitez', email: 'Bitez@admin.ae', role: 'admin' as const };

const MEDUSA: ScoringCandidate = {
  license: { decision: 'ACCEPT', detected: 'MIT' }, maturity: { stars: 25000, activelyMaintained: true },
  archFit: { rating: 'possible' }, maintainability: { rating: 'maintainable' },
  cloudNative: 'partial', billingHooks: 'integratable', multiTenancy: 'unknown',
};

function reconstruct(): GradedCandidate {
  const score = scoreCandidate(MEDUSA, 'subscription');
  expect(score.total).toBe(74.1);
  const identity = { host: 'github.com', owner: 'medusajs', name: 'medusa' };
  const record: RepoEvaluationRecord = {
    evaluatedAtIso: '2026-07-09T00:00:00.000Z', identity, licenseDetected: 'MIT', licenseDecision: 'ACCEPT',
    eligibility: 'eligible', provenanceVerified: true, maturity: MEDUSA.maturity ?? null,
    airGapSuitability: 'unknown', whiteLabelFit: 'unknown', multiTenancy: 'unknown', cloudNative: MEDUSA.cloudNative, billingHooks: MEDUSA.billingHooks,
    architectureFitNotes: null, priorVerdict: null, readme: null, description: null, status: 'recorded',
  };
  return {
    repoUrl: 'https://github.com/medusajs/medusa', identity, record, score, licenseOneLine: 'MIT License',
    licenseVerified: true, licenseDisagreement: false, rawLicenseText: 'MIT License ...', notes: [],
    enrichment: { applied: false, status: 'NONE', totalBefore: score.total, totalAfter: score.total, bandBefore: score.band, bandAfter: score.band, dimensions: [] },
  };
}

function report(spine: GradedCandidate): HarvestReport {
  const sub: SubDomainResult = {
    subDomain: { key: 'commerce-core', title: 'Commerce Core (headless)', query: 'headless commerce backend' },
    candidates: [spine], spine, decision: 'EXTEND', decisionEvidence: ['EXTEND — multi-tenancy UNMEASURED'],
  };
  return { domain: 'Vertical SaaS Commerce', productMode: 'subscription', generatedAtIso: '2026-07-09T12:00:00.000Z', subDomains: [sub],
    sovereign: {} as HarvestReport['sovereign'], reviewer: [], redTeam: [], moat: [], marketPosition: [], limitations: [], status: 'STOP-AWAITING-HUMAN-APPROVAL' };
}

async function assembleDecision(): Promise<ApprovedBuildDecision> {
  const spine = reconstruct();
  const gate = new ApprovalGate();
  const seat = new DecisionConsole(gate, new InMemoryConsoleAudit());
  const seam = new SubscriptionDecisionSeam({ gate, console: seat, proposingCaller: 'orchestrator-agent' });
  const prep = seam.prepare({ report: report(spine), subDomainKey: 'commerce-core', multiTenancy: { value: 'full', rationale: 'multi-store/multi-region tenant isolation' } });
  if (prep.status !== 'PENDING-APPROVAL') throw new Error('prepare did not pend');
  if (seat.approve(prep.prepared.actionId, OPERATOR, 'Approve subscription FORK of medusajs/medusa (multi-tenancy full).').status !== 'APPROVED') throw new Error('gate 1 approval failed');
  const asm = await seam.assemble(prep.prepared);
  if (asm.status !== 'APPROVED-BUILD-DECISION') throw new Error('assemble failed');
  return asm.approved;
}

async function tokenFor(gate: ApprovalGate, actionId: string, binding: ApprovalBinding): Promise<ConsumedApproval> {
  const dispatcher = new ClassDispatcher(new BridgeApprovalGate(gate, 'orchestrator-agent'));
  let token: ConsumedApproval | undefined;
  await dispatcher.dispatch<never, never, ConsumedApproval>('APPROVAL_REQUIRED_WRITE',
    { approvalWrite: async (a) => { token = a; return a; } },
    { approvalActionId: actionId, approvalBinding: binding, tool: binding.tool });
  if (!token) throw new Error('failed to re-materialize execute approval');
  return token;
}

const sha256 = (p: string): string => createHash('sha256').update(readFileSync(p)).digest('hex');

describe('SUBSCRIPTION EXERCISE B — Phase B: scaffold-write gate + confirm ⇒ real Medusa sandbox skeleton', () => {
  it('materializes the ece-medusa skeleton into /tmp/ece-dryrun-* and verifies it on disk', async () => {
    const approved = await assembleDecision();
    const plan = buildPlanFor(approved);
    const base = plan.sandbox.basePath;
    log(`[B] sandbox basePath = ${base}`);
    expect(base.startsWith('/tmp/ece-dryrun-')).toBe(true);
    rmSync(base, { recursive: true, force: true }); // O_EXCL re-runnability (safe: inside the jail). No cleanup after.
    expect(existsSync(base)).toBe(false);

    // ── GATE 2 — the SCAFFOLD-WRITE approval (distinct from the build-decision gate). operator=bitez ──
    const decisionRef = `${approved.sourceReport.domain}/${approved.decision.subDomain.key}`;
    const intent = toScaffoldIntent(plan, decisionRef);
    const binding = new FilesystemAdapterDryRun(CRED).intentBinding(intent);
    const scaffoldGate = new ApprovalGate();
    const scaffoldActionId = scaffoldGate.request({
      tool: binding.tool, target: binding.target, after: scaffoldPayload(intent),
      risk: 'high', reversible: 'no', requestedBy: { user_id: 'orchestrator-agent' },
    }).actionId;
    const g2 = scaffoldGate.resolve({ actionId: scaffoldActionId, approver: OPERATOR, decision: 'APPROVE', reason: 'Approve sandbox scaffold write (14 entries) for ece-medusa into the /tmp/ece-dryrun- jail.' });
    log(`[B] scaffold-write gate: approve(${scaffoldActionId}, operator=bitez) ⇒ ok=${g2.ok} approvalId=${g2.record?.approvalId} approver=${g2.record?.approver.user_id}`);
    expect(g2.ok).toBe(true);

    const scaffoldGrant: ScaffoldGrant = {
      approvalActionId: scaffoldActionId, gate: scaffoldGate, caller: 'orchestrator-agent', audit: silentGov(),
      human: OPERATOR, organizationId: 'org_ece', environment: 'local',
    };
    const input: BuildPlannerInput = { approved, scaffoldGrant, credential: CRED };

    // ── PHASE A (gate cleared) ⇒ a real PlannedFilesystemWrite; still nothing on disk ──
    const orch = new BuildChainOrchestrator();
    const planned = await orch.planOnly(input);
    log(`[B] planOnly ⇒ scaffold.ok=${planned.scaffold.ok} plannedWrite=${planned.plannedWrite ? 'present' : 'null'} targetPaths=${planned.targetPaths.length} boundToApprovalId=${planned.plannedWrite?.boundToApprovalId}`);
    expect(planned.scaffold.ok).toBe(true);
    expect(planned.plannedWrite).not.toBeNull();
    expect(existsSync(base)).toBe(false);

    // ── PHASE B — execute with the re-materialized approval + the explicit human confirm ──
    const approvalForExec = await tokenFor(scaffoldGate, scaffoldActionId, binding);
    const confirm: HumanExecuteConfirm = { token: EXECUTE_CONFIRM_TOKEN, confirmedBy: 'bitez' };
    const audit: FilesystemExecutorAudit = { appendIntent() {}, appendResult() {}, appendRefusal() {} };
    const ctx: ExecuteContext = { audit, human: OPERATOR, organizationId: 'org_ece', environment: 'local' };
    const out = await orch.execute(planned.plannedWrite!, approvalForExec, confirm, ctx);
    log(`[B] execute ⇒ ok=${out.ok} status=${out.status} created=${out.created.length}${'reason' in out ? ` reason=${out.reason}` : ''}`);
    expect(out.ok).toBe(true);
    expect(out.status).toBe('written');

    // ── VERIFY ON DISK (independent of the executor's report) with per-file sha256 ──
    log(`\n[B] ON-DISK ece-medusa SKELETON + sha256:`);
    const walk = (dir: string): string[] => readdirSync(dir).flatMap((e) => {
      const p = join(dir, e); return statSync(p).isDirectory() ? [p + '/', ...walk(p)] : [p];
    });
    const entries = walk(base).sort();
    for (const p of entries) log(p.endsWith('/') ? `   dir   ${p}` : `   file  ${sha256(p)}  ${p}`);
    const files = entries.filter((p) => !p.endsWith('/'));
    log(`\n[B] wrote ${files.length} files + ${entries.length - files.length} dirs under ${base}`);
    expect(existsSync(join(base, 'ece.manifest.json'))).toBe(true);
    expect(existsSync(join(base, 'src', 'index.ts'))).toBe(true);
  });
});
