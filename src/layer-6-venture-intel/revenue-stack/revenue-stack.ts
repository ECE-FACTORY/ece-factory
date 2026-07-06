// Revenue Stack Engine (Venture Intelligence Wave — JUDGMENT engine 3; follows the Category-Creation / Moat template).
//
// Given a venture concept + the structural backbone's facts, it produces an ADVISORY Revenue Stack — an OPINION on
// how the venture could monetize, across the requirement's commercial-model taxonomy (setup, subscription, per-seat,
// usage, managed-service, license, marketplace-commission, certification, data-products, api, training, sla,
// white-label, partner-share, renewals, upsells), RECURRING-REVENUE-FIRST (§3b of
// REQUIREMENT_VENTURE_INTELLIGENCE_LAYER.md). Each revenue layer cites the real ECE capabilities (Reuse-Graph
// nodes) that SUPPORT it — it fabricates NO capability. It is a strategic opinion to inform a human, NOT a decision.
//
// HONEST EXTERNAL-DATA BOUNDARY (load-bearing here): the backbone supplies INTERNAL facts (which ECE assets support
// which revenue layer). It does NOT supply willingness-to-pay, market size, or price points — those are EXTERNAL
// market data the backbone lacks. This engine therefore GROUNDS the capability-support opinion in cited internal
// facts, and for concrete pricing it FLAGS the external-data need honestly (`pricingNote` / `externalDataNeeded`)
// rather than fabricating a market/pricing "fact." No invented prices, no invented market sizes.
//
// Governed by blueprint/REQUIREMENT_JUDGMENT_ENGINE_DISCIPLINE.md — every clause enforced, identical to Engines 1–2:
//   §1 ADVISORY, NEVER PROOF — `advisory: true` (literal type; never false); the OPINION (layers/rationale) is a
//      distinct object from the CITED FACTS (`groundedOn`).
//   §2 GROUNDED IN CITED FACTS — every supporting capability is READ from the Reuse Graph and CITED by node id.
//   §3 PLAN-ONLY / NO-SELF-EXECUTE (type-level) — no execute/create/approve/mint/mutate/deploy; single plan-only status.
//   §4 INSTRUCTION-BOUNDARY — the concept text is inert DATA (secret-scrubbed, echoed).
//   §5 HONEST UNCERTAINTY — confidence signal; thin grounding ⇒ `insufficient-basis`; pricing needs flagged, not faked.
//   §6 AUDITED + REDACTED — records concept + opinion + CITED facts to the hash-chain.
//   §8 NEVER DRIVES A CONSEQUENTIAL ACTION — informs a human; no gate/build path.
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
export type SupportStrength = 'none' | 'weak' | 'moderate' | 'strong';

/** The requirement's commercial-model taxonomy (§3b). */
export const REVENUE_STREAMS = [
  'setup', 'subscription', 'per-seat', 'usage', 'managed-service', 'license', 'marketplace-commission',
  'certification', 'data-products', 'api', 'training', 'sla', 'white-label', 'partner-share', 'renewals', 'upsells',
] as const;
export type RevenueStream = (typeof REVENUE_STREAMS)[number];

/** Recurring-vs-one-time classification (recurring-revenue-first, §3b). A fixed attribute of each stream. */
const RECURRING: ReadonlySet<RevenueStream> = new Set<RevenueStream>([
  'subscription', 'per-seat', 'usage', 'managed-service', 'marketplace-commission', 'data-products', 'api', 'sla', 'partner-share', 'renewals',
]);

/** Deterministic keyword map — which structural capabilities SUPPORT each revenue stream (re-derivable). */
const STREAM_KEYWORDS: Record<RevenueStream, readonly string[]> = {
  setup: ['deploy', 'package', 'build', 'preview', 'observer'],
  subscription: ['engine', 'audit', 'registry', 'settings', 'sovereign'],
  'per-seat': ['permission', 'policy', 'approval', 'seat'],
  usage: ['audit', 'observer', 'metering', 'usage', 'evidence'],
  'managed-service': ['sovereign', 'air-gap', 'audit', 'trust', 'kill'],
  license: ['license', 'compliance'],
  'marketplace-commission': ['registry', 'marketplace', 'harvest', 'domain'],
  certification: ['attestation', 'trust', 'sovereign', 'audit'],
  'data-products': ['audit', 'ledger', 'evidence', 'attestation', 'data'],
  api: ['bridge', 'mcp', 'api', 'gateway', 'tool-registry'],
  training: ['doc', 'preview', 'feature'],
  sla: ['audit', 'observer', 'kill', 'sovereign'],
  'white-label': ['white-label', 'brand'],
  'partner-share': ['harvest', 'partner', 'sourcing', 'scoring'],
  renewals: ['attestation', 'sovereign', 'trust', 'audit'],
  upsells: ['engine', 'registry', 'capability', 'package'],
};

/** One revenue layer's assessment — the support OPINION, grounded on CITED facts; pricing flagged as external. */
export interface RevenueLayer {
  stream: RevenueStream;
  recurring: boolean;
  /** OPINION: strength of ECE capability support for this revenue layer (from cited-fact count). */
  support: SupportStrength;
  /** the CITED backbone capabilities that support this layer — every one traces to the injected graph. */
  groundedOn: CitedFact[];
  /** OPINION rationale (advisory). */
  rationale: string;
  /** honest external-data boundary: concrete price / willingness-to-pay needs external market data (never fabricated). */
  pricingNote: string;
}

/** THE ASSESSMENT — the opinion (layers/model) sits ON TOP of the cited facts, never as proof. */
export interface RevenueStackAssessment {
  /** echoed inert concept text (secret-scrubbed) */
  concept: string;
  /** LITERAL true — JUDGMENT, never re-derivable proof (§1). */
  advisory: true;
  /** the plan-only status (§3). */
  status: PlanOnlyStatus;
  /** per-stream revenue layers, each grounded on cited facts. */
  layers: RevenueLayer[];
  /** the RECURRING revenue layers ECE capabilities support — recurring-revenue-first (§3b). */
  recurringLayers: RevenueStream[];
  /** OPINION: the overall commercial-model read. */
  overall: { model: string; recurringFirst: boolean };
  /** the UNION of all cited backbone facts (§2). */
  groundedOn: CitedFact[];
  /** honest confidence signal (§5). */
  confidence: Confidence;
  /** honest external-data boundary (§5) — the market/pricing facts the backbone CANNOT supply (flagged, not faked). */
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
const EXTERNAL_PRICING_NOTE = 'Concrete price points / willingness-to-pay / market size require EXTERNAL market data the structural backbone does not hold — flagged, not fabricated. This layer cites only which ECE capabilities SUPPORT the stream.';

function norm(s: string): string { return String(s ?? '').toLowerCase(); }
function supportFor(n: number): SupportStrength { return n === 0 ? 'none' : n === 1 ? 'weak' : n === 2 ? 'moderate' : 'strong'; }

/**
 * Produces an advisory Revenue Stack grounded in cited backbone facts. Its ONLY method is assess() → data. It holds
 * no gate/approval/bridge reference and can neither act nor mutate the graph. The FACTS (capability support) come
 * from the graph; the OPINION (revenue model) is composed over those cited facts; pricing is flagged as external.
 */
export class RevenueStackEngine {
  constructor(private readonly graph: GraphReader, private readonly redactor: TextRedactor = IDENTITY_REDACTOR) {}

  assess(concept: VentureConcept): RevenueStackAssessment {
    const terms = (concept.terms ?? []).map(norm).filter((t) => t.length > 0);
    const conceptText = this.redactor.redact(String(concept.description ?? ''));

    // §2 CONCEPT GROUNDING GATE: if NO ECE capability relates to the concept, there is no grounded revenue stack —
    // honest insufficient-basis (§5), not a fabricated one.
    const conceptFacts = this.citeForTerms(terms);
    if (conceptFacts.length === 0) {
      const layers = REVENUE_STREAMS.map((s): RevenueLayer => ({
        stream: s, recurring: RECURRING.has(s), support: 'none', groundedOn: [],
        rationale: `insufficient basis: no ECE capability in the structural backbone relates to this concept — no ${s} revenue layer can be grounded (§5).`,
        pricingNote: EXTERNAL_PRICING_NOTE,
      }));
      return {
        concept: conceptText, advisory: true, status: PLAN_ONLY, layers, recurringLayers: [],
        overall: { model: 'OPINION: insufficient basis — the structural backbone cites no ECE capability for this concept; no grounded revenue model can be proposed.', recurringFirst: false },
        groundedOn: [], confidence: 'insufficient-basis', externalDataNeeded: EXTERNAL_PRICING_NOTE,
        basis: this.redactor.redact('insufficient-basis: 0 backbone facts matched the concept terms — no confident revenue stack is asserted (§5).'),
      };
    }

    // §2 per-stream grounding: cite the real capabilities that SUPPORT each revenue stream.
    const seenAll = new Set<string>();
    const groundedAll: CitedFact[] = [];
    const layers: RevenueLayer[] = REVENUE_STREAMS.map((s) => {
      const facts = this.citeForTerms(STREAM_KEYWORDS[s]);
      for (const f of facts) { if (!seenAll.has(f.ref)) { seenAll.add(f.ref); groundedAll.push(f); } }
      const support = supportFor(facts.length);
      const names = facts.map((f) => f.name);
      const cites = facts.map((f) => f.ref);
      return {
        stream: s,
        recurring: RECURRING.has(s),
        support,
        groundedOn: facts,
        rationale: support === 'none'
          ? `OPINION: no cited ECE capability supports a ${s} revenue layer.`
          : `OPINION (advisory): a ${support}-supported ${s} layer${RECURRING.has(s) ? ' (recurring)' : ''} rests on ECE's cited capabilit${names.length === 1 ? 'y' : 'ies'} ${names.join(', ')} [${cites.join(', ')}].`,
        pricingNote: EXTERNAL_PRICING_NOTE,
      };
    });

    for (const v of concept.sourcingVerdicts ?? []) {
      const ref = `verdict:${norm(v.capability)}`;
      if (!seenAll.has(ref)) { seenAll.add(ref); groundedAll.push({ kind: 'sourcing-verdict', ref, name: v.capability, note: `sourcing verdict ${v.verdict}` }); }
    }
    groundedAll.sort((a, b) => (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0));

    // recurring-revenue-first: the recurring layers with real support, ranked ahead of one-time ones.
    const recurringLayers = layers.filter((l) => l.recurring && (l.support !== 'none')).map((l) => l.stream);
    const supportedRecurring = recurringLayers.length;
    const supportedOneTime = layers.filter((l) => !l.recurring && l.support !== 'none').length;
    const confidence = this.confidenceFor(groundedAll.length);

    return {
      concept: conceptText,
      advisory: true,
      status: PLAN_ONLY,
      layers,
      recurringLayers,
      overall: {
        model: `OPINION (${confidence}): a recurring-revenue-first model — lead with ${supportedRecurring} ECE-supported recurring layer(s) [${recurringLayers.join(', ') || 'none'}], complemented by ${supportedOneTime} one-time/expansion layer(s). Advisory read, not a verified finding; pricing requires external market data.`,
        recurringFirst: supportedRecurring > 0,
      },
      groundedOn: groundedAll,
      confidence,
      externalDataNeeded: EXTERNAL_PRICING_NOTE,
      basis: this.redactor.redact(`${confidence}: grounded on ${groundedAll.length} cited backbone fact(s) of ECE capability SUPPORT. Revenue layers/model are OPINION on top; pricing/WTP/market-size are EXTERNAL data — flagged, not fabricated.`),
    };
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
    if (n <= 5) return 'moderate';
    return 'speculative-high';
  }
}

// ── audit tie-in (§6) — record concept, the assessment, and which facts it cited ──────────────────────────────
export const REVENUE_AUDIT_ALLOWLIST: readonly string[] = [
  'revenueStack', 'event', 'advisory', 'status', 'terms', 'overall', 'model', 'recurringFirst', 'recurringLayers',
  'confidence', 'basis', 'externalDataNeeded', 'groundedOn', 'kind', 'ref', 'name', 'citedCount', 'environment',
];

export class RevenueStackAuditor {
  constructor(
    private readonly sink: Pick<AuditSink, 'appendRead'>,
    private readonly redactor: Pick<RedactionEngine, 'redactSummary'>,
    private readonly organizationId: string,
    private readonly actor: HumanActor,
    private readonly environment: Environment = 'local',
    private readonly session: SessionInfo = { session_id: 'revenue-stack' },
  ) {}

  async record(assessment: RevenueStackAssessment, terms: string[]): Promise<AppendResult> {
    const summary = this.redactor.redactSummary({
      revenueStack: 'assess',
      event: 'revenue.assessed',
      advisory: assessment.advisory,
      status: assessment.status,
      terms,
      overall: { model: assessment.overall.model, recurringFirst: assessment.overall.recurringFirst },
      recurringLayers: assessment.recurringLayers,
      confidence: assessment.confidence,
      basis: assessment.basis,
      externalDataNeeded: assessment.externalDataNeeded,
      groundedOn: assessment.groundedOn.map((f) => ({ kind: f.kind, ref: f.ref, name: f.name })),
      citedCount: assessment.groundedOn.length,
      environment: this.environment,
    });
    return this.sink.appendRead({ organization_id: this.organizationId, human_actor: this.actor, session: this.session, query_range: summary, rows_returned: assessment.groundedOn.length });
  }
}
