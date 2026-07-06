import { describe, it, expect } from 'vitest';
import { classifyLicense } from '../license-compliance/license-compliance.js';
import { RepoIntelligenceEngine } from '../repo-intelligence/repo-intelligence.js';
import { scoreCandidate, type ScoringCandidate } from '../scoring-engine/scoring-engine.js';
import { assessProductSpine } from '../../layer-4-build-harden/product-spine/product-spine.js';
import { assessSovereignReadiness, SOVEREIGN_CHECKS, type SovereignDescriptor } from '../sovereign-readiness/sovereign-readiness.js';
import { assessWhiteLabel } from '../../layer-4-build-harden/white-label/white-label.js';
import { HarvestEngine, type HarvestEngines, type HarvestCandidateInput } from './harvest-engine.js';

// Harvest Engine (Module 8). The REAL five engines are injected (this validates the actual orchestration);
// the orchestration logic itself is pure, so no DB is needed.

const repoEng = new RepoIntelligenceEngine({ classify: classifyLicense }, () => 1000);
const engines: HarvestEngines = {
  classifyLicense,
  evaluateRepo: (i) => repoEng.evaluate(i),
  score: scoreCandidate,
  assessSpine: assessProductSpine,
  assessSovereign: assessSovereignReadiness,
  assessWhiteLabel,
};
const harvest = new HarvestEngine(engines);

const APACHE = 'Apache License\nVersion 2.0, January 2004';
const BSL = 'Business Source License 1.1\nMariaDB Corporation Ab';

function scoringCandidate(decision: 'ACCEPT' | 'REJECT', over: Partial<ScoringCandidate> = {}): ScoringCandidate {
  return {
    license: { decision, detected: decision === 'ACCEPT' ? 'Apache-2.0' : 'BSL' },
    maturity: { activelyMaintained: true, stars: 3735 },
    airGap: 'yes', whiteLabel: 'easy', archFit: { rating: 'strong' }, maintainability: { rating: 'clean' },
    ...over,
  };
}
function cleanCandidate(id: string): HarvestCandidateInput {
  return {
    id, identity: { host: 'github.com', owner: 'google', name: id }, license: { text: APACHE }, provenanceVerified: true,
    scoringPassA: scoringCandidate('ACCEPT'), scoringPassB: scoringCandidate('ACCEPT'),
  };
}
function fullyLocal(): SovereignDescriptor {
  const d: SovereignDescriptor = {};
  for (const c of SOVEREIGN_CHECKS) d[c.id] = { state: c.id === 'aiInferenceLocal' ? 'not-applicable' : 'local' };
  return d;
}
const branding = [{ id: 'logo.svg', category: 'replaceable' as const }, { id: 'NOTICE', category: 'must-keep' as const }];

describe('Harvest Engine — complete report ends in STOP', () => {
  it('a clean candidate set ⇒ a complete Harvest Report ending in STOP (spine/sovereign/white-label/SPOF present)', () => {
    const r = harvest.harvest({ candidates: [cleanCandidate('trillian')], sovereignDescriptor: fullyLocal(), brandingElements: branding });
    expect(r.status).toBe('STOP-AWAITING-HUMAN-APPROVAL');
    expect(r.spine.spineType).toBe('single-spine');
    expect(r.sovereign?.verdict).toBe('Acceptable');
    expect(r.whiteLabel?.verdict).toBe('Ready-after-stripping');
    expect(r.spof.repoId).toBe('trillian');
    expect(r.recommendation.evidence.length).toBeGreaterThan(0); // no verdict without evidence
    expect(r.blockingItems).toHaveLength(0);
  });
});

describe('Harvest Engine — NEVER self-approves (core)', () => {
  it('every harvest ends STOP-for-human; there is no "approved" output state', () => {
    const r = harvest.harvest({ candidates: [cleanCandidate('trillian')] });
    expect(r.status).toBe('STOP-AWAITING-HUMAN-APPROVAL');
    // Type-level proof: status can only ever be the STOP literal — there is no approved variant.
    const _onlyStop: 'STOP-AWAITING-HUMAN-APPROVAL' = r.status;
    void _onlyStop;
    // Runtime: nothing in the report is an approval/proceed signal.
    expect(JSON.stringify(r)).not.toMatch(/"status":"(approved|proceed|APPROVED|PROCEED)"/);
  });
});

describe('Harvest Engine — §3.8 second-pass escalation', () => {
  it('a 2-pass scoring disagreement > 15 ⇒ the candidate is escalated, not silently resolved', () => {
    const c = cleanCandidate('disagree');
    c.scoringPassB = scoringCandidate('ACCEPT', { airGap: 'partial', whiteLabel: 'moderate', archFit: { rating: 'good' }, maintainability: { rating: 'maintainable' } }); // ~78 vs 98
    const r = harvest.harvest({ candidates: [c] });
    const ca = r.candidates[0]!;
    expect(ca.scoreDisagreement).toBeGreaterThan(15);
    expect(ca.escalated).toBe(true);
    expect(r.reviewItems.join('\n')).toMatch(/§3\.8.*escalate/i);
  });
});

describe('Harvest Engine — §3.9 reuse-beats-rebuild', () => {
  it('a BUILD recommendation where an acceptable FORK/EXTEND exists ⇒ flagged', () => {
    const r = harvest.harvest({ candidates: [cleanCandidate('trillian')], proposedVerdict: 'BUILD' });
    expect(r.recommendation.verdict).toBe('BUILD');
    expect(r.recommendation.reuseOverBuildFlag).toBe(true);
    expect(r.reviewItems.join('\n')).toMatch(/§3\.9/);
  });
});

describe('Harvest Engine — deny-by-default surfacing', () => {
  it('a rejected-license + non-sovereign candidate ⇒ surfaced as blocking, not buried', () => {
    const bsl: HarvestCandidateInput = {
      id: 'immudb', identity: { host: 'github.com', owner: 'codenotary', name: 'immudb' }, license: { text: BSL, declaredSpdx: 'Apache-2.0' }, provenanceVerified: true,
      scoringPassA: scoringCandidate('REJECT'), scoringPassB: scoringCandidate('REJECT'),
    };
    const sov = fullyLocal();
    sov.noForeignSaaS = { state: 'mandatory-blocker', note: 'foreign control plane' };
    const r = harvest.harvest({ candidates: [bsl], sovereignDescriptor: sov });
    expect(r.status).toBe('STOP-AWAITING-HUMAN-APPROVAL'); // still STOP
    expect(r.blockingItems.join('\n')).toMatch(/immudb: license REJECT/i);
    expect(r.blockingItems.join('\n')).toMatch(/sovereign: Rejected/i);
  });
});
