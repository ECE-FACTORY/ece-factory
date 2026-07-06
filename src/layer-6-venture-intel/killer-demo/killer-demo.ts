// Killer Demo Engine (Venture Intelligence Wave — JUDGMENT engine 6; follows the Engines 1–5 template).
//
// Given a venture concept + the structural backbone's facts, it produces an ADVISORY killer-demo assessment — an
// OPINION on the single most compelling demonstration that would prove the venture's thesis, across the requirement's
// demo formats (3-minute, boardroom, technical, government, investor, exhibition, made-in-the-emirates; §3b of
// REQUIREMENT_VENTURE_INTELLIGENCE_LAYER.md): WHAT to show, WHICH of ECE's real capabilities (cited from the backbone)
// make that demo buildable/credible, and WHY it lands. A demo can ONLY claim to showcase capabilities ECE genuinely
// has (cited). It is a strategic opinion to inform a human, NOT a decision.
//
// TWO HONESTY BOUNDARIES:
//   • RECOMMENDS, NEVER BUILDS/RUNS (this engine's specific one): it RECOMMENDS a demo — it has NO build/run/deploy/
//     render/present path. An actual demo build routes through the factory's NORMAL gated build path, never here.
//   • AUDIENCE / MARKET IMPACT is EXTERNAL: how an audience reacts / the market impact needs external data the backbone
//     does NOT hold — FLAGGED (`impactNote` / `externalDataNeeded`), never fabricated. Only the buildability/
//     credibility side (which cited ECE capabilities make the demo real) is grounded.
//
// Governed by blueprint/REQUIREMENT_JUDGMENT_ENGINE_DISCIPLINE.md — every clause enforced, identical to Engines 1–5:
//   §1 ADVISORY, NEVER PROOF — `advisory: true` (literal); OPINION distinct from CITED FACTS.
//   §2 GROUNDED — the demo's buildability/credibility read from the Reuse Graph; every capability claim cited by node id.
//   §3 PLAN-ONLY / NO-SELF-EXECUTE (type-level) — no execute/create/approve/mint/mutate/deploy AND critically NO
//      build/run/deploy/render/present-the-demo method or path; single plan-only status.
//   §4 INSTRUCTION-BOUNDARY — the concept text is inert DATA (secret-scrubbed, echoed).
//   §5 HONEST UNCERTAINTY — confidence signal; thin ⇒ `insufficient-basis`; audience/market impact flagged, not faked.
//   §6 AUDITED + REDACTED — records concept + opinion + CITED facts to the hash-chain.
//   §8 NEVER DRIVES A CONSEQUENTIAL ACTION — a demo RECOMMENDATION must NEVER trigger an actual build/run.
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

/** The requirement's demo formats (§3b). */
export const DEMO_FORMATS = [
  '3-minute', 'boardroom', 'technical', 'government', 'investor', 'exhibition', 'made-in-the-emirates',
] as const;
export type DemoFormat = (typeof DEMO_FORMATS)[number];

/** Deterministic keyword map — which structural capabilities each demo format best showcases (re-derivable). */
const FORMAT_KEYWORDS: Record<DemoFormat, readonly string[]> = {
  '3-minute': ['audit', 'sovereign', 'attestation', 'preview'],
  boardroom: ['sovereign', 'audit', 'compliance', 'trust'],
  technical: ['engine', 'audit', 'bridge', 'mcp', 'hash', 'redaction'],
  government: ['sovereign', 'air-gap', 'compliance', 'audit', 'kill'],
  investor: ['sovereign', 'audit', 'attestation', 'registry', 'package'],
  exhibition: ['preview', 'package', 'observer', 'attestation'],
  'made-in-the-emirates': ['sovereign', 'trust', 'attestation', 'air-gap'],
};

/** One demo format's view — which cited capabilities it showcases + framing OPINION; audience impact flagged external. */
export interface DemoFormatView {
  format: DemoFormat;
  /** cited ECE capabilities this demo showcases (grounded — every one traces to the injected graph). */
  showcases: CitedFact[];
  /** OPINION (advisory) framing for this format/audience. */
  opinion: string;
  /** audience reaction / market impact — EXTERNAL data the backbone lacks (flagged, never fabricated). */
  impactNote: string;
}

/** THE ASSESSMENT — buildability grounded in cited facts; audience/market impact flagged; RECOMMENDS, never builds. */
export interface KillerDemoAssessment {
  /** echoed inert concept text (secret-scrubbed) */
  concept: string;
  /** LITERAL true — JUDGMENT, never re-derivable proof (§1). */
  advisory: true;
  /** the plan-only status (§3). */
  status: PlanOnlyStatus;
  /** OPINION: the single most compelling demo, grounded on the strongest cited capability. */
  headline: { opinion: string; groundedOn: CitedFact[] };
  /** the CITED ECE capabilities that make the demo BUILDABLE / CREDIBLE (grounded fact). */
  buildability: CitedFact[];
  /** per-format demo framing (each showcasing cited capabilities; audience impact flagged external). */
  formats: DemoFormatView[];
  /** LITERAL true — this engine RECOMMENDS a demo; it does NOT build/run one (a build routes through the gated path). */
  recommendsOnly: true;
  /** the UNION of all cited backbone facts (§2). */
  groundedOn: CitedFact[];
  /** honest confidence signal (§5). */
  confidence: Confidence;
  /** honest external-data boundary (§5) — audience reaction / market impact needs external data, never fabricated. */
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
const EXTERNAL_IMPACT_NOTE = 'Audience reaction and market impact require EXTERNAL data (real audience testing / market signal) the structural backbone does not hold — FLAGGED, never fabricated. Only the demo\'s buildability from cited ECE capabilities is grounded here.';

function norm(s: string): string { return String(s ?? '').toLowerCase(); }

/**
 * Produces an advisory killer-demo assessment grounded in cited backbone facts. Its ONLY method is assess() → data.
 * It holds no gate/approval/bridge reference and — critically — NO build/run/deploy/render/present path: it
 * RECOMMENDS a demo, it never builds or runs one. The buildability facts come from the graph; the framing is an
 * opinion composed over those cited facts; audience/market impact is FLAGGED external, never fabricated.
 */
export class KillerDemoEngine {
  constructor(private readonly graph: GraphReader, private readonly redactor: TextRedactor = IDENTITY_REDACTOR) {}

  assess(concept: VentureConcept): KillerDemoAssessment {
    const terms = (concept.terms ?? []).map(norm).filter((t) => t.length > 0);
    const conceptText = this.redactor.redact(String(concept.description ?? ''));

    // §2 GROUND: buildability = cited capabilities matching the concept terms (what ECE can genuinely SHOW).
    const buildability = this.citeForTerms(terms);

    // §5 CONCEPT GROUNDING GATE: a demo can only showcase real capabilities — if ECE has none for the concept,
    // there is no grounded demo (honest insufficient-basis), not a fabricated one.
    if (buildability.length === 0) {
      const formats = DEMO_FORMATS.map((f): DemoFormatView => ({
        format: f, showcases: [],
        opinion: `insufficient basis: no cited ECE capability makes a ${f} demo of this concept buildable/credible — recommending one would be speculation (§5).`,
        impactNote: EXTERNAL_IMPACT_NOTE,
      }));
      return {
        concept: conceptText, advisory: true, status: PLAN_ONLY,
        headline: { opinion: 'insufficient basis — no cited ECE capability to build a credible demo around.', groundedOn: [] },
        buildability: [], formats, recommendsOnly: true, groundedOn: [], confidence: 'insufficient-basis',
        externalDataNeeded: EXTERNAL_IMPACT_NOTE,
        basis: this.redactor.redact('insufficient-basis: 0 backbone facts matched the concept terms — no confident killer demo is recommended (§5).'),
      };
    }

    const lead = buildability[0];
    const buildNames = buildability.map((f) => f.name);

    // §2 per-format: each demo showcases the cited capabilities its audience cares about (subset; falls back to all).
    const groundedAll: CitedFact[] = [...buildability];
    const formats: DemoFormatView[] = DEMO_FORMATS.map((f) => {
      const emphasis = this.citeForTerms(FORMAT_KEYWORDS[f]);
      const emphasisIds = new Set(emphasis.map((x) => x.ref));
      // showcase the concept-relevant capabilities this format emphasizes; if none, showcase all buildability.
      const showcases = buildability.filter((b) => emphasisIds.has(b.ref));
      const shown = showcases.length > 0 ? showcases : buildability;
      for (const s of shown) if (!groundedAll.some((g) => g.ref === s.ref)) groundedAll.push(s);
      return {
        format: f,
        showcases: shown,
        opinion: `OPINION (advisory): a ${f} demo showcasing ECE's cited capabilit${shown.length === 1 ? 'y' : 'ies'} ${shown.map((s) => s.name).join(', ')} [${shown.map((s) => s.ref).join(', ')}] — buildable because ECE genuinely has these.`,
        impactNote: EXTERNAL_IMPACT_NOTE,
      };
    });

    for (const v of concept.sourcingVerdicts ?? []) {
      const ref = `verdict:${norm(v.capability)}`;
      if (!groundedAll.some((g) => g.ref === ref)) groundedAll.push({ kind: 'sourcing-verdict', ref, name: v.capability, note: `sourcing verdict ${v.verdict}` });
    }
    groundedAll.sort((a, b) => (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0));

    const confidence = this.confidenceFor(buildability.length);
    return {
      concept: conceptText,
      advisory: true,
      status: PLAN_ONLY,
      headline: {
        opinion: `OPINION (${confidence}): the single most compelling demo leads with ECE's cited capability ${lead.name} [${lead.ref}] — show it working, air-gapped, live. Buildable because ECE genuinely has ${buildability.length} cited capabilit${buildability.length === 1 ? 'y' : 'ies'} (${buildNames.join(', ')}). Advisory read, not a verified finding; audience impact needs external testing.`,
        groundedOn: [lead],
      },
      buildability,
      formats,
      recommendsOnly: true,
      groundedOn: groundedAll,
      confidence,
      externalDataNeeded: EXTERNAL_IMPACT_NOTE,
      basis: this.redactor.redact(`${confidence}: grounded on ${buildability.length} cited backbone buildability fact(s). The demo framing is OPINION on top; the capabilities are the only facts, each cited; audience/market impact is EXTERNAL — flagged, not fabricated. RECOMMENDS a demo; does not build/run one.`),
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
    if (n <= 4) return 'moderate';
    return 'speculative-high';
  }
}

// ── audit tie-in (§6) — record concept, the assessment, and which facts it cited ──────────────────────────────
export const KILLERDEMO_AUDIT_ALLOWLIST: readonly string[] = [
  'killerDemo', 'event', 'advisory', 'status', 'terms', 'headline', 'opinion', 'recommendsOnly', 'confidence',
  'basis', 'externalDataNeeded', 'buildability', 'groundedOn', 'kind', 'ref', 'name', 'citedCount', 'environment',
];

export class KillerDemoAuditor {
  constructor(
    private readonly sink: Pick<AuditSink, 'appendRead'>,
    private readonly redactor: Pick<RedactionEngine, 'redactSummary'>,
    private readonly organizationId: string,
    private readonly actor: HumanActor,
    private readonly environment: Environment = 'local',
    private readonly session: SessionInfo = { session_id: 'killer-demo' },
  ) {}

  async record(assessment: KillerDemoAssessment, terms: string[]): Promise<AppendResult> {
    const summary = this.redactor.redactSummary({
      killerDemo: 'assess',
      event: 'demo.recommended',
      advisory: assessment.advisory,
      status: assessment.status,
      terms,
      headline: { opinion: assessment.headline.opinion },
      recommendsOnly: assessment.recommendsOnly,
      confidence: assessment.confidence,
      basis: assessment.basis,
      externalDataNeeded: assessment.externalDataNeeded,
      buildability: assessment.buildability.map((f) => ({ ref: f.ref, name: f.name })),
      groundedOn: assessment.groundedOn.map((f) => ({ kind: f.kind, ref: f.ref, name: f.name })),
      citedCount: assessment.groundedOn.length,
      environment: this.environment,
    });
    return this.sink.appendRead({ organization_id: this.organizationId, human_actor: this.actor, session: this.session, query_range: summary, rows_returned: assessment.groundedOn.length });
  }
}
