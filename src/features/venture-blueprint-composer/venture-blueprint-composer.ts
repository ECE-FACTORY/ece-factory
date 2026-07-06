// Venture Blueprint Composer (Venture Intelligence Wave — CAPSTONE; the apex the whole wave was built to produce).
//
// It UNIFIES all VI engines' OUTPUTS into ONE coherent, inert Venture Blueprint. Three binding design decisions
// (human-chosen), realized here:
//
//   (1) PURE UNIFIER — `compose(inputs)` composes engine OUTPUTS PASSED IN as data. It does NOT import, call, run,
//       or orchestrate the engines — they run separately upstream; the composer only unifies their results. It
//       imports NO VI-engine module (source-scan enforced); it defines its OWN generic output shapes that every
//       engine's result structurally satisfies (the shared judgment-tier convention: `advisory` + `groundedOn`).
//
//   (2) ONE UNIFIED OBJECT, FACT/OPINION SEPARATED (the mixed engine's no-bleed guarantee at wave scale) —
//       `whatWeKnow` holds ALL `advisory:false` re-derivable STRUCTURAL content; `whatWeBelieve` holds ALL
//       `advisory:true` JUDGMENT content. The separation is type-level (the two arrays admit only their own
//       advisory literal) AND validated at runtime: content is routed BY its `advisory` flag, and any malformed /
//       misrouted output is REJECTED (placed in neither section). No opinion in the fact-section; no fact-as-opinion
//       in the belief-section. Each engine's OWN grounding/citations are carried through — the composer never
//       re-derives or re-opines.
//
//   (3) PLAN-ONLY STATUS + HUMAN-ONLY ROUTING — `status` is the SINGLE literal
//       `VENTURE-BLUEPRINT-AWAITING-HUMAN-APPROVAL`; the forbidden statuses (APPROVED/CREATED/EXECUTED/DEPLOYED/
//       SIGNED_OFF/REPO_CREATED/PRODUCT_LIVE/AUTHORIZED) are UNREPRESENTABLE in the type. The blueprint may CONTAIN
//       proposals — but as INERT DATA a HUMAN routes; the composer imports/calls NOTHING from mcp-bridge /
//       approval-gate / decision-console / propose-surface / pipeline (source-scan enforced). It never routes,
//       proposes-into-pipeline, approves, executes, creates, mutates, or deploys — type-level + source-scan.
//
// INSTRUCTION-BOUNDARY (ingested concept/engine-output text is inert DATA); AUDITED + REDACTED (verifyChain ok);
// SELF-CONTAINED (every cross-engine reference is `import type` — only the audit/redaction PORTS, no VI engine).

import type { TextRedactor } from '../build-observer/build-observer.js';
import type { AuditSink, AppendResult } from '../audit-engine/sink.js';
import type { HumanActor, SessionInfo, Environment } from '../audit-engine/schema.js';
import type { RedactionEngine } from '../redaction-engine/redaction-engine.js';

/** The single plan-only status literal (decision 3). The forbidden statuses are NOT part of this type. */
export type PlanOnlyStatus = 'VENTURE-BLUEPRINT-AWAITING-HUMAN-APPROVAL';

/** One CITED fact — carried through from an engine (never re-derived here). */
export interface CitedFact {
  kind: 'capability' | 'sourcing-verdict';
  ref: string;
  name: string;
  note: string;
}

/** A STRUCTURAL engine output — advisory:false re-derivable FACT (its own shape is opaque; the convention is `advisory`). */
export interface StructuralOutput {
  engine: string;
  /** LITERAL false — re-derivable structural fact. */
  advisory: false;
  /** the engine's own cited facts (carried through). */
  groundedOn?: CitedFact[];
  /** optional Phase-4 sourcing verdicts — turned into INERT proposals (never routed). */
  sourcingVerdicts?: Array<{ capability: string; verdict: string }>;
  [key: string]: unknown;
}

/** A JUDGMENT engine output — advisory:true OPINION (its own shape is opaque; the convention is `advisory`). */
export interface JudgmentOutput {
  engine: string;
  /** LITERAL true — advisory opinion. */
  advisory: true;
  /** the engine's own cited facts (carried through). */
  groundedOn?: CitedFact[];
  [key: string]: unknown;
}

export type EngineOutput = StructuralOutput | JudgmentOutput;

/** An INERT proposal — data a HUMAN may route through the existing gated pipeline. The composer NEVER routes it. */
export interface Proposal {
  capability: string;
  suggestedRoute: string;
  /** LITERAL true — inert. */
  inert: true;
  note: string;
}

export interface RejectedOutput { engine: string; reason: string }

/** THE UNIFIED VENTURE BLUEPRINT — one inert object; fact and opinion visibly + type-level separated. */
export interface VentureBlueprint {
  /** echoed inert concept text (secret-scrubbed) */
  concept: string;
  /** the SINGLE plan-only status — the ONLY representable status. */
  status: PlanOnlyStatus;
  /** "what we know" — ALL advisory:false structural FACT (each item's advisory is false). */
  whatWeKnow: StructuralOutput[];
  /** "what we believe" — ALL advisory:true JUDGMENT opinion (each item's advisory is true). */
  whatWeBelieve: JudgmentOutput[];
  /** INERT proposals a HUMAN routes through the gated pipeline; the composer never routes/approves. */
  proposals: Proposal[];
  /** malformed / misrouted engine outputs that were REJECTED (placed in neither section). */
  rejected: RejectedOutput[];
  /** LITERAL true — the composer only unifies; it never routes, proposes-into-pipeline, approves, or executes. */
  routesNothing: true;
  /** the union of each engine's OWN cited facts — citations PRESERVED, never re-derived. */
  citationsPreserved: CitedFact[];
}

const IDENTITY_REDACTOR: TextRedactor = { redact: (s) => s };
const PLAN_ONLY: PlanOnlyStatus = 'VENTURE-BLUEPRINT-AWAITING-HUMAN-APPROVAL';
const PROPOSAL_NOTE = 'INERT DATA — a HUMAN routes this through the existing gated pipeline (Decision Console / approval gate). The Venture Blueprint Composer never routes, proposes-into-pipeline, approves, or acts.';

export interface ComposeInput {
  /** inert DATA — never instruction */
  concept: string;
  /** the already-produced VI engine outputs (structural + judgment + the mixed engine's two halves), as data. */
  outputs: ReadonlyArray<EngineOutput>;
}

/**
 * The pure unifier. Its ONLY method is compose(). It orchestrates NOTHING (outputs are passed in), routes NOTHING
 * (proposals are inert), approves/executes NOTHING. It partitions the passed-in outputs into whatWeKnow (advisory
 * false) and whatWeBelieve (advisory true) BY their advisory flag, rejects the malformed, preserves each engine's
 * citations, and stamps the single plan-only status.
 */
export class VentureBlueprintComposer {
  constructor(private readonly redactor: TextRedactor = IDENTITY_REDACTOR) {}

  compose(input: ComposeInput): VentureBlueprint {
    const conceptText = this.redactor.redact(String(input.concept ?? ''));
    const whatWeKnow: StructuralOutput[] = [];
    const whatWeBelieve: JudgmentOutput[] = [];
    const rejected: RejectedOutput[] = [];
    const citeMap = new Map<string, CitedFact>();

    // (2) FACT/OPINION SEPARATION — route BY the advisory flag; reject malformed/misrouted (no-bleed).
    for (const o of input.outputs ?? []) {
      if (o == null || typeof o !== 'object') { rejected.push({ engine: 'unknown', reason: 'not an engine output object' }); continue; }
      const engine = typeof (o as { engine?: unknown }).engine === 'string' ? (o as { engine: string }).engine : 'unnamed';
      const adv = (o as { advisory?: unknown }).advisory;
      if (adv === false) {
        whatWeKnow.push(o as StructuralOutput);
      } else if (adv === true) {
        whatWeBelieve.push(o as JudgmentOutput);
      } else {
        rejected.push({ engine, reason: `advisory must be the literal true (opinion) or false (fact); got ${String(adv)} — misrouted content rejected` });
        continue;
      }
      // citations PRESERVED (carried through, never re-derived).
      for (const f of ((o as { groundedOn?: CitedFact[] }).groundedOn ?? [])) if (f && !citeMap.has(f.ref)) citeMap.set(f.ref, f);
    }

    // Defensive no-bleed invariant: whatWeKnow is ALL advisory:false, whatWeBelieve is ALL advisory:true.
    // (True by construction above; asserted so a hand-crafted misrouting cannot slip through.)
    if (!whatWeKnow.every((x) => x.advisory === false) || !whatWeBelieve.every((x) => x.advisory === true)) {
      throw new Error('venture-blueprint-composer: fact/opinion separation invariant violated (no-bleed)');
    }

    // (3) INERT proposals from the structural sourcing verdicts — data only; the composer never routes them.
    const proposals: Proposal[] = [];
    const seenProposal = new Set<string>();
    for (const s of whatWeKnow) {
      for (const v of s.sourcingVerdicts ?? []) {
        const key = `${v.capability}:${v.verdict}`;
        if (seenProposal.has(key)) continue;
        seenProposal.add(key);
        proposals.push({ capability: this.redactor.redact(v.capability), suggestedRoute: v.verdict, inert: true, note: PROPOSAL_NOTE });
      }
    }

    return {
      concept: conceptText,
      status: PLAN_ONLY,
      whatWeKnow,
      whatWeBelieve,
      proposals,
      rejected,
      routesNothing: true,
      citationsPreserved: [...citeMap.values()].sort((a, b) => (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0)),
    };
  }
}

// ── audit tie-in — record the unified blueprint's STRUCTURE (allowlist-redacted; verifyChain ok) ──────────────
export const BLUEPRINT_AUDIT_ALLOWLIST: readonly string[] = [
  'ventureBlueprint', 'event', 'status', 'routesNothing', 'whatWeKnow', 'whatWeBelieve', 'engine', 'advisory',
  'proposals', 'capability', 'suggestedRoute', 'inert', 'rejected', 'reason', 'citationCount', 'environment',
];

export class VentureBlueprintAuditor {
  constructor(
    private readonly sink: Pick<AuditSink, 'appendRead'>,
    private readonly redactor: Pick<RedactionEngine, 'redactSummary'>,
    private readonly organizationId: string,
    private readonly actor: HumanActor,
    private readonly environment: Environment = 'local',
    private readonly session: SessionInfo = { session_id: 'venture-blueprint-composer' },
  ) {}

  async record(bp: VentureBlueprint): Promise<AppendResult> {
    const summary = this.redactor.redactSummary({
      ventureBlueprint: 'compose',
      event: 'blueprint.composed',
      status: bp.status,
      routesNothing: bp.routesNothing,
      // record the SECTIONS with their advisory markings (fact vs opinion distinctly), not the free-text content.
      whatWeKnow: bp.whatWeKnow.map((x) => ({ engine: x.engine, advisory: x.advisory })),
      whatWeBelieve: bp.whatWeBelieve.map((x) => ({ engine: x.engine, advisory: x.advisory })),
      proposals: bp.proposals.map((p) => ({ capability: p.capability, suggestedRoute: p.suggestedRoute, inert: p.inert })),
      rejected: bp.rejected.map((r) => ({ engine: r.engine, reason: r.reason })),
      citationCount: bp.citationsPreserved.length,
      environment: this.environment,
    });
    return this.sink.appendRead({ organization_id: this.organizationId, human_actor: this.actor, session: this.session, query_range: summary, rows_returned: bp.citationsPreserved.length });
  }
}
