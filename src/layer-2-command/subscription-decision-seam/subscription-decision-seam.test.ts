// Tests for the Subscription Promotion Seam (Layer 2) — the subscription-mode analog of the build-decision seam.
//
// Invariant under test (mirrors the sovereign seam): NO subscription ApprovedBuildDecision without a REAL,
// human-consumed Approval-Gate approval. We drive the REAL ApprovalGate + DecisionConsole + ClassDispatcher.

import { describe, it, expect } from 'vitest';
import { ApprovalGate } from '../../layer-1-law/approval-gate/approval-gate.js';
import { DecisionConsole, InMemoryConsoleAudit } from '../decision-console/decision-console.js';
import { scoreCandidate } from '../../layer-3-harvest/scoring-engine/scoring-engine.js';
import type { ScoringCandidate } from '../../layer-3-harvest/scoring-engine/scoring-engine.js';
import type { GradedCandidate, HarvestReport, SubDomainResult } from '../../layer-3-harvest/harvest-orchestrator/harvest-orchestrator.js';
import type { RepoEvaluationRecord, MultiTenancy } from '../../layer-3-harvest/repo-intelligence/repo-intelligence.js';
import { SubscriptionDecisionSeam, promoteToForkSubscription } from './subscription-decision-seam.js';

// ── Fixtures — a SUBSCRIPTION-scored GradedCandidate (multi-tenancy left UNMEASURED, as every real harvest is). ──
function subSpine(opts: { multiTenancy?: MultiTenancy; eligibility?: RepoEvaluationRecord['eligibility']; scoring?: Partial<ScoringCandidate> } = {}): GradedCandidate {
  const scoring: ScoringCandidate = {
    license: { decision: 'ACCEPT', detected: 'MIT' }, maturity: { stars: 2000, activelyMaintained: true },
    archFit: { rating: 'strong' }, maintainability: { rating: 'clean' },
    cloudNative: 'strong', billingHooks: 'native', multiTenancy: opts.multiTenancy ?? 'unknown',
    ...opts.scoring,
  };
  const score = scoreCandidate(scoring, 'subscription');
  const identity = { host: 'github.com', owner: 'acme', name: 'saas-engine' };
  const record: RepoEvaluationRecord = {
    evaluatedAtIso: '2026-07-09T00:00:00.000Z', identity, licenseDetected: 'MIT', licenseDecision: 'ACCEPT',
    eligibility: opts.eligibility ?? 'eligible', provenanceVerified: true, maturity: scoring.maturity ?? null,
    airGapSuitability: 'unknown', whiteLabelFit: 'unknown', multiTenancy: scoring.multiTenancy, cloudNative: scoring.cloudNative, billingHooks: scoring.billingHooks,
    architectureFitNotes: null, priorVerdict: null, readme: null, description: null, status: 'recorded',
  };
  return {
    repoUrl: `https://github.com/${identity.owner}/${identity.name}`, identity, record, score,
    licenseOneLine: 'MIT License', licenseVerified: true, licenseDisagreement: false, rawLicenseText: 'MIT License ...', notes: [],
    enrichment: { applied: false, status: 'NONE', totalBefore: score.total, totalAfter: score.total, bandBefore: score.band, bandAfter: score.band, dimensions: [] },
  };
}

function subResult(spine: GradedCandidate | null): SubDomainResult {
  return {
    subDomain: { key: 'saas-core', title: 'SaaS Core', query: 'q' },
    candidates: spine ? [spine] : [], spine, decision: 'EXTEND',
    decisionEvidence: ['harvest held at EXTEND — multi-tenancy UNMEASURED (a human must assess before any FORK)'],
  };
}

function report(sub: SubDomainResult, productMode: HarvestReport['productMode'] = 'subscription'): HarvestReport {
  return {
    domain: 'Vertical SaaS', productMode, generatedAtIso: '2026-07-09T12:00:00.000Z', subDomains: [sub],
    sovereign: {} as HarvestReport['sovereign'], reviewer: [], redTeam: [], moat: [], marketPosition: [], limitations: [],
    status: 'STOP-AWAITING-HUMAN-APPROVAL',
  };
}

function mkSeam(proposingCaller = 'orchestrator-agent') {
  const gate = new ApprovalGate();
  const console = new DecisionConsole(gate, new InMemoryConsoleAudit());
  const seam = new SubscriptionDecisionSeam({ gate, console, proposingCaller });
  return { gate, console, seam };
}

const MT_FULL = { value: 'full' as const, rationale: 'schema-per-tenant isolation with tenant-scoped queries throughout' };
const HUMAN = { user_id: 'alice', email: 'alice@example.com', role: 'admin' };

describe('promoteToForkSubscription — pure, non-mutating, verdict re-derived (not hand-stamped)', () => {
  it('promotes a subscription EXTEND spine to FORK when the human multi-tenancy measurement completes the score', () => {
    const res = promoteToForkSubscription(subResult(subSpine()), MT_FULL);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.promoted.decision).toBe('FORK');
    const ps = res.promoted.spine!;
    expect(ps.record.multiTenancy).toBe('full');
    expect(ps.score.subScores.find((s) => s.dimension === 'multi-tenancy')!.measured).toBe(true);
    expect(ps.score.subScores.some((s) => s.dimension === 'air-gap')).toBe(false); // subscription has no air-gap dim
  });

  it('BUILD-PHASE non-mutation — never mutates the input SubDomainResult (referential + deep-equality)', () => {
    const spine = subSpine();
    const input = subResult(spine);
    const snapshot = structuredClone(input);
    const res = promoteToForkSubscription(input, MT_FULL);
    expect(res.ok).toBe(true);
    expect(input).toEqual(snapshot);
    if (!res.ok) return;
    expect(res.promoted.spine).not.toBe(spine);
    expect(res.promoted.spine!.score).not.toBe(spine.score);
    for (const orig of spine.score.subScores) {
      if (orig.dimension === 'multi-tenancy') continue;
      expect(res.promoted.spine!.score.subScores.find((s) => s.dimension === orig.dimension)).toEqual(orig);
    }
  });

  it('a weak multi-tenancy ("none") that drags the score below the FORK floor is REFUSED (deny-by-default)', () => {
    // Thin subscription spine: license + maturity + arch measured only (no cloud/billing) ⇒ 3 dims, ~76.
    const thin = subSpine({ scoring: { cloudNative: 'unknown', billingHooks: 'unknown', archFit: { rating: 'possible' }, maturity: { stars: 200, activelyMaintained: true } } });
    expect(thin.score.total).toBeGreaterThanOrEqual(70);
    const res = promoteToForkSubscription(subResult(thin), { value: 'none', rationale: 'explicitly single-tenant' });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.stage).toBe('promotion');
  });

  it('refuses a spine the harvest never graded fork-eligible: no spine / not eligible', () => {
    expect(promoteToForkSubscription(subResult(null), MT_FULL)).toMatchObject({ ok: false, stage: 'precondition' });
    expect(promoteToForkSubscription(subResult(subSpine({ eligibility: 'needs-review' })), MT_FULL)).toMatchObject({ ok: false, stage: 'precondition' });
  });
});

describe('SubscriptionDecisionSeam — no ApprovedBuildDecision without a real human-consumed approval', () => {
  it('HAPPY PATH — a genuine human APPROVE yields exactly one decision with multiTenancyAssessment provenance', async () => {
    const { console, seam } = mkSeam();
    const prep = seam.prepare({ report: report(subResult(subSpine())), subDomainKey: 'saas-core', multiTenancy: MT_FULL });
    expect(prep.status).toBe('PENDING-APPROVAL');
    if (prep.status !== 'PENDING-APPROVAL') return;

    const approve = console.approve(prep.prepared.actionId, HUMAN, 'multi-tenancy independently verified; approve the fork');
    expect(approve.status).toBe('APPROVED');

    const asm = await seam.assemble(prep.prepared);
    expect(asm.status).toBe('APPROVED-BUILD-DECISION');
    if (asm.status !== 'APPROVED-BUILD-DECISION') return;
    const d = asm.approved;
    expect(d.decision.decision).toBe('FORK');
    expect(d.approvedBy).toBe('alice');
    if (approve.status === 'APPROVED') expect(d.approval.approvalId).toBe(approve.approvalId);
    expect(d.multiTenancyAssessment?.gateActionId).toBe(prep.prepared.actionId); // REAL gate action id
    expect(d.multiTenancyAssessment?.value).toBe('full');
    expect(d.multiTenancyAssessment?.measuredBy).toBe('alice');
    expect(d.airGapAssessment).toBeUndefined(); // exactly ONE provenance field — the subscription one
  });

  it('NO APPROVAL ⇒ nothing; REFUSED ⇒ nothing; self-approval ⇒ nothing; claude ⇒ nothing', async () => {
    for (const scenario of ['unresolved', 'refused', 'self', 'claude'] as const) {
      const { console, seam } = mkSeam('orchestrator-agent');
      const prep = seam.prepare({ report: report(subResult(subSpine())), subDomainKey: 'saas-core', multiTenancy: MT_FULL });
      if (prep.status !== 'PENDING-APPROVAL') throw new Error('expected pending');
      if (scenario === 'refused') console.refuse(prep.prepared.actionId, HUMAN, 'not satisfied');
      if (scenario === 'self') console.approve(prep.prepared.actionId, { user_id: 'orchestrator-agent' }, 'self');
      if (scenario === 'claude') console.approve(prep.prepared.actionId, { user_id: 'claude' }, 'ai');
      const asm = await seam.assemble(prep.prepared);
      expect(asm.status, scenario).toBe('refused');
    }
  });

  it('GUARD — refuses a SOVEREIGN report (symmetric mode fail-closed), before any gate action', () => {
    const { gate, seam } = mkSeam();
    const prep = seam.prepare({ report: report(subResult(subSpine()), 'sovereign'), subDomainKey: 'saas-core', multiTenancy: MT_FULL });
    expect(prep).toMatchObject({ status: 'refused', stage: 'mode' });
    expect(gate.get('act_1')).toBeUndefined(); // nothing enqueued
  });

  it('CROSS-MODE BINDING — a sovereign-tool approval cannot assemble a subscription decision', async () => {
    const { console, seam } = mkSeam();
    const prep = seam.prepare({ report: report(subResult(subSpine())), subDomainKey: 'saas-core', multiTenancy: MT_FULL });
    if (prep.status !== 'PENDING-APPROVAL') throw new Error('expected pending');
    console.approve(prep.prepared.actionId, HUMAN, 'approve');
    // Tamper: swap the binding tool to the sovereign tool name — consume must fail on tool mismatch.
    const tampered = { ...prep.prepared, binding: { ...prep.prepared.binding, tool: 'approve_build_decision' } };
    expect((await seam.assemble(tampered)).status).toBe('refused');
  });
});
