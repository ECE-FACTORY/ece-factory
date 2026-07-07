// Unit tests for the Harvest Orchestrator — NO NETWORK, NO TOKEN. The scout is injected as a fake port
// returning canned data; the GRADERS are the REAL engines (repo-intelligence, license-compliance,
// scoring-engine, sovereign-readiness). A green run proves the chain assembles and decides correctly on
// real grader output, and fails closed without fabricating — all without touching GitHub.

import { describe, it, expect } from 'vitest';
import {
  HarvestOrchestrator, decompose, decomposeLegalContractOps, decideSourcing, reviewLicense, reviewAirGap,
} from './harvest-orchestrator.js';
import type { ScoutPort, GradedCandidate } from './harvest-orchestrator.js';
import type { ScoutResult, ScoutedCandidate } from '../repo-scout/repo-scout.js';
import type { RepoEvaluationRecord, LicenseDecision } from '../repo-intelligence/repo-intelligence.js';
import type { ScoreResult, ScoreBand } from '../scoring-engine/scoring-engine.js';

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
  return { repoUrl: 'u', identity: record.identity, record, score: score(p.total, p.band, p.unassessedFlagged ?? true), licenseOneLine: 'MIT License', licenseVerified: true, licenseDisagreement: false, rawLicenseText: MIT_TEXT, notes: [] };
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
