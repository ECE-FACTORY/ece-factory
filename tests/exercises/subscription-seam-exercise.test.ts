// UNCOMMITTED EXERCISE DRIVER (tests/ — outside src/, trips no layer scan). Drives the REAL subscription
// promotion seam (834a7b6) against a RECONSTRUCTED subscription spine shaped like medusajs/medusa (MIT, headless
// commerce: cloud-native + Stripe/PayPal billing, multi-tenancy genuinely ambiguous). SELF-CHECKING: the spine's
// subscription score is rebuilt with the REAL engine and asserted to equal the stated decomposition (74.1)
// before anything runs — a mismatch STOPS the exercise rather than fabricating.
//
// Exercise A — prove the MULTI-TENANCY gate BITES: honest LOW ('none') ⇒ folds below the FORK floor ⇒ refused.
// Exercise B (prepare) — honest 'full' ⇒ re-derives FORK ⇒ enqueues a held gate action (NO approval here).

import { describe, it, expect } from 'vitest';
import { ApprovalGate } from '../../src/layer-1-law/approval-gate/approval-gate.js';
import { DecisionConsole, InMemoryConsoleAudit } from '../../src/layer-2-command/decision-console/decision-console.js';
import { scoreCandidate, foldMultiTenancyMeasurement } from '../../src/layer-3-harvest/scoring-engine/scoring-engine.js';
import type { ScoringCandidate } from '../../src/layer-3-harvest/scoring-engine/scoring-engine.js';
import { decideSourcing } from '../../src/layer-3-harvest/harvest-orchestrator/harvest-orchestrator.js';
import type { GradedCandidate, HarvestReport, SubDomainResult } from '../../src/layer-3-harvest/harvest-orchestrator/harvest-orchestrator.js';
import type { RepoEvaluationRecord, MultiTenancy } from '../../src/layer-3-harvest/repo-intelligence/repo-intelligence.js';
import { SubscriptionDecisionSeam, promoteToForkSubscription } from '../../src/layer-2-command/subscription-decision-seam/subscription-decision-seam.js';

const log = (...a: unknown[]) => console.log(...a); // eslint-disable-line no-console

// medusajs/medusa — RECONSTRUCTED subscription ratings (see driver header + report). air-gap NOT a subscription dim.
const MEDUSA: ScoringCandidate = {
  license: { decision: 'ACCEPT', detected: 'MIT' },
  maturity: { stars: 25000, activelyMaintained: true }, // ⇒ 18/20
  archFit: { rating: 'possible' },                       // ⇒ 6/15  (large complex commerce framework)
  maintainability: { rating: 'maintainable' },           // ⇒ 7/10
  cloudNative: 'partial',                                // ⇒ 6/10  (Dockerfile/compose; no confirmed orchestration)
  billingHooks: 'integratable',                          // ⇒ 6/10  (Stripe/PayPal payment module)
  multiTenancy: 'unknown',                               // ⇒ UNMEASURED — the human dimension
};

function reconstruct(): GradedCandidate {
  const score = scoreCandidate(MEDUSA, 'subscription');
  // SELF-CHECK: the reconstruction must reproduce the stated decomposition, or we STOP.
  expect(score.total, 'medusa subscription base must reconstruct to 74.1').toBe(74.1);
  expect(score.measuredCount).toBe(6);
  expect(score.subScores.find((s) => s.dimension === 'multi-tenancy')!.measured).toBe(false);
  expect(score.subScores.some((s) => s.dimension === 'air-gap')).toBe(false); // subscription profile: no air-gap dim
  const identity = { host: 'github.com', owner: 'medusajs', name: 'medusa' };
  const record: RepoEvaluationRecord = {
    evaluatedAtIso: '2026-07-09T00:00:00.000Z', identity, licenseDetected: 'MIT', licenseDecision: 'ACCEPT',
    eligibility: 'eligible', provenanceVerified: true, maturity: MEDUSA.maturity ?? null,
    airGapSuitability: 'unknown', whiteLabelFit: 'unknown',
    multiTenancy: 'unknown', cloudNative: MEDUSA.cloudNative, billingHooks: MEDUSA.billingHooks,
    architectureFitNotes: null, priorVerdict: null, readme: null, description: null, status: 'recorded',
  };
  return {
    repoUrl: 'https://github.com/medusajs/medusa', identity, record, score,
    licenseOneLine: 'MIT License', licenseVerified: true, licenseDisagreement: false, rawLicenseText: 'MIT License ...', notes: [],
    enrichment: { applied: false, status: 'NONE', totalBefore: score.total, totalAfter: score.total, bandBefore: score.band, bandAfter: score.band, dimensions: [] },
  };
}

function subResult(spine: GradedCandidate): SubDomainResult {
  return {
    subDomain: { key: 'commerce-core', title: 'Commerce Core (headless)', query: 'headless commerce backend' },
    candidates: [spine], spine, decision: 'EXTEND',
    decisionEvidence: ['harvest held at EXTEND — multi-tenancy UNMEASURED; a human must assess tenant isolation before any FORK'],
  };
}

function report(spine: GradedCandidate): HarvestReport {
  return {
    domain: 'Vertical SaaS Commerce', productMode: 'subscription', generatedAtIso: '2026-07-09T12:00:00.000Z',
    subDomains: [subResult(spine)], sovereign: {} as HarvestReport['sovereign'],
    reviewer: [], redTeam: [], moat: [], marketPosition: [], limitations: [], status: 'STOP-AWAITING-HUMAN-APPROVAL',
  };
}

function show(spine: GradedCandidate, mt: Exclude<MultiTenancy, 'unknown'>) {
  const before = spine.score;
  const after = foldMultiTenancyMeasurement(before, mt);
  const verdict = decideSourcing([{ ...spine, record: { ...spine.record, multiTenancy: mt }, score: after }], 'subscription');
  log(`   fold multi-tenancy='${mt}' ⇒ ${after.total}/100 (${after.band}, ${after.measuredCount}/7 measured) ⇒ decideSourcing('subscription') = ${verdict.decision}`);
  return { after, verdict };
}

describe('SUBSCRIPTION EXERCISE A — the multi-tenancy gate must BITE (expected REFUSED)', () => {
  it('medusa (74.1, single-store-per-backend) with honest multi-tenancy="none" drops below the FORK floor', () => {
    const spine = reconstruct();
    log(`\n[base] medusajs/medusa subscription score ${spine.score.total}/100 (${spine.score.band}, ${spine.score.measuredCount}/7 measured; multi-tenancy UNMEASURED)`);
    log(`[A] multi-tenancy SENSITIVITY (where the gate sits):`);
    const none = show(spine, 'none');
    show(spine, 'partial');
    show(spine, 'full');

    const res = promoteToForkSubscription(subResult(spine), { value: 'none', rationale: 'single store per backend deployment; no first-class tenant isolation boundary — honest LOW reading' });
    log(`[A] promoteToForkSubscription(none) ⇒ ${res.ok ? 'FORK (ok)' : `REFUSED (stage=${res.stage}) — ${res.reason}`}`);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.stage).toBe('promotion');
    expect(none.after.total).toBeLessThan(70); // 66.0 — below the FORK floor
    expect(none.verdict.decision).not.toBe('FORK');
  });
});

describe('SUBSCRIPTION EXERCISE B (prepare only) — honest "full" promotes to FORK + enqueues; NO approval here', () => {
  it('medusa with honest multi-tenancy="full" re-derives FORK and enqueues a held gate action', () => {
    const spine = reconstruct();
    const { verdict } = (() => { log(`[B] fold check:`); return { verdict: show(spine, 'full').verdict }; })();
    expect(verdict.decision).toBe('FORK');

    const gate = new ApprovalGate();
    const seam = new SubscriptionDecisionSeam({ gate, console: new DecisionConsole(gate, new InMemoryConsoleAudit()), proposingCaller: 'orchestrator-agent' });
    const prep = seam.prepare({
      report: report(spine), subDomainKey: 'commerce-core',
      multiTenancy: { value: 'full', rationale: 'multi-store + multi-region modules provide per-tenant data boundaries; assessed as first-class tenant isolation' },
    });
    log(`[B] prepare ⇒ ${prep.status}` + (prep.status === 'PENDING-APPROVAL'
      ? ` actionId=${prep.prepared.actionId} tool=${prep.prepared.binding.tool} promotedVerdict=${prep.prepared.promoted.decision} promotedScore=${prep.prepared.promoted.spine!.score.total}`
      : ` (stage=${(prep as { stage: string }).stage})`));
    expect(prep.status).toBe('PENDING-APPROVAL');
    if (prep.status !== 'PENDING-APPROVAL') return;
    expect(prep.prepared.promoted.decision).toBe('FORK');
    expect(gate.get(prep.prepared.actionId)!.state).toBe('held'); // NOT approved — the human's step
  });
});
