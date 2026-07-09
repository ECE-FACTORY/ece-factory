// UNCOMMITTED EXERCISE DRIVER — Subscription Exercise B continuation: human APPROVES the build-decision gate
// (operator=bitez), the seam assembles the ApprovedBuildDecision, then Phase A plans the scaffold WITHOUT writing.
// Deterministic re-run of prepare (actionId=act_1, multi-tenancy='full'). NO scaffold-write approval, NO Phase B.

import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { ApprovalGate } from '../../src/layer-1-law/approval-gate/approval-gate.js';
import { DecisionConsole, InMemoryConsoleAudit } from '../../src/layer-2-command/decision-console/decision-console.js';
import { scoreCandidate } from '../../src/layer-3-harvest/scoring-engine/scoring-engine.js';
import type { ScoringCandidate } from '../../src/layer-3-harvest/scoring-engine/scoring-engine.js';
import type { GradedCandidate, HarvestReport, SubDomainResult } from '../../src/layer-3-harvest/harvest-orchestrator/harvest-orchestrator.js';
import type { RepoEvaluationRecord } from '../../src/layer-3-harvest/repo-intelligence/repo-intelligence.js';
import { SubscriptionDecisionSeam } from '../../src/layer-2-command/subscription-decision-seam/subscription-decision-seam.js';
import { buildPlanFor, type ScaffoldGrant, type BuildPlannerInput } from '../../src/layer-4-build-harden/build-planner/build-planner.js';
import { BuildChainOrchestrator } from '../../src/layer-4-build-harden/build-chain-orchestrator/build-chain-orchestrator.js';
import type { ScopedCredentialRef, GovernedAuditRecorder } from '../../src/layer-5-action/governed-adapter/governed-adapter.js';

const log = (...a: unknown[]) => console.log(...a); // eslint-disable-line no-console
const CRED: ScopedCredentialRef = { ref: 'sandbox-filesystem-credential-handle', scopes: ['fs:sandbox'] };
const silentAudit = (): GovernedAuditRecorder => ({ appendIntent() {}, appendResult() {}, appendRefusal() {} });
const OPERATOR = { user_id: 'bitez', email: 'Bitez@admin.ae', role: 'admin' as const };

const MEDUSA: ScoringCandidate = {
  license: { decision: 'ACCEPT', detected: 'MIT' }, maturity: { stars: 25000, activelyMaintained: true },
  archFit: { rating: 'possible' }, maintainability: { rating: 'maintainable' },
  cloudNative: 'partial', billingHooks: 'integratable', multiTenancy: 'unknown',
};

function reconstruct(): GradedCandidate {
  const score = scoreCandidate(MEDUSA, 'subscription');
  expect(score.total).toBe(74.1); // self-check
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

describe('SUBSCRIPTION EXERCISE B — approve act_1 (bitez), assemble, Phase A plan (no write)', () => {
  it('approve ⇒ assemble ⇒ ApprovedBuildDecision (multiTenancyAssessment provenance) ⇒ Phase A; scaffold gate CLOSED', async () => {
    const spine = reconstruct();
    const gate = new ApprovalGate();
    const seat = new DecisionConsole(gate, new InMemoryConsoleAudit());
    const seam = new SubscriptionDecisionSeam({ gate, console: seat, proposingCaller: 'orchestrator-agent' });
    const prep = seam.prepare({ report: report(spine), subDomainKey: 'commerce-core', multiTenancy: { value: 'full', rationale: 'multi-store + multi-region modules provide per-tenant data boundaries; assessed as first-class tenant isolation' } });
    if (prep.status !== 'PENDING-APPROVAL') throw new Error('expected PENDING-APPROVAL');
    const actionId = prep.prepared.actionId;

    // ── THE HUMAN CLEARS GATE 1 (operator = bitez ≠ claude ≠ orchestrator-agent caller) ──
    const approve = seat.approve(actionId, OPERATOR, 'Multi-tenancy assessed FULL (multi-store/multi-region isolation); approve the subscription FORK of medusajs/medusa.');
    log(`[B] console.approve(${actionId}, operator=bitez) ⇒ ${approve.status}` + (approve.status === 'APPROVED' ? ` approvalId=${approve.approvalId} approver=${approve.approver}` : ''));
    expect(approve.status).toBe('APPROVED');

    // ── ASSEMBLE — real dispatcher mints the token; decision built INSIDE approvalWrite ──
    const asm = await seam.assemble(prep.prepared);
    expect(asm.status).toBe('APPROVED-BUILD-DECISION');
    if (asm.status !== 'APPROVED-BUILD-DECISION') return;
    const d = asm.approved;
    log(`[B] ApprovedBuildDecision:`);
    log(`      decision.decision         = ${d.decision.decision}`);
    log(`      spine                     = ${d.decision.spine!.identity.owner}/${d.decision.spine!.identity.name} @ ${d.decision.spine!.score.total}/100 (${d.decision.spine!.score.band})`);
    log(`      approvedBy                = ${d.approvedBy}`);
    log(`      approval.approvalId       = ${d.approval.approvalId}`);
    log(`      multiTenancyAssessment    = ${JSON.stringify(d.multiTenancyAssessment)}`);
    log(`      airGapAssessment          = ${JSON.stringify(d.airGapAssessment)}  (must be undefined — exactly one provenance)`);
    expect(d.decision.decision).toBe('FORK');
    expect(d.approvedBy).toBe('bitez');
    if (approve.status === 'APPROVED') expect(d.approval.approvalId).toBe(approve.approvalId);
    expect(d.multiTenancyAssessment?.gateActionId).toBe(actionId); // REAL gate action id
    expect(d.multiTenancyAssessment?.value).toBe('full');
    expect(d.multiTenancyAssessment?.measuredBy).toBe('bitez');
    expect(d.airGapAssessment).toBeUndefined();

    // ── PHASE A (plan) — deterministic BuildPlan + fail-closed scaffold gate ──
    const plan = buildPlanFor(d);
    log(`\n[B] BuildPlan (inert, deterministic):`);
    log(`      sandbox.basePath          = ${plan.sandbox.basePath}`);
    log(`      forkTarget                = ${plan.forkTarget.host}/${plan.forkTarget.owner}/${plan.forkTarget.name} (license ${plan.forkTarget.license.detected}/${plan.forkTarget.license.decision}, score ${plan.forkTarget.score.total}/${plan.forkTarget.score.band})`);
    log(`      packagingManifest         = ${JSON.stringify(plan.packagingManifest.value)}`);
    log(`      forkIntegration notes:`); for (const n of plan.forkIntegration.value) log(`        - ${n}`);
    log(`      productStructure (${plan.productStructure.value.length} entries):`);
    for (const n of plan.productStructure.value) log(`        [${n.kind}] ${plan.sandbox.basePath}/${n.path}`);

    const scaffoldGrant: ScaffoldGrant = {
      approvalActionId: 'no-such-action', gate: new ApprovalGate(), caller: 'orchestrator-agent', audit: silentAudit(),
      human: OPERATOR, organizationId: 'org_ece', environment: 'local',
    };
    const input: BuildPlannerInput = { approved: d, scaffoldGrant, credential: CRED };
    const diskBefore = existsSync(plan.sandbox.basePath);
    const out = await new BuildChainOrchestrator().planOnly(input);
    log(`\n[B] Phase A planOnly (scaffold-write gate NOT approved):`);
    log(`      scaffold.ok               = ${out.scaffold.ok}`);
    log(`      plannedWrite              = ${out.plannedWrite === null ? 'null (FAIL-CLOSED — scaffold write is a second, un-cleared human gate)' : 'present'}`);
    log(`      exists(basePath) before/after = ${diskBefore}/${existsSync(plan.sandbox.basePath)} (unchanged ⇒ Phase A wrote nothing)`);
    expect(out.scaffold.ok).toBe(false);
    expect(out.plannedWrite).toBeNull();
    expect(existsSync(plan.sandbox.basePath)).toBe(diskBefore);
  });
});
