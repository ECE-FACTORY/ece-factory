// Category Creation (Venture Intelligence Wave — first JUDGMENT engine; the TEMPLATE for the ~9 judgment engines).
//
// Given a venture concept + the structural backbone's facts, it produces an ADVISORY Category Thesis — an OPINION
// on how ECE could define and own a market category (proposed category/positioning, why-now, wedge), grounded in
// CITED backbone capabilities. It is a strategic opinion to inform a human — NOT a fact, NOT a decision.
//
// It is governed by blueprint/REQUIREMENT_JUDGMENT_ENGINE_DISCIPLINE.md. Every clause is enforced here:
//   §1 ADVISORY, NEVER PROOF — the output is `advisory: true` (a literal type; it can NEVER be false) and the
//      OPINION is a distinct object from the CITED FACTS (`groundedOn`) — a confident opinion never occupies the
//      type position of a proof.
//   §2 GROUNDED IN CITED FACTS — every factual ECE-capability claim is READ from the structural Reuse Graph (via
//      its read-only search port) and CITED by node id + lineage. It fabricates NO capability; the opinion is only
//      what it ADDS on top of the cited facts.
//   §3 PLAN-ONLY / NO-SELF-EXECUTE (type-level) — no execute/create/approve/mint/mutate/deploy method or ref; the
//      output carries the single plan-only status literal; the forbidden statuses are UNREPRESENTABLE in its types.
//   §4 INSTRUCTION-BOUNDARY — the concept text is inert DATA (stored, secret-scrubbed, echoed as quoted content);
//      command-like text has no effect. No dynamic code-execution or outbound network is driven by input.
//   §5 HONEST UNCERTAINTY — an explicit confidence signal; when the cited facts don't support a thesis it reports
//      `insufficient-basis` rather than fabricating a confident category. No false precision (never "proven").
//   §6 AUDITED + REDACTED — producing a thesis records (concept, opinion, CITED facts) to the hash-chain; no secret.
//   §8 NEVER DRIVES A CONSEQUENTIAL ACTION — it INFORMS a human; it has no path to a gate/build/adoption.
//
// STANDALONE-PACKAGEABLE (§7): every cross-engine reference is `import type` / injected (the graph node types + the
// redactor). Zero runtime engine coupling.

import type { CapabilityNode, CapabilityQuery } from '../../factory-shared/capability-reuse-graph/capability-reuse-graph.js';
import type { TextRedactor } from '../../layer-4-build-harden/build-observer/build-observer.js';
import type { AuditSink, AppendResult } from '../../factory-shared/audit-engine/sink.js';
import type { HumanActor, SessionInfo, Environment } from '../../factory-shared/audit-engine/schema.js';
import type { RedactionEngine } from '../../factory-shared/redaction-engine/redaction-engine.js';

/** The read-only slice of the Phase-1 graph this engine grounds on (it never mutates it). */
export interface GraphReader { search(q?: CapabilityQuery): CapabilityNode[] }

/** The single plan-only status literal (§3). The forbidden statuses are simply not part of this type — a thesis
 *  CANNOT be marked APPROVED/CREATED/EXECUTED/DEPLOYED/SIGNED_OFF/REPO_CREATED/PRODUCT_LIVE/AUTHORIZED. */
export type PlanOnlyStatus = 'VENTURE-BLUEPRINT-AWAITING-HUMAN-APPROVAL';

export interface VentureConcept {
  /** inert DATA — never instruction */
  description: string;
  /** the normalized terms the thesis is grounded against (the caller supplies structured terms) */
  terms: string[];
  /** OPTIONAL: unified sourcing verdicts (from Phase-4) the caller wants cited as additional grounding facts */
  sourcingVerdicts?: Array<{ capability: string; verdict: string }>;
}

/** One CITED fact — traces to a real structural-backbone node (or a Phase-4 verdict). NOT an opinion. */
export interface CitedFact {
  kind: 'capability' | 'sourcing-verdict';
  ref: string;   // the Reuse-Graph node id, or the capability the verdict is about
  name: string;
  note: string;  // what the fact is (from the backbone) — e.g. the capability kind + lineage, or the verdict
}

export type Confidence = 'insufficient-basis' | 'low' | 'moderate' | 'speculative-high';

/** THE OPINION — clearly separated from the cited facts. This is what the engine ADDS; it is not a proof. */
export interface CategoryOpinion {
  proposedCategory: string;
  positioning: string;
  whyNow: string;
  wedge: string;
}

export interface CategoryThesis {
  /** echoed inert concept text (secret-scrubbed) */
  concept: string;
  /** LITERAL true — this is a JUDGMENT, never re-derivable proof (§1). */
  advisory: true;
  /** the plan-only status (§3) — the ONLY status representable. */
  status: PlanOnlyStatus;
  /** the opinion the engine adds on top of the facts (§1 separation). */
  opinion: CategoryOpinion;
  /** the CITED backbone facts the opinion is grounded on (§2) — every one traces to the injected structural layer. */
  groundedOn: CitedFact[];
  /** honest confidence signal (§5). */
  confidence: Confidence;
  /** an explicit statement of the basis / its insufficiency (§5) — no false precision. */
  basis: string;
}

const IDENTITY_REDACTOR: TextRedactor = { redact: (s) => s };
const PLAN_ONLY: PlanOnlyStatus = 'VENTURE-BLUEPRINT-AWAITING-HUMAN-APPROVAL';

function norm(s: string): string { return String(s ?? '').toLowerCase(); }

/**
 * Produces an advisory Category Thesis grounded in cited backbone facts. Its ONLY method is propose() → data. It
 * holds no gate/approval/bridge reference and can neither act nor mutate the graph. The FACTS come from the graph;
 * the OPINION is a deterministic composition over those cited facts (an LLM could phrase it, but may NOT add facts).
 */
export class CategoryCreationEngine {
  constructor(private readonly graph: GraphReader, private readonly redactor: TextRedactor = IDENTITY_REDACTOR) {}

  propose(concept: VentureConcept): CategoryThesis {
    const terms = (concept.terms ?? []).map(norm).filter((t) => t.length > 0);
    const conceptText = this.redactor.redact(String(concept.description ?? ''));

    // §2 GROUND: read real capabilities from the structural graph. Cite ONLY nodes the graph actually returned —
    // fabricate nothing. Deterministic selection (dedupe by id, stable order) so the grounding is inspectable.
    const seen = new Set<string>();
    const grounded: CitedFact[] = [];
    for (const t of terms) {
      for (const n of this.graph.search({ text: t })) {
        if (seen.has(n.id)) continue;
        seen.add(n.id);
        grounded.push({ kind: 'capability', ref: n.id, name: n.name, note: `${n.kind} at ${n.source}${n.posture.hasTests ? ' (tested)' : ''}` });
      }
    }
    // optional Phase-4 sourcing verdicts as additional CITED facts (the caller vouches they came from Phase-4).
    for (const v of concept.sourcingVerdicts ?? []) {
      const ref = `verdict:${norm(v.capability)}`;
      if (seen.has(ref)) continue;
      seen.add(ref);
      grounded.push({ kind: 'sourcing-verdict', ref, name: v.capability, note: `sourcing verdict ${v.verdict}` });
    }
    grounded.sort((a, b) => (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0));

    const confidence = this.confidenceFor(grounded.length);
    const [opinion, basis] = this.composeOpinion(terms, grounded, confidence);

    return {
      concept: conceptText,
      advisory: true,
      status: PLAN_ONLY,
      opinion,
      groundedOn: grounded,
      confidence,
      basis: this.redactor.redact(basis),
    };
  }

  private confidenceFor(n: number): Confidence {
    if (n === 0) return 'insufficient-basis';
    if (n <= 2) return 'low';
    if (n <= 4) return 'moderate';
    return 'speculative-high';
  }

  /**
   * Deterministic opinion composition over the CITED facts. It names ONLY capabilities present in `grounded`
   * (no fabricated capability can appear), and it stays honest — labeled opinion, never "proven"; an empty
   * grounding yields an explicit insufficient-basis thesis rather than a confident fabrication.
   */
  private composeOpinion(terms: string[], grounded: CitedFact[], confidence: Confidence): [CategoryOpinion, string] {
    const topic = terms[0] ?? 'the concept';
    if (grounded.length === 0) {
      return [
        {
          proposedCategory: `(insufficient basis) no ECE capability grounds a category for "${topic}"`,
          positioning: 'The structural backbone cites no ECE capability matching this concept; asserting a category here would be speculation, not a grounded opinion.',
          whyNow: 'n/a — insufficient basis (no cited facts).',
          wedge: 'n/a — insufficient basis. Recommend: run the structural sourcing (Phases 2–4) to establish what ECE could own before forming a category thesis.',
        },
        'insufficient-basis: 0 backbone facts matched the concept terms — no confident category is asserted (honest uncertainty, §5).',
      ];
    }
    const names = grounded.map((f) => f.name);
    const cites = grounded.map((f) => f.ref);
    const lead = grounded[0];
    return [
      {
        proposedCategory: `OPINION: "Sovereign ${topic}" — a category ECE is positioned to define`,
        positioning: `OPINION (advisory): position ECE as the sovereign, air-gapped ${topic} platform, built on ECE's cited capabilities: ${names.join(', ')} [${cites.join(', ')}].`,
        whyNow: `OPINION: "why now" rests on ECE already owning ${grounded.length} relevant, cited capabilit${grounded.length === 1 ? 'y' : 'ies'} (${names.join(', ')}) — a head start; this is a ${confidence} advisory thesis, not a verified finding.`,
        wedge: `OPINION: lead the wedge with ${lead.name} [${lead.ref}] — a cited ECE capability — as the initial beachhead, expanding as the other cited capabilities are hardened.`,
      },
      `${confidence}: grounded on ${grounded.length} cited backbone fact${grounded.length === 1 ? '' : 's'} (${cites.join(', ')}). The category and positioning are OPINION added on top; the capabilities are the only facts, and each is cited.`,
    ];
  }
}

// ── audit tie-in (§6) — record what concept was asked, the thesis given, and which facts it cited ──────────────
export const CATEGORY_AUDIT_ALLOWLIST: readonly string[] = [
  'categoryCreation', 'event', 'advisory', 'status', 'terms', 'proposedCategory', 'confidence', 'basis',
  'groundedOn', 'kind', 'ref', 'name', 'citedCount', 'environment',
];

export class CategoryThesisAuditor {
  constructor(
    private readonly sink: Pick<AuditSink, 'appendRead'>,
    private readonly redactor: Pick<RedactionEngine, 'redactSummary'>,
    private readonly organizationId: string,
    private readonly actor: HumanActor,
    private readonly environment: Environment = 'local',
    private readonly session: SessionInfo = { session_id: 'category-creation' },
  ) {}

  async record(thesis: CategoryThesis, terms: string[]): Promise<AppendResult> {
    const summary = this.redactor.redactSummary({
      categoryCreation: 'propose',
      event: 'category.proposed',
      advisory: thesis.advisory,
      status: thesis.status,
      terms,
      proposedCategory: thesis.opinion.proposedCategory,
      confidence: thesis.confidence,
      basis: thesis.basis,
      groundedOn: thesis.groundedOn.map((f) => ({ kind: f.kind, ref: f.ref, name: f.name })),
      citedCount: thesis.groundedOn.length,
      environment: this.environment,
    });
    return this.sink.appendRead({ organization_id: this.organizationId, human_actor: this.actor, session: this.session, query_range: summary, rows_returned: thesis.groundedOn.length });
  }
}
