// Harvest Orchestrator (Layer 3) — runs ONE governed, READ-ONLY harvest pass for a named domain and
// assembles a Harvest Report for human review. It ORCHESTRATES existing proven pieces; it reimplements
// NONE of them, wires to NO write/external path, and takes NO external action. It STOPS at the human gate.
//
// THE CHAIN (read-and-assemble only):
//   1. DECOMPOSE the domain into sub-domains (inert domain knowledge — not fetched data).
//   2. SCOUT each sub-domain via the injected repo-scout PORT (live GitHub reads live in repo-scout only;
//      raw-LICENSE verification; fail-closed on missing token/network — never fabricates).
//   3. GRADE each candidate through the REAL engines, by their real entry points:
//        • RepoIntelligenceEngine.evaluate            — repo-intelligence.ts:109
//        • classifyLicense (via the LicenseClassifier) — license-compliance.ts:92
//        • scoreCandidate / candidateFromScoringInputs — scoring-engine.ts:131 / :51
//        • assessSovereignReadiness                    — sovereign-readiness.ts:77
//   4. DECIDE fork / extend / build / needs-assessment per sub-domain FROM THE REAL SCORES.
//   5. ASSEMBLE the Harvest Report (decomposition, spine + supporting, license evidence, sovereign/air-gap,
//      custom-code boundary/moat, adversarial red-team, market position).
//   6. REVIEWER RE-DERIVATION: independently re-derive license + air-gap from the scouted evidence (NOT the
//      assembler's summary) and record agreement/disagreement.
//   7. STOP — status is the single literal 'STOP-AWAITING-HUMAN-APPROVAL'. The orchestrator produces a
//      report string; WRITING it to docs/ and any approval are outside this module (the human gate).
//
// FAIL-CLOSED: if any sub-domain scout fails closed (no token / unreachable network), the whole run fails
// closed with an honest reason and NO report — never a fabricated one.
//
// READ-ONLY / STANDALONE: every cross-engine reference is the real read/grader engine in Layer 3; NOTHING
// from the action layer is imported. Frozen read-only by src/architecture/write-asks-read-first.test.ts.

import type { ScoutQuery, ScoutResult, ScoutedCandidate } from '../repo-scout/repo-scout.js';
import { RepoIntelligenceEngine, scoringInputs } from '../repo-intelligence/repo-intelligence.js';
import type { RepoEvaluationRecord, RepoIdentity, LicenseClassifier, LicenseDecision } from '../repo-intelligence/repo-intelligence.js';
import { classifyLicense, detectFromText } from '../license-compliance/license-compliance.js';
import { scoreCandidate, candidateFromScoringInputs } from '../scoring-engine/scoring-engine.js';
import type { ScoreResult } from '../scoring-engine/scoring-engine.js';
import { assessSovereignReadiness } from '../sovereign-readiness/sovereign-readiness.js';
import type { SovereignDescriptor, SovereignReport } from '../sovereign-readiness/sovereign-readiness.js';

// ── Public shapes ────────────────────────────────────────────────────────────────────────────────────

export interface SubDomain { key: string; title: string; query: string }

/** The injected scout PORT — exactly the committed repo-scout's surface (network lives there, not here). */
export interface ScoutPort { scout(q: ScoutQuery): Promise<ScoutResult> }

export interface OrchestratorOptions { now?: () => number; maxPerSubDomain?: number }

export type SourcingDecision = 'FORK' | 'EXTEND' | 'BUILD' | 'NEEDS-ASSESSMENT';

/** A candidate after passing through the real graders. */
export interface GradedCandidate {
  repoUrl: string;
  identity: RepoIdentity;
  record: RepoEvaluationRecord;   // RepoIntelligenceEngine.evaluate output (repo-intelligence.ts:109)
  score: ScoreResult;             // scoreCandidate output (scoring-engine.ts:131)
  licenseOneLine: string;         // ≤1 short line quoted from the REAL LICENSE file
  licenseVerified: boolean;
  licenseDisagreement: boolean;   // API hint vs raw text (raw won)
  rawLicenseText: string | null;  // kept for the independent reviewer pass; NOT rendered in full
  notes: string[];
}

export interface SubDomainResult {
  subDomain: SubDomain;
  candidates: GradedCandidate[];
  spine: GradedCandidate | null;
  decision: SourcingDecision;
  decisionEvidence: string[];
}

export interface ReviewerFinding {
  repoUrl: string;
  assemblerLicense: string;   // what the assembler recorded (decision/detected)
  reviewerLicense: string;    // independently re-derived from the RAW license text
  licenseAgrees: boolean;
  assemblerAirGap: string;    // what the record claims
  reviewerAirGap: string;     // what the scouted evidence actually supports
  airGapAgrees: boolean;
}

export interface HarvestReport {
  domain: string;
  generatedAtIso: string;
  subDomains: SubDomainResult[];
  sovereign: SovereignReport;          // real assessSovereignReadiness (empty descriptor ⇒ deny-by-default)
  reviewer: ReviewerFinding[];
  redTeam: string[];
  moat: string[];
  marketPosition: string[];
  limitations: string[];
  status: 'STOP-AWAITING-HUMAN-APPROVAL';
}

export type OrchestratorStatus = 'OK' | 'FAILED_CLOSED';
export interface OrchestratorResult {
  status: OrchestratorStatus;
  report: HarvestReport | null;
  reportMarkdown: string | null;
  reason?: string;
}

// ── Stage 1: decomposition (inert domain knowledge, not fetched data) ──────────────────────────────────

export function decomposeLegalContractOps(): SubDomain[] {
  return [
    { key: 'contract-lifecycle', title: 'Contract Lifecycle Management (CLM)', query: 'contract lifecycle management' },
    { key: 'e-signature', title: 'E-Signature & Approvals', query: 'electronic signature esignature open source' },
    { key: 'clause-template-library', title: 'Clause & Template Library', query: 'contract clause template library' },
    { key: 'document-assembly', title: 'Document Assembly & Generation', query: 'document assembly generation legal' },
    { key: 'obligation-tracking', title: 'Obligation & Deadline Tracking', query: 'contract obligation deadline tracking' },
  ];
}

/** Decompose a domain. Only the mission's domain is implemented; anything else returns []. */
export function decompose(domain: string): SubDomain[] {
  return /legal\s*&?\s*contract/i.test(domain) ? decomposeLegalContractOps() : [];
}

// ── Stage 6 (pure, independently testable): the reviewer's re-derivation ───────────────────────────────

/** Re-derive the license from the RAW text (not the assembler's summary) and compare to the claim. */
export function reviewLicense(rawText: string | null, claimedDetected: string, claimedDecision: LicenseDecision): {
  reviewer: string; agrees: boolean;
} {
  if (!rawText || !rawText.trim()) {
    const agrees = claimedDetected === 'unknown';
    return { reviewer: 'unknown (no LICENSE text)', agrees };
  }
  const detected = detectFromText(rawText);
  const decision = classifyLicense({ text: rawText }).decision;
  const agrees = detected === claimedDetected && decision === claimedDecision;
  return { reviewer: `${decision} (${detected})`, agrees };
}

/** Re-derive air-gap support from the scouted evidence. The scout supplies NO deployment facts, so the only
 *  honest value is 'unknown'; this catches an assembler that claimed more than the evidence supports. */
export function reviewAirGap(claimed: string, hasDeploymentEvidence: boolean): { reviewer: string; agrees: boolean } {
  const reviewer = hasDeploymentEvidence ? claimed : 'unknown';
  return { reviewer, agrees: claimed === reviewer };
}

// ── Stage 4 (pure): decision from the real score ───────────────────────────────────────────────────────

/** Do the four dimensions the scout cannot source dominate the shortfall? (air-gap/white-label/arch/maint) */
function shortfallIsUnassessed(score: ScoreResult): boolean {
  const unassessed = score.subScores.filter((s) => ['air-gap', 'white-label', 'arch-fit', 'maintainability'].includes(s.dimension));
  return unassessed.every((s) => s.flagged); // all deny-by-default ⇒ the low score is "not looked at yet", not "bad"
}

export function decideSourcing(candidates: GradedCandidate[]): { decision: SourcingDecision; evidence: string[] } {
  const evidence: string[] = [];
  if (candidates.length === 0) {
    return { decision: 'BUILD', evidence: ['no candidate repositories discovered for this sub-domain'] };
  }
  const eligible = candidates.filter((c) => c.record.eligibility === 'eligible');
  const anyPermissive = candidates.some((c) => c.record.licenseDecision !== 'REJECT');
  if (eligible.length === 0) {
    if (!anyPermissive) return { decision: 'BUILD', evidence: ['no permissively-licensed repo found (all candidates REJECT/ineligible) — a genuine absence'] };
    return { decision: 'NEEDS-ASSESSMENT', evidence: ['candidates exist but none are yet eligible (license NEEDS_REVIEW / provenance unverified) — human ratification needed'] };
  }
  const spine = pickSpine(eligible);
  evidence.push(`spine: ${spine.identity.owner}/${spine.identity.name} — real score ${spine.score.total}/100, band "${spine.score.band}"`);
  if (spine.score.band === 'strong' || spine.score.band === 'acceptable') {
    return { decision: 'FORK', evidence: [...evidence, 'score ≥ 70 (acceptable/strong) — fork and white-label'] };
  }
  if (spine.score.band === 'risky') {
    return { decision: 'EXTEND', evidence: [...evidence, 'score 55–69 (risky) — fork then build the gap'] };
  }
  // band 'reject' (< 55): distinguish a genuinely weak repo from one merely UN-ASSESSED on 4 dimensions.
  if (spine.record.licenseDecision !== 'REJECT' && shortfallIsUnassessed(spine.score)) {
    return {
      decision: 'NEEDS-ASSESSMENT',
      evidence: [...evidence,
        'low score is driven ENTIRELY by dimensions the scout does not source (air-gap, white-label, arch-fit, maintainability) — deny-by-default, NOT a proven weakness',
        'reuse-beats-rebuild: a permissive, maintained repo must be assessed on those dimensions before any BUILD (Write-Asks-Read-First / §3.9)'],
    };
  }
  return { decision: 'BUILD', evidence: [...evidence, 'spine rejected on assessed evidence (e.g. license) — build justified'] };
}

function pickSpine(eligible: GradedCandidate[]): GradedCandidate {
  return [...eligible].sort((a, b) =>
    b.score.total - a.score.total || (b.record.maturity?.stars ?? 0) - (a.record.maturity?.stars ?? 0))[0]!;
}

// ── The orchestrator ───────────────────────────────────────────────────────────────────────────────────

const DEFAULT_MAX = 6;

export class HarvestOrchestrator {
  private readonly now: () => number;
  private readonly maxPer: number;
  private readonly repoIntel: RepoIntelligenceEngine;

  constructor(private readonly scoutPort: ScoutPort, opts: OrchestratorOptions = {}) {
    this.now = opts.now ?? (() => Date.now());
    this.maxPer = opts.maxPerSubDomain ?? DEFAULT_MAX;
    // The License Engine is consumed via the injected classifier PORT the engine already defines — not reimplemented.
    const licenseClassifier: LicenseClassifier = { classify: (input) => classifyLicense(input) };
    this.repoIntel = new RepoIntelligenceEngine(licenseClassifier, this.now);
  }

  async run(domain = 'Legal & Contract Operations'): Promise<OrchestratorResult> {
    const subDomains = decompose(domain);
    if (subDomains.length === 0) {
      return { status: 'FAILED_CLOSED', report: null, reportMarkdown: null, reason: `no decomposition available for domain "${domain}"` };
    }

    const results: SubDomainResult[] = [];
    for (const sd of subDomains) {
      const scouted = await this.scoutPort.scout({ query: sd.query, maxResults: this.maxPer });
      if (scouted.status === 'FAILED_CLOSED') {
        // Fail-closed: NO report is produced from a broken source (no fabrication).
        return { status: 'FAILED_CLOSED', report: null, reportMarkdown: null, reason: `scout failed closed for "${sd.title}": ${scouted.reason ?? 'unknown'}` };
      }
      const graded = scouted.candidates.map((c) => this.grade(c));
      const { decision, evidence } = decideSourcing(graded);
      results.push({ subDomain: sd, candidates: graded, spine: graded.length ? pickSpineOrNull(graded) : null, decision, decisionEvidence: evidence });
    }

    const report = this.assemble(domain, results);
    return { status: 'OK', report, reportMarkdown: this.renderMarkdown(report) };
  }

  /** Stage 3: run ONE candidate through the real graders. */
  private grade(c: ScoutedCandidate): GradedCandidate {
    const record = this.repoIntel.evaluate(c.evaluationInput);                 // repo-intelligence.ts:109
    const scoringCandidate = candidateFromScoringInputs(scoringInputs(record)); // scoring-engine.ts:51 (+ :90)
    const score = scoreCandidate(scoringCandidate);                            // scoring-engine.ts:131
    return {
      repoUrl: c.repoUrl,
      identity: record.identity,
      record,
      score,
      licenseOneLine: firstLicenseLine(c.evaluationInput.license.text, c.licenseVerified),
      licenseVerified: c.licenseVerified,
      licenseDisagreement: c.licenseDisagreement,
      rawLicenseText: c.evaluationInput.license.text ?? null,
      notes: c.notes,
    };
  }

  /** Stages 5 + 6: assemble the report and run the independent reviewer re-derivation. */
  private assemble(domain: string, results: SubDomainResult[]): HarvestReport {
    // Real sovereign call over an EMPTY descriptor — the scout sources no deployment facts, so this is the
    // honest deny-by-default verdict (Acceptable-after-hardening), never a fabricated "Acceptable".
    const emptyDescriptor: SovereignDescriptor = {};
    const sovereign = assessSovereignReadiness(emptyDescriptor);              // sovereign-readiness.ts:77

    const reviewer: ReviewerFinding[] = [];
    for (const r of results) {
      const target = r.spine ?? r.candidates[0];
      if (!target) continue;
      const lic = reviewLicense(target.rawLicenseText, target.record.licenseDetected, target.record.licenseDecision);
      const air = reviewAirGap(target.record.airGapSuitability, /* scout supplies no deployment evidence */ false);
      reviewer.push({
        repoUrl: target.repoUrl,
        assemblerLicense: `${target.record.licenseDecision} (${target.record.licenseDetected})`,
        reviewerLicense: lic.reviewer,
        licenseAgrees: lic.agrees,
        assemblerAirGap: target.record.airGapSuitability,
        reviewerAirGap: air.reviewer,
        airGapAgrees: air.agrees,
      });
    }

    return {
      domain,
      generatedAtIso: new Date(this.now()).toISOString(),
      subDomains: results,
      sovereign,
      reviewer,
      redTeam: [
        'Scores are structurally capped: the scout sources only license + maturity. Air-gap, white-label, architecture-fit and maintainability are deny-by-default (0), so even excellent repos band as "reject". Any BUILD read from the raw band would be an artifact of missing assessment, not proven absence — which is why such cases are reported as NEEDS-ASSESSMENT, not BUILD.',
        'Discovery is single-page, popularity-sorted GitHub search — it can miss the best repo if it is not stars-ranked for the exact query string.',
        'Sub-domain queries are hand-authored; a poorly chosen query yields weak candidates that are not representative of the field.',
        'License detection is signature-based over the raw file; an unusual or dual-license file lands as NEEDS_REVIEW rather than a confident decision (correctly conservative, but it defers work to a human).',
        'The sovereign verdict is deny-by-default over an empty descriptor — it says nothing positive about any repo; it only proves nothing was verified.',
      ],
      moat: [
        'REUSE (harvest): permissively-licensed spines per sub-domain (CLM, e-sign, clause libraries, document assembly, obligation tracking) — do not rebuild what a proven repo does.',
        'ECE BUILDS (the moat): the unified data model + integration glue across the sub-domains; sovereign/air-gap hardening; Arabic-first adaptation; the white-label brand layer; and any genuinely missing capability confirmed absent after assessment.',
        'The deeper assessment engines the scout does NOT yet provide (air-gap prober, white-label friction analyzer, architecture-fit + maintainability review) are themselves ECE-built factory capability.',
      ],
      marketPosition: [
        'Incumbents are proprietary SaaS CLM suites (foreign-cloud, subscription, non-sovereign).',
        'The sovereign/air-gap + Arabic-first white-label composition is the differentiator nothing local offers off-the-shelf.',
      ],
      limitations: [
        'End-to-end scores reflect ONLY license + maturity evidence. Fork/Extend/Build decisions are provisional until air-gap, white-label, architecture-fit and maintainability are assessed.',
        'This is a READ-ONLY report. No repo was forked, created, or modified; no external action was taken.',
      ],
      status: 'STOP-AWAITING-HUMAN-APPROVAL',
    };
  }

  renderMarkdown(report: HarvestReport): string {
    const L: string[] = [];
    L.push(`# Harvest Report — ${report.domain}`, '');
    L.push(`**Status:** ${report.status} · **Generated:** ${report.generatedAtIso}`, '');
    L.push('> READ-ONLY harvest pass. Scores come from the real graders on scout-sourced evidence. No build, fork, or external action was taken. Awaiting human approval.', '');

    L.push('## 1. Sub-domain decomposition & decisions', '');
    L.push('| Sub-domain | Decision | Spine (score/band) | Candidates |', '|---|---|---|---|');
    for (const r of report.subDomains) {
      const spine = r.spine ? `${r.spine.identity.owner}/${r.spine.identity.name} (${r.spine.score.total}/100, ${r.spine.score.band})` : '—';
      L.push(`| ${r.subDomain.title} | **${r.decision}** | ${spine} | ${r.candidates.length} |`);
    }
    L.push('');

    for (const r of report.subDomains) {
      L.push(`### ${r.subDomain.title}  —  decision: **${r.decision}**`, '');
      L.push(`_Query:_ \`${r.subDomain.query}\``, '');
      for (const e of r.decisionEvidence) L.push(`- ${e}`);
      L.push('', '| Repo | License (from real file) | Decision | Eligibility | Score | Band |', '|---|---|---|---|---|---|');
      for (const c of r.candidates) {
        const dis = c.licenseDisagreement ? ' ⚠︎hint≠file' : '';
        L.push(`| [${c.identity.owner}/${c.identity.name}](${c.repoUrl}) | ${c.record.licenseDetected}${dis} · "${c.licenseOneLine}" | ${c.record.licenseDecision} | ${c.record.eligibility} | ${c.score.total}/100 | ${c.score.band} |`);
      }
      L.push('');
    }

    L.push('## 2. Sovereign readiness / air-gap', '');
    L.push(`**Verdict (deny-by-default, empty descriptor):** ${report.sovereign.verdict}`, '');
    L.push('_The scout sources no deployment artifacts, so every sovereign check is UNKNOWN (deny-by-default). This verdict confirms nothing was verified — it is not a positive air-gap claim for any repo._', '');

    L.push('## 3. Reviewer re-derivation (independent — not trusting the assembler)', '');
    L.push('| Repo | Assembler license | Reviewer (from raw file) | Agree? | Assembler air-gap | Reviewer | Agree? |', '|---|---|---|---|---|---|---|');
    for (const f of report.reviewer) {
      L.push(`| ${f.repoUrl} | ${f.assemblerLicense} | ${f.reviewerLicense} | ${f.licenseAgrees ? '✓' : '✗'} | ${f.assemblerAirGap} | ${f.reviewerAirGap} | ${f.airGapAgrees ? '✓' : '✗'} |`);
    }
    L.push('');

    L.push('## 4. Custom-code boundary (reuse vs. ECE builds — the moat)', '');
    for (const m of report.moat) L.push(`- ${m}`);
    L.push('');
    L.push('## 5. Adversarial red-team (where this plan is weakest)', '');
    for (const t of report.redTeam) L.push(`- ${t}`);
    L.push('');
    L.push('## 6. Market position', '');
    for (const m of report.marketPosition) L.push(`- ${m}`);
    L.push('');
    L.push('## 7. Limitations (honest scope)', '');
    for (const x of report.limitations) L.push(`- ${x}`);
    L.push('');
    L.push('---', '', '**STOP — AWAITING HUMAN APPROVAL. No build, fork, or external action taken.**', '');
    return L.join('\n');
  }
}

function pickSpineOrNull(graded: GradedCandidate[]): GradedCandidate | null {
  const eligible = graded.filter((c) => c.record.eligibility === 'eligible');
  return eligible.length ? pickSpine(eligible) : null;
}

/** ≤1 short line quoted from the real LICENSE file (first non-empty line), or an honest unverified marker. */
function firstLicenseLine(text: string | undefined, verified: boolean): string {
  if (!verified || !text) return 'no LICENSE file read — unverified';
  const line = text.split(/\r?\n/).map((s) => s.trim()).find((s) => s.length > 0) ?? '';
  return line.slice(0, 80);
}
