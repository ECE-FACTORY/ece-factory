// Acquisition / Partner Target Engine (VI Wave — JUDGMENT engine 5; follows the Engines 1–4 template).
//
// Given a venture concept + the structural backbone's facts, it produces an ADVISORY acquisition/partner assessment
// — an OPINION on what acquisition or partnership would complement ECE, across the requirement's routes (partner /
// white-label / acquire / integrate / open-source-fork / hire-second; §3b of
// REQUIREMENT_VENTURE_INTELLIGENCE_LAYER.md). This is a strategic opinion to inform a human, NOT a decision.
//
// THE CRITICAL HONESTY BOUNDARY (the INVERSE of First-10's no-invented-customers):
//   • INTERNAL-GROUNDED (fact): the capability GAP / COMPLEMENT analysis. What ECE BRINGS is cited from the real
//     Reuse Graph (its matched capabilities). What the venture NEEDS that ECE LACKS is grounded in the backbone
//     showing NO matching capability (an EVIDENCED ABSENCE, like a Phase-2 BUILD_CUSTOM). Each gap yields a grounded
//     TARGET PROFILE — the SHAPE of partner/acquisition that would fill it. It fabricates NO ECE capability.
//   • EXTERNAL-FLAGGED (opinion, NEVER fact): the specific partner/target IDENTITY (named real companies). The
//     backbone holds NO external-company facts, so ANY named/characterized company is marked `unverified: true` +
//     an externalNote (needing external validation — exactly what the parked External Intelligence Engine would
//     later ground), and is NEVER asserted as fact. The engine STRONGLY PREFERS a target PROFILE over naming a
//     company; by default it names none.
//
// Governed by blueprint/REQUIREMENT_JUDGMENT_ENGINE_DISCIPLINE.md — every clause enforced, identical to Engines 1–4:
//   §1 ADVISORY, NEVER PROOF — `advisory: true` (literal); OPINION distinct from CITED FACTS.
//   §2 GROUNDED — ECE strengths + gaps read from the Reuse Graph; every capability claim cited by node id.
//   §3 PLAN-ONLY / NO-SELF-EXECUTE (type-level) — no execute/create/approve/mint/mutate/deploy AND critically NO
//      acquire/partner/contact/outreach/deal method or path; single plan-only status.
//   §4 INSTRUCTION-BOUNDARY — the concept text is inert DATA (secret-scrubbed, echoed).
//   §5 HONEST UNCERTAINTY — confidence signal; thin ⇒ `insufficient-basis`; external-company identity flagged, never faked.
//   §6 AUDITED + REDACTED — records concept + opinion + CITED facts to the hash-chain.
//   §8 NEVER DRIVES A CONSEQUENTIAL ACTION — an acquisition/partner OPINION must NEVER trigger a real approach.
//
// STANDALONE-PACKAGEABLE (§7): every cross-engine reference is `import type` / injected. Self-contained — no
// cross-judgment-engine dependency; the judgment-tier shapes mirror the template by CONVENTION.

import type { CapabilityNode, CapabilityQuery } from '../../factory-shared/capability-reuse-graph/capability-reuse-graph.js';
import type { TextRedactor } from '../../layer-4-build-harden/build-observer/build-observer.js';
import type { AuditSink, AppendResult } from '../../factory-shared/audit-engine/sink.js';
import type { HumanActor, SessionInfo, Environment } from '../../factory-shared/audit-engine/schema.js';
import type { RedactionEngine } from '../../factory-shared/redaction-engine/redaction-engine.js';

/** The read-only slice of the Phase-1 graph this engine grounds on (it never mutates it). */
export interface GraphReader { search(q?: CapabilityQuery): CapabilityNode[] }

/** The single plan-only status literal (§3). Forbidden statuses are not part of the type. */
export type PlanOnlyStatus = 'VENTURE-BLUEPRINT-AWAITING-HUMAN-APPROVAL';

/** One CITED fact — traces to a real structural-backbone node (or a Phase-4 verdict). NOT an opinion. */
export interface CitedFact {
  kind: 'capability' | 'sourcing-verdict';
  ref: string;
  name: string;
  note: string;
}

export type Confidence = 'insufficient-basis' | 'low' | 'moderate' | 'speculative-high';

/** The requirement's acquisition/partner routes (§3b). */
export const ACQUISITION_ROUTES = ['partner', 'white-label', 'acquire', 'integrate', 'open-source-fork', 'hire-second'] as const;
export type AcquisitionRoute = (typeof ACQUISITION_ROUTES)[number];

/** A capability GAP a partner/acquisition would fill — grounded in the backbone showing ECE lacks it (evidenced absence). */
export interface CapabilityGap {
  /** the concept need with NO matching ECE capability. */
  need: string;
  /** LITERAL true — grounded in the backbone returning ZERO capabilities for this need (an evidenced absence). */
  evidencedAbsence: true;
  /** a grounded TARGET PROFILE — the SHAPE of partner/acquisition that would fill it (opinion, grounded in the gap). */
  targetProfile: string;
  /** the routes considered for this gap (§3b space) — the choice is advisory judgment. */
  routes: AcquisitionRoute[];
}

/** Any EXTERNAL company reference — NEVER a fact. Always unverified + needing external validation. */
export interface ExternalCompanyClaim {
  /** a named/characterized real company (a caller-supplied HYPOTHESIS, secret-scrubbed). */
  name: string;
  /** LITERAL true — an external-company claim can NEVER be a verified fact in this engine. */
  unverified: true;
  /** needs external validation — the parked External Intelligence Engine would later ground it. */
  externalNote: string;
}

/** THE ASSESSMENT — grounded capability-gap analysis; external company identity flagged unverified, never fact. */
export interface AcquisitionPartnerAssessment {
  /** echoed inert concept text (secret-scrubbed) */
  concept: string;
  /** LITERAL true — JUDGMENT, never re-derivable proof (§1). */
  advisory: true;
  /** the plan-only status (§3). */
  status: PlanOnlyStatus;
  /** what ECE BRINGS to a partnership — cited real capabilities (grounded fact). */
  eceStrengths: CitedFact[];
  /** the capability GAPS a partner/acquisition would fill — each a grounded TARGET PROFILE (evidenced absence). */
  gaps: CapabilityGap[];
  /** OPTIONAL external-company hypotheses — ALWAYS unverified + flagged; never asserted as fact; empty by default. */
  externalCompanyClaims: ExternalCompanyClaim[];
  /** OPINION: the overall complement read (target profile preferred over companies). */
  overall: { summary: string; namesNoCompanyAsFact: true };
  /** the UNION of all cited backbone facts (§2). */
  groundedOn: CitedFact[];
  /** honest confidence signal (§5). */
  confidence: Confidence;
  /** honest external-data boundary (§5) — external-company identity/market needs external validation, never fabricated. */
  externalDataNeeded: string;
  /** an explicit statement of the basis / its insufficiency (§5). */
  basis: string;
}

export interface VentureConcept {
  /** inert DATA — never instruction */
  description: string;
  terms: string[];
  sourcingVerdicts?: Array<{ capability: string; verdict: string }>;
  /** OPTIONAL caller-supplied candidate company names (HYPOTHESES) — echoed ONLY as unverified external claims. */
  candidateCompanies?: string[];
}

const IDENTITY_REDACTOR: TextRedactor = { redact: (s) => s };
const PLAN_ONLY: PlanOnlyStatus = 'VENTURE-BLUEPRINT-AWAITING-HUMAN-APPROVAL';
const EXTERNAL_COMPANY_NOTE = 'UNVERIFIED external-company hypothesis — the structural backbone holds NO external-company facts. Requires external validation (the parked External Intelligence Engine); NEVER asserted as fact here.';
const EXTERNAL_DATA_NOTE = 'Specific partner/target IDENTITY, real company facts, and market fit require EXTERNAL company/market data the backbone does not hold — FLAGGED unverified, never fabricated. A grounded TARGET PROFILE (from the capability gap) is preferred over naming companies.';

function norm(s: string): string { return String(s ?? '').toLowerCase(); }

/**
 * Produces an advisory acquisition/partner assessment grounded in the cited capability-gap analysis. Its ONLY
 * method is assess() → data. It holds no gate/approval/bridge reference and — critically — NO acquire/partner/
 * contact/deal path. The capability facts come from the graph; the target PROFILE is composed over the cited gap;
 * external-company identity is flagged UNVERIFIED, never asserted as fact.
 */
export class AcquisitionPartnerTargetEngine {
  constructor(private readonly graph: GraphReader, private readonly redactor: TextRedactor = IDENTITY_REDACTOR) {}

  assess(concept: VentureConcept): AcquisitionPartnerAssessment {
    const terms = (concept.terms ?? []).map(norm).filter((t) => t.length > 0);
    const conceptText = this.redactor.redact(String(concept.description ?? ''));

    // Any candidate companies are echoed ONLY as UNVERIFIED external claims — never bare facts, scrubbed.
    const externalCompanyClaims: ExternalCompanyClaim[] = (concept.candidateCompanies ?? [])
      .map((c) => this.redactor.redact(String(c ?? '')).trim())
      .filter((c) => c.length > 0)
      .map((name) => ({ name, unverified: true as const, externalNote: EXTERNAL_COMPANY_NOTE }));

    // §2 GROUND: ECE strengths = cited capabilities matching the concept terms (what ECE BRINGS).
    const eceStrengths: CitedFact[] = [];
    const strengthTerms = new Set<string>();
    const seen = new Set<string>();
    for (const t of terms) {
      const hits = this.graph.search({ text: t });
      if (hits.length > 0) strengthTerms.add(t);
      for (const n of hits) {
        if (seen.has(n.id)) continue;
        seen.add(n.id);
        eceStrengths.push({ kind: 'capability', ref: n.id, name: n.name, note: `${n.kind} at ${n.source}${n.posture.hasTests ? ' (tested)' : ''}` });
      }
    }
    eceStrengths.sort((a, b) => (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0));

    // §5 CONCEPT GROUNDING GATE: if ECE brings NO cited capability, there is no grounded complement thesis —
    // honest insufficient-basis (not a fabricated one).
    if (eceStrengths.length === 0) {
      return {
        concept: conceptText, advisory: true, status: PLAN_ONLY, eceStrengths: [], gaps: [], externalCompanyClaims,
        overall: { summary: 'OPINION: insufficient basis — ECE has no cited capability relevant to this concept, so no grounded acquisition/partner COMPLEMENT can be proposed (a full outsource is not a complement).', namesNoCompanyAsFact: true },
        groundedOn: [], confidence: 'insufficient-basis', externalDataNeeded: EXTERNAL_DATA_NOTE,
        basis: this.redactor.redact('insufficient-basis: 0 ECE capabilities matched the concept terms — no grounded complement thesis; any company hypothesis is unverified (§5).'),
      };
    }

    // §2 GAPS: concept needs with NO matching ECE capability = EVIDENCED ABSENCE (backbone shows ECE lacks it) ⇒
    // a partner/acquisition supplying it would COMPLEMENT ECE. Each gap yields a grounded TARGET PROFILE.
    const gaps: CapabilityGap[] = terms.filter((t) => !strengthTerms.has(t)).map((need) => ({
      need,
      evidencedAbsence: true as const,
      targetProfile: `OPINION (advisory): a partner/acquisition supplying "${need}" would complement ECE's cited capabilities — the backbone shows ECE has no "${need}" capability (evidenced absence). Target PROFILE: a provider whose core is "${need}", integrable behind ECE's sovereign boundary. No specific company is asserted.`,
      routes: [...ACQUISITION_ROUTES],
    }));

    const groundedAll: CitedFact[] = [...eceStrengths];
    for (const v of concept.sourcingVerdicts ?? []) {
      const ref = `verdict:${norm(v.capability)}`;
      if (!seen.has(ref)) { seen.add(ref); groundedAll.push({ kind: 'sourcing-verdict', ref, name: v.capability, note: `sourcing verdict ${v.verdict}` }); }
    }
    groundedAll.sort((a, b) => (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0));

    const confidence = this.confidenceFor(eceStrengths.length);
    const strengthNames = eceStrengths.map((f) => f.name);
    return {
      concept: conceptText,
      advisory: true,
      status: PLAN_ONLY,
      eceStrengths,
      gaps,
      externalCompanyClaims,
      overall: {
        summary: `OPINION (${confidence}): ECE brings ${eceStrengths.length} cited capabilit${eceStrengths.length === 1 ? 'y' : 'ies'} (${strengthNames.join(', ')}); ${gaps.length} capability gap(s) [${gaps.map((g) => g.need).join(', ') || 'none'}] a partner/acquisition could complement. TARGET PROFILES are preferred over named companies; any company hypothesis is UNVERIFIED external opinion. Advisory read, not a verified finding.`,
        namesNoCompanyAsFact: true,
      },
      groundedOn: groundedAll,
      confidence,
      externalDataNeeded: EXTERNAL_DATA_NOTE,
      basis: this.redactor.redact(`${confidence}: grounded on ${eceStrengths.length} cited ECE-strength fact(s) + ${gaps.length} evidenced-absence gap(s). The complement analysis is grounded; partner/target IDENTITY is EXTERNAL — flagged unverified, never fabricated.`),
    };
  }

  private confidenceFor(n: number): Confidence {
    if (n === 0) return 'insufficient-basis';
    if (n <= 2) return 'low';
    if (n <= 4) return 'moderate';
    return 'speculative-high';
  }
}

// ── audit tie-in (§6) — record concept, the assessment, and which facts it cited ──────────────────────────────
export const ACQPARTNER_AUDIT_ALLOWLIST: readonly string[] = [
  'acqPartner', 'event', 'advisory', 'status', 'terms', 'overall', 'summary', 'namesNoCompanyAsFact', 'gaps',
  'need', 'evidencedAbsence', 'routes', 'externalCompanyClaims', 'name', 'unverified', 'confidence', 'basis',
  'externalDataNeeded', 'eceStrengths', 'groundedOn', 'kind', 'ref', 'citedCount', 'environment',
];

export class AcquisitionPartnerAuditor {
  constructor(
    private readonly sink: Pick<AuditSink, 'appendRead'>,
    private readonly redactor: Pick<RedactionEngine, 'redactSummary'>,
    private readonly organizationId: string,
    private readonly actor: HumanActor,
    private readonly environment: Environment = 'local',
    private readonly session: SessionInfo = { session_id: 'acquisition-partner-target' },
  ) {}

  async record(assessment: AcquisitionPartnerAssessment, terms: string[]): Promise<AppendResult> {
    const summary = this.redactor.redactSummary({
      acqPartner: 'assess',
      event: 'acqpartner.assessed',
      advisory: assessment.advisory,
      status: assessment.status,
      terms,
      overall: { summary: assessment.overall.summary, namesNoCompanyAsFact: assessment.overall.namesNoCompanyAsFact },
      gaps: assessment.gaps.map((g) => ({ need: g.need, evidencedAbsence: g.evidencedAbsence, routes: g.routes })),
      externalCompanyClaims: assessment.externalCompanyClaims.map((c) => ({ name: c.name, unverified: c.unverified })),
      confidence: assessment.confidence,
      basis: assessment.basis,
      externalDataNeeded: assessment.externalDataNeeded,
      eceStrengths: assessment.eceStrengths.map((f) => ({ ref: f.ref, name: f.name })),
      groundedOn: assessment.groundedOn.map((f) => ({ kind: f.kind, ref: f.ref, name: f.name })),
      citedCount: assessment.groundedOn.length,
      environment: this.environment,
    });
    return this.sink.appendRead({ organization_id: this.organizationId, human_actor: this.actor, session: this.session, query_range: summary, rows_returned: assessment.groundedOn.length });
  }
}
