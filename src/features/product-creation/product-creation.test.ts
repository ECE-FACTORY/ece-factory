import { describe, it, expect } from 'vitest';
import {
  ProductCreationEngine,
  type ProductCreationPorts,
  type ProductCreationRequest,
  type ProductCreationOutcome,
  type HarvestVerdictView,
} from './product-creation.js';
import type { GateView } from '../project-registry/project-registry.js';
import type { RiskRecord } from '../risk-register/risk-register.js';
import { RepoBuilder } from '../repo-builder/repo-builder.js';
import { surfaceBlockingRisks } from '../risk-register/risk-register.js';

// Product Creation Engine (Module 6) — pure-logic. The composed engines are injected as ports:
// the REAL RepoBuilder (plans only) and the REAL surfaceBlockingRisks are wired in as fakes-by-injection,
// proving the orchestrator composes them rather than re-implementing them. No DB needed — this engine is a
// pure composer over already-gathered Wave 1–4 outputs.

const ports: ProductCreationPorts = {
  repoBuilder: new RepoBuilder(),
  surfaceBlockingRisks,
};
const engine = new ProductCreationEngine(ports);

function clearedGate(over: Partial<GateView> = {}): GateView {
  return { project: 'p', currentPhase: 'Harvest approved', harvestApprovalStatus: 'approved', clearedToBuild: true, reason: 'harvest approved', ...over };
}
function approvedHarvest(over: Partial<HarvestVerdictView> = {}): HarvestVerdictView {
  return { verdict: 'FORK', status: 'STOP-AWAITING-HUMAN-APPROVAL', approved: true, ...over };
}
function risk(over: Partial<RiskRecord> = {}): RiskRecord {
  return {
    registeredAtIso: 'x', key: 'RISK-1', title: 't', type: 'security', owner: 'ECE', severity: 'high',
    mitigation: null, status: 'open', linkedProject: null, linkedRepo: null, linkedDecision: null, linkedEvidence: null, ...over,
  };
}
function fullyCleared(over: Partial<ProductCreationRequest> = {}): ProductCreationRequest {
  return {
    product: 'Sahab', repo: 'sahab', domain: { name: 'Cloud', status: 'registered' },
    harvest: approvedHarvest(), gate: clearedGate(), docCompliance: 'Compliant', featureCompliance: 'Compliant',
    risks: [], features: ['f1'], forkedRepos: [], ...over,
  };
}

describe('Product Creation Engine — complete plan (composition)', () => {
  it('a fully-cleared product composes a complete plan ending PLAN-AWAITING-APPROVAL', () => {
    const out = engine.compose(fullyCleared());
    expect(out.status).toBe('PLAN-AWAITING-APPROVAL');
    if (out.status !== 'PLAN-AWAITING-APPROVAL') return;
    // composes ALL parts: domain ref, sourcing verdict, repo build plan, doc+feature compliance, risks
    expect(out.plan.domain).toBe('Cloud');
    expect(out.plan.sourcingVerdict).toBe('FORK');
    expect(out.plan.harvestStatus).toBe('STOP-AWAITING-HUMAN-APPROVAL');
    expect(out.plan.repoBuildPlan.repo).toBe('sahab'); // came from the REAL injected RepoBuilder
    expect(out.plan.repoBuildPlan.directories.length).toBeGreaterThan(0);
    expect(out.plan.docCompliance).toBe('Compliant');
    expect(out.plan.featureCompliance).toBe('Compliant');
    expect(out.plan.hasBlockingRisks).toBe(false);
    expect(out.plan.blockingItems).toEqual([]);
  });
});

describe('Product Creation Engine — harvest-before-build (inherited)', () => {
  it('an uncleared gate ⇒ REFUSED, no plan', () => {
    const out = engine.compose(fullyCleared({ gate: clearedGate({ clearedToBuild: false, reason: 'harvest pending' }) }));
    expect(out.status).toBe('REFUSED');
    if (out.status === 'REFUSED') expect(out.reason).toMatch(/harvest-before-build/);
  });
  it('an unapproved harvest ⇒ REFUSED, no plan', () => {
    const out = engine.compose(fullyCleared({ harvest: approvedHarvest({ approved: false }) }));
    expect(out.status).toBe('REFUSED');
    if (out.status === 'REFUSED') expect(out.reason).toMatch(/harvest not approved/);
  });
});

describe('Product Creation Engine — never self-executes / never self-approves (the core)', () => {
  it('the outcome type has NO created/executed/approved/proceed state (type-level proof)', () => {
    // @ts-expect-error 'CREATED' is not a member of ProductCreationOutcome['status']
    const _noCreated: ProductCreationOutcome['status'] = 'CREATED';
    // @ts-expect-error 'EXECUTED' is not a member of ProductCreationOutcome['status']
    const _noExecuted: ProductCreationOutcome['status'] = 'EXECUTED';
    // @ts-expect-error 'APPROVED' is not a member of ProductCreationOutcome['status']
    const _noApproved: ProductCreationOutcome['status'] = 'APPROVED';
    // @ts-expect-error 'PROCEED' is not a member of ProductCreationOutcome['status']
    const _noProceed: ProductCreationOutcome['status'] = 'PROCEED';
    void _noCreated; void _noExecuted; void _noApproved; void _noProceed;

    // ...and at runtime the only non-refused status it can emit is PLAN-AWAITING-APPROVAL.
    const out = engine.compose(fullyCleared());
    expect(out.status).toBe('PLAN-AWAITING-APPROVAL');
    expect(JSON.stringify(out)).not.toMatch(/"status":"(CREATED|EXECUTED|APPROVED|PROCEED)"/i);
  });
});

describe('Product Creation Engine — blocking risks surfaced (not buried)', () => {
  it('an unmitigated high/critical OPEN risk is surfaced as blocking in an otherwise-complete plan', () => {
    const out = engine.compose(fullyCleared({
      risks: [risk({ key: 'RISK-crit', severity: 'critical', status: 'open', title: 'air-gap unverified' })],
    }));
    expect(out.status).toBe('PLAN-AWAITING-APPROVAL'); // plan still produced...
    if (out.status !== 'PLAN-AWAITING-APPROVAL') return;
    expect(out.plan.hasBlockingRisks).toBe(true); // ...but the danger is surfaced
    expect(out.plan.blockingRisks.map((r) => r.key)).toContain('RISK-crit');
    expect(out.plan.blockingItems.join(' ')).toMatch(/BLOCKING RISK .*RISK-crit/);
    expect(out.plan.recommendation).toMatch(/BLOCKING/);
  });
  it('a mitigated/closed high risk is NOT surfaced as blocking', () => {
    const out = engine.compose(fullyCleared({ risks: [risk({ key: 'RISK-mit', severity: 'high', status: 'mitigating' })] }));
    expect(out.status).toBe('PLAN-AWAITING-APPROVAL');
    if (out.status === 'PLAN-AWAITING-APPROVAL') expect(out.plan.hasBlockingRisks).toBe(false);
  });
});

describe('Product Creation Engine — deny-by-default', () => {
  it('an unregistered domain (null) ⇒ REFUSED', () => {
    const out = engine.compose(fullyCleared({ domain: null }));
    expect(out.status).toBe('REFUSED');
    if (out.status === 'REFUSED') expect(out.reason).toMatch(/unregistered domain/);
  });
  it('a domain still at "idea" ⇒ REFUSED', () => {
    const out = engine.compose(fullyCleared({ domain: { name: 'Cloud', status: 'idea' } }));
    expect(out.status).toBe('REFUSED');
    if (out.status === 'REFUSED') expect(out.reason).toMatch(/unregistered domain/);
  });
  it('a missing harvest result ⇒ REFUSED', () => {
    const out = engine.compose(fullyCleared({ harvest: null }));
    expect(out.status).toBe('REFUSED');
    if (out.status === 'REFUSED') expect(out.reason).toMatch(/missing harvest result/);
  });
  it('a missing risk snapshot ⇒ REFUSED', () => {
    const out = engine.compose(fullyCleared({ risks: null }));
    expect(out.status).toBe('REFUSED');
    if (out.status === 'REFUSED') expect(out.reason).toMatch(/risk register snapshot/);
  });
  it('a missing doc/feature compliance input ⇒ REFUSED', () => {
    const out = engine.compose(fullyCleared({ docCompliance: null }));
    expect(out.status).toBe('REFUSED');
    if (out.status === 'REFUSED') expect(out.reason).toMatch(/doc\/feature compliance/);
  });
});
