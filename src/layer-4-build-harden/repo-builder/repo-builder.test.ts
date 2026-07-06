import { describe, it, expect } from 'vitest';
import { RepoBuilder, type RepoBuildRequest, type RepoBuildOutcome } from './repo-builder.js';
import type { GateView } from '../../factory-shared/project-registry/project-registry.js';

// Repo Builder / Operator (Module 29). Pure-logic: the plan is a pure function of (project, gate).

const builder = new RepoBuilder();

const clearedGate: GateView = { project: 'ece-identity', currentPhase: 'Harvest approved', harvestApprovalStatus: 'approved', clearedToBuild: true, reason: 'harvest approved — cleared to build' };
const unclearedGate: GateView = { project: 'ece-identity', currentPhase: 'Harvest pending', harvestApprovalStatus: 'pending', clearedToBuild: false, reason: 'not cleared to build — harvest approval is "pending"' };

function req(over: Partial<RepoBuildRequest> = {}): RepoBuildRequest {
  return { project: 'ece-identity', repo: 'ece-identity', gate: clearedGate, features: ['audit-engine'], ...over };
}
const filePaths = (o: Extract<RepoBuildOutcome, { status: 'PLAN-AWAITING-APPROVAL' }>) => o.plan.files.map((f) => f.path);

describe('Repo Builder — cleared project ⇒ complete plan', () => {
  it('a cleared project ⇒ PLAN-AWAITING-APPROVAL with the full §5 structure', () => {
    const out = builder.plan(req());
    expect(out.status).toBe('PLAN-AWAITING-APPROVAL');
    if (out.status !== 'PLAN-AWAITING-APPROVAL') return;
    const files = filePaths(out);
    for (const f of ['CLAUDE.md', 'README.md', 'SECURITY.md', '.env.example', '.github/workflows/ci.yml', 'docs/ARCHITECTURE.md', 'docs/FEATURE_REGISTRY.md', 'src/features/audit-engine/audit-engine.feature.md']) {
      expect(files).toContain(f);
    }
    const dirs = out.plan.directories.map((d) => d.path);
    expect(dirs).toContain('src/features');
    expect(dirs).toContain('tests/unit');
    expect(dirs).toContain('src/features/audit-engine');
  });
});

describe('Repo Builder — harvest-before-build gate inherited', () => {
  it('an uncleared project (clearedToBuild=false) ⇒ REFUSED, no plan emitted', () => {
    const out = builder.plan(req({ gate: unclearedGate }));
    expect(out.status).toBe('REFUSED');
    expect(out).not.toHaveProperty('plan');
  });
});

describe('Repo Builder — plans, never executes (core)', () => {
  it('the only plan status is PLAN-AWAITING-APPROVAL; there is no executed/created state', () => {
    const out = builder.plan(req());
    expect(out.status).toBe('PLAN-AWAITING-APPROVAL');
    if (out.status === 'PLAN-AWAITING-APPROVAL') {
      const _onlyPlan: 'PLAN-AWAITING-APPROVAL' = out.status; // type-level: status can only be this literal
      void _onlyPlan;
    }
    // The outcome union has NO "executed"/"created" status — proven at the type level.
    // @ts-expect-error 'executed' is not a member of RepoBuildOutcome['status']
    const _noExec: RepoBuildOutcome['status'] = 'executed';
    void _noExec;
    // Runtime: nothing in the outcome is an execution/creation signal.
    expect(JSON.stringify(out)).not.toMatch(/"status":"(executed|created|EXECUTED|CREATED)"/);
  });
});

describe('Repo Builder — upstream tracking (§11)', () => {
  it('a forked repo ⇒ an upstream-tracking entry is planned', () => {
    const out = builder.plan(req({ forkedRepos: [{ name: 'trillian', upstreamUrl: 'https://github.com/google/trillian', license: 'Apache-2.0', forkPointCommit: 'abc123' }] }));
    expect(out.status).toBe('PLAN-AWAITING-APPROVAL');
    if (out.status !== 'PLAN-AWAITING-APPROVAL') return;
    expect(out.plan.upstreamTracking).toHaveLength(1);
    expect(out.plan.upstreamTracking[0]!.upstreamUrl).toMatch(/google\/trillian/);
  });
});

describe('Repo Builder — deny-by-default', () => {
  it('a missing project field ⇒ REFUSED', () => {
    expect(builder.plan(req({ project: '' })).status).toBe('REFUSED');
  });
  it('an unverifiable gate state ⇒ REFUSED', () => {
    const badGate = { ...clearedGate, clearedToBuild: undefined as unknown as boolean };
    expect(builder.plan(req({ gate: badGate })).status).toBe('REFUSED');
  });
});
