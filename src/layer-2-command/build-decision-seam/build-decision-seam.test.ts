// Tests for the Build-Decision Seam (Layer 2) — the deciding→building seam.
//
// The invariant under test: NO ApprovedBuildDecision comes into existence without a REAL, human-consumed
// Approval-Gate approval. We drive the REAL ApprovalGate + DecisionConsole + ClassDispatcher (no fakes on the
// token path) so a green run proves the seam cannot self-approve, and that the two build-phase requirements
// hold: (1) promoteToFork never mutates its input; (2) airGapAssessment.gateActionId is the real gate action id.

import { describe, it, expect } from 'vitest';
import { ApprovalGate } from '../../layer-1-law/approval-gate/approval-gate.js';
import { DecisionConsole, InMemoryConsoleAudit } from '../decision-console/decision-console.js';
import { scoreCandidate } from '../../layer-3-harvest/scoring-engine/scoring-engine.js';
import type { ScoringCandidate } from '../../layer-3-harvest/scoring-engine/scoring-engine.js';
import type { GradedCandidate, HarvestReport, SubDomainResult } from '../../layer-3-harvest/harvest-orchestrator/harvest-orchestrator.js';
import type { RepoEvaluationRecord } from '../../layer-3-harvest/repo-intelligence/repo-intelligence.js';
import { BuildDecisionSeam, promoteToFork } from './build-decision-seam.js';

// ── Fixtures — a GradedCandidate whose score comes from the REAL scoring engine (air-gap left UNMEASURED). ──
function gradedSpine(opts: { scoring: ScoringCandidate; eligibility?: RepoEvaluationRecord['eligibility'] }): GradedCandidate {
  const score = scoreCandidate(opts.scoring, 'sovereign');
  const identity = { host: 'github.com', owner: 'acme', name: 'engine' };
  const record: RepoEvaluationRecord = {
    evaluatedAtIso: '2026-07-07T00:00:00.000Z', identity,
    licenseDetected: opts.scoring.license.detected, licenseDecision: opts.scoring.license.decision,
    eligibility: opts.eligibility ?? 'eligible', provenanceVerified: true, maturity: opts.scoring.maturity ?? null,
    airGapSuitability: opts.scoring.airGap ?? 'unknown', whiteLabelFit: opts.scoring.whiteLabel ?? 'unknown',
    architectureFitNotes: null, priorVerdict: null, readme: null, description: null, status: 'recorded',
  };
  return {
    repoUrl: `https://github.com/${identity.owner}/${identity.name}`, identity, record, score,
    licenseOneLine: `${opts.scoring.license.detected} License`, licenseVerified: true, licenseDisagreement: false,
    rawLicenseText: 'MIT License ...', notes: [],
    enrichment: { applied: false, status: 'NONE', totalBefore: score.total, totalAfter: score.total, bandBefore: score.band, bandAfter: score.band, dimensions: [] },
  };
}

// A strong, eligible, permissive spine — air-gap UNMEASURED (as every real harvested spine is). 4 dims measured.
function strongScoring(): ScoringCandidate {
  return {
    license: { decision: 'ACCEPT', detected: 'MIT' },
    maturity: { stars: 1500, activelyMaintained: true },
    archFit: { rating: 'strong' },
    maintainability: { rating: 'clean' },
    // airGap + whiteLabel left undefined ⇒ UNMEASURED.
  };
}

function subResult(spine: GradedCandidate | null, decision: SubDomainResult['decision'] = 'EXTEND'): SubDomainResult {
  return {
    subDomain: { key: 'document-assembly', title: 'Document Assembly & Generation', query: 'q' },
    candidates: spine ? [spine] : [],
    spine,
    decision,
    decisionEvidence: ['harvest held at EXTEND — air-gap UNMEASURED (a human must assess before any FORK)'],
  };
}

function report(sub: SubDomainResult): HarvestReport {
  return {
    domain: 'Legal & Contract Ops', productMode: 'sovereign', generatedAtIso: '2026-07-07T12:00:00.000Z', subDomains: [sub],
    sovereign: {} as HarvestReport['sovereign'], reviewer: [], redTeam: [], moat: [], marketPosition: [], limitations: [],
    status: 'STOP-AWAITING-HUMAN-APPROVAL',
  };
}

function mkSeam(proposingCaller = 'orchestrator-agent') {
  const gate = new ApprovalGate();
  const console = new DecisionConsole(gate, new InMemoryConsoleAudit());
  const seam = new BuildDecisionSeam({ gate, console, proposingCaller });
  return { gate, console, seam };
}

const AIRGAP_YES = { value: 'yes' as const, rationale: 'fully self-hosted; no cloud services in the dependency tree' };
const HUMAN = { user_id: 'alice', email: 'alice@example.com', role: 'admin' };

// ── promoteToFork: purity, non-mutation, and the verdict comes from decideSourcing ────────────────────────
describe('promoteToFork — pure, non-mutating, verdict re-derived (not hand-stamped)', () => {
  it('promotes an EXTEND spine to FORK when the human air-gap measurement completes a fork-eligible score', () => {
    const spine = gradedSpine({ scoring: strongScoring() });
    const res = promoteToFork(subResult(spine), AIRGAP_YES);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.promoted.decision).toBe('FORK');
    // air-gap is now measured on the promoted spine; other dims unchanged.
    const promotedSpine = res.promoted.spine!;
    expect(promotedSpine.record.airGapSuitability).toBe('yes');
    expect(promotedSpine.score.subScores.find((s) => s.dimension === 'air-gap')!.measured).toBe(true);
  });

  it('BUILD-PHASE REQ 1 — never mutates the input SubDomainResult (referential + deep-equality)', () => {
    const spine = gradedSpine({ scoring: strongScoring() });
    const input = subResult(spine);
    const snapshot = structuredClone(input);
    const res = promoteToFork(input, AIRGAP_YES);
    expect(res.ok).toBe(true);
    // The original object graph is byte-for-byte unchanged.
    expect(input).toEqual(snapshot);
    // And the promotion is a FRESH graph — not the same objects.
    if (!res.ok) return;
    expect(res.promoted).not.toBe(input);
    expect(res.promoted.spine).not.toBe(spine);
    expect(res.promoted.spine!.score).not.toBe(spine.score);
    // Every NON-air-gap sub-score is carried byte-for-byte (no re-grade).
    for (const orig of spine.score.subScores) {
      if (orig.dimension === 'air-gap') continue;
      expect(res.promoted.spine!.score.subScores.find((s) => s.dimension === orig.dimension)).toEqual(orig);
    }
  });

  it('a bad air-gap measurement ("no") that drags the score below the FORK floor is REFUSED (deny-by-default)', () => {
    // license 20/20 + maturity 16/20 + arch-fit "possible" 6/15 ⇒ 3 measured dims, total ≈ 76 (≥70).
    const spine = gradedSpine({ scoring: {
      license: { decision: 'ACCEPT', detected: 'MIT' }, maturity: { stars: 200, activelyMaintained: true }, archFit: { rating: 'possible' },
    } });
    expect(spine.score.total).toBeGreaterThanOrEqual(70);
    expect(spine.score.measuredCount).toBe(3);
    const res = promoteToFork(subResult(spine), { value: 'no', rationale: 'requires an external cloud KMS' });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.stage).toBe('promotion');
  });

  it('refuses a spine the harvest never graded fork-eligible: no spine / not eligible / low score / thin measure', () => {
    expect(promoteToFork(subResult(null, 'BUILD'), AIRGAP_YES)).toMatchObject({ ok: false, stage: 'precondition' });
    const ineligible = gradedSpine({ scoring: strongScoring(), eligibility: 'needs-review' });
    expect(promoteToFork(subResult(ineligible), AIRGAP_YES)).toMatchObject({ ok: false, stage: 'precondition' });
    // Only license + maturity measured ⇒ measuredCount 2 (< 3).
    const thin = gradedSpine({ scoring: { license: { decision: 'ACCEPT', detected: 'MIT' }, maturity: { stars: 1500, activelyMaintained: true } } });
    expect(thin.score.measuredCount).toBe(2);
    expect(promoteToFork(subResult(thin), AIRGAP_YES)).toMatchObject({ ok: false, stage: 'precondition' });
  });
});

// ── The seam end-to-end against the REAL gate/console/dispatcher ──────────────────────────────────────────
describe('BuildDecisionSeam — no ApprovedBuildDecision without a real human-consumed approval', () => {
  it('HAPPY PATH — a genuine human APPROVE yields exactly one decision, tied to the real approval + approver', async () => {
    const { console, seam } = mkSeam();
    const prep = seam.prepare({ report: report(subResult(gradedSpine({ scoring: strongScoring() }))), subDomainKey: 'document-assembly', airGap: AIRGAP_YES });
    expect(prep.status).toBe('PENDING-APPROVAL');
    if (prep.status !== 'PENDING-APPROVAL') return;

    const approve = console.approve(prep.prepared.actionId, HUMAN, 'air-gap independently verified; approve the fork');
    expect(approve.status).toBe('APPROVED');

    const asm = await seam.assemble(prep.prepared);
    expect(asm.status).toBe('APPROVED-BUILD-DECISION');
    if (asm.status !== 'APPROVED-BUILD-DECISION') return;
    const d = asm.approved;
    expect(d.decision.decision).toBe('FORK');
    expect(d.approvedBy).toBe('alice');
    expect(d.approvedBy).not.toBe('claude');
    if (approve.status === 'APPROVED') expect(d.approval.approvalId).toBe(approve.approvalId);
    // BUILD-PHASE REQ 2 — gateActionId is the REAL approved gate action id, not a placeholder.
    expect(d.airGapAssessment?.gateActionId).toBe(prep.prepared.actionId);
    expect(d.airGapAssessment?.value).toBe('yes');
    expect(d.airGapAssessment?.measuredBy).toBe('alice');
  });

  it('NO APPROVAL ⇒ nothing: assembling an unresolved (still-held) action returns refused, no decision', async () => {
    const { seam } = mkSeam();
    const prep = seam.prepare({ report: report(subResult(gradedSpine({ scoring: strongScoring() }))), subDomainKey: 'document-assembly', airGap: AIRGAP_YES });
    if (prep.status !== 'PENDING-APPROVAL') throw new Error('expected pending');
    // Human never approves.
    const asm = await seam.assemble(prep.prepared);
    expect(asm.status).toBe('refused');
  });

  it('REFUSED at the seat ⇒ nothing', async () => {
    const { console, seam } = mkSeam();
    const prep = seam.prepare({ report: report(subResult(gradedSpine({ scoring: strongScoring() }))), subDomainKey: 'document-assembly', airGap: AIRGAP_YES });
    if (prep.status !== 'PENDING-APPROVAL') throw new Error('expected pending');
    expect(console.refuse(prep.prepared.actionId, HUMAN, 'not satisfied with air-gap evidence').status).toBe('REFUSED');
    expect((await seam.assemble(prep.prepared)).status).toBe('refused');
  });

  it('SELF-APPROVAL blocked — the proposing caller cannot approve its own action', async () => {
    const { console, seam } = mkSeam('orchestrator-agent');
    const prep = seam.prepare({ report: report(subResult(gradedSpine({ scoring: strongScoring() }))), subDomainKey: 'document-assembly', airGap: AIRGAP_YES });
    if (prep.status !== 'PENDING-APPROVAL') throw new Error('expected pending');
    // operator == proposingCaller ⇒ the console rejects; the gate is never approved.
    expect(console.approve(prep.prepared.actionId, { user_id: 'orchestrator-agent' }, 'self approve').status).toBe('rejected');
    expect((await seam.assemble(prep.prepared)).status).toBe('refused');
  });

  it("'claude' can never approve", async () => {
    const { console, seam } = mkSeam();
    const prep = seam.prepare({ report: report(subResult(gradedSpine({ scoring: strongScoring() }))), subDomainKey: 'document-assembly', airGap: AIRGAP_YES });
    if (prep.status !== 'PENDING-APPROVAL') throw new Error('expected pending');
    expect(console.approve(prep.prepared.actionId, { user_id: 'claude' }, 'ai approve').status).toBe('rejected');
    expect((await seam.assemble(prep.prepared)).status).toBe('refused');
  });

  it('GUARD — an under-assessed spine is refused BEFORE any gate action is enqueued', () => {
    const { gate, seam } = mkSeam();
    const thin = gradedSpine({ scoring: { license: { decision: 'ACCEPT', detected: 'MIT' }, maturity: { stars: 1500, activelyMaintained: true } } });
    const prep = seam.prepare({ report: report(subResult(thin)), subDomainKey: 'document-assembly', airGap: AIRGAP_YES });
    expect(prep.status).toBe('refused');
    // Nothing was enqueued — no held action exists to approve.
    expect(gate.get('act_1')).toBeUndefined();
  });

  it('lookup miss ⇒ refused (unknown sub-domain key)', () => {
    const { seam } = mkSeam();
    const prep = seam.prepare({ report: report(subResult(gradedSpine({ scoring: strongScoring() }))), subDomainKey: 'no-such-key', airGap: AIRGAP_YES });
    expect(prep).toMatchObject({ status: 'refused', stage: 'lookup' });
  });

  it('an approval bound to a DIFFERENT action cannot assemble this one (per-action binding)', async () => {
    const { console, seam } = mkSeam();
    const prep = seam.prepare({ report: report(subResult(gradedSpine({ scoring: strongScoring() }))), subDomainKey: 'document-assembly', airGap: AIRGAP_YES });
    if (prep.status !== 'PENDING-APPROVAL') throw new Error('expected pending');
    // Approve a DIFFERENT, unrelated action; the seam's action stays held.
    console.approve(prep.prepared.actionId, HUMAN, 'approve');
    // Tamper: assemble with a binding whose payload no longer matches the approved action.
    const tampered = { ...prep.prepared, binding: { ...prep.prepared.binding, payloadJson: '{"decision":"FORK","tampered":true}' } };
    expect((await seam.assemble(tampered)).status).toBe('refused');
  });
});
