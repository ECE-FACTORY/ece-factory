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

// synthetic graded candidates to exercise EVERY branch of the decision mapping directly
function score(total: number, band: ScoreBand, unassessedFlagged = true): ScoreResult {
  const dim = (dimension: string, flagged: boolean) => ({ dimension, score: 0, max: 20, evidence: 'x', flagged });
  return {
    subScores: [dim('license', false), dim('maturity', false), dim('air-gap', unassessedFlagged), dim('white-label', unassessedFlagged), dim('arch-fit', unassessedFlagged), dim('maintainability', unassessedFlagged)],
    total, band, rejected: band === 'reject' && total < 20, flags: [],
  };
}
function gc(p: { owner?: string; name?: string; eligibility: RepoEvaluationRecord['eligibility']; licenseDecision: LicenseDecision; total: number; band: ScoreBand; stars?: number; unassessedFlagged?: boolean }): GradedCandidate {
  const record = {
    evaluatedAtIso: '2026-07-07T00:00:00.000Z', identity: { host: 'github.com', owner: p.owner ?? 'o', name: p.name ?? 'n' },
    licenseDetected: 'MIT', licenseDecision: p.licenseDecision, eligibility: p.eligibility, provenanceVerified: true,
    maturity: { stars: p.stars ?? 100 }, airGapSuitability: 'unknown', whiteLabelFit: 'unknown', architectureFitNotes: null,
    priorVerdict: null, readme: null, description: null, status: 'recorded',
  } as RepoEvaluationRecord;
  const sc = score(p.total, p.band, p.unassessedFlagged ?? true);
  return {
    repoUrl: 'u', identity: record.identity, record, score: sc, licenseOneLine: 'MIT License', licenseVerified: true, licenseDisagreement: false, rawLicenseText: MIT_TEXT, notes: [],
    // default: no signals gathered ⇒ graded exactly as a license+maturity-only pass (applied:false).
    enrichment: { applied: false, status: 'NONE', totalBefore: p.total, totalAfter: p.total, bandBefore: p.band, bandAfter: p.band, dimensions: [] },
  };
}

describe('Harvest Orchestrator — decideSourcing mapping (from REAL score bands)', () => {
  it('no candidates ⇒ BUILD', () => {
    expect(decideSourcing([]).decision).toBe('BUILD');
  });
  it('all REJECT / none eligible ⇒ BUILD (genuine absence of a permissive repo)', () => {
    expect(decideSourcing([gc({ eligibility: 'not-eligible', licenseDecision: 'REJECT', total: 0, band: 'reject' })]).decision).toBe('BUILD');
  });
  it('eligible spine, band acceptable (≥70) ⇒ FORK', () => {
    expect(decideSourcing([gc({ eligibility: 'eligible', licenseDecision: 'ACCEPT', total: 72, band: 'acceptable' })]).decision).toBe('FORK');
  });
  it('eligible spine, band risky (55–69) ⇒ EXTEND', () => {
    expect(decideSourcing([gc({ eligibility: 'eligible', licenseDecision: 'ACCEPT', total: 60, band: 'risky' })]).decision).toBe('EXTEND');
  });
  it('eligible permissive spine, low band ONLY due to unassessed dims ⇒ NEEDS-ASSESSMENT (not a false BUILD)', () => {
    const r = decideSourcing([gc({ eligibility: 'eligible', licenseDecision: 'ACCEPT', total: 38, band: 'reject', unassessedFlagged: true })]);
    expect(r.decision).toBe('NEEDS-ASSESSMENT');
    expect(r.evidence.join(' ')).toMatch(/reuse-beats-rebuild|deny-by-default/);
  });
  it('candidates exist but NEEDS_REVIEW / unverified (none eligible, some permissive) ⇒ NEEDS-ASSESSMENT', () => {
    expect(decideSourcing([gc({ eligibility: 'needs-review', licenseDecision: 'NEEDS_REVIEW', total: 10, band: 'reject' })]).decision).toBe('NEEDS-ASSESSMENT');
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
    const res = await orch.run('Legal & Contract Operations');

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
    const res = await orch.run('Legal & Contract Operations');
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
    const res = await orch.run('Legal & Contract Operations');
    const dec = Object.fromEntries(res.report!.subDomains.map((r) => [r.subDomain.key, r.decision]));
    expect(dec['contract-lifecycle']).toBe('NEEDS-ASSESSMENT'); // permissive+maintained but unassessed dims
    expect(dec['e-signature']).toBe('BUILD');                   // BSL only ⇒ no permissive repo
    expect(dec['clause-template-library']).toBe('BUILD');       // no candidates
  });

  it('reviewer re-derivation AGREES with the assembler on the honest MIT/air-gap facts', async () => {
    const orch = new HarvestOrchestrator(fakeScout(byQuery), { now: FIXED_NOW });
    const res = await orch.run('Legal & Contract Operations');
    const clmFinding = res.report!.reviewer.find((f) => f.repoUrl.includes('acme/clm'))!;
    expect(clmFinding.licenseAgrees).toBe(true);   // both derive ACCEPT (MIT) from the raw file
    expect(clmFinding.airGapAgrees).toBe(true);    // both 'unknown' — no over-claim
  });

  it('the sovereign engine really ran (empty descriptor ⇒ deny-by-default Acceptable-after-hardening)', async () => {
    const orch = new HarvestOrchestrator(fakeScout(byQuery), { now: FIXED_NOW });
    const res = await orch.run('Legal & Contract Operations');
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
    const res = await orch.run('Legal & Contract Operations');

    expect(res.status).toBe('FAILED_CLOSED');
    expect(res.report).toBeNull();
    expect(res.reportMarkdown).toBeNull();
    expect(res.reason).toMatch(/failed closed/i);
    expect(res.reason).toMatch(/GITHUB_TOKEN/);
  });

  it('an unknown domain ⇒ fail closed with no report (never fabricates sub-domains)', async () => {
    const orch = new HarvestOrchestrator(fakeScout({}), { now: FIXED_NOW });
    const res = await orch.run('Underwater Basket Weaving');
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
const baseScoreOf = (i: ScoringInputs): ScoreResult => scoreCandidate(candidateFromScoringInputs(i));

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
    const { score, enrichment } = enrichScore(MIT_INPUTS, base, null);
    expect(score).toBe(base);                 // same object — nothing recomputed
    expect(enrichment.applied).toBe(false);
    expect(enrichment.status).toBe('NONE');
    expect(enrichment.bandBefore).toBe(enrichment.bandAfter);
  });

  it('MEASURED good maintainability + architecture SHARPEN the band (reject→risky) at full weight', () => {
    const base = baseScoreOf(MIT_INPUTS);
    expect(base.total).toBe(38); expect(base.band).toBe('reject');
    const { score, enrichment } = enrichScore(MIT_INPUTS, base, okSignals('acme', 'clm')); // clean + good, both measured
    expect(byDim(score)['maintainability']).toBe(10); // 'clean' at full weight
    expect(byDim(score)['arch-fit']).toBe(11);        // 'good' at full weight
    expect(score.total).toBe(59);                      // 38 + 10 + 11
    expect(score.band).toBe('risky');                  // reject → risky = SHARPENED
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
    const { score, enrichment } = enrichScore(MIT_INPUTS, base, okSignals('acme', 'clm', { arch: ['good', 'partial'], maint: ['maintainable', 'measured'] }));
    expect(byDim(score)['arch-fit']).toBe(6);   // bounded — NOT 11
    expect(byDim(score)['maintainability']).toBe(7);
    expect(score.total).toBe(51);                // 38 + 7 + 6 — still < 55
    expect(score.band).toBe('reject');           // bounded partial did NOT over-promote it
    const arch = enrichment.dimensions.find((d) => d.dimension === 'architecture')!;
    expect(arch).toMatchObject({ confidence: 'partial', influence: 'bounded', pointsAfter: 6 });
  });

  it('NOT-MECHANIZABLE white-label and PARTIAL air-gap NEVER lift the score (deny-by-default preserved)', () => {
    const base = baseScoreOf(MIT_INPUTS);
    const { score, enrichment } = enrichScore(MIT_INPUTS, base, okSignals('acme', 'clm'));
    expect(byDim(score)['white-label']).toBe(0);  // not-mechanizable ⇒ 0, unchanged
    expect(byDim(score)['air-gap']).toBe(0);       // partial ⇒ bounded to ZERO uplift (absence ≠ proof)
    const wl = enrichment.dimensions.find((d) => d.dimension === 'white-label')!;
    const ag = enrichment.dimensions.find((d) => d.dimension === 'air-gap')!;
    expect(wl).toMatchObject({ influence: 'none', pointsBefore: 0, pointsAfter: 0 });
    expect(ag).toMatchObject({ influence: 'none', pointsBefore: 0, pointsAfter: 0 });
  });

  it('a found cloud blocker (air-gap "no") is surfaced as evidence but STILL never lifts the score', () => {
    const base = baseScoreOf(MIT_INPUTS);
    const { score } = enrichScore(MIT_INPUTS, base, okSignals('acme', 'clm', { airGap: ['no', 'partial'] }));
    expect(byDim(score)['air-gap']).toBe(0);       // negative evidence never becomes a positive score
  });

  it('the enriched score CANNOT reach FORK: air-gap + white-label deny-by-default cap it at "risky" (≤59)', () => {
    const base = baseScoreOf(MIT_INPUTS);
    // Best possible measured signals AND a permissive air-gap partial: still cannot cross 70 (acceptable/FORK).
    const { score } = enrichScore(MIT_INPUTS, base, okSignals('acme', 'clm', { maint: ['clean', 'measured'], arch: ['good', 'measured'] }));
    expect(score.total).toBeLessThanOrEqual(59);
    expect(['reject', 'risky']).toContain(score.band);
    expect(score.band).not.toBe('acceptable');
    expect(score.band).not.toBe('strong');
  });

  it('signals FAILED_CLOSED ⇒ graded exactly as today (base score verbatim, no fabrication)', () => {
    const base = baseScoreOf(MIT_INPUTS);
    const { score, enrichment } = enrichScore(MIT_INPUTS, base, failClosedSignals('acme', 'clm'));
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

  it('MEASURED signals sharpen contract-lifecycle NEEDS-ASSESSMENT → EXTEND, traced to the signal evidence', async () => {
    const signals = fakeSignals({ 'acme/clm': okSignals('acme', 'clm') });
    const orch = new HarvestOrchestrator(fakeScout(scoutByQuery), { now: FIXED_NOW, signalsPort: signals });
    const res = await orch.run('Legal & Contract Operations');
    const clm = res.report!.subDomains.find((r) => r.subDomain.key === 'contract-lifecycle')!;
    expect(clm.decision).toBe('EXTEND');                       // was NEEDS-ASSESSMENT without signals
    expect(clm.spine!.score.band).toBe('risky');
    expect(clm.spine!.enrichment.applied).toBe(true);
    expect(clm.spine!.enrichment.bandBefore).toBe('reject');
    expect(clm.spine!.enrichment.bandAfter).toBe('risky');
    // the decision evidence attributes the change to the exact measured signals
    expect(clm.decisionEvidence.join(' ')).toMatch(/enrichment sharpened band reject→risky/);
    expect(clm.decisionEvidence.join(' ')).toMatch(/maintainability=clean \(measured/);
    // report renders the confidence-gated column
    expect(res.reportMarkdown!).toContain('Signals (confidence-gated)');
    expect(res.reportMarkdown!).toMatch(/maintainability=clean\(meas/);
  });

  it('WITHOUT a signals port the SAME scout data yields NEEDS-ASSESSMENT (proves the change is signal-driven)', async () => {
    const orch = new HarvestOrchestrator(fakeScout(scoutByQuery), { now: FIXED_NOW }); // no signalsPort
    const res = await orch.run('Legal & Contract Operations');
    const clm = res.report!.subDomains.find((r) => r.subDomain.key === 'contract-lifecycle')!;
    expect(clm.decision).toBe('NEEDS-ASSESSMENT');
    expect(clm.spine!.enrichment.applied).toBe(false);
  });

  it('signals that FAIL CLOSED for a candidate ⇒ graded exactly as today (NEEDS-ASSESSMENT, no crash)', async () => {
    const signals = fakeSignals({}); // every repo ⇒ fail-closed
    const orch = new HarvestOrchestrator(fakeScout(scoutByQuery), { now: FIXED_NOW, signalsPort: signals });
    const res = await orch.run('Legal & Contract Operations');
    expect(res.status).toBe('OK');
    const clm = res.report!.subDomains.find((r) => r.subDomain.key === 'contract-lifecycle')!;
    expect(clm.decision).toBe('NEEDS-ASSESSMENT');
    expect(clm.spine!.enrichment.applied).toBe(false);
    expect(clm.spine!.enrichment.status).toBe('FAILED_CLOSED');
  });

  it('a THROWING signals port never crashes the chain and never fabricates (graded as today)', async () => {
    const signals = fakeSignals({ 'acme/clm': okSignals('acme', 'clm') }, { throwFor: 'acme/clm' });
    const orch = new HarvestOrchestrator(fakeScout(scoutByQuery), { now: FIXED_NOW, signalsPort: signals });
    const res = await orch.run('Legal & Contract Operations');
    expect(res.status).toBe('OK');
    const clm = res.report!.subDomains.find((r) => r.subDomain.key === 'contract-lifecycle')!;
    expect(clm.decision).toBe('NEEDS-ASSESSMENT');
    expect(clm.spine!.enrichment.applied).toBe(false); // throw ⇒ null ⇒ deny-by-default
  });

  it('PARTIAL-only architecture keeps contract-lifecycle at NEEDS-ASSESSMENT (weak/bounded, no over-promotion)', async () => {
    const signals = fakeSignals({ 'acme/clm': okSignals('acme', 'clm', { arch: ['good', 'partial'], maint: ['maintainable', 'measured'] }) });
    const orch = new HarvestOrchestrator(fakeScout(scoutByQuery), { now: FIXED_NOW, signalsPort: signals });
    const res = await orch.run('Legal & Contract Operations');
    const clm = res.report!.subDomains.find((r) => r.subDomain.key === 'contract-lifecycle')!;
    expect(clm.spine!.score.total).toBe(51);         // bounded partial arch (6) + measured maint (7)
    expect(clm.decision).toBe('NEEDS-ASSESSMENT');    // still short of risky ⇒ human assessment still required
  });
});
