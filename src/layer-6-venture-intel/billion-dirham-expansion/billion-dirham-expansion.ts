// Billion-Dirham Expansion Engine (Venture Intelligence Wave — JUDGMENT engine 8; follows the Engines 1–7 template).
//
// Given a venture concept + the structural backbone's facts, it produces an ADVISORY expansion thesis — an OPINION
// on the path to large-scale growth, forcing every idea across the requirement's FIVE LEVELS: Tool → Product →
// Platform → Ecosystem → Category/market-infrastructure (§3b of REQUIREMENT_VENTURE_INTELLIGENCE_LAYER.md). Each
// expansion stage cites which of ECE's real capabilities SUPPORT reaching it. It always shows the maximum version.
// It is a strategic opinion to inform a human, NOT a decision.
//
// THE SHARPEST HONESTY BOUNDARY (this engine leans HARD on market claims):
//   • GROUNDED (fact): the capability side — which cited ECE capabilities enable which expansion stage.
//   • EXTERNAL, NEVER FABRICATED: ALL market-size / TAM / growth-rate / revenue-magnitude / "billion-dirham"
//     NUMBERS. The backbone holds NO market data, so the engine NEVER invents a market size, a growth figure, or a
//     billion-dirham projection — every financial magnitude is FLAGGED as external-data-needed. "Billion-dirham" is
//     the venture's ASPIRATION LABEL (the engine's remit), NOT an engine-asserted projection. It describes the
//     expansion LOGIC grounded in capabilities; it does NOT assert the financial magnitudes.
//
// Governed by blueprint/REQUIREMENT_JUDGMENT_ENGINE_DISCIPLINE.md — every clause enforced, identical to Engines 1–7:
//   §1 ADVISORY, NEVER PROOF — `advisory: true` (literal); OPINION distinct from CITED FACTS.
//   §2 GROUNDED — expansion-stage support read from the Reuse Graph; every capability claim cited by node id.
//   §3 PLAN-ONLY / NO-SELF-EXECUTE (type-level) — no execute/create/approve/mint/mutate/deploy; single plan-only status.
//   §4 INSTRUCTION-BOUNDARY — the concept text is inert DATA (secret-scrubbed, echoed).
//   §5 HONEST UNCERTAINTY — confidence signal; thin ⇒ `insufficient-basis`; ALL financial magnitudes flagged, not faked.
//   §6 AUDITED + REDACTED — records concept + opinion + CITED facts to the hash-chain.
//   §8 NEVER DRIVES A CONSEQUENTIAL ACTION — an expansion OPINION must NEVER trigger a real action.
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

/** The requirement's five expansion levels (§3b): Tool → Product → Platform → Ecosystem → Category. */
export const EXPANSION_LEVELS = ['tool', 'product', 'platform', 'ecosystem', 'category'] as const;
export type ExpansionLevel = (typeof EXPANSION_LEVELS)[number];

/** Deterministic keyword map — which structural capabilities SUPPORT reaching each expansion level (re-derivable). */
const LEVEL_KEYWORDS: Record<ExpansionLevel, readonly string[]> = {
  tool: ['engine', 'audit', 'cli', 'observer'],
  product: ['package', 'preview', 'observer', 'build'],
  platform: ['bridge', 'mcp', 'api', 'gateway', 'registry', 'tool-registry'],
  ecosystem: ['registry', 'domain', 'harvest', 'partner', 'marketplace', 'sourcing'],
  category: ['sovereign', 'trust', 'attestation', 'audit', 'air-gap'],
};

/** One expansion stage — the capabilities that SUPPORT it (fact) + the vector OPINION; financials flagged external. */
export interface ExpansionStage {
  level: ExpansionLevel;
  /** cited ECE capabilities that support reaching this expansion stage (empty ⇒ not yet capability-supported). */
  supportedBy: CitedFact[];
  /** OPINION (advisory) — the expansion vector at this level. */
  opinion: string;
  /** ALL financial magnitude for this stage (market size / growth / revenue) is EXTERNAL — flagged, never fabricated. */
  financialsNote: string;
}

/** THE ASSESSMENT — expansion logic grounded in cited capabilities; ALL market/financial magnitudes flagged external. */
export interface ExpansionAssessment {
  /** echoed inert concept text (secret-scrubbed) */
  concept: string;
  /** LITERAL true — JUDGMENT, never re-derivable proof (§1). */
  advisory: true;
  /** the plan-only status (§3). */
  status: PlanOnlyStatus;
  /** OPINION: the maximum-version thesis. "Billion-dirham" is the venture's aspiration LABEL, not an engine projection. */
  maxVersionThesis: string;
  /** the five expansion stages, each supported by cited capabilities. */
  stages: ExpansionStage[];
  /** the levels ECE capabilities genuinely support (grounded). */
  supportedLevels: ExpansionLevel[];
  /** LITERAL true — the engine asserts NO market size / growth / revenue / billion-dirham NUMBER (all external). */
  assertsNoFinancials: true;
  /** the UNION of all cited backbone facts (§2). */
  groundedOn: CitedFact[];
  /** honest confidence signal (§5). */
  confidence: Confidence;
  /** the SHARPEST external-data boundary — ALL market-size/TAM/growth/revenue/billion-dirham magnitudes need external data. */
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
const EXTERNAL_FINANCIALS_NOTE = 'ALL market size / TAM / growth rate / revenue magnitude / billion-dirham NUMBERS require EXTERNAL market data the structural backbone does not hold — FLAGGED, never fabricated. This engine asserts NO financial figure; it grounds only which cited ECE capabilities SUPPORT each expansion stage.';

function norm(s: string): string { return String(s ?? '').toLowerCase(); }

/**
 * Produces an advisory expansion thesis grounded in cited backbone facts. Its ONLY method is assess() → data. It
 * holds no gate/approval/bridge reference and cannot act. The capability-support facts come from the graph; the
 * expansion vectors are an opinion composed over those cited facts; ALL market/financial magnitudes are FLAGGED
 * external and NEVER fabricated (no invented market size, growth rate, or billion-dirham projection).
 */
export class BillionDirhamExpansionEngine {
  constructor(private readonly graph: GraphReader, private readonly redactor: TextRedactor = IDENTITY_REDACTOR) {}

  assess(concept: VentureConcept): ExpansionAssessment {
    const terms = (concept.terms ?? []).map(norm).filter((t) => t.length > 0);
    const conceptText = this.redactor.redact(String(concept.description ?? ''));

    // §5 CONCEPT GROUNDING GATE: expansion anchored in ECE requires ECE capabilities relevant to the concept —
    // if none, there is no grounded expansion thesis (honest insufficient-basis), not a fabricated one.
    const conceptFacts = this.citeForTerms(terms);
    if (conceptFacts.length === 0) {
      const stages = EXPANSION_LEVELS.map((l): ExpansionStage => ({
        level: l, supportedBy: [],
        opinion: `insufficient basis: no cited ECE capability supports a ${l}-level expansion of this concept (§5).`,
        financialsNote: EXTERNAL_FINANCIALS_NOTE,
      }));
      return {
        concept: conceptText, advisory: true, status: PLAN_ONLY,
        maxVersionThesis: 'OPINION: insufficient basis — the structural backbone cites no ECE capability for this concept, so no grounded expansion path can be proposed. No market magnitude is asserted (all external).',
        stages, supportedLevels: [], assertsNoFinancials: true, groundedOn: [], confidence: 'insufficient-basis',
        externalDataNeeded: EXTERNAL_FINANCIALS_NOTE,
        basis: this.redactor.redact('insufficient-basis: 0 backbone facts matched the concept terms — no confident expansion thesis; no financial magnitude asserted (§5).'),
      };
    }

    // §2 per-level SUPPORT: cite the real capabilities that support reaching each expansion level.
    const groundedAll: CitedFact[] = [];
    const seen = new Set<string>();
    const stages: ExpansionStage[] = EXPANSION_LEVELS.map((l) => {
      const supportedBy = this.citeForTerms(LEVEL_KEYWORDS[l]);
      for (const f of supportedBy) if (!seen.has(f.ref)) { seen.add(f.ref); groundedAll.push(f); }
      return {
        level: l,
        supportedBy,
        opinion: supportedBy.length === 0
          ? `OPINION: no cited ECE capability yet supports the ${l} level — the expansion vector here is unsupported (would need building).`
          : `OPINION (advisory): reach the ${l} level on ECE's cited capabilit${supportedBy.length === 1 ? 'y' : 'ies'} ${supportedBy.map((f) => f.name).join(', ')} [${supportedBy.map((f) => f.ref).join(', ')}]. Market magnitude at this level is EXTERNAL — not asserted.`,
        financialsNote: EXTERNAL_FINANCIALS_NOTE,
      };
    });

    for (const v of concept.sourcingVerdicts ?? []) {
      const ref = `verdict:${norm(v.capability)}`;
      if (!seen.has(ref)) { seen.add(ref); groundedAll.push({ kind: 'sourcing-verdict', ref, name: v.capability, note: `sourcing verdict ${v.verdict}` }); }
    }
    groundedAll.sort((a, b) => (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0));

    const supportedLevels = stages.filter((s) => s.supportedBy.length > 0).map((s) => s.level);
    const confidence = this.confidenceFor(groundedAll.length);

    return {
      concept: conceptText,
      advisory: true,
      status: PLAN_ONLY,
      // "billion-dirham" is the venture's ASPIRATION LABEL (the engine's remit) — NOT an engine-asserted number.
      maxVersionThesis: `OPINION (${confidence}): the maximum-version (the venture's billion-dirham aspiration) forces the idea from tool to category — ECE capabilities genuinely support ${supportedLevels.length} of 5 level(s) [${supportedLevels.join(' → ') || 'none'}]. This is an advisory expansion LOGIC; every market size / growth / revenue magnitude is EXTERNAL and NOT asserted here.`,
      stages,
      supportedLevels,
      assertsNoFinancials: true,
      groundedOn: groundedAll,
      confidence,
      externalDataNeeded: EXTERNAL_FINANCIALS_NOTE,
      basis: this.redactor.redact(`${confidence}: grounded on ${groundedAll.length} cited backbone capability-support fact(s). Expansion vectors are OPINION on top; the capabilities are the only facts, each cited; ALL market/financial magnitudes are EXTERNAL — flagged, never fabricated (no invented market size, growth rate, or billion-dirham number).`),
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
export const EXPANSION_AUDIT_ALLOWLIST: readonly string[] = [
  'expansion', 'event', 'advisory', 'status', 'terms', 'maxVersionThesis', 'supportedLevels', 'assertsNoFinancials',
  'confidence', 'basis', 'externalDataNeeded', 'groundedOn', 'kind', 'ref', 'name', 'citedCount', 'environment',
];

export class ExpansionAuditor {
  constructor(
    private readonly sink: Pick<AuditSink, 'appendRead'>,
    private readonly redactor: Pick<RedactionEngine, 'redactSummary'>,
    private readonly organizationId: string,
    private readonly actor: HumanActor,
    private readonly environment: Environment = 'local',
    private readonly session: SessionInfo = { session_id: 'billion-dirham-expansion' },
  ) {}

  async record(assessment: ExpansionAssessment, terms: string[]): Promise<AppendResult> {
    const summary = this.redactor.redactSummary({
      expansion: 'assess',
      event: 'expansion.assessed',
      advisory: assessment.advisory,
      status: assessment.status,
      terms,
      maxVersionThesis: assessment.maxVersionThesis,
      supportedLevels: assessment.supportedLevels,
      assertsNoFinancials: assessment.assertsNoFinancials,
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
