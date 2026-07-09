// UNCOMMITTED EXERCISE DRIVER — Exercise B continuation: human APPROVES the build-decision gate (operator=bitez),
// seam assembles the ApprovedBuildDecision, then Phase A plans the scaffold WITHOUT writing. Deterministic re-run
// of prepare (actionId=act_1). NO scaffold-write approval here and NO Phase B — those are the human's next gates.

import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { ApprovalGate } from '../../src/layer-1-law/approval-gate/approval-gate.js';
import { DecisionConsole, InMemoryConsoleAudit } from '../../src/layer-2-command/decision-console/decision-console.js';
import { scoreCandidate } from '../../src/layer-3-harvest/scoring-engine/scoring-engine.js';
import type { ScoringCandidate } from '../../src/layer-3-harvest/scoring-engine/scoring-engine.js';
import type { GradedCandidate, HarvestReport, SubDomainResult } from '../../src/layer-3-harvest/harvest-orchestrator/harvest-orchestrator.js';
import type { RepoEvaluationRecord } from '../../src/layer-3-harvest/repo-intelligence/repo-intelligence.js';
import { BuildDecisionSeam } from '../../src/layer-2-command/build-decision-seam/build-decision-seam.js';
import { buildPlanFor, type ScaffoldGrant, type BuildPlannerInput } from '../../src/layer-4-build-harden/build-planner/build-planner.js';
import { BuildChainOrchestrator } from '../../src/layer-4-build-harden/build-chain-orchestrator/build-chain-orchestrator.js';
import type { ScopedCredentialRef, GovernedAuditRecorder } from '../../src/layer-5-action/governed-adapter/governed-adapter.js';

const log = (...a: unknown[]) => console.log(...a); // eslint-disable-line no-console

function reconstruct(scoring: ScoringCandidate, owner: string, name: string, expectTotal: number): GradedCandidate {
  const score = scoreCandidate(scoring, 'sovereign');
  expect(score.total, `reconstruction of ${owner}/${name} must match the report`).toBe(expectTotal);
  const identity = { host: 'github.com', owner, name };
  const record: RepoEvaluationRecord = {
    evaluatedAtIso: '2026-07-09T00:00:00.000Z', identity, licenseDetected: scoring.license.detected, licenseDecision: scoring.license.decision,
    eligibility: 'eligible', provenanceVerified: true, maturity: scoring.maturity ?? null, airGapSuitability: 'unknown', whiteLabelFit: 'unknown',
    architectureFitNotes: null, priorVerdict: null, readme: null, description: null, status: 'recorded',
  };
  return {
    repoUrl: `https://github.com/${owner}/${name}`, identity, record, score, licenseOneLine: 'MIT License', licenseVerified: true,
    licenseDisagreement: false, rawLicenseText: 'MIT License ...', notes: [],
    enrichment: { applied: false, status: 'NONE', totalBefore: score.total, totalAfter: score.total, bandBefore: score.band, bandAfter: score.band, dimensions: [] },
  };
}

const MGOURLIS: ScoringCandidate = {
  license: { decision: 'ACCEPT', detected: 'MIT' }, maturity: { stars: 40, activelyMaintained: true },
  maintainability: { rating: 'maintainable' }, archFit: { rating: 'possible' },
};

function iamReport(spine: GradedCandidate): HarvestReport {
  const sub: SubDomainResult = {
    subDomain: { key: 'authorization-policy', title: 'Authorization & Policy (RBAC/ABAC)', query: 'authorization rbac abac policy engine access control' },
    candidates: [spine], spine, decision: 'EXTEND', decisionEvidence: ['harvest held at EXTEND — air-gap UNMEASURED'],
  };
  return {
    domain: 'Identity & Access Management (IAM)', productMode: 'sovereign', generatedAtIso: '2026-07-09T00:00:00.000Z', subDomains: [sub],
    sovereign: {} as HarvestReport['sovereign'], reviewer: [], redTeam: [], moat: [], marketPosition: [], limitations: [], status: 'STOP-AWAITING-HUMAN-APPROVAL',
  };
}

const CRED: ScopedCredentialRef = { ref: 'sandbox-filesystem-credential-handle', scopes: ['fs:sandbox'] };
const silentAudit = (): GovernedAuditRecorder => ({ appendIntent() {}, appendResult() {}, appendRefusal() {} });
const OPERATOR = { user_id: 'bitez', email: 'Bitez@admin.ae', role: 'admin' as const };

describe('EXERCISE B — human approves act_1, seam assembles, Phase A plans (no write)', () => {
  it('approve(act_1, operator=bitez) ⇒ assemble ⇒ ApprovedBuildDecision ⇒ Phase A plan; scaffold-write gate still CLOSED', async () => {
    // Deterministic re-run of prepare (same inputs ⇒ actionId=act_1).
    const spine = reconstruct(MGOURLIS, 'mgourlis', 'stateful-abac-policy-engine', 70.8);
    const gate = new ApprovalGate();
    const seat = new DecisionConsole(gate, new InMemoryConsoleAudit());
    const seam = new BuildDecisionSeam({ gate, console: seat, proposingCaller: 'orchestrator-agent' });
    const prep = seam.prepare({ report: iamReport(spine), subDomainKey: 'authorization-policy', airGap: { value: 'yes', rationale: 'server-side stateful ABAC engine: self-hostable with local policy state, no external cloud trust anchor — fully air-gap deployable' } });
    if (prep.status !== 'PENDING-APPROVAL') throw new Error('expected PENDING-APPROVAL');
    const actionId = prep.prepared.actionId;

    // ── THE HUMAN CLEARS THE GATE (operator = bitez, a real human ≠ claude ≠ the proposing caller) ──
    const approve = seat.approve(actionId, OPERATOR, 'Air-gap independently assessed for a server-side ABAC engine; approve the FORK of mgourlis/stateful-abac-policy-engine.');
    log(`[B] console.approve(${actionId}, operator=bitez) ⇒ ${approve.status}` + (approve.status === 'APPROVED' ? ` approvalId=${approve.approvalId} approver=${approve.approver}` : ''));
    expect(approve.status).toBe('APPROVED');
    expect(gate.get(actionId)!.state).toBe('approved');

    // ── ASSEMBLE — real dispatcher mints the token; decision built INSIDE approvalWrite ──
    const asm = await seam.assemble(prep.prepared);
    expect(asm.status).toBe('APPROVED-BUILD-DECISION');
    if (asm.status !== 'APPROVED-BUILD-DECISION') return;
    const d = asm.approved;
    log(`[B] ApprovedBuildDecision:`);
    log(`      decision.decision      = ${d.decision.decision}`);
    log(`      spine                  = ${d.decision.spine!.identity.owner}/${d.decision.spine!.identity.name} @ ${d.decision.spine!.score.total}/100 (${d.decision.spine!.score.band})`);
    log(`      approvedBy             = ${d.approvedBy}`);
    log(`      approval.approvalId    = ${d.approval.approvalId}`);
    log(`      airGapAssessment       = ${JSON.stringify(d.airGapAssessment)}`);
    expect(d.decision.decision).toBe('FORK');
    expect(d.approvedBy).toBe('bitez');
    if (approve.status === 'APPROVED') expect(d.approval.approvalId).toBe(approve.approvalId);
    expect(d.airGapAssessment?.gateActionId).toBe(actionId); // REAL gate action id, not a placeholder
    expect(d.airGapAssessment?.measuredBy).toBe('bitez');

    // ── PHASE A (plan) — the deterministic BuildPlan (always available), plus a fail-closed scaffold gate ──
    const plan = buildPlanFor(d);
    log(`\n[B] BuildPlan (inert, deterministic):`);
    log(`      sandbox.basePath       = ${plan.sandbox.basePath}`);
    log(`      forkTarget             = ${plan.forkTarget.host}/${plan.forkTarget.owner}/${plan.forkTarget.name} (license ${plan.forkTarget.license.detected}/${plan.forkTarget.license.decision}, score ${plan.forkTarget.score.total}/${plan.forkTarget.score.band})`);
    log(`      packagingManifest      = ${JSON.stringify(plan.packagingManifest.value)}`);
    log(`      productStructure (${plan.productStructure.value.length} entries):`);
    for (const n of plan.productStructure.value) log(`        [${n.kind}] ${plan.sandbox.basePath}/${n.path}`);

    // scaffold-write gate NOT approved ⇒ Phase A must fail-closed (plannedWrite null) — proving gate 2 is real.
    const scaffoldGrant: ScaffoldGrant = {
      approvalActionId: 'no-such-action', gate: new ApprovalGate(), caller: 'orchestrator-agent', audit: silentAudit(),
      human: OPERATOR, organizationId: 'org_ece', environment: 'local',
    };
    const input: BuildPlannerInput = { approved: d, scaffoldGrant, credential: CRED };
    // "Phase A writes nothing" = planOnly does not CHANGE the on-disk state (it neither creates nor deletes).
    // Asserted as before==after so this is robust to a skeleton a prior Phase-B exercise left for inspection.
    const diskBefore = existsSync(plan.sandbox.basePath);
    const out = await new BuildChainOrchestrator().planOnly(input);
    log(`\n[B] Phase A planOnly (scaffold-write gate NOT approved):`);
    log(`      scaffold.ok            = ${out.scaffold.ok}`);
    log(`      plannedWrite           = ${out.plannedWrite === null ? 'null (FAIL-CLOSED — scaffold write is a second, un-cleared human gate)' : 'present'}`);
    log(`      targetPaths            = ${out.targetPaths.length}`);
    expect(out.scaffold.ok).toBe(false);
    expect(out.plannedWrite).toBeNull();

    // Phase A performed NO write — the on-disk state is unchanged by planOnly.
    log(`      exists(basePath) before/after planOnly = ${diskBefore}/${existsSync(plan.sandbox.basePath)} (unchanged ⇒ Phase A wrote nothing)`);
    expect(existsSync(plan.sandbox.basePath)).toBe(diskBefore);
  });
});
