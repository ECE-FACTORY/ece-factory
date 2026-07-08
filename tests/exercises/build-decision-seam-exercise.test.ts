// UNCOMMITTED EXERCISE DRIVER (tests/ — outside src/, trips no layer scan). Drives the REAL build-decision seam
// against spines reconstructed from docs/HARVEST_REPORT_IAM.md. The reconstruction is SELF-CHECKING: each spine's
// score is rebuilt with the REAL scoring engine and asserted to equal the report's published total (78.5 / 70.8)
// before anything runs — a mismatch fails the exercise rather than fabricating a candidate.
//
// Exercise A — react-access-engine (78.5, CLIENT-SIDE React RBAC lib): honest sovereign air-gap = 'no'. Expect REFUSED.
// Exercise B — mgourlis/stateful-abac-policy-engine (70.8, SERVER-SIDE ABAC): honest air-gap = 'yes'. Expect PENDING.

import { describe, it, expect } from 'vitest';
import { ApprovalGate } from '../../src/layer-1-law/approval-gate/approval-gate.js';
import { DecisionConsole, InMemoryConsoleAudit } from '../../src/layer-2-command/decision-console/decision-console.js';
import { scoreCandidate, foldAirGapMeasurement } from '../../src/layer-3-harvest/scoring-engine/scoring-engine.js';
import type { ScoringCandidate } from '../../src/layer-3-harvest/scoring-engine/scoring-engine.js';
import { decideSourcing } from '../../src/layer-3-harvest/harvest-orchestrator/harvest-orchestrator.js';
import type { GradedCandidate, HarvestReport, SubDomainResult } from '../../src/layer-3-harvest/harvest-orchestrator/harvest-orchestrator.js';
import type { RepoEvaluationRecord } from '../../src/layer-3-harvest/repo-intelligence/repo-intelligence.js';
import { BuildDecisionSeam, promoteToFork } from '../../src/layer-2-command/build-decision-seam/build-decision-seam.js';

// Rebuild a report spine as a GradedCandidate via the REAL engine. `expectTotal` is the report's published score.
function reconstruct(opts: { owner: string; name: string; scoring: ScoringCandidate; expectTotal: number }): GradedCandidate {
  const score = scoreCandidate(opts.scoring);
  // SELF-CHECK: the reconstruction must reproduce the harvest report exactly, or we stop.
  expect(score.total, `reconstruction of ${opts.owner}/${opts.name} must match the report`).toBe(opts.expectTotal);
  const identity = { host: 'github.com', owner: opts.owner, name: opts.name };
  const record: RepoEvaluationRecord = {
    evaluatedAtIso: '2026-07-09T00:00:00.000Z', identity,
    licenseDetected: opts.scoring.license.detected, licenseDecision: opts.scoring.license.decision,
    eligibility: 'eligible', provenanceVerified: true, maturity: opts.scoring.maturity ?? null,
    airGapSuitability: 'unknown', whiteLabelFit: 'unknown', architectureFitNotes: null,
    priorVerdict: null, readme: null, description: null, status: 'recorded',
  };
  return {
    repoUrl: `https://github.com/${identity.owner}/${identity.name}`, identity, record, score,
    licenseOneLine: 'MIT License', licenseVerified: true, licenseDisagreement: false, rawLicenseText: 'MIT License ...', notes: [],
    enrichment: { applied: false, status: 'NONE', totalBefore: score.total, totalAfter: score.total, bandBefore: score.band, bandAfter: score.band, dimensions: [] },
  };
}

function subResult(spine: GradedCandidate): SubDomainResult {
  return {
    subDomain: { key: 'authorization-policy', title: 'Authorization & Policy (RBAC/ABAC)', query: 'authorization rbac abac policy engine access control' },
    candidates: [spine], spine, decision: 'EXTEND',
    decisionEvidence: ['harvest held at EXTEND — air-gap UNMEASURED; a human must assess before any FORK'],
  };
}

function iamReport(spine: GradedCandidate): HarvestReport {
  return {
    domain: 'Identity & Access Management (IAM)', generatedAtIso: '2026-07-09T00:00:00.000Z', subDomains: [subResult(spine)],
    sovereign: {} as HarvestReport['sovereign'], reviewer: [], redTeam: [], moat: [], marketPosition: [], limitations: [],
    status: 'STOP-AWAITING-HUMAN-APPROVAL',
  };
}

// react-access-engine: license ACCEPT/MIT(20) + maturity 13 + maintainability 'maintainable'(7) + arch 'good'(11)
// over 65 measured weight ⇒ 51/65 = 78.5. air-gap + white-label UNMEASURED (as the report shows).
const REACT_ACCESS: ScoringCandidate = {
  license: { decision: 'ACCEPT', detected: 'MIT' },
  maturity: { stars: 40, activelyMaintained: true }, // stars<100 ⇒ 13/20 (forced by the report's 78.5 decomposition)
  maintainability: { rating: 'maintainable' },
  archFit: { rating: 'good' },
};

// mgourlis/stateful-abac-policy-engine: MIT(20) + maturity 13 + maintainability 'maintainable'(7) + arch 'possible'(6)
// over 65 ⇒ 46/65 = 70.8. air-gap + white-label UNMEASURED.
const MGOURLIS_ABAC: ScoringCandidate = {
  license: { decision: 'ACCEPT', detected: 'MIT' },
  maturity: { stars: 40, activelyMaintained: true },
  maintainability: { rating: 'maintainable' },
  archFit: { rating: 'possible' },
};

function show(label: string, spine: GradedCandidate, airGap: 'yes' | 'partial' | 'no') {
  const before = spine.score;
  const after = foldAirGapMeasurement(before, airGap);
  const verdict = decideSourcing([{ ...spine, record: { ...spine.record, airGapSuitability: airGap }, score: after }]);
  // eslint-disable-next-line no-console
  console.log(`\n[${label}] base ${before.total}/100 (${before.band}, ${before.measuredCount}/6 measured) ` +
    `— fold air-gap='${airGap}' ⇒ ${after.total}/100 (${after.band}, ${after.measuredCount}/6 measured) ⇒ decideSourcing = ${verdict.decision}`);
  return { after, verdict };
}

describe('EXERCISE A — air-gap gate must BITE on the client-side spine (expected REFUSED)', () => {
  it('react-access-engine (78.5, client-side) with honest air-gap="no" drops below the FORK floor and refuses', () => {
    const spine = reconstruct({ owner: 'abhishekayu', name: 'react-access-engine', scoring: REACT_ACCESS, expectTotal: 78.5 });
    const { after, verdict } = show('A react-access-engine air-gap=no', spine, 'no');
    expect(verdict.decision).not.toBe('FORK');

    const res = promoteToFork(subResult(spine), { value: 'no', rationale: 'client-side React access-control library: authorization is enforced in the browser, no server-side trust anchor to air-gap; unusable as a sovereign authorization authority' });
    // eslint-disable-next-line no-console
    console.log(`[A] promoteToFork ⇒ ${res.ok ? 'FORK (ok)' : `REFUSED (stage=${res.stage}) — ${res.reason}`}`);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.stage).toBe('promotion');
    expect(after.band).toBe('risky'); // 64.7 — below the 70 acceptable/strong FORK floor
  });

  it('sensitivity note — a "partial" rating would fold to 74.1 and PASS; recorded so the judgment is explicit', () => {
    const spine = reconstruct({ owner: 'abhishekayu', name: 'react-access-engine', scoring: REACT_ACCESS, expectTotal: 78.5 });
    const { after, verdict } = show('A react-access-engine air-gap=partial (NOT used — shown for transparency)', spine, 'partial');
    expect(after.band).toBe('acceptable');
    expect(verdict.decision).toBe('FORK'); // documents exactly where the threshold sits
  });
});

describe('EXERCISE B (prepare only) — server-side spine promotes and ENQUEUES a held gate action', () => {
  it('mgourlis/stateful-abac-policy-engine (70.8) with honest air-gap="yes" re-derives FORK and enqueues; NO approval here', () => {
    const spine = reconstruct({ owner: 'mgourlis', name: 'stateful-abac-policy-engine', scoring: MGOURLIS_ABAC, expectTotal: 70.8 });
    const { verdict } = show('B mgourlis air-gap=yes', spine, 'yes');
    expect(verdict.decision).toBe('FORK');

    const gate = new ApprovalGate();
    const seam = new BuildDecisionSeam({ gate, console: new DecisionConsole(gate, new InMemoryConsoleAudit()), proposingCaller: 'orchestrator-agent' });
    const prep = seam.prepare({
      report: iamReport(spine), subDomainKey: 'authorization-policy',
      airGap: { value: 'yes', rationale: 'server-side stateful ABAC policy engine: self-hostable in-process/service with local policy state, no external cloud trust anchor — fully air-gap deployable as the sovereign authorization authority' },
    });
    // eslint-disable-next-line no-console
    console.log(`[B] prepare ⇒ ${prep.status}` + (prep.status === 'PENDING-APPROVAL'
      ? ` actionId=${prep.prepared.actionId} binding=${JSON.stringify(prep.prepared.binding)} promotedVerdict=${prep.prepared.promoted.decision} promotedScore=${prep.prepared.promoted.spine!.score.total}`
      : ` (stage=${(prep as { stage: string }).stage})`));
    expect(prep.status).toBe('PENDING-APPROVAL');
    if (prep.status !== 'PENDING-APPROVAL') return;
    expect(prep.prepared.promoted.decision).toBe('FORK');

    // The gate action is HELD, awaiting a human. We DO NOT approve here — that is the human's step.
    expect(gate.get(prep.prepared.actionId)!.state).toBe('held');
  });
});
