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
//   3b. ENRICH (optional, read-only): if a SignalsScoutPort is injected, gather the four dimensions the base
//       scout cannot source (maintainability / architecture / air-gap / white-label) via repo-scout-signals
//       and RE-GRADE the candidate UNDER THE CONFIDENCE CONTRACT (below). Enrichment can only SHARPEN a band
//       where real fetched evidence justifies it; if no port is injected, or signals fail closed for a
//       candidate, that candidate is graded EXACTLY as before (deny-by-default, no fabrication, no crash).
//   4. DECIDE fork / extend / build / needs-assessment per sub-domain FROM THE (possibly enriched) SCORES.
//
// THE CONFIDENCE CONTRACT (the integrity mechanism — enrichScore() encodes it):
//   • measured        → the dimension is graded at FULL weight by the real scoring engine (MAY raise the band).
//   • partial         → the dimension contributes WEAKLY / BOUNDED: architecture is capped at 'possible'
//                       (6/15, still flagged); AIR-GAP is bounded to ZERO uplift — absence of a cloud dep is
//                       not proof of air-gap safety, and any uplift would erode the sovereign air-gap gate.
//   • not-mechanizable → the dimension stays DENY-BY-DEFAULT (0), byte-identical to an un-enriched grade.
//   Because air-gap + white-label NEVER raise a band from signals, the TOP reachable enriched score is
//   license(20)+maturity(18)+arch(11,'good')+maint(10,'clean') = 59 ⇒ band 'risky'. Enrichment can sharpen
//   NEEDS-ASSESSMENT → EXTEND on real measured evidence, but can NEVER manufacture a FORK — that still needs
//   the human air-gap + white-label judgment. Every point of movement is TRACED in GradedCandidate.enrichment.
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
import type { RepoEvaluationRecord, RepoIdentity, LicenseClassifier, LicenseDecision, ScoringInputs } from '../repo-intelligence/repo-intelligence.js';
import { classifyLicense, detectFromText } from '../license-compliance/license-compliance.js';
import { scoreCandidate, candidateFromScoringInputs } from '../scoring-engine/scoring-engine.js';
import type { ScoreResult, ScoreBand, ArchFitRating, ProductMode } from '../scoring-engine/scoring-engine.js';
export type { ProductMode } from '../scoring-engine/scoring-engine.js';
import { assessSovereignReadiness } from '../sovereign-readiness/sovereign-readiness.js';
import type { SovereignDescriptor, SovereignReport } from '../sovereign-readiness/sovereign-readiness.js';
// TYPE-ONLY: the signals scout's output shapes. All of its network egress lives in repo-scout-signals; this
// module never news it up — it consumes an injected SignalsScoutPort (exactly as it consumes the ScoutPort).
import type { RepoSignals, Confidence } from '../repo-scout-signals/repo-scout-signals.js';

// ── Public shapes ────────────────────────────────────────────────────────────────────────────────────

export interface SubDomain { key: string; title: string; query: string }

/** The injected scout PORT — exactly the committed repo-scout's surface (network lives there, not here). */
export interface ScoutPort { scout(q: ScoutQuery): Promise<ScoutResult> }

/** Minimal repo identity the signals scout needs. The branch is resolved by the adapter (the orchestrator
 *  never sees a token or a branch — it only knows owner/name, exactly as the base graders do). */
export interface SignalsQuery { owner: string; name: string }
/** The injected signals PORT — the read-only repo-scout-signals surface. All of ITS network egress lives in
 *  repo-scout-signals; the orchestrator only assembles its confidence-tagged output. OPTIONAL: absent ⇒ no
 *  enrichment ⇒ every candidate is graded deny-by-default exactly as before. */
export interface SignalsScoutPort { gather(q: SignalsQuery): Promise<RepoSignals> }

export interface OrchestratorOptions { now?: () => number; maxPerSubDomain?: number; signalsPort?: SignalsScoutPort }

// ── Enrichment trace (the audit trail for every confidence-gated verdict movement) ─────────────────────

/** How one dimension's scout-signal influenced the score, under the confidence contract — fully traceable. */
export interface DimensionEnrichment {
  dimension: 'maintainability' | 'architecture' | 'air-gap' | 'white-label' | 'cloud-native' | 'billing-hooks' | 'multi-tenancy';
  confidence: Confidence;
  value: string;
  /** 'raised' — measured evidence lifted the sub-score at full weight; 'bounded' — a partial signal lifted it
   *  weakly within a cap; 'none' — deny-by-default preserved (not-mechanizable, or no positive evidence). */
  influence: 'raised' | 'bounded' | 'none';
  pointsBefore: number; // the un-enriched (deny-by-default) sub-score
  pointsAfter: number;  // the sub-score after the confidence-gated enrichment
  evidence: string[];   // the signal's own evidence — the ONLY basis on which a verdict may move
}

/** The complete before/after audit for one candidate's enrichment. `applied:false` ⇒ graded as before. */
export interface EnrichmentTrace {
  applied: boolean;
  status: 'OK' | 'FAILED_CLOSED' | 'NONE';
  reason?: string;            // set when signals failed closed for this candidate (honest, no fabrication)
  totalBefore: number;
  totalAfter: number;
  bandBefore: ScoreBand;
  bandAfter: ScoreBand;
  dimensions: DimensionEnrichment[];
}

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
  /** The confidence-gated enrichment audit. Present whenever grade() ran; `applied:false` when no signals
   *  were available (no port / fail-closed) ⇒ `score` equals the un-enriched deny-by-default grade. */
  enrichment: EnrichmentTrace;
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
  /** The product lens this report was harvested under — REQUIRED; every report declares its mode. */
  productMode: ProductMode;
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

export function decomposeHrPayroll(): SubDomain[] {
  return [
    { key: 'core-hris', title: 'Core HRIS & Employee Records', query: 'human resources information system hris employee' },
    { key: 'payroll', title: 'Payroll Processing', query: 'payroll processing open source' },
    { key: 'time-attendance-leave', title: 'Time, Attendance & Leave', query: 'time attendance leave management' },
    { key: 'recruitment-ats', title: 'Recruitment & Applicant Tracking (ATS)', query: 'applicant tracking system recruitment ats' },
    { key: 'onboarding-performance', title: 'Onboarding & Performance', query: 'employee onboarding performance management' },
  ];
}

export function decomposeIam(): SubDomain[] {
  return [
    { key: 'authentication-sso', title: 'Authentication & SSO (OIDC/SAML)', query: 'openid connect saml single sign-on identity provider' },
    { key: 'authorization-policy', title: 'Authorization & Policy (RBAC/ABAC)', query: 'authorization rbac abac policy engine access control' },
    { key: 'identity-user-management', title: 'Identity & User Management', query: 'identity management user directory self-service open source' },
    { key: 'oauth-token-services', title: 'OAuth2 / OIDC Token Services', query: 'oauth2 oidc token server authorization server' },
    { key: 'mfa-federation', title: 'MFA & Identity Federation', query: 'multi-factor authentication identity federation open source' },
  ];
}

/** Decompose a domain into inert sub-domain search queries (domain knowledge, NOT fetched data). Only the
 *  domains the mission has authored are implemented; anything else returns [] (fail-closed decomposition). */
export function decompose(domain: string): SubDomain[] {
  if (/legal\s*&?\s*contract/i.test(domain)) return decomposeLegalContractOps();
  if (/hr\s*&?\s*payroll|human\s*resources|payroll/i.test(domain)) return decomposeHrPayroll();
  if (/identity\s*&?\s*access|\biam\b/i.test(domain)) return decomposeIam();
  return [];
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

// ── Stage 3b (pure): confidence-gated enrichment — the CONFIDENCE CONTRACT, encoded ────────────────────

/** Bound a PARTIAL architecture rating to a WEAK contribution: never better than 'possible' (6/15, flagged).
 *  A partial (tree-only) architecture signal must not earn the full 'good' (11) that a manifest-MEASURED one
 *  would — that is the whole point of "partial contributes weakly, within bounds". 'poor' stays 'poor'. */
function boundPartialArch(rating: ArchFitRating): ArchFitRating {
  return rating === 'poor' ? 'poor' : 'possible';
}

function enrichNote(kind: string, evidence: string[]): string {
  return `${kind}: ${evidence.join('; ')}`.slice(0, 240);
}

/**
 * Re-grade ONE candidate under the CONFIDENCE CONTRACT, using the signals scout's confidence-tagged evidence.
 * Returns the (possibly sharpened) score AND a full before/after trace. See the file header for the contract.
 *
 * KEY INVARIANTS:
 *   • signals absent / FAILED_CLOSED ⇒ returns the un-enriched `baseScore` verbatim (applied:false). No crash,
 *     no fabrication — the candidate is graded exactly as before.
 *   • air-gap + white-label are NEVER overridden ⇒ they stay at the record's deny-by-default 'unknown' (0).
 *   • only MEASURED (full) or PARTIAL-architecture (bounded to 'possible') can move a sub-score upward.
 */
export function enrichScore(
  inputs: ScoringInputs,
  baseScore: ScoreResult,
  signals: RepoSignals | null,
  mode: ProductMode,
): { score: ScoreResult; enrichment: EnrichmentTrace } {
  if (!signals || signals.status !== 'OK') {
    return {
      score: baseScore,
      enrichment: {
        applied: false,
        status: signals ? 'FAILED_CLOSED' : 'NONE',
        reason: signals?.reason,
        totalBefore: baseScore.total, totalAfter: baseScore.total,
        bandBefore: baseScore.band, bandAfter: baseScore.band,
        dimensions: [],
      },
    };
  }

  const extra: {
    archFit?: { rating: ArchFitRating; note?: string };
    maintainability?: { rating: 'clean' | 'maintainable' | 'hard' | 'unsafe'; note?: string };
    cloudNative?: 'strong' | 'partial' | 'poor';
    billingHooks?: 'native' | 'integratable' | 'none';
  } = {};

  // MAINTAINABILITY — 'measured' MAY raise at full weight; anything else stays deny-by-default. (Both modes.)
  if (signals.maintainability.confidence === 'measured' && signals.maintainability.value !== 'unknown') {
    extra.maintainability = { rating: signals.maintainability.value, note: enrichNote('measured', signals.maintainability.evidence) };
  }
  // ARCHITECTURE — 'measured' at full weight; 'partial' bounded to ≤ 'possible'; else deny-by-default. (Both modes.)
  if (signals.architecture.value !== 'unknown') {
    if (signals.architecture.confidence === 'measured') {
      extra.archFit = { rating: signals.architecture.value, note: enrichNote('measured', signals.architecture.evidence) };
    } else if (signals.architecture.confidence === 'partial') {
      extra.archFit = { rating: boundPartialArch(signals.architecture.value), note: enrichNote('partial→bounded', signals.architecture.evidence) };
    }
  }
  // SOVEREIGN: AIR-GAP + WHITE-LABEL are deliberately NOT passed — they stay the record's deny-by-default (0),
  // surfaced as evidence but never lifting the score (human-assessed). Sovereign folding is UNCHANGED.
  if (mode === 'subscription') {
    // CLOUD-NATIVE — folded ONLY when the scout MEASURED present artifacts (never a 'poor' inferred from absence).
    if (signals.cloudNative.confidence === 'measured' && signals.cloudNative.value !== 'unknown') {
      extra.cloudNative = signals.cloudNative.value;
    }
    // BILLING — the scout emits at most 'partial' ('integratable'); a dep proves a hook exists, not 'native'.
    if (signals.billingHooks.confidence !== 'not-mechanizable' && signals.billingHooks.value !== 'unknown') {
      extra.billingHooks = signals.billingHooks.value;
    }
    // MULTI-TENANCY — the scout is ALWAYS not-mechanizable ⇒ NEVER folded here; it stays deny-by-default for a human.
  }

  const score = scoreCandidate(candidateFromScoringInputs(inputs, extra), mode);
  return {
    score,
    enrichment: {
      applied: true,
      status: 'OK',
      totalBefore: baseScore.total, totalAfter: score.total,
      bandBefore: baseScore.band, bandAfter: score.band,
      dimensions: buildDimensionTrace(baseScore, score, signals, mode),
    },
  };
}

function subScoreByDim(s: ScoreResult): Record<string, number> {
  return Object.fromEntries(s.subScores.map((x) => [x.dimension, x.score]));
}

/** Build the per-dimension before/after audit rows — the ONLY basis on which a verdict may be said to move.
 *  Mode-aware: the SOVEREIGN rows (and their order) are byte-identical to before the switch; subscription lists
 *  its own dimensions instead of air-gap/white-label. */
function buildDimensionTrace(base: ScoreResult, enriched: ScoreResult, signals: RepoSignals, mode: ProductMode): DimensionEnrichment[] {
  const b = subScoreByDim(base), e = subScoreByDim(enriched);
  const row = (dimension: DimensionEnrichment['dimension'], key: string, sig: { value: unknown; confidence: Confidence; evidence: string[] }): DimensionEnrichment => {
    const before = b[key] ?? 0, after = e[key] ?? 0;
    const influence: DimensionEnrichment['influence'] = after > before ? (sig.confidence === 'measured' ? 'raised' : 'bounded') : 'none';
    return { dimension, confidence: sig.confidence, value: String(sig.value), influence, pointsBefore: before, pointsAfter: after, evidence: sig.evidence };
  };
  const universal = [
    row('maintainability', 'maintainability', signals.maintainability),
    row('architecture', 'arch-fit', signals.architecture),
  ];
  if (mode === 'sovereign') {
    return [...universal, row('air-gap', 'air-gap', signals.airGap), row('white-label', 'white-label', signals.whiteLabel)];
  }
  return [...universal,
    row('cloud-native', 'cloud-native', signals.cloudNative),
    row('billing-hooks', 'billing-hooks', signals.billingHooks),
    row('multi-tenancy', 'multi-tenancy', signals.multiTenancy),
  ];
}

// ── Stage 5 (pure): domain-specific narrative (moat spine list + market position) ──────────────────────

/** The ONLY domain-specific narrative in the report. Everything else (sections 1–3, red-team, limitations)
 *  is data-driven or method-driven and is domain-agnostic. Defaults to the Legal wording (byte-identical to
 *  the original) so the Legal report regenerates unchanged; adds HR & Payroll; otherwise a neutral fallback. */
export function domainNarrative(domain: string): { moat: string[]; marketPosition: string[] } {
  const sharedMoatTail = [
    'ECE BUILDS (the moat): the unified data model + integration glue across the sub-domains; sovereign/air-gap hardening; Arabic-first adaptation; the white-label brand layer; and any genuinely missing capability confirmed absent after assessment.',
    'The deeper assessment engines the scout does NOT yet provide (air-gap prober, white-label friction analyzer, architecture-fit + maintainability review) are themselves ECE-built factory capability.',
  ];
  if (/hr\s*&?\s*payroll|human\s*resources|payroll/i.test(domain)) {
    return {
      moat: [
        'REUSE (harvest): permissively-licensed spines per sub-domain (core HRIS/employee records, payroll processing, time & attendance/leave, recruitment/ATS, onboarding & performance) — do not rebuild what a proven repo does.',
        ...sharedMoatTail,
      ],
      marketPosition: [
        'Incumbents are proprietary SaaS HR/payroll suites (foreign-cloud, subscription, non-sovereign) alongside copyleft self-hosted stacks (GPL/AGPL) whose licenses block white-label resale.',
        'The sovereign/air-gap + Arabic-first composition — including Arabic-language payroll and local labor-law/end-of-service localization under a white-label brand — is the differentiator nothing local offers off-the-shelf.',
      ],
    };
  }
  if (/identity\s*&?\s*access|\biam\b/i.test(domain)) {
    return {
      moat: [
        'REUSE (harvest): permissively-licensed spines per sub-domain (authentication/SSO, authorization/policy, identity & user management, OAuth2/OIDC token services, MFA & federation) — proven IAM cores (e.g. Keycloak, Ory, Casbin, Casdoor, all Apache-2.0) do not get rebuilt.',
        ...sharedMoatTail,
      ],
      marketPosition: [
        'Incumbents are proprietary cloud identity providers (foreign-cloud, subscription, non-sovereign) whose trust anchor and user directory live outside the jurisdiction.',
        'The sovereign/air-gap + Arabic-first composition — a fully self-hosted trust anchor and directory, Arabic-first admin/consent UX, under a white-label brand — is the differentiator nothing local offers off-the-shelf.',
      ],
    };
  }
  // Default: Legal & Contract Operations (and any other domain) — original wording preserved verbatim.
  return {
    moat: [
      'REUSE (harvest): permissively-licensed spines per sub-domain (CLM, e-sign, clause libraries, document assembly, obligation tracking) — do not rebuild what a proven repo does.',
      ...sharedMoatTail,
    ],
    marketPosition: [
      'Incumbents are proprietary SaaS CLM suites (foreign-cloud, subscription, non-sovereign).',
      'The sovereign/air-gap + Arabic-first white-label composition is the differentiator nothing local offers off-the-shelf.',
    ],
  };
}

// ── Stage 4 (pure): decision from the real (possibly enriched) score ───────────────────────────────────

export function decideSourcing(candidates: GradedCandidate[], mode: ProductMode): { decision: SourcingDecision; evidence: string[] } {
  const evidence: string[] = [];
  if (candidates.length === 0) {
    return { decision: 'BUILD', evidence: ['no candidate repositories discovered for this sub-domain'] };
  }
  // Eligibility precondition + hard gates run BEFORE any banding — an ineligible/REJECT candidate never reaches
  // the score→verdict mapping. UNCHANGED.
  const eligible = candidates.filter((c) => c.record.eligibility === 'eligible');
  const anyPermissive = candidates.some((c) => c.record.licenseDecision !== 'REJECT');
  if (eligible.length === 0) {
    if (!anyPermissive) return { decision: 'BUILD', evidence: ['no permissively-licensed repo found (all candidates REJECT/ineligible) — a genuine absence'] };
    return { decision: 'NEEDS-ASSESSMENT', evidence: ['candidates exist but none are yet eligible (license NEEDS_REVIEW / provenance unverified) — human ratification needed'] };
  }
  const spine = pickSpine(eligible);
  const { total, band, measuredCount } = spine.score;
  const dimsCount = spine.score.subScores.length; // 6 (sovereign) / 7 (subscription)
  evidence.push(`spine: ${spine.identity.owner}/${spine.identity.name} — real score ${total}/100, band "${band}" (${measuredCount}/${dimsCount} dims measured, coverage ${Math.round(spine.score.measuredWeightFraction * 100)}%)`);
  // TRACEABILITY: if enrichment MATERIALLY changed the score (total or band), record EXACTLY which measured/bounded
  // signals justified it — a verdict that changed must be attributable to specific fetched evidence. Under
  // normalization the band often does NOT move (a base measured on 2 strong dims already bands high), yet enrichment
  // still adds MEASURED dimensions that raise the confidence/measuredCount that the floor turns on — so we trigger
  // on any total/band change, not band alone.
  if (spine.enrichment?.applied && (spine.enrichment.totalAfter !== spine.enrichment.totalBefore || spine.enrichment.bandAfter !== spine.enrichment.bandBefore)) {
    const moved = spine.enrichment.dimensions.filter((d) => d.influence !== 'none')
      .map((d) => `${d.dimension}=${d.value} (${d.confidence}, +${d.pointsAfter - d.pointsBefore})`).join(', ');
    evidence.push(`enrichment refined score ${spine.enrichment.totalBefore}→${spine.enrichment.totalAfter} (band ${spine.enrichment.bandBefore}→${spine.enrichment.bandAfter}) — justified ONLY by: ${moved || 'no positive signal'}`);
  }

  // ── CONFIDENCE FLOOR (SPLIT by stakes) ──
  //   FORK   (high commitment): normalized ≥ 70 (acceptable/strong) AND ≥3 dims measured AND air-gap MEASURED.
  //           A machine NEVER auto-forks without a human-confirmed air-gap dimension (sovereign hard gate); the
  //           signals scout never sources air-gap, so a FORK always requires a human.
  //   EXTEND (lower commitment): ≥3 dims measured AND normalized ≥ 55 (risky/acceptable/strong), but NOT a
  //           qualified FORK (either < 70 OR air-gap unmeasured). Air-gap left unmeasured is FLAGGED as
  //           still-needs-human — enrichment can promote NEEDS-ASSESSMENT→EXTEND on real measured evidence, but
  //           can never manufacture a FORK.
  //   else   normalized < 55 OR < 3 dims measured ⇒ NEEDS-ASSESSMENT.
  // Unmeasured dims are EXCLUDED from the score (never assumed good) — the floor, not a deny-by-default 0, is what
  // holds an under-assessed repo back.
  // MODE-SELECTED HARD GATE. sovereign → air-gap; subscription → multi-tenancy. The sovereign path (dimension,
  // wording, flags) is byte-identical to before the switch. A candidate scored under the OTHER mode has no
  // `gateDim` sub-score at all, so `gateMeasured` is false ⇒ the gate FAILS CLOSED under mode confusion (§4).
  const gateDim = mode === 'sovereign' ? 'air-gap' : 'multi-tenancy';
  const gateMeasured = spine.score.subScores.some((s) => s.dimension === gateDim && s.measured);
  const whiteLabelMeasured = spine.score.subScores.some((s) => s.dimension === 'white-label' && s.measured); // sovereign flag only
  const enoughMeasured = measuredCount >= 3;
  const scorePassesFork = band === 'strong' || band === 'acceptable'; // normalized ≥ 70
  const scorePassesExtend = scorePassesFork || band === 'risky';       // normalized ≥ 55
  const unmeasured = spine.score.subScores.filter((s) => !s.measured).map((s) => s.dimension);
  const unmeasuredLine = `unmeasured at decision: ${unmeasured.length ? unmeasured.join(', ') : 'none'}`;

  // GLASS-BOX: a FORK/EXTEND must never be silent about the mode-critical dimension it did NOT assess. Raise a
  // human-approval flag for the unmeasured gate dimension (+ sovereign white-label) on a promotion.
  const promotionFlags = (): string[] => {
    const f: string[] = [];
    if (mode === 'sovereign') {
      if (!gateMeasured) f.push('HUMAN APPROVAL REQUIRED: air-gap is UNMEASURED — a human must assess the sovereign air-gap dimension before this becomes a FORK (a machine never auto-forks without measured air-gap)');
      if (!whiteLabelMeasured) f.push('HUMAN APPROVAL REQUIRED: white-label is UNMEASURED — a human must assess rebrand/telemetry friction before adoption');
    } else {
      if (!gateMeasured) f.push('HUMAN APPROVAL REQUIRED: multi-tenancy is UNMEASURED — a human must assess tenant isolation before this becomes a FORK (a machine never auto-forks without measured multi-tenancy)');
    }
    return f;
  };

  // FORK — full confidence (the mode-critical gate dimension measured).
  if (enoughMeasured && gateMeasured && scorePassesFork) {
    const forkLine = mode === 'sovereign'
      ? `normalized ${total}/100 ≥ 70 (${band}), ${measuredCount}/${dimsCount} dims measured incl. air-gap — FORK: fork and white-label`
      : `normalized ${total}/100 ≥ 70 (${band}), ${measuredCount}/${dimsCount} dims measured incl. multi-tenancy — FORK: fork and white-label`;
    return { decision: 'FORK', evidence: [...evidence, forkLine, unmeasuredLine, ...promotionFlags()] };
  }
  // EXTEND — partial confidence (≥3 measured, score ≥ 55, but not a qualified FORK). Gate dim flagged if unmeasured.
  if (enoughMeasured && scorePassesExtend) {
    const reason = mode === 'sovereign'
      ? (!gateMeasured
          ? `normalized ${total}/100 ≥ 55 on ${measuredCount}/${dimsCount} measured dims, but air-gap UNMEASURED — EXTEND (fork then build the gap); air-gap still needs a human before any FORK`
          : `normalized ${total}/100 in 55–69 (risky) with ${measuredCount}/${dimsCount} dims measured — EXTEND: fork then build the gap`)
      : (!gateMeasured
          ? `normalized ${total}/100 ≥ 55 on ${measuredCount}/${dimsCount} measured dims, but multi-tenancy UNMEASURED — EXTEND (fork then build the gap); multi-tenancy still needs a human before any FORK`
          : `normalized ${total}/100 in 55–69 (risky) with ${measuredCount}/${dimsCount} dims measured — EXTEND: fork then build the gap`);
    return { decision: 'EXTEND', evidence: [...evidence, reason, unmeasuredLine, ...promotionFlags()] };
  }

  // else — normalized < 55 (genuinely weak on measured dims) OR < 3 dims measured (too little assessed). For an
  // ELIGIBLE, permissive spine this is NEEDS-ASSESSMENT — nothing proves a rebuild is needed.
  const why = !enoughMeasured
    ? `only ${measuredCount}/${dimsCount} dimensions measured (< confidence floor of 3) — too little assessed to FORK/EXTEND, regardless of the ${total}/100 partial score`
    : `normalized ${total}/100 is below 55 on ${measuredCount} measured dimensions — genuinely weak on what was assessed`;
  return {
    decision: 'NEEDS-ASSESSMENT',
    evidence: [...evidence, why, unmeasuredLine,
      'reuse-beats-rebuild: assess the unmeasured dimensions before any BUILD (Write-Asks-Read-First / §3.9) — unmeasured dims are excluded from the score, NOT assumed good or bad'],
  };
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
  private readonly signalsPort?: SignalsScoutPort;

  constructor(private readonly scoutPort: ScoutPort, opts: OrchestratorOptions = {}) {
    this.now = opts.now ?? (() => Date.now());
    this.maxPer = opts.maxPerSubDomain ?? DEFAULT_MAX;
    this.signalsPort = opts.signalsPort; // OPTIONAL: absent ⇒ no enrichment ⇒ deny-by-default exactly as before
    // The License Engine is consumed via the injected classifier PORT the engine already defines — not reimplemented.
    const licenseClassifier: LicenseClassifier = { classify: (input) => classifyLicense(input) };
    this.repoIntel = new RepoIntelligenceEngine(licenseClassifier, this.now);
  }

  async run(domain: string, mode: ProductMode): Promise<OrchestratorResult> {
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
      // Grade each candidate; enrich with the signals scout when a port is injected (per-candidate, tolerant).
      const graded: GradedCandidate[] = [];
      for (const c of scouted.candidates) graded.push(this.grade(c, await this.gatherSignals(c), mode));
      const { decision, evidence } = decideSourcing(graded, mode);
      results.push({ subDomain: sd, candidates: graded, spine: graded.length ? pickSpineOrNull(graded) : null, decision, decisionEvidence: evidence });
    }

    const report = this.assemble(domain, results, mode);
    return { status: 'OK', report, reportMarkdown: this.renderMarkdown(report) };
  }

  /** Read-only, tolerant signals gather for ONE candidate. Signals are ENRICHMENT, never the source of truth:
   *  no port ⇒ null; a throw ⇒ null (graded deny-by-default as before). Never crashes the chain, never fabricates. */
  private async gatherSignals(c: ScoutedCandidate): Promise<RepoSignals | null> {
    if (!this.signalsPort) return null;
    try {
      return await this.signalsPort.gather({ owner: c.evaluationInput.identity.owner, name: c.evaluationInput.identity.name });
    } catch {
      return null;
    }
  }

  /** Stage 3 (+ 3b): run ONE candidate through the real graders, then re-grade under the confidence contract
   *  when signals are available. Without signals, `score` is the un-enriched deny-by-default grade (unchanged). */
  private grade(c: ScoutedCandidate, signals: RepoSignals | null, mode: ProductMode): GradedCandidate {
    const record = this.repoIntel.evaluate(c.evaluationInput);                 // repo-intelligence.ts:109
    const inputs = scoringInputs(record);                                      // scoring-engine.ts:90
    const baseScore = scoreCandidate(candidateFromScoringInputs(inputs), mode); // scoring-engine.ts:51 / :131 (deny-by-default)
    const { score, enrichment } = enrichScore(inputs, baseScore, signals, mode); // Stage 3b — confidence contract
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
      enrichment,
    };
  }

  /** Stages 5 + 6: assemble the report and run the independent reviewer re-derivation. */
  private assemble(domain: string, results: SubDomainResult[], mode: ProductMode): HarvestReport {
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

    const narrative = domainNarrative(domain);
    return {
      domain,
      productMode: mode,
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
        'Signal enrichment is CONFIDENCE-GATED: only MEASURED maintainability/architecture may raise a band at full weight; a PARTIAL architecture is bounded to "possible" (≤6/15); air-gap + white-label NEVER lift a band. An unreadable manifest/tree or a wrong default branch degrades a candidate to deny-by-default — it can only lose enrichment points, never gain fabricated ones.',
        'Because air-gap + white-label stay deny-by-default, enrichment can sharpen a candidate to EXTEND ("risky", ≥55) at most — it can NEVER produce a FORK. Reading a FORK from signals alone would be impossible by construction; a FORK still requires human air-gap + white-label assessment.',
      ],
      moat: narrative.moat,
      marketPosition: narrative.marketPosition,
      limitations: [
        'End-to-end scores reflect license + maturity, plus (where a signals scout ran) MEASURED maintainability/architecture. Air-gap + white-label remain deny-by-default (0) — machine-unassessable — so every decision is provisional until a human assesses them; enrichment can lift a candidate to EXTEND at most, never FORK.',
        'Where signals were gathered, each candidate row shows the confidence-gated per-dimension deltas; a band that moved is attributed in the decision evidence to the exact measured/bounded signals that justified it. A candidate with no signals (or fail-closed) is graded exactly as a license+maturity-only pass.',
        'This is a READ-ONLY report. No repo was forked, created, or modified; no external action was taken.',
      ],
      status: 'STOP-AWAITING-HUMAN-APPROVAL',
    };
  }

  renderMarkdown(report: HarvestReport): string {
    const L: string[] = [];
    L.push(`# Harvest Report — ${report.domain}`, '');
    L.push(`**Product mode:** ${report.productMode.toUpperCase()} · **Status:** ${report.status} · **Generated:** ${report.generatedAtIso}`, '');
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
      L.push('', '| Repo | License (from real file) | Decision | Eligibility | Score | Band | Signals (confidence-gated) |', '|---|---|---|---|---|---|---|');
      for (const c of r.candidates) {
        const dis = c.licenseDisagreement ? ' ⚠︎hint≠file' : '';
        L.push(`| [${c.identity.owner}/${c.identity.name}](${c.repoUrl}) | ${c.record.licenseDetected}${dis} · "${c.licenseOneLine}" | ${c.record.licenseDecision} | ${c.record.eligibility} | ${c.score.total}/100 | ${c.score.band} | ${enrichmentCell(c.enrichment)} |`);
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

const CONF_ABBR: Record<Confidence, string> = { measured: 'meas', partial: 'part', 'not-mechanizable': 'n/m' };

/** Compact, traceable per-candidate enrichment summary for the report table. Shows each dimension's value,
 *  confidence, and the signed point delta the confidence contract allowed — so every movement is auditable. */
function enrichmentCell(e: EnrichmentTrace): string {
  if (!e.applied) return e.status === 'FAILED_CLOSED' ? '_fail-closed → deny-by-default_' : '_not gathered_';
  return e.dimensions.map((d) => {
    const delta = d.pointsAfter - d.pointsBefore;
    return `${d.dimension}=${d.value}(${CONF_ABBR[d.confidence]},${delta >= 0 ? '+' : ''}${delta})`;
  }).join(' · ');
}

/** ≤1 short line quoted from the real LICENSE file (first non-empty line), or an honest unverified marker. */
function firstLicenseLine(text: string | undefined, verified: boolean): string {
  if (!verified || !text) return 'no LICENSE file read — unverified';
  const line = text.split(/\r?\n/).map((s) => s.trim()).find((s) => s.length > 0) ?? '';
  return line.slice(0, 80);
}
