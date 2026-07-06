// First 10 Customers Engine (Venture Intelligence Wave — JUDGMENT engine 4; follows the Engines 1–3 template).
//
// Given a venture concept + the structural backbone's facts, it produces an ADVISORY first-10 / go-to-market wedge
// assessment — an OPINION on the initial customer profile and GTM wedge, across the requirement's aspects (target
// client, buyer title, pain, entry wedge, pilot offer, proof required, pricing, expansion path, stakeholders, sales
// motion; §3b of REQUIREMENT_VENTURE_INTELLIGENCE_LAYER.md). The internal side — which ECE capabilities/credentials
// make ECE CREDIBLE to a customer type, the entry wedge, the pilot offer, the proof it can show — is GROUNDED in
// cited real Reuse-Graph capabilities (it fabricates NO capability). The external side — the actual named customers,
// their real pain, market demand, buyer titles, pricing — is EXTERNAL customer data the backbone does NOT hold: the
// engine FLAGS it honestly and NEVER invents a named customer or a demand "fact." It is a strategic opinion to
// inform a human, NOT a decision.
//
// Governed by blueprint/REQUIREMENT_JUDGMENT_ENGINE_DISCIPLINE.md — every clause enforced, identical to Engines 1–3:
//   §1 ADVISORY, NEVER PROOF — `advisory: true` (literal type); OPINION distinct from CITED FACTS (`groundedOn`).
//   §2 GROUNDED IN CITED FACTS — internal credibility/wedge/proof read from the Reuse Graph, cited by node id.
//   §3 PLAN-ONLY / NO-SELF-EXECUTE (type-level) — no execute/create/approve/mint/mutate/deploy; single plan-only status.
//   §4 INSTRUCTION-BOUNDARY — the concept text is inert DATA (secret-scrubbed, echoed).
//   §5 HONEST UNCERTAINTY — confidence signal; thin ⇒ `insufficient-basis`; EXTERNAL customer data flagged, not faked.
//   §6 AUDITED + REDACTED — records concept + opinion + CITED facts to the hash-chain.
//   §8 NEVER DRIVES A CONSEQUENTIAL ACTION — informs a human; no gate/build/outreach path.
//
// STANDALONE-PACKAGEABLE (§7): every cross-engine reference is `import type` / injected. Self-contained — no
// cross-judgment-engine dependency; the judgment-tier shapes mirror the template by CONVENTION.

import type { CapabilityNode, CapabilityQuery } from '../capability-reuse-graph/capability-reuse-graph.js';
import type { TextRedactor } from '../build-observer/build-observer.js';
import type { AuditSink, AppendResult } from '../audit-engine/sink.js';
import type { HumanActor, SessionInfo, Environment } from '../audit-engine/schema.js';
import type { RedactionEngine } from '../redaction-engine/redaction-engine.js';

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

/** The requirement's GTM aspects (§3b). */
export const GTM_ASPECTS = [
  'target-client', 'buyer-title', 'pain', 'entry-wedge', 'pilot-offer',
  'proof-required', 'pricing', 'expansion-path', 'stakeholders', 'sales-motion',
] as const;
export type GtmAspect = (typeof GTM_ASPECTS)[number];

/** Which aspects the backbone can GROUND (internal capability facts) vs which need EXTERNAL customer/market data. */
const INTERNAL_GROUNDED: ReadonlySet<GtmAspect> = new Set<GtmAspect>(['entry-wedge', 'pilot-offer', 'proof-required', 'expansion-path']);

export type AspectBasis = 'internal-grounded' | 'external-data-needed';

export interface GtmAspectView {
  aspect: GtmAspect;
  /** whether the backbone can ground this aspect, or it needs external customer/market data. */
  basis: AspectBasis;
  /** cited ECE capabilities grounding this aspect (empty for external-data-needed). */
  groundedOn: CitedFact[];
  /** OPINION (advisory). */
  opinion: string;
  /** for external-data-needed: the external customer/market data required — FLAGGED, never fabricated. */
  externalNote?: string;
}

/** THE ASSESSMENT — the opinion sits ON TOP of the cited facts; external customer data is flagged, never invented. */
export interface First10Assessment {
  /** echoed inert concept text (secret-scrubbed) */
  concept: string;
  /** LITERAL true — JUDGMENT, never re-derivable proof (§1). */
  advisory: true;
  /** the plan-only status (§3). */
  status: PlanOnlyStatus;
  /** the CITED ECE capabilities that make ECE credible to a customer type (the core internal grounding). */
  credibility: CitedFact[];
  /** OPINION: the entry wedge, grounded on the strongest cited capability. */
  entryWedge: { opinion: string; groundedOn: CitedFact[] };
  /** per-aspect GTM views (grounded or external-flagged). */
  aspects: GtmAspectView[];
  /** the UNION of all cited backbone facts (§2). */
  groundedOn: CitedFact[];
  /** honest confidence signal (§5). */
  confidence: Confidence;
  /** honest external-data boundary (§5) — customer identity / demand / pricing need external data, never fabricated. */
  externalDataNeeded: string;
  /** an explicit statement of the basis / its insufficiency (§5). */
  basis: string;
}

export interface VentureConcept {
  /** inert DATA — never instruction */
  description: string;
  terms: string[];
  sourcingVerdicts?: Array<{ capability: string; verdict: string }>;
}

const IDENTITY_REDACTOR: TextRedactor = { redact: (s) => s };
const PLAN_ONLY: PlanOnlyStatus = 'VENTURE-BLUEPRINT-AWAITING-HUMAN-APPROVAL';
const EXTERNAL_CUSTOMER_NOTE = 'Concrete customer identity, real buyer pain, market demand, buyer titles and pricing require EXTERNAL customer/market data the structural backbone does not hold — FLAGGED, never fabricated. No named customer or demand figure is invented; only a plausible customer TYPE grounded in ECE credibility capabilities is offered.';

function norm(s: string): string { return String(s ?? '').toLowerCase(); }

/**
 * Produces an advisory first-10 / GTM-wedge assessment grounded in cited backbone facts. Its ONLY method is
 * assess() → data. It holds no gate/approval/bridge reference and can neither act nor mutate the graph. The FACTS
 * (ECE credibility capabilities) come from the graph; the OPINION (wedge, customer type, pilot) is composed over
 * those cited facts; external customer/market data is FLAGGED, never invented.
 */
export class First10CustomersEngine {
  constructor(private readonly graph: GraphReader, private readonly redactor: TextRedactor = IDENTITY_REDACTOR) {}

  assess(concept: VentureConcept): First10Assessment {
    const terms = (concept.terms ?? []).map(norm).filter((t) => t.length > 0);
    const conceptText = this.redactor.redact(String(concept.description ?? ''));

    // §2 CONCEPT GROUNDING GATE: the credibility side is ECE's real capabilities for THIS venture — if NONE relate
    // to the concept, there is no grounded GTM (honest insufficient-basis, §5), not a fabricated one.
    const credibility = this.citeForTerms(terms);
    if (credibility.length === 0) {
      const aspects = GTM_ASPECTS.map((a): GtmAspectView => ({
        aspect: a,
        basis: INTERNAL_GROUNDED.has(a) ? 'internal-grounded' : 'external-data-needed',
        groundedOn: [],
        opinion: `insufficient basis: no ECE capability relates to this concept — no grounded ${a} can be offered (§5).`,
        externalNote: INTERNAL_GROUNDED.has(a) ? undefined : EXTERNAL_CUSTOMER_NOTE,
      }));
      return {
        concept: conceptText, advisory: true, status: PLAN_ONLY, credibility: [],
        entryWedge: { opinion: 'insufficient basis — no cited ECE capability to lead a wedge with.', groundedOn: [] },
        aspects, groundedOn: [], confidence: 'insufficient-basis', externalDataNeeded: EXTERNAL_CUSTOMER_NOTE,
        basis: this.redactor.redact('insufficient-basis: 0 backbone facts matched the concept terms — no confident first-10 GTM is asserted (§5).'),
      };
    }

    const names = credibility.map((f) => f.name);
    const cites = credibility.map((f) => f.ref);
    const lead = credibility[0];

    // §2 per-aspect: internal-grounded aspects cite ECE capabilities; external-data-needed aspects are FLAGGED.
    const aspects: GtmAspectView[] = GTM_ASPECTS.map((a) => {
      if (INTERNAL_GROUNDED.has(a)) {
        return {
          aspect: a, basis: 'internal-grounded', groundedOn: credibility,
          opinion: this.internalOpinion(a, names, cites, lead),
        };
      }
      return {
        aspect: a, basis: 'external-data-needed', groundedOn: [],
        opinion: this.externalOpinion(a, credibility.length),
        externalNote: EXTERNAL_CUSTOMER_NOTE,
      };
    });

    // optional Phase-4 sourcing verdicts as additional CITED credibility facts.
    const groundedAll: CitedFact[] = [...credibility];
    const seen = new Set(credibility.map((f) => f.ref));
    for (const v of concept.sourcingVerdicts ?? []) {
      const ref = `verdict:${norm(v.capability)}`;
      if (!seen.has(ref)) { seen.add(ref); groundedAll.push({ kind: 'sourcing-verdict', ref, name: v.capability, note: `sourcing verdict ${v.verdict}` }); }
    }
    groundedAll.sort((x, y) => (x.ref < y.ref ? -1 : x.ref > y.ref ? 1 : 0));

    const confidence = this.confidenceFor(credibility.length);
    return {
      concept: conceptText,
      advisory: true,
      status: PLAN_ONLY,
      credibility,
      entryWedge: {
        opinion: `OPINION (advisory): lead the wedge with ${lead.name} [${lead.ref}] — a cited ECE capability — as the credibility beachhead for the first customers.`,
        groundedOn: [lead],
      },
      aspects,
      groundedOn: groundedAll,
      confidence,
      externalDataNeeded: EXTERNAL_CUSTOMER_NOTE,
      basis: this.redactor.redact(`${confidence}: grounded on ${credibility.length} cited backbone credibility fact(s) (${cites.join(', ')}). Wedge/pilot/proof are OPINION on top; concrete customers, demand, buyer titles and pricing are EXTERNAL data — flagged, not fabricated (no invented customer).`),
    };
  }

  private internalOpinion(a: GtmAspect, names: string[], cites: string[], lead: CitedFact): string {
    switch (a) {
      case 'entry-wedge': return `OPINION: the entry wedge is ECE's cited capability ${lead.name} [${lead.ref}] — the credibility others lack.`;
      case 'pilot-offer': return `OPINION: a pilot could demonstrate ECE's cited capabilities ${names.join(', ')} [${cites.join(', ')}] on the customer's own (air-gapped) environment.`;
      case 'proof-required': return `OPINION: the evidence ECE can already show is its cited, tested capabilities ${names.join(', ')} [${cites.join(', ')}] — not promises.`;
      case 'expansion-path': return `OPINION: expand as more of ECE's cited capabilities (${names.join(', ')}) harden — the capability graph is the expansion surface.`;
      default: return `OPINION grounded on ${names.join(', ')} [${cites.join(', ')}].`;
    }
  }
  private externalOpinion(a: GtmAspect, n: number): string {
    const seg = 'sovereign / regulated (government or accredited-enterprise) buyers — a customer TYPE, not a named company';
    switch (a) {
      case 'target-client': return `OPINION (external data needed): a plausible first-customer TYPE is ${seg}, credible because of ECE's ${n} cited capabilit${n === 1 ? 'y' : 'ies'}. The actual named clients require external customer data — not invented here.`;
      case 'buyer-title': return 'OPINION (external data needed): a plausible buyer is a sovereignty/security-accountable executive; the real title requires external customer research.';
      case 'pain': return 'OPINION (external data needed): a plausible pain is dependence on non-sovereign tooling; real customer pain must be validated with external interviews, not asserted.';
      case 'pricing': return 'OPINION (external data needed): pricing / willingness-to-pay requires external market data — not fabricated here (see Revenue Stack for the same boundary).';
      case 'stakeholders': return 'OPINION (external data needed): real org stakeholders require external account mapping — not invented.';
      case 'sales-motion': return 'OPINION (external data needed): the sales motion (e.g. sovereign-first design-partner pilots) is a hypothesis requiring external market validation.';
      default: return 'OPINION (external data needed): requires external customer/market data — flagged, not fabricated.';
    }
  }

  private citeForTerms(terms: readonly string[]): CitedFact[] {
    const seen = new Set<string>();
    const out: CitedFact[] = [];
    for (const t of terms) {
      for (const n of this.graph.search({ text: t })) {
        if (seen.has(n.id)) continue;
        seen.add(n.id);
        out.push({ kind: 'capability', ref: n.id, name: n.name, note: `${n.kind} at ${n.source}${n.posture.hasTests ? ' (tested)' : ''}` });
      }
    }
    return out.sort((a, b) => (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0));
  }

  private confidenceFor(n: number): Confidence {
    if (n === 0) return 'insufficient-basis';
    if (n <= 2) return 'low';
    if (n <= 4) return 'moderate';
    return 'speculative-high';
  }
}

// ── audit tie-in (§6) — record concept, the assessment, and which facts it cited ──────────────────────────────
export const FIRST10_AUDIT_ALLOWLIST: readonly string[] = [
  'first10', 'event', 'advisory', 'status', 'terms', 'entryWedge', 'opinion', 'confidence', 'basis',
  'externalDataNeeded', 'credibility', 'groundedOn', 'kind', 'ref', 'name', 'citedCount', 'environment',
];

export class First10Auditor {
  constructor(
    private readonly sink: Pick<AuditSink, 'appendRead'>,
    private readonly redactor: Pick<RedactionEngine, 'redactSummary'>,
    private readonly organizationId: string,
    private readonly actor: HumanActor,
    private readonly environment: Environment = 'local',
    private readonly session: SessionInfo = { session_id: 'first-10-customers' },
  ) {}

  async record(assessment: First10Assessment, terms: string[]): Promise<AppendResult> {
    const summary = this.redactor.redactSummary({
      first10: 'assess',
      event: 'first10.assessed',
      advisory: assessment.advisory,
      status: assessment.status,
      terms,
      entryWedge: { opinion: assessment.entryWedge.opinion },
      confidence: assessment.confidence,
      basis: assessment.basis,
      externalDataNeeded: assessment.externalDataNeeded,
      credibility: assessment.credibility.map((f) => ({ ref: f.ref, name: f.name })),
      groundedOn: assessment.groundedOn.map((f) => ({ kind: f.kind, ref: f.ref, name: f.name })),
      citedCount: assessment.groundedOn.length,
      environment: this.environment,
    });
    return this.sink.appendRead({ organization_id: this.organizationId, human_actor: this.actor, session: this.session, query_range: summary, rows_returned: assessment.groundedOn.length });
  }
}
