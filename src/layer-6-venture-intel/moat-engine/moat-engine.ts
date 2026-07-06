// Moat Engine (Venture Intelligence Wave — JUDGMENT engine 2; follows the Category-Creation judgment-tier template).
//
// Given a venture concept + the structural backbone's facts, it produces an ADVISORY Moat assessment — an OPINION
// on the durable competitive advantage / defensibility ECE could build, scored across the requirement's moat
// taxonomy (data / workflow / compliance / distribution / integration / brand / sovereign / ecosystem /
// switching-cost / partner / regulatory). A moat component can only rest on ECE capabilities that GENUINELY EXIST
// in the injected structural backbone (each CITED by Reuse-Graph node id) — it fabricates nothing. A weak/absent
// moat is FLAGGED with a proposed strengthening (per §3b of REQUIREMENT_VENTURE_INTELLIGENCE_LAYER.md). It is a
// strategic opinion to inform a human — NOT a fact, NOT a decision.
//
// Governed by blueprint/REQUIREMENT_JUDGMENT_ENGINE_DISCIPLINE.md — every clause enforced, identical to Category
// Creation (the template):
//   §1 ADVISORY, NEVER PROOF — `advisory: true` (literal type; never false); the OPINION (strengths/rationale) is
//      a distinct object from the CITED FACTS (`groundedOn`) — a confident opinion never occupies a proof's position.
//   §2 GROUNDED IN CITED FACTS — every moat-constituting capability is READ from the structural Reuse Graph (its
//      read-only search port) and CITED by node id + lineage; the opinion is only what it ADDS on top.
//   §3 PLAN-ONLY / NO-SELF-EXECUTE (type-level) — no execute/create/approve/mint/mutate/deploy method or ref; the
//      output carries the single plan-only status literal; the forbidden statuses are UNREPRESENTABLE in its types.
//   §4 INSTRUCTION-BOUNDARY — the concept text is inert DATA (stored, secret-scrubbed, echoed as quoted content).
//   §5 HONEST UNCERTAINTY — an explicit confidence signal; thin/absent grounding ⇒ `insufficient-basis`, not a
//      confident fabricated moat. No false precision (never "proven").
//   §6 AUDITED + REDACTED — producing an assessment records (concept, opinion, CITED facts) to the hash-chain.
//   §8 NEVER DRIVES A CONSEQUENTIAL ACTION — it INFORMS a human; it has no path to a gate/build/adoption.
//
// STANDALONE-PACKAGEABLE (§7): every cross-engine reference is `import type` / injected (the graph node types + the
// redactor). Zero runtime engine coupling. The judgment-tier shapes mirror Category Creation by CONVENTION (the
// template), each engine self-contained — no cross-judgment-engine dependency.

import type { CapabilityNode, CapabilityQuery } from '../../factory-shared/capability-reuse-graph/capability-reuse-graph.js';
import type { TextRedactor } from '../../layer-4-build-harden/build-observer/build-observer.js';
import type { AuditSink, AppendResult } from '../../factory-shared/audit-engine/sink.js';
import type { HumanActor, SessionInfo, Environment } from '../../factory-shared/audit-engine/schema.js';
import type { RedactionEngine } from '../../factory-shared/redaction-engine/redaction-engine.js';

/** The read-only slice of the Phase-1 graph this engine grounds on (it never mutates it). */
export interface GraphReader { search(q?: CapabilityQuery): CapabilityNode[] }

/** The single plan-only status literal (§3). Forbidden statuses (APPROVED/CREATED/EXECUTED/…) are not part of the type. */
export type PlanOnlyStatus = 'VENTURE-BLUEPRINT-AWAITING-HUMAN-APPROVAL';

/** One CITED fact — traces to a real structural-backbone node (or a Phase-4 verdict). NOT an opinion. */
export interface CitedFact {
  kind: 'capability' | 'sourcing-verdict';
  ref: string;   // the Reuse-Graph node id, or the capability the verdict is about
  name: string;
  note: string;  // what the fact is (from the backbone) — e.g. the capability kind + lineage
}

export type Confidence = 'insufficient-basis' | 'low' | 'moderate' | 'speculative-high';
export type MoatStrength = 'none' | 'weak' | 'moderate' | 'strong';

/** The requirement's moat taxonomy (§3b). */
export const MOAT_DIMENSIONS = [
  'data', 'workflow', 'compliance', 'distribution', 'integration',
  'brand', 'sovereign', 'ecosystem', 'switching-cost', 'partner', 'regulatory',
] as const;
export type MoatDimension = (typeof MOAT_DIMENSIONS)[number];

/** Deterministic keyword map — which structural capabilities constitute each moat dimension (re-derivable). */
const DIMENSION_KEYWORDS: Record<MoatDimension, readonly string[]> = {
  data: ['audit', 'hash', 'attestation', 'ledger', 'evidence'],
  workflow: ['engine', 'pipeline', 'orchestrat', 'workflow', 'automation', 'autopilot'],
  compliance: ['compliance', 'license', 'redaction', 'policy', 'audit'],
  distribution: ['package', 'preview', 'deploy', 'observer', 'build'],
  integration: ['bridge', 'mcp', 'adapter', 'gateway', 'api', 'tool-registry'],
  brand: ['white-label', 'brand'],
  sovereign: ['sovereign', 'air-gap', 'offline', 'did', 'trust', 'attestation'],
  ecosystem: ['registry', 'domain', 'project', 'harvest', 'repo-intelligence'],
  'switching-cost': ['audit', 'attestation', 'chain', 'lineage', 'evidence'],
  partner: ['harvest', 'sourcing', 'partner', 'scoring'],
  regulatory: ['sovereign', 'compliance', 'license', 'redaction', 'kill'],
};

/** One moat dimension's assessment — the strength OPINION, grounded on CITED facts (empty ⇒ flagged + strengthening). */
export interface MoatComponent {
  dimension: MoatDimension;
  /** OPINION: how strong this moat is, given the cited facts. */
  strength: MoatStrength;
  /** the CITED backbone capabilities that constitute this moat — every one traces to the injected graph. */
  groundedOn: CitedFact[];
  /** OPINION rationale (advisory). */
  rationale: string;
  /** present iff weak/none — the requirement's "weak moat ⇒ flag + proposed strengthening" (opinion). */
  strengthening?: string;
}

/** THE ASSESSMENT — the opinion (strengths/rationale/strengthenings) sits ON TOP of the cited facts, never as proof. */
export interface MoatAssessment {
  /** echoed inert concept text (secret-scrubbed) */
  concept: string;
  /** LITERAL true — this is a JUDGMENT, never re-derivable proof (§1). */
  advisory: true;
  /** the plan-only status (§3) — the ONLY status representable. */
  status: PlanOnlyStatus;
  /** per-dimension moat opinions, each grounded on cited facts. */
  components: MoatComponent[];
  /** OPINION: the overall defensibility read. */
  overall: { strength: MoatStrength; summary: string };
  /** dimensions flagged weak/none (requirement §3b) — each has a `strengthening` in its component. */
  weakMoats: MoatDimension[];
  /** the UNION of all cited backbone facts (§2) — every one traces to the injected structural layer. */
  groundedOn: CitedFact[];
  /** honest confidence signal (§5). */
  confidence: Confidence;
  /** an explicit statement of the basis / its insufficiency (§5) — no false precision. */
  basis: string;
}

export interface VentureConcept {
  /** inert DATA — never instruction */
  description: string;
  /** the normalized terms the assessment is grounded against (the caller supplies structured terms) */
  terms: string[];
  /** OPTIONAL: unified sourcing verdicts (from Phase-4) the caller wants cited as additional grounding facts */
  sourcingVerdicts?: Array<{ capability: string; verdict: string }>;
}

const IDENTITY_REDACTOR: TextRedactor = { redact: (s) => s };
const PLAN_ONLY: PlanOnlyStatus = 'VENTURE-BLUEPRINT-AWAITING-HUMAN-APPROVAL';

function norm(s: string): string { return String(s ?? '').toLowerCase(); }
function strengthFor(n: number): MoatStrength { return n === 0 ? 'none' : n === 1 ? 'weak' : n === 2 ? 'moderate' : 'strong'; }

/**
 * Produces an advisory Moat assessment grounded in cited backbone facts. Its ONLY method is assess() → data. It
 * holds no gate/approval/bridge reference and can neither act nor mutate the graph. The FACTS come from the graph;
 * the OPINION (strengths, rationale, strengthenings) is a deterministic composition over those cited facts.
 */
export class MoatEngine {
  constructor(private readonly graph: GraphReader, private readonly redactor: TextRedactor = IDENTITY_REDACTOR) {}

  assess(concept: VentureConcept): MoatAssessment {
    const terms = (concept.terms ?? []).map(norm).filter((t) => t.length > 0);
    const conceptText = this.redactor.redact(String(concept.description ?? ''));

    // §2 CONCEPT GROUNDING GATE: the moat is ECE's advantage FOR this venture — if NO ECE capability relates to
    // the concept at all, there is no grounded moat (honest insufficient-basis, §5), not a fabricated one.
    const conceptFacts = this.citeForTerms(terms);
    if (conceptFacts.length === 0) {
      const components = MOAT_DIMENSIONS.map((d): MoatComponent => ({
        dimension: d, strength: 'none', groundedOn: [],
        rationale: `insufficient basis: no ECE capability in the structural backbone relates to this concept — no ${d} moat can be asserted (honest uncertainty, §5).`,
        strengthening: `establish an ECE capability relevant to this concept first (run the structural sourcing, Phases 2–4), then reassess the ${d} moat.`,
      }));
      return {
        concept: conceptText, advisory: true, status: PLAN_ONLY, components,
        overall: { strength: 'none', summary: 'OPINION: insufficient basis — the structural backbone cites no ECE capability for this concept, so no defensibility can be grounded. Asserting a moat here would be speculation.' },
        weakMoats: [...MOAT_DIMENSIONS], groundedOn: [], confidence: 'insufficient-basis',
        basis: this.redactor.redact('insufficient-basis: 0 backbone facts matched the concept terms — no confident moat is asserted (§5).'),
      };
    }

    // §2 per-dimension grounding: cite the real capabilities that constitute each moat dimension.
    const seenAll = new Set<string>();
    const groundedAll: CitedFact[] = [];
    const components: MoatComponent[] = MOAT_DIMENSIONS.map((d) => {
      const facts = this.citeForTerms(DIMENSION_KEYWORDS[d]);
      for (const f of facts) { if (!seenAll.has(f.ref)) { seenAll.add(f.ref); groundedAll.push(f); } }
      const strength = strengthFor(facts.length);
      const names = facts.map((f) => f.name);
      const cites = facts.map((f) => f.ref);
      const component: MoatComponent = {
        dimension: d, strength, groundedOn: facts,
        rationale: strength === 'none'
          ? `OPINION: no cited ECE capability constitutes a ${d} moat for this venture.`
          : `OPINION (advisory): a ${strength} ${d} moat rests on ECE's cited capabilit${names.length === 1 ? 'y' : 'ies'} ${names.join(', ')} [${cites.join(', ')}].`,
      };
      if (strength === 'none' || strength === 'weak') {
        component.strengthening = strength === 'none'
          ? `OPINION: ECE has no cited ${d} capability — propose building/acquiring one to open a ${d} moat.`
          : `OPINION: the ${d} moat rests on a single cited capability (${names[0]}) — propose hardening/broadening it (add ${d}-reinforcing capabilities) to deepen defensibility.`;
      }
      return component;
    });

    // optional Phase-4 sourcing verdicts as additional CITED facts (the caller vouches they came from Phase-4).
    for (const v of concept.sourcingVerdicts ?? []) {
      const ref = `verdict:${norm(v.capability)}`;
      if (!seenAll.has(ref)) { seenAll.add(ref); groundedAll.push({ kind: 'sourcing-verdict', ref, name: v.capability, note: `sourcing verdict ${v.verdict}` }); }
    }
    groundedAll.sort((a, b) => (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0));

    const weakMoats = components.filter((c) => c.strength === 'none' || c.strength === 'weak').map((c) => c.dimension);
    const strongCount = components.filter((c) => c.strength === 'strong' || c.strength === 'moderate').length;
    const overallStrength: MoatStrength = strongCount >= 4 ? 'strong' : strongCount >= 2 ? 'moderate' : strongCount >= 1 ? 'weak' : 'none';
    const confidence = this.confidenceFor(groundedAll.length);

    return {
      concept: conceptText,
      advisory: true,
      status: PLAN_ONLY,
      components,
      overall: {
        strength: overallStrength,
        summary: `OPINION (${confidence}): ECE could build a ${overallStrength} overall moat, strongest in [${components.filter((c) => c.strength === 'strong').map((c) => c.dimension).join(', ') || 'none'}]; ${weakMoats.length} weak/absent moat(s) flagged with strengthenings. This is an advisory read, not a verified finding.`,
      },
      weakMoats,
      groundedOn: groundedAll,
      confidence,
      basis: this.redactor.redact(`${confidence}: grounded on ${groundedAll.length} cited backbone fact(s). Moat strengths/rationale/strengthenings are OPINION on top; the capabilities are the only facts, each cited.`),
    };
  }

  /** Cite the real graph capabilities matching any of the given terms (dedupe by id, stable order). No fabrication. */
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

// ── audit tie-in (§6) — record what concept was asked, the assessment given, and which facts it cited ──────────
export const MOAT_AUDIT_ALLOWLIST: readonly string[] = [
  'moatEngine', 'event', 'advisory', 'status', 'terms', 'overall', 'strength', 'summary', 'weakMoats',
  'confidence', 'basis', 'groundedOn', 'kind', 'ref', 'name', 'citedCount', 'environment',
];

export class MoatAssessmentAuditor {
  constructor(
    private readonly sink: Pick<AuditSink, 'appendRead'>,
    private readonly redactor: Pick<RedactionEngine, 'redactSummary'>,
    private readonly organizationId: string,
    private readonly actor: HumanActor,
    private readonly environment: Environment = 'local',
    private readonly session: SessionInfo = { session_id: 'moat-engine' },
  ) {}

  async record(assessment: MoatAssessment, terms: string[]): Promise<AppendResult> {
    const summary = this.redactor.redactSummary({
      moatEngine: 'assess',
      event: 'moat.assessed',
      advisory: assessment.advisory,
      status: assessment.status,
      terms,
      overall: { strength: assessment.overall.strength, summary: assessment.overall.summary },
      weakMoats: assessment.weakMoats,
      confidence: assessment.confidence,
      basis: assessment.basis,
      groundedOn: assessment.groundedOn.map((f) => ({ kind: f.kind, ref: f.ref, name: f.name })),
      citedCount: assessment.groundedOn.length,
      environment: this.environment,
    });
    return this.sink.appendRead({ organization_id: this.organizationId, human_actor: this.actor, session: this.session, query_range: summary, rows_returned: assessment.groundedOn.length });
  }
}
