// Unit tests for the Harvest Orchestrator — NO NETWORK, NO TOKEN. The scout is injected as a fake port
// returning canned data; the GRADERS are the REAL engines (repo-intelligence, license-compliance,
// scoring-engine, sovereign-readiness). A green run proves the chain assembles and decides correctly on
// real grader output, and fails closed without fabricating — all without touching GitHub.

import { describe, it, expect } from 'vitest';
import {
  HarvestOrchestrator, decompose, decomposeLegalContractOps, decideSourcing, reviewLicense, reviewAirGap, enrichScore,
} from './harvest-orchestrator.js';
import type { ScoutPort, GradedCandidate, SignalsScoutPort } from './harvest-orchestrator.js';
import type { ScoutResult, ScoutedCandidate } from '../repo-scout/repo-scout.js';
import type { RepoEvaluationRecord, LicenseDecision, ScoringInputs, AirGapSuitability, WhiteLabelFit } from '../repo-intelligence/repo-intelligence.js';
import { scoreCandidate, candidateFromScoringInputs } from '../scoring-engine/scoring-engine.js';
import type { ScoreResult, ScoreBand, MaintainabilityRating, ArchFitRating } from '../scoring-engine/scoring-engine.js';
import type { RepoSignals, Confidence } from '../repo-scout-signals/repo-scout-signals.js';

const FIXED_NOW = () => Date.parse('2026-07-07T00:00:00Z');

const MIT_TEXT = `MIT License\n\nCopyright (c) 2024 Example\n\nPermission is hereby granted, free of charge, to any person obtaining a copy...`;
const BSL_TEXT = `Business Source License 1.1\n\nLicensor: Example Inc.\nThe Business Source License is not an Open Source license...`;

// Build a ScoutedCandidate exactly as the real repo-scout would emit it (inert facts for the graders).
function mkCandidate(p: {
  owner: string; name: string; licenseText: string | null; verified: boolean;
  hint?: string; fromText?: string; disagreement?: boolean; stars?: number; activelyMaintained?: boolean; archived?: boolean;
}): ScoutedCandidate {
  return {
    evaluationInput: {
      identity: { host: 'github.com', owner: p.owner, name: p.name },
      license: { text: p.licenseText ?? undefined, declaredSpdx: p.hint, source: `${p.owner}/${p.name}` },
      provenanceVerified: p.verified,
      maturity: { stars: p.stars, lastCommitIso: '2025-06-01T00:00:00Z', archived: p.archived, activelyMaintained: p.activelyMaintained },
      description: `${p.name} — a library`,
    },
    repoUrl: `https://github.com/${p.owner}/${p.name}`,
    rawLicenseUrl: p.verified ? `https://raw.githubusercontent.com/${p.owner}/${p.name}/main/LICENSE` : null,
    licenseVerified: p.verified,
    licenseHint: p.hint ?? 'unknown',
    licenseFromRawText: p.fromText ?? 'unknown',
    licenseDisagreement: p.disagreement ?? false,
    notes: [],
  };
}
const ok = (query: string, candidates: ScoutedCandidate[]): ScoutResult => ({ status: 'OK', query, candidates });

// A fake scout port that maps each query to a canned result (no network).
function fakeScout(byQuery: Record<string, ScoutResult>): ScoutPort {
  return { scout: async (q) => byQuery[q.query] ?? ok(q.query, []) };
}

describe('Harvest Orchestrator — decomposition', () => {
  it('decomposes "Legal & Contract Operations" into 5 concrete sub-domains with queries', () => {
    const subs = decompose('Legal & Contract Operations');
    expect(subs.length).toBe(5);
    for (const s of subs) { expect(s.query.trim().length).toBeGreaterThan(0); expect(s.title.length).toBeGreaterThan(0); }
    expect(subs.map((s) => s.key)).toContain('contract-lifecycle');
  });
  it('returns no decomposition for an unrelated domain (never fabricated)', () => {
    expect(decompose('Underwater Basket Weaving')).toEqual([]);
  });
});

describe('Harvest Orchestrator — reviewer re-derivation (pure, agrees AND disagrees)', () => {
  it('license: reviewer AGREES when the raw text matches the assembler claim', () => {
    expect(reviewLicense(MIT_TEXT, 'MIT', 'ACCEPT')).toEqual({ reviewer: 'ACCEPT (MIT)', agrees: true });
  });
  it('license: reviewer DISAGREES when the assembler claim contradicts the raw text (catches fabrication)', () => {
    const r = reviewLicense(MIT_TEXT, 'Apache-2.0', 'ACCEPT'); // claim says Apache; the file is MIT
    expect(r.reviewer).toBe('ACCEPT (MIT)');
    expect(r.agrees).toBe(false);
  });
  it('license: no raw text ⇒ reviewer only agrees with an "unknown" claim', () => {
    expect(reviewLicense(null, 'unknown', 'REJECT').agrees).toBe(true);
    expect(reviewLicense(null, 'MIT', 'ACCEPT').agrees).toBe(false);
  });
  it('air-gap: reviewer AGREES with unknown-when-no-evidence; DISAGREES with an over-claim', () => {
    expect(reviewAirGap('unknown', false)).toEqual({ reviewer: 'unknown', agrees: true });
    expect(reviewAirGap('yes', false)).toEqual({ reviewer: 'unknown', agrees: false }); // over-claim caught
  });
});

// synthetic graded candidates to exercise EVERY branch of the decision mapping directly. `measuredDims` drives the
// SPLIT confidence floor: measuredCount + WHICH dims were measured (air-gap gates FORK). Default = license+maturity
// (2 dims), i.e. a base "scout sourced license + maturity only" pass.
const DIM_MAX: Record<string, number> = { license: 20, maturity: 20, 'air-gap': 20, 'white-label': 15, 'arch-fit': 15, maintainability: 10 };
const ALL_DIMS = ['license', 'maturity', 'air-gap', 'white-label', 'arch-fit', 'maintainability'] as const;
function score(total: number, band: ScoreBand, measuredDims: readonly string[] = ['license', 'maturity']): ScoreResult {
  const subScores = ALL_DIMS.map((dimension) => ({
    dimension, score: 0, max: DIM_MAX[dimension]!, evidence: 'x', flagged: !measuredDims.includes(dimension), measured: measuredDims.includes(dimension),
  }));
  const measuredWeight = subScores.filter((s) => s.measured).reduce((w, s) => w + s.max, 0);
  return { subScores, total, band, rejected: band === 'reject' && total < 20, flags: [], measuredCount: measuredDims.length, measuredWeightFraction: measuredWeight / 100 };
}
function mkRecord(p: { owner?: string; name?: string; eligibility: RepoEvaluationRecord['eligibility']; licenseDecision: LicenseDecision; stars?: number }): RepoEvaluationRecord {
  return {
    evaluatedAtIso: '2026-07-07T00:00:00.000Z', identity: { host: 'github.com', owner: p.owner ?? 'o', name: p.name ?? 'n' },
    licenseDetected: 'MIT', licenseDecision: p.licenseDecision, eligibility: p.eligibility, provenanceVerified: true,
    maturity: { stars: p.stars ?? 100 }, airGapSuitability: 'unknown', whiteLabelFit: 'unknown', architectureFitNotes: null,
    priorVerdict: null, readme: null, description: null, status: 'recorded',
  } as RepoEvaluationRecord;
}
function gc(p: { owner?: string; name?: string; eligibility: RepoEvaluationRecord['eligibility']; licenseDecision: LicenseDecision; total: number; band: ScoreBand; stars?: number; measuredDims?: readonly string[] }): GradedCandidate {
  return gcWith(score(p.total, p.band, p.measuredDims ?? ['license', 'maturity']), mkRecord(p));
}
// Wrap a REAL ScoreResult (e.g. straight from enrichScore) into a GradedCandidate so decideSourcing can grade it.
function gcWith(sc: ScoreResult, rec: RepoEvaluationRecord = mkRecord({ eligibility: 'eligible', licenseDecision: 'ACCEPT' })): GradedCandidate {
  return {
    repoUrl: 'u', identity: rec.identity, record: rec, score: sc, licenseOneLine: 'MIT License', licenseVerified: true, licenseDisagreement: false, rawLicenseText: MIT_TEXT, notes: [],
    enrichment: { applied: false, status: 'NONE', totalBefore: sc.total, totalAfter: sc.total, bandBefore: sc.band, bandAfter: sc.band, dimensions: [] },
  };
}

describe('Harvest Orchestrator — decideSourcing mapping (from REAL score bands)', () => {
  it('no candidates ⇒ BUILD', () => {
    expect(decideSourcing([], 'sovereign').decision).toBe('BUILD');
  });
  it('all REJECT / none eligible ⇒ BUILD (genuine absence of a permissive repo)', () => {
    expect(decideSourcing([gc({ eligibility: 'not-eligible', licenseDecision: 'REJECT', total: 0, band: 'reject' })], 'sovereign').decision).toBe('BUILD');
  });
  it('eligible spine, band acceptable (≥70) + ≥3 measured INCLUDING air-gap ⇒ FORK', () => {
    // SPLIT FLOOR: FORK now requires air-gap MEASURED. measuredDims = license+maturity+air-gap (3, incl. air-gap).
    expect(decideSourcing([gc({ eligibility: 'eligible', licenseDecision: 'ACCEPT', total: 72, band: 'acceptable', measuredDims: ['license', 'maturity', 'air-gap'] })], 'sovereign').decision).toBe('FORK');
  });
  it('eligible spine, band risky (55–69) + ≥3 measured (no air-gap needed) ⇒ EXTEND', () => {
    // SPLIT FLOOR: EXTEND requires ≥3 measured + score ≥55, but NOT air-gap. measuredDims = license+maturity+arch (no air-gap).
    expect(decideSourcing([gc({ eligibility: 'eligible', licenseDecision: 'ACCEPT', total: 60, band: 'risky', measuredDims: ['license', 'maturity', 'arch-fit'] })], 'sovereign').decision).toBe('EXTEND');
  });
  it('eligible spine ≥70 but < 3 measured dims ⇒ REFUSES FORK/EXTEND ⇒ NEEDS-ASSESSMENT (the floor)', () => {
    // 2 measured dims only (base-like). High score, but below the confidence floor of 3.
    const r = decideSourcing([gc({ eligibility: 'eligible', licenseDecision: 'ACCEPT', total: 95, band: 'strong', measuredDims: ['license', 'maturity'] })], 'sovereign');
    expect(r.decision).toBe('NEEDS-ASSESSMENT');
    expect(r.evidence.join(' ')).toMatch(/< confidence floor of 3/);
  });
  it('eligible spine ≥70 + ≥3 measured but WITHOUT air-gap ⇒ EXTEND, never FORK (air-gap gates FORK)', () => {
    // license+maturity+maintainability measured (3, NO air-gap); score ≥70. FORK needs air-gap ⇒ demoted to EXTEND.
    const r = decideSourcing([gc({ eligibility: 'eligible', licenseDecision: 'ACCEPT', total: 82, band: 'acceptable', measuredDims: ['license', 'maturity', 'maintainability'] })], 'sovereign');
    expect(r.decision).toBe('EXTEND');
    expect(r.decision).not.toBe('FORK');
    expect(r.evidence.join(' ')).toMatch(/air-gap UNMEASURED/);
    expect(r.evidence.join(' ')).toMatch(/HUMAN APPROVAL REQUIRED: air-gap/); // air-gap flagged still-needs-human
  });
  it('eligible spine, band reject (<55) ⇒ NEEDS-ASSESSMENT (not a false BUILD)', () => {
    const r = decideSourcing([gc({ eligibility: 'eligible', licenseDecision: 'ACCEPT', total: 38, band: 'reject', measuredDims: ['license', 'maturity'] })], 'sovereign');
    expect(r.decision).toBe('NEEDS-ASSESSMENT');
    expect(r.evidence.join(' ')).toMatch(/reuse-beats-rebuild/);
  });
  it('candidates exist but NEEDS_REVIEW / unverified (none eligible, some permissive) ⇒ NEEDS-ASSESSMENT', () => {
    expect(decideSourcing([gc({ eligibility: 'needs-review', licenseDecision: 'NEEDS_REVIEW', total: 10, band: 'reject' })], 'sovereign').decision).toBe('NEEDS-ASSESSMENT');
  });
  it('FORK evidence names the unmeasured dimensions at decision time (glass-box)', () => {
    // measured license+maturity+air-gap ⇒ FORK; unmeasured = white-label, arch-fit, maintainability must be listed.
    const r = decideSourcing([gc({ eligibility: 'eligible', licenseDecision: 'ACCEPT', total: 78, band: 'acceptable', measuredDims: ['license', 'maturity', 'air-gap'] })], 'sovereign');
    expect(r.decision).toBe('FORK');
    expect(r.evidence.join(' ')).toMatch(/unmeasured at decision:.*white-label/);
    expect(r.evidence.join(' ')).toMatch(/HUMAN APPROVAL REQUIRED: white-label/); // white-label unmeasured ⇒ flagged
  });
});

describe('Harvest Orchestrator — full run() over the REAL graders with a fake scout (no network)', () => {
  const subs = decomposeLegalContractOps();
  // MIT verified + actively maintained + 4200★ for most sub-domains; a BSL-only sub-domain; an empty one.
  const mit = () => [mkCandidate({ owner: 'acme', name: 'clm', licenseText: MIT_TEXT, verified: true, hint: 'MIT', fromText: 'MIT', stars: 4200, activelyMaintained: true })];
  const byQuery: Record<string, ScoutResult> = {};
  for (const s of subs) byQuery[s.query] = ok(s.query, mit());
  byQuery[subs[1].query] = ok(subs[1].query, [mkCandidate({ owner: 'globex', name: 'esign', licenseText: BSL_TEXT, verified: true, hint: 'Apache-2.0', fromText: 'BSL', disagreement: true, stars: 900, activelyMaintained: true })]);
  byQuery[subs[2].query] = ok(subs[2].query, []); // no candidates for clause libraries

  it('runs the whole chain and returns a STOP report shaped for human review', async () => {
    const orch = new HarvestOrchestrator(fakeScout(byQuery), { now: FIXED_NOW });
    const res = await orch.run('Legal & Contract Operations', 'sovereign');

    expect(res.status).toBe('OK');
    expect(res.report).not.toBeNull();
    expect(res.report!.status).toBe('STOP-AWAITING-HUMAN-APPROVAL');
    expect(res.report!.subDomains.length).toBe(5);
    expect(res.report!.redTeam.length).toBeGreaterThan(0);
    expect(res.report!.moat.length).toBeGreaterThan(0);
    expect(res.reportMarkdown).toContain('# Harvest Report');
    expect(res.reportMarkdown).toContain('STOP — AWAITING HUMAN APPROVAL');
  });

  it('the REAL graders ran: MIT candidate is ACCEPT + eligible, license 20 & maturity 18, air-gap flagged', async () => {
    const orch = new HarvestOrchestrator(fakeScout(byQuery), { now: FIXED_NOW });
    const res = await orch.run('Legal & Contract Operations', 'sovereign');
    const clm = res.report!.subDomains[0].candidates[0];
    expect(clm.record.licenseDecision).toBe('ACCEPT');       // license-compliance classified the raw MIT text
    expect(clm.record.eligibility).toBe('eligible');          // repo-intelligence deny-by-default: ACCEPT + provenance
    const byDim = Object.fromEntries(clm.score.subScores.map((s) => [s.dimension, s.score]));
    expect(byDim['license']).toBe(20);
    expect(byDim['maturity']).toBe(18);                       // actively maintained, 4200★
    expect(byDim['air-gap']).toBe(0);                         // NOT sourced ⇒ deny-by-default
  });

  it('decisions reflect the honest finding: MIT-eligible ⇒ NEEDS-ASSESSMENT; BSL-only ⇒ BUILD; empty ⇒ BUILD', async () => {
    const orch = new HarvestOrchestrator(fakeScout(byQuery), { now: FIXED_NOW });
    const res = await orch.run('Legal & Contract Operations', 'sovereign');
    const dec = Object.fromEntries(res.report!.subDomains.map((r) => [r.subDomain.key, r.decision]));
    expect(dec['contract-lifecycle']).toBe('NEEDS-ASSESSMENT'); // permissive+maintained but unassessed dims
    expect(dec['e-signature']).toBe('BUILD');                   // BSL only ⇒ no permissive repo
    expect(dec['clause-template-library']).toBe('BUILD');       // no candidates
  });

  it('REGRESSION PIN: recalibration does NOT retro-promote the Legal-Ops MIT spine (2 dims measured ⇒ NEEDS-ASSESSMENT)', async () => {
    // The whole point of the fix must NOT falsely promote a repo assessed on license+maturity only. The scout
    // sources exactly 2 dimensions ⇒ measuredCount 2 < the floor of 3 ⇒ NEEDS-ASSESSMENT, even though the
    // normalized score is high (license 20 + maturity 18 = 38; 38/40×100 = 95).
    const orch = new HarvestOrchestrator(fakeScout(byQuery), { now: FIXED_NOW }); // no signals port ⇒ 2 dims only
    const res = await orch.run('Legal & Contract Operations', 'sovereign');
    const clm = res.report!.subDomains.find((r) => r.subDomain.key === 'contract-lifecycle')!;
    expect(clm.spine!.score.total).toBe(95);            // normalized, high — but confidence is low
    expect(clm.spine!.score.measuredCount).toBe(2);     // only license + maturity sourced
    expect(clm.decision).toBe('NEEDS-ASSESSMENT');
    expect(clm.decisionEvidence.join(' ')).toMatch(/< confidence floor of 3/);
  });

  it('reviewer re-derivation AGREES with the assembler on the honest MIT/air-gap facts', async () => {
    const orch = new HarvestOrchestrator(fakeScout(byQuery), { now: FIXED_NOW });
    const res = await orch.run('Legal & Contract Operations', 'sovereign');
    const clmFinding = res.report!.reviewer.find((f) => f.repoUrl.includes('acme/clm'))!;
    expect(clmFinding.licenseAgrees).toBe(true);   // both derive ACCEPT (MIT) from the raw file
    expect(clmFinding.airGapAgrees).toBe(true);    // both 'unknown' — no over-claim
  });

  it('the sovereign engine really ran (empty descriptor ⇒ deny-by-default Acceptable-after-hardening)', async () => {
    const orch = new HarvestOrchestrator(fakeScout(byQuery), { now: FIXED_NOW });
    const res = await orch.run('Legal & Contract Operations', 'sovereign');
    expect(res.report!.sovereign.verdict).toBe('Acceptable-after-hardening');
    expect(res.report!.sovereign.checks.length).toBeGreaterThan(0);
  });
});

describe('Harvest Orchestrator — FAIL CLOSED (no report, no fabrication)', () => {
  it('a scout FAILED_CLOSED ⇒ run fails closed, report null, markdown null, honest reason', async () => {
    const subs = decomposeLegalContractOps();
    const byQuery: Record<string, ScoutResult> = {};
    for (const s of subs) byQuery[s.query] = ok(s.query, []);
    byQuery[subs[0].query] = { status: 'FAILED_CLOSED', query: subs[0].query, candidates: [], reason: 'no GITHUB_TOKEN' };
    const orch = new HarvestOrchestrator(fakeScout(byQuery), { now: FIXED_NOW });
    const res = await orch.run('Legal & Contract Operations', 'sovereign');

    expect(res.status).toBe('FAILED_CLOSED');
    expect(res.report).toBeNull();
    expect(res.reportMarkdown).toBeNull();
    expect(res.reason).toMatch(/failed closed/i);
    expect(res.reason).toMatch(/GITHUB_TOKEN/);
  });

  it('an unknown domain ⇒ fail closed with no report (never fabricates sub-domains)', async () => {
    const orch = new HarvestOrchestrator(fakeScout({}), { now: FIXED_NOW });
    const res = await orch.run('Underwater Basket Weaving', 'sovereign');
    expect(res.status).toBe('FAILED_CLOSED');
    expect(res.report).toBeNull();
  });
});

// ──────────────────────────────────────────────────────────────────────────────────────────────────────
// SIGNALS ENRICHMENT — the CONFIDENCE CONTRACT (no network, no token; signals injected as a fake port).
// ──────────────────────────────────────────────────────────────────────────────────────────────────────

// A ScoringInputs for a real, permissive, actively-maintained repo (MIT, 4200★) — the same shape the base
// grader produces. Un-enriched it scores license 20 + maturity 18 + (air-gap/white-label/arch/maint = 0) = 38.
const MIT_INPUTS: ScoringInputs = {
  licenseDecision: 'ACCEPT', licenseDetected: 'MIT',
  maturity: { stars: 4200, activelyMaintained: true },
  airGapSuitability: 'unknown', whiteLabelFit: 'unknown', architectureFitNotes: null,
};
const baseScoreOf = (i: ScoringInputs): ScoreResult => scoreCandidate(candidateFromScoringInputs(i), 'sovereign');

function sig<V>(value: V, confidence: Confidence, evidence: string[]) { return { value, confidence, evidence }; }

// Build an OK RepoSignals with per-dimension (value, confidence) overrides; sensible measured-good defaults.
function okSignals(owner: string, name: string, o: {
  maint?: [MaintainabilityRating | 'unknown', Confidence];
  arch?: [ArchFitRating | 'unknown', Confidence];
  airGap?: [AirGapSuitability, Confidence];
} = {}): RepoSignals {
  return {
    status: 'OK', target: { owner, name, branch: 'main' },
    maintainability: sig<MaintainabilityRating | 'unknown'>(o.maint?.[0] ?? 'clean', o.maint?.[1] ?? 'measured', ['last push 10d ago', '8 contributor(s)', 'CI config present', 'tests present']),
    architecture: sig<ArchFitRating | 'unknown'>(o.arch?.[0] ?? 'good', o.arch?.[1] ?? 'measured', ['primary language TypeScript', '42 direct dependencies', 'modular layout (packages/modules/apps dirs)']),
    airGap: sig<AirGapSuitability>(o.airGap?.[0] ?? 'partial', o.airGap?.[1] ?? 'partial', ['no hard cloud/SaaS dependency found in the manifest', 'PARTIAL BY NATURE: absence of evidence is not proof']),
    whiteLabel: sig<WhiteLabelFit>('unknown', 'not-mechanizable', ['rebrandability is an architectural/legal judgment — NOT MECHANIZABLE']),
  };
}
function failClosedSignals(owner: string, name: string, reason = 'no GITHUB_TOKEN — signals scout refuses to source (fail-closed)'): RepoSignals {
  const ev = [reason];
  return {
    status: 'FAILED_CLOSED', target: { owner, name, branch: 'main' }, reason,
    maintainability: sig<MaintainabilityRating | 'unknown'>('unknown', 'not-mechanizable', ev),
    architecture: sig<ArchFitRating | 'unknown'>('unknown', 'not-mechanizable', ev),
    airGap: sig<AirGapSuitability>('unknown', 'not-mechanizable', ev),
    whiteLabel: sig<WhiteLabelFit>('unknown', 'not-mechanizable', ev),
  };
}
function fakeSignals(byRepo: Record<string, RepoSignals>, opts: { throwFor?: string } = {}): SignalsScoutPort {
  return {
    gather: async ({ owner, name }) => {
      const key = `${owner}/${name}`;
      if (opts.throwFor === key) throw new Error('signals network boom');
      return byRepo[key] ?? failClosedSignals(owner, name, 'repo not in fixture (fail-closed)');
    },
  };
}
const byDim = (s: ScoreResult) => Object.fromEntries(s.subScores.map((x) => [x.dimension, x.score]));

describe('enrichScore — CONFIDENCE CONTRACT (pure, deterministic)', () => {
  it('no signals ⇒ returns the un-enriched grade verbatim (applied:false) — preserved behavior', () => {
    const base = baseScoreOf(MIT_INPUTS);
    const { score, enrichment } = enrichScore(MIT_INPUTS, base, null, 'sovereign');
    expect(score).toBe(base);                 // same object — nothing recomputed
    expect(enrichment.applied).toBe(false);
    expect(enrichment.status).toBe('NONE');
    expect(enrichment.bandBefore).toBe(enrichment.bandAfter);
  });

  it('MEASURED good maintainability + architecture raise measuredCount 2→4 and normalize to 90.8 (strong)', () => {
    // RECALIBRATION (normalize over measured dims): base measured = license 20 + maturity 18 (4200★); 38/40×100 = 95.0 → strong.
    const base = baseScoreOf(MIT_INPUTS);
    expect(base.total).toBe(95); expect(base.band).toBe('strong'); expect(base.measuredCount).toBe(2);
    const { score, enrichment } = enrichScore(MIT_INPUTS, base, okSignals('acme', 'clm'), 'sovereign'); // clean + good, both measured
    expect(byDim(score)['maintainability']).toBe(10); // 'clean' at full weight (raw dim points unchanged)
    expect(byDim(score)['arch-fit']).toBe(11);        // 'good' at full weight
    // measured = license 20 + maturity 18 + maint 10 + arch 11 = 59 pts; measured max = 20+20+10+15 = 65; 59/65×100 = 90.769 → 90.8
    expect(score.total).toBe(90.8);
    expect(score.measuredCount).toBe(4);               // the enrichment's real work: confidence 2→4 (what the floor turns on)
    expect(score.band).toBe('strong');                 // 90.8 ≥ 85 (enrichment DILUTES the 95 base by averaging in arch 73%, but stays strong)
    // The movement is TRACEABLE to the specific measured signals.
    const maint = enrichment.dimensions.find((d) => d.dimension === 'maintainability')!;
    expect(maint).toMatchObject({ confidence: 'measured', value: 'clean', influence: 'raised', pointsBefore: 0, pointsAfter: 10 });
    expect(maint.evidence.join(' ')).toMatch(/CI config present/);
    const arch = enrichment.dimensions.find((d) => d.dimension === 'architecture')!;
    expect(arch).toMatchObject({ confidence: 'measured', value: 'good', influence: 'raised', pointsAfter: 11 });
  });

  it('PARTIAL architecture contributes only WEAKLY / BOUNDED (capped at "possible"=6, never full "good"=11)', () => {
    const base = baseScoreOf(MIT_INPUTS);
    // arch 'good' but only PARTIAL confidence (tree-only, no manifest) ⇒ must be bounded to 'possible' (6).
    const { score, enrichment } = enrichScore(MIT_INPUTS, base, okSignals('acme', 'clm', { arch: ['good', 'partial'], maint: ['maintainable', 'measured'] }), 'sovereign');
    expect(byDim(score)['arch-fit']).toBe(6);   // bounded — NOT 11 (the bound still works at the DIM level)
    expect(byDim(score)['maintainability']).toBe(7);
    // measured = license 20 + maturity 18 + maint 7 + arch 6 (bounded) = 51 pts; measured max = 65; 51/65×100 = 78.46 → 78.5
    expect(score.total).toBe(78.5);
    expect(score.band).toBe('acceptable');       // 78.5 ≥ 70: the OTHER measured dims are strong, so the average is high even with a weak bounded arch
    const arch = enrichment.dimensions.find((d) => d.dimension === 'architecture')!;
    expect(arch).toMatchObject({ confidence: 'partial', influence: 'bounded', pointsAfter: 6 });
  });

  it('NOT-MECHANIZABLE white-label and PARTIAL air-gap NEVER lift the score (deny-by-default preserved)', () => {
    const base = baseScoreOf(MIT_INPUTS);
    const { score, enrichment } = enrichScore(MIT_INPUTS, base, okSignals('acme', 'clm'), 'sovereign');
    expect(byDim(score)['white-label']).toBe(0);  // not-mechanizable ⇒ 0, unchanged
    expect(byDim(score)['air-gap']).toBe(0);       // partial ⇒ bounded to ZERO uplift (absence ≠ proof)
    const wl = enrichment.dimensions.find((d) => d.dimension === 'white-label')!;
    const ag = enrichment.dimensions.find((d) => d.dimension === 'air-gap')!;
    expect(wl).toMatchObject({ influence: 'none', pointsBefore: 0, pointsAfter: 0 });
    expect(ag).toMatchObject({ influence: 'none', pointsBefore: 0, pointsAfter: 0 });
  });

  it('a found cloud blocker (air-gap "no") is surfaced as evidence but STILL never lifts the score', () => {
    const base = baseScoreOf(MIT_INPUTS);
    const { score } = enrichScore(MIT_INPUTS, base, okSignals('acme', 'clm', { airGap: ['no', 'partial'] }), 'sovereign');
    expect(byDim(score)['air-gap']).toBe(0);       // negative evidence never becomes a positive score
  });

  it('the enriched candidate CANNOT reach FORK: the signals scout never measures air-gap ⇒ EXTEND at most', () => {
    // RECALIBRATION: the invariant "no machine auto-FORK" now holds via the FLOOR, not by capping the band. The
    // enriched normalized score is HIGH (90.8, strong), but FORK requires air-gap MEASURED — the signals scout
    // never sources it — so decideSourcing yields EXTEND, never FORK.
    const base = baseScoreOf(MIT_INPUTS);
    const { score } = enrichScore(MIT_INPUTS, base, okSignals('acme', 'clm', { maint: ['clean', 'measured'], arch: ['good', 'measured'] }), 'sovereign');
    expect(score.total).toBe(90.8);                                                   // 59/65×100 (see above)
    expect(score.subScores.find((s) => s.dimension === 'air-gap')!.measured).toBe(false); // scout never measures air-gap
    const decision = decideSourcing([gcWith(score)], 'sovereign').decision;
    expect(decision).toBe('EXTEND'); // ≥3 measured (4) + ≥55, no air-gap ⇒ EXTEND
    expect(decision).not.toBe('FORK');
  });

  it('signals FAILED_CLOSED ⇒ graded exactly as today (base score verbatim, no fabrication)', () => {
    const base = baseScoreOf(MIT_INPUTS);
    const { score, enrichment } = enrichScore(MIT_INPUTS, base, failClosedSignals('acme', 'clm'), 'sovereign');
    expect(score).toBe(base);
    expect(enrichment.applied).toBe(false);
    expect(enrichment.status).toBe('FAILED_CLOSED');
    expect(enrichment.reason).toMatch(/GITHUB_TOKEN/);
  });
});

describe('Harvest Orchestrator — full run() WITH signals port (enrichment sharpens, honestly)', () => {
  const subs = decomposeLegalContractOps();
  const mit = () => [mkCandidate({ owner: 'acme', name: 'clm', licenseText: MIT_TEXT, verified: true, hint: 'MIT', fromText: 'MIT', stars: 4200, activelyMaintained: true })];
  const scoutByQuery: Record<string, ScoutResult> = {};
  for (const s of subs) scoutByQuery[s.query] = ok(s.query, mit());

  it('MEASURED signals promote contract-lifecycle NEEDS-ASSESSMENT → EXTEND (confidence crosses the floor), traced', async () => {
    const signals = fakeSignals({ 'acme/clm': okSignals('acme', 'clm') });
    const orch = new HarvestOrchestrator(fakeScout(scoutByQuery), { now: FIXED_NOW, signalsPort: signals });
    const res = await orch.run('Legal & Contract Operations', 'sovereign');
    const clm = res.report!.subDomains.find((r) => r.subDomain.key === 'contract-lifecycle')!;
    // DECISION PRESERVED (still EXTEND) but via a NEW mechanism: enrichment raises measuredCount 2→4 across the
    // floor of 3 (air-gap still unmeasured ⇒ EXTEND, never FORK). The score itself is 90.8 (see enrichScore tests),
    // so band is 'strong', not 'risky' — the OLD additive 59/'risky' is gone.
    expect(clm.decision).toBe('EXTEND');                       // was NEEDS-ASSESSMENT without signals
    expect(clm.spine!.score.band).toBe('strong');              // 90.8 normalized (was 'risky' under the old additive 59)
    expect(clm.spine!.score.measuredCount).toBe(4);
    expect(clm.spine!.enrichment.applied).toBe(true);
    expect(clm.spine!.enrichment.bandBefore).toBe('strong');   // base 95 (license+maturity only) already bands strong
    expect(clm.spine!.enrichment.bandAfter).toBe('strong');    // enrichment does not move the band; it moves confidence
    // the decision evidence attributes the change to the exact measured signals, and flags air-gap still-needs-human
    expect(clm.decisionEvidence.join(' ')).toMatch(/enrichment refined score 95→90\.8/);
    expect(clm.decisionEvidence.join(' ')).toMatch(/maintainability=clean \(measured/);
    expect(clm.decisionEvidence.join(' ')).toMatch(/air-gap UNMEASURED/);
    // report renders the confidence-gated column
    expect(res.reportMarkdown!).toContain('Signals (confidence-gated)');
    expect(res.reportMarkdown!).toMatch(/maintainability=clean\(meas/);
  });

  it('WITHOUT a signals port the SAME scout data yields NEEDS-ASSESSMENT (proves the change is signal-driven)', async () => {
    const orch = new HarvestOrchestrator(fakeScout(scoutByQuery), { now: FIXED_NOW }); // no signalsPort
    const res = await orch.run('Legal & Contract Operations', 'sovereign');
    const clm = res.report!.subDomains.find((r) => r.subDomain.key === 'contract-lifecycle')!;
    expect(clm.decision).toBe('NEEDS-ASSESSMENT');
    expect(clm.spine!.enrichment.applied).toBe(false);
  });

  it('signals that FAIL CLOSED for a candidate ⇒ graded exactly as today (NEEDS-ASSESSMENT, no crash)', async () => {
    const signals = fakeSignals({}); // every repo ⇒ fail-closed
    const orch = new HarvestOrchestrator(fakeScout(scoutByQuery), { now: FIXED_NOW, signalsPort: signals });
    const res = await orch.run('Legal & Contract Operations', 'sovereign');
    expect(res.status).toBe('OK');
    const clm = res.report!.subDomains.find((r) => r.subDomain.key === 'contract-lifecycle')!;
    expect(clm.decision).toBe('NEEDS-ASSESSMENT');
    expect(clm.spine!.enrichment.applied).toBe(false);
    expect(clm.spine!.enrichment.status).toBe('FAILED_CLOSED');
  });

  it('a THROWING signals port never crashes the chain and never fabricates (graded as today)', async () => {
    const signals = fakeSignals({ 'acme/clm': okSignals('acme', 'clm') }, { throwFor: 'acme/clm' });
    const orch = new HarvestOrchestrator(fakeScout(scoutByQuery), { now: FIXED_NOW, signalsPort: signals });
    const res = await orch.run('Legal & Contract Operations', 'sovereign');
    expect(res.status).toBe('OK');
    const clm = res.report!.subDomains.find((r) => r.subDomain.key === 'contract-lifecycle')!;
    expect(clm.decision).toBe('NEEDS-ASSESSMENT');
    expect(clm.spine!.enrichment.applied).toBe(false); // throw ⇒ null ⇒ deny-by-default
  });

  it('PARTIAL architecture (bounded at dim level) still normalizes to EXTEND — air-gap flagged for a human', async () => {
    // VERDICT CHANGE (NEEDS-ASSESSMENT → EXTEND) under the split floor. Rationale: the arch signal is still BOUNDED
    // at the dim level (6, not 11), but measured = license 20 + maturity 18 + maint 7 + arch 6 = 51 pts / 65 max
    // ×100 = 78.5 (≥55) with 4 dims measured ⇒ EXTEND. The old NEEDS-ASSESSMENT was an artifact of the additive
    // cap (51 < 55); the honest normalized score is 78.5. Air-gap unmeasured ⇒ EXTEND (never FORK), flagged.
    const signals = fakeSignals({ 'acme/clm': okSignals('acme', 'clm', { arch: ['good', 'partial'], maint: ['maintainable', 'measured'] }) });
    const orch = new HarvestOrchestrator(fakeScout(scoutByQuery), { now: FIXED_NOW, signalsPort: signals });
    const res = await orch.run('Legal & Contract Operations', 'sovereign');
    const clm = res.report!.subDomains.find((r) => r.subDomain.key === 'contract-lifecycle')!;
    expect(clm.spine!.score.total).toBe(78.5);       // 51/65×100 — bounded partial arch (6) + measured maint (7)
    expect(clm.decision).toBe('EXTEND');
    expect(clm.decisionEvidence.join(' ')).toMatch(/air-gap UNMEASURED/); // FORK still needs a human air-gap assessment
  });
});
