// GOLDEN tests for the harvest-report parser — asserted against the REAL committed reports (Design §3.2).
// Written BEFORE the parser (golden-first). The five EXTEND verdicts must parse out EXACTLY; the parser reads the
// stated score and NEVER recomputes; a stated total that contradicts its own row is FLAGGED, not reconciled.

import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { parseHarvestReport, parseHarvestReportFile } from './report-parser.js';

const DOCS = join(__dirname, '..', '..', '..', 'docs');
const iam = parseHarvestReportFile(join(DOCS, 'HARVEST_REPORT_IAM.md'));
const hr = parseHarvestReportFile(join(DOCS, 'HARVEST_REPORT_HR_PAYROLL.md'));
const legal = parseHarvestReportFile(join(DOCS, 'HARVEST_REPORT_LEGAL_CONTRACT_OPS.md'));

const byTitle = (r: typeof iam, sub: string) => r.subDomains.find((s) => s.title.includes(sub))!;

describe('report parser — golden round-trip of the committed reports', () => {
  it('reports carry provenance basics + default productMode sovereign (pre-Stage-2 files)', () => {
    expect(iam.productMode).toBe('sovereign');
    expect(iam.contentSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(iam.status).toBe('STOP-AWAITING-HUMAN-APPROVAL');
    expect(iam.parseIssues.join(' ')).toMatch(/productMode absent in file/); // honest note, not silent
  });

  it('IAM RBAC/ABAC ⇒ EXTEND, spine react-access-engine 78.5 acceptable (exact)', () => {
    const s = byTitle(iam, 'RBAC/ABAC');
    expect(s.decision).toBe('EXTEND');
    expect(s.spine!.identity).toMatchObject({ owner: 'abhishekayu', name: 'react-access-engine' });
    expect(s.spine!.score).toEqual({ total: 78.5, band: 'acceptable' });
    expect(s.spine!.license).toMatchObject({ detected: 'MIT', decision: 'ACCEPT', disagreement: false });
  });

  it('IAM OAuth2/OIDC ⇒ EXTEND, spine tokn 70.8', () => {
    const s = byTitle(iam, 'OAuth2');
    expect(s.decision).toBe('EXTEND');
    expect(s.spine!.identity).toMatchObject({ owner: 'JohnBasrai', name: 'tokn' });
    expect(s.spine!.score.total).toBe(70.8);
  });

  it('HR Time/Attendance ⇒ redmine_leaves 70.8; ATS ⇒ OpenATS 75.4; Onboarding ⇒ dutyduke 70.8 (all EXTEND)', () => {
    const ta = byTitle(hr, 'Time, Attendance'); expect(ta.decision).toBe('EXTEND'); expect(ta.spine!.identity.name).toBe('redmine_leaves'); expect(ta.spine!.score.total).toBe(70.8);
    const ats = byTitle(hr, 'Recruitment'); expect(ats.decision).toBe('EXTEND'); expect(ats.spine!.identity.name).toBe('OpenATS'); expect(ats.spine!.score.total).toBe(75.4);
    const onb = byTitle(hr, 'Onboarding'); expect(onb.decision).toBe('EXTEND'); expect(onb.spine!.identity.name).toBe('dutyduke'); expect(onb.spine!.score.total).toBe(70.8);
  });

  it('facts / measured / judgment / unknown / human-required buckets are separated (by per-dim confidence)', () => {
    // react-access-engine spine: maintainability=meas · architecture=meas · air-gap=part · white-label=n/m.
    const s = byTitle(iam, 'RBAC/ABAC');
    expect(s.buckets.measured.map((d) => d.dimension)).toEqual(expect.arrayContaining(['maintainability', 'architecture']));
    expect(s.buckets.judgments.map((d) => d.dimension)).toEqual(['air-gap']);        // partial signal (bounded)
    expect(s.buckets.judgments.every((d) => d.confidence === 'partial')).toBe(true);
    expect(s.buckets.unknowns.map((d) => d.dimension)).toEqual(['white-label']);      // not-mechanizable
    expect(s.buckets.humanRequired.join(' ')).toMatch(/air-gap is UNMEASURED/);
    expect(s.buckets.facts.join(' ')).toMatch(/license/i);
    // The DECISION-level unmeasured set is separate from per-dim confidence — BOTH air-gap & white-label here.
    expect(s.unmeasured).toEqual(expect.arrayContaining(['air-gap', 'white-label']));
  });

  it('non-EXTEND verdicts parse: NEEDS-ASSESSMENT (spine, weak) and BUILD (no spine)', () => {
    const ssoo = byTitle(iam, 'Authentication & SSO'); expect(ssoo.decision).toBe('NEEDS-ASSESSMENT'); expect(ssoo.spine!.score.total).toBe(47.7);
    const ium = byTitle(iam, 'Identity & User Management'); expect(ium.decision).toBe('BUILD'); expect(ium.spine).toBeNull();
  });

  it('the license ⚠︎hint≠file disagreement marker is parsed as a fact', () => {
    const sso = byTitle(iam, 'Authentication & SSO');
    const blast = sso.candidates.find((c) => c.identity.name === 'blast-ON')!;
    expect(blast.license).toMatchObject({ detected: 'MIT', disagreement: true }); // "MIT ⚠︎hint≠file"
  });

  it('all three committed reports parse without loss (5 sub-domains each)', () => {
    for (const r of [iam, hr, legal]) expect(r.subDomains.length).toBe(5);
  });
});

describe('report parser — reads stated scores, never recomputes; flags inconsistency', () => {
  it('a stated spine total that contradicts its own candidate row is FLAGGED, not reconciled', () => {
    const md = [
      '# Harvest Report — Synthetic',
      '**Status:** STOP-AWAITING-HUMAN-APPROVAL · **Generated:** 2026-07-09T00:00:00.000Z',
      '',
      '### Test Sub  —  decision: **EXTEND**',
      '',
      '_Query:_ `q`',
      '',
      '- spine: acme/widget — real score 99.9/100, band "strong" (4/6 dims measured, coverage 65%)', // stated 99.9
      '- unmeasured at decision: air-gap, white-label',
      '',
      '| Repo | License | Decision | Eligibility | Score | Band | Signals |',
      '|---|---|---|---|---|---|---|',
      '| [acme/widget](https://github.com/acme/widget) | MIT · "MIT License" | ACCEPT | eligible | 70.8/100 | acceptable | maintainability=clean(meas,+10) |', // row says 70.8
    ].join('\n');
    const r = parseHarvestReport(md, 'synthetic.md', 'deadbeef'.repeat(8));
    const s = r.subDomains[0]!;
    expect(s.spine!.score.total).toBe(70.8); // the candidate-row value (the real graded number), read not computed
    expect(r.parseIssues.join(' ')).toMatch(/inconsisten/i); // 99.9 (spine line) vs 70.8 (row) surfaced
  });
});
