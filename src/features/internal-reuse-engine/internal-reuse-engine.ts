// Internal Reuse Engine (Venture Intelligence Wave — Phase 2, STRUCTURAL / DETERMINISTIC engine).
//
// Given a needed capability (what a venture requires), it decides EXACTLY ONE internal-reuse classification —
// REUSE_INTERNAL / COPY_INTERNAL / FORK_INTERNAL / EXTEND_INTERNAL / BUILD_CUSTOM (or NEEDS_REVIEW when the
// evidence is insufficient) — DERIVED DETERMINISTICALLY from the Phase-1 Capability Reuse Graph's facts + posture.
// It is NOT a judgment engine: the decision is a re-derivable function of graph facts (same need + same graph ⇒
// same decision + same evidence), never an LLM opinion, and it is never marked advisory.
//
// CORE DOCTRINE — DENY-BY-DEFAULT, ANTI-REBUILD (§3a of REQUIREMENT_VENTURE_INTELLIGENCE_LAYER.md):
//   • BUILD_CUSTOM is returned ONLY on an EVIDENCED ABSENCE — no graph node matched the need at all. A real
//     internal match can NEVER yield BUILD_CUSTOM (the anti-rebuild guarantee — never rebuild what exists).
//   • Insufficient / ambiguous evidence ⇒ NEEDS_REVIEW (flag a human) — never an optimistic default in EITHER
//     direction (neither a fabricated reuse nor a premature custom build).
//   • Every decision carries its supporting FACTS: which node(s) matched (or the evidenced absence), their
//     posture, and the deterministic reason the decision followed. No unsupported verdicts.
//
// PLAN-ONLY / READ-ONLY (type-level safety): holds NO gate/approval/mint/bridge-write reference and exposes NO
// method to execute/create/approve/mutate/deploy — its only capability is classify() → data. It CONSUMES the
// Phase-1 graph through a read-only port (search); it does NOT reimplement or mutate the graph/registries/repo.
// A source-scan + structural test enforce this. INSTRUCTION-BOUNDARY: the need text/terms are inert DATA.
//
// STANDALONE-PACKAGEABLE: every cross-engine reference is `import type` (the graph's node types + the redactor).

import type { CapabilityNode, CapabilityKind, CapabilityPosture, CapabilityQuery } from '../capability-reuse-graph/capability-reuse-graph.js';
import type { TextRedactor } from '../build-observer/build-observer.js';
import type { AuditSink, AppendResult } from '../audit-engine/sink.js';
import type { HumanActor, SessionInfo, Environment } from '../audit-engine/schema.js';
import type { RedactionEngine } from '../redaction-engine/redaction-engine.js';

/** The read-only slice of the Phase-1 graph this engine consumes (it never mutates it). */
export interface GraphReader { search(q?: CapabilityQuery): CapabilityNode[] }

export type ReuseClassification =
  | 'REUSE_INTERNAL'   // exact match, good posture — use it as-is
  | 'EXTEND_INTERNAL'  // strong match but a posture/scope gap — extend the existing capability
  | 'FORK_INTERNAL'    // strong match of a different shape/kind — fork it into a variant
  | 'COPY_INTERNAL'    // partial match — copy structure/approach from it
  | 'BUILD_CUSTOM'     // EVIDENCED ABSENCE — nothing internal matched
  | 'NEEDS_REVIEW';    // insufficient/ambiguous evidence — a human decides (never guessed)

/** A needed capability — inert DATA. `terms` are the normalized keywords the decision is derived from (the
 *  caller supplies structured terms; the engine does deterministic matching, NOT fuzzy NLP/judgment). */
export interface NeededCapability {
  description: string;
  terms: string[];
  kind?: CapabilityKind;
  /** posture the reused capability must satisfy to be reused as-is (default: must be tested). */
  requiredPosture?: Partial<CapabilityPosture>;
}

export interface MatchEvidence {
  id: string;
  name: string;
  kind: CapabilityKind;
  source: string;
  posture: CapabilityPosture;
  matchedTerms: string[];
  /** matchedTerms / totalTerms — deterministic */
  coverage: number;
  postureOk: boolean;
}
export interface ReuseDecision {
  classification: ReuseClassification;
  /** the deterministic reason the classification followed (a fact, not an opinion) */
  reason: string;
  /** supporting facts: the matched node(s) (best first) or, for BUILD_CUSTOM, the evidenced absence */
  evidence: MatchEvidence[];
  /** the evidenced-absence witness for BUILD_CUSTOM / the search scope considered */
  searched: { terms: string[]; kind: CapabilityKind | null; candidatesConsidered: number };
  /** ALWAYS false — this is a structural, re-derivable classification, not advisory judgment */
  advisory: false;
}

// Deterministic thresholds (named, so the rule is auditable and re-derivable).
const EXACT = 1;          // all terms present
const STRONG = 0.75;      // strong-but-not-exact
const PARTIAL = 0.5;      // partial — copy-worthy
const IDENTITY_REDACTOR: TextRedactor = { redact: (s) => s };

function norm(s: string): string { return String(s ?? '').toLowerCase(); }
function round(n: number): number { return Math.round(n * 1000) / 1000; }

/**
 * Classifies a needed capability against the Phase-1 graph — DETERMINISTIC. It reads candidate nodes via the
 * graph's search port, computes term coverage + posture per candidate, and applies fixed rules. It writes
 * nothing. Its only method is classify().
 */
export class InternalReuseEngine {
  private readonly redactor: TextRedactor;
  constructor(private readonly graph: GraphReader, redactor: TextRedactor = IDENTITY_REDACTOR) {
    this.redactor = redactor;
  }

  classify(need: NeededCapability): ReuseDecision {
    const terms = (need.terms ?? []).map(norm).filter((t) => t.length > 0);
    const kind = need.kind ?? null;
    const scope = kind ? { kind } : {};
    // Consume the graph (read-only). If a kind is given, restrict to that kind; else all nodes.
    const candidates = this.graph.search(scope);
    const searched = { terms, kind, candidatesConsidered: candidates.length };

    // No signal to derive from ⇒ NEEDS_REVIEW (never guess a default in either direction).
    if (terms.length === 0) {
      return this.decide('NEEDS_REVIEW', 'no match terms supplied — insufficient evidence to derive a reuse decision (deny-by-default: flag for human)', [], searched);
    }

    // Deterministic scoring per candidate (sorted by id for stable tie-breaks).
    const scored: MatchEvidence[] = candidates
      .map((n) => {
        const hay = `${norm(n.name)} ${norm(n.description)}`;
        const matchedTerms = terms.filter((t) => hay.includes(t));
        return { id: n.id, name: n.name, kind: n.kind, source: n.source, posture: n.posture, matchedTerms, coverage: round(matchedTerms.length / terms.length), postureOk: this.postureOk(n, need) };
      })
      .filter((m) => m.coverage > 0)
      .sort((a, b) => (b.coverage - a.coverage) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

    // EVIDENCED ABSENCE ⇒ BUILD_CUSTOM (the ONLY path to BUILD_CUSTOM — nothing internal matched at all).
    if (scored.length === 0) {
      return this.decide('BUILD_CUSTOM', `no internal capability matched terms [${terms.join(', ')}]${kind ? ` of kind ${kind}` : ''} — evidenced absence (${candidates.length} candidate node(s) considered, 0 matched)`, [], searched);
    }

    const best = scored[0];
    const evidence = scored.slice(0, 3); // top supporting facts

    // Ambiguity guard: two DISTINCT strong candidates tied at the top ⇒ NEEDS_REVIEW (don't guess which).
    if (scored.length >= 2 && scored[1].coverage === best.coverage && best.coverage >= PARTIAL) {
      return this.decide('NEEDS_REVIEW', `${scored.filter((s) => s.coverage === best.coverage).length} internal capabilities match equally well (coverage ${best.coverage}) — ambiguous; a human must choose (deny-by-default)`, evidence, searched);
    }

    // EXACT match.
    if (best.coverage >= EXACT) {
      return best.postureOk
        ? this.decide('REUSE_INTERNAL', `exact match "${best.id}" with sufficient posture — reuse as-is (never rebuild what exists)`, evidence, searched)
        : this.decide('EXTEND_INTERNAL', `exact match "${best.id}" but a posture gap (${this.postureGaps(best, need).join(', ')}) — extend the existing capability, do NOT rebuild`, evidence, searched);
    }
    // STRONG-but-not-exact.
    if (best.coverage >= STRONG) {
      const sameKind = !kind || best.kind === kind;
      return sameKind && best.postureOk
        ? this.decide('EXTEND_INTERNAL', `strong match "${best.id}" (coverage ${best.coverage}), same kind + good posture — extend it rather than rebuild`, evidence, searched)
        : this.decide('FORK_INTERNAL', `strong match "${best.id}" (coverage ${best.coverage}) of a different shape/posture — fork it into a variant rather than rebuild`, evidence, searched);
    }
    // PARTIAL.
    if (best.coverage >= PARTIAL) {
      return this.decide('COPY_INTERNAL', `partial match "${best.id}" (coverage ${best.coverage}) — copy its structure/approach rather than rebuild from scratch`, evidence, searched);
    }
    // WEAK signal (0 < coverage < PARTIAL): too weak to justify reuse, too present to claim absence ⇒ NEEDS_REVIEW.
    return this.decide('NEEDS_REVIEW', `only a weak partial match "${best.id}" (coverage ${best.coverage}) — insufficient to justify reuse OR to declare absence; a human decides (deny-by-default, never an optimistic BUILD_CUSTOM)`, evidence, searched);
  }

  private postureOk(n: CapabilityNode, need: NeededCapability): boolean {
    const req = need.requiredPosture ?? { hasTests: true }; // default: a reusable capability must be tested
    for (const k of Object.keys(req) as (keyof CapabilityPosture)[]) { if (req[k] && !n.posture[k]) return false; }
    return true;
  }
  private postureGaps(m: MatchEvidence, need: NeededCapability): string[] {
    const req = need.requiredPosture ?? { hasTests: true };
    return (Object.keys(req) as (keyof CapabilityPosture)[]).filter((k) => req[k] && !m.posture[k]).map((k) => `missing ${k}`);
  }
  private decide(classification: ReuseClassification, reason: string, evidence: MatchEvidence[], searched: ReuseDecision['searched']): ReuseDecision {
    return { classification, reason: this.redactor.redact(reason), evidence, searched, advisory: false };
  }
}

// ── audit tie-in (reuse) — record each classification (allowlist-redacted; the need terms are inert data) ────
export const REUSE_AUDIT_ALLOWLIST: readonly string[] = [
  'internalReuse', 'event', 'classification', 'reason', 'terms', 'kind', 'candidatesConsidered', 'matched',
  'id', 'coverage', 'postureOk', 'advisory', 'environment',
];

export class ReuseDecisionAuditor {
  constructor(
    private readonly sink: Pick<AuditSink, 'appendRead'>,
    private readonly redactor: Pick<RedactionEngine, 'redactSummary'>,
    private readonly organizationId: string,
    private readonly actor: HumanActor,
    private readonly environment: Environment = 'local',
    private readonly session: SessionInfo = { session_id: 'internal-reuse-engine' },
  ) {}

  async record(decision: ReuseDecision): Promise<AppendResult> {
    const summary = this.redactor.redactSummary({
      internalReuse: 'classify',
      event: 'reuse.classified',
      classification: decision.classification,
      reason: decision.reason,
      terms: decision.searched.terms,
      kind: decision.searched.kind,
      candidatesConsidered: decision.searched.candidatesConsidered,
      matched: decision.evidence.map((m) => ({ id: m.id, coverage: m.coverage, postureOk: m.postureOk })),
      advisory: decision.advisory,
      environment: this.environment,
    });
    return this.sink.appendRead({ organization_id: this.organizationId, human_actor: this.actor, session: this.session, query_range: summary, rows_returned: decision.evidence.length });
  }
}
