// Build/Buy/Partner/Acquire Engine (Venture Intelligence Wave — Phase 4, STRUCTURAL / DETERMINISTIC engine).
// COMPLETES the VI structural backbone.
//
// The superset decision: for a needed capability, it produces EXACTLY ONE unified sourcing verdict from the full
// option space — BUILD / BUY / PARTNER / ACQUIRE / REUSE / REJECT / NEEDS_REVIEW — by UNIFYING Phase-2's internal
// reuse decision and Phase-3's external harvest decision into one coherent recommendation. It contains NO
// internal-reuse or sourcing logic of its own: it RESOLVES the two legs' outputs. Same Phase-2/3 outputs ⇒ same
// verdict + evidence (re-derivable).
//
// DENY-BY-DEFAULT — it INHERITS both legs' vetoes (§3a of REQUIREMENT_VENTURE_INTELLIGENCE_LAYER.md):
//   • NEVER BUILD when internal REUSE genuinely applies (Phase-2 anti-rebuild).
//   • NEVER BUY/ACQUIRE a license-incompatible or sovereign-unsafe candidate — a Phase-3 REJECT can never become
//     BUY (Phase-3 absolute vetoes carry through).
//   • Unknown / ambiguous / conflicting evidence, or a partner/acquire choice that genuinely needs judgment ⇒
//     NEEDS_REVIEW — never an optimistic BUILD or BUY.
//
// STRUCTURAL, NOT JUDGMENT: derived from the two engines' re-derivable outputs; `advisory` is always false.
// PARTNER/ACQUIRE are derived from STRUCTURAL signals (the external evidence + an optional upstream structural
// strategic signal — NOT an LLM opinion); where the choice genuinely requires judgment, it routes to NEEDS_REVIEW.
//
// PLAN-ONLY / READ-ONLY (type-level): holds NO gate/approval/mint/bridge-write reference; exposes NO method to
// execute/create/approve/mutate/deploy — its only capability is decide() → data. It consumes Phase-2/3 DECISIONS
// (already computed, passed in) by type only; it reimplements neither and mutates nothing. INSTRUCTION-BOUNDARY:
// capability text is inert DATA. STANDALONE-PACKAGEABLE: every cross-engine reference is `import type`.

import type { ReuseDecision, ReuseClassification } from '../internal-reuse-engine/internal-reuse-engine.js';
import type { ExternalSourcingDecision, ExternalSourcing } from '../external-harvest-composer/external-harvest-composer.js';
import type { TextRedactor } from '../build-observer/build-observer.js';
import type { AuditSink, AppendResult } from '../audit-engine/sink.js';
import type { HumanActor, SessionInfo, Environment } from '../audit-engine/schema.js';
import type { RedactionEngine } from '../redaction-engine/redaction-engine.js';

export type SourcingVerdict = 'BUILD' | 'BUY' | 'PARTNER' | 'ACQUIRE' | 'REUSE' | 'REJECT' | 'NEEDS_REVIEW';

/** An OPTIONAL structural strategic signal set by an upstream STRUCTURAL gate — never an LLM opinion. It only
 *  gates the PARTNER/ACQUIRE route where the external candidate exists but is not adoptable. */
export interface StrategicSignal { acquisitionEligible?: boolean; partnershipViable?: boolean }

export interface UnifiedSourcingInput {
  capability: string;
  /** Phase-2 internal reuse decision (ALWAYS present). */
  internal: ReuseDecision;
  /** Phase-3 external harvest decision (present iff internal reuse was absent, i.e. internal = BUILD_CUSTOM). */
  external?: ExternalSourcingDecision;
  strategic?: StrategicSignal;
}

export interface UnifiedSourcingDecision {
  capability: string;
  verdict: SourcingVerdict;
  reason: string;
  /** Phase-2 evidence that fed the resolution */
  internal: { classification: ReuseClassification; topMatchId: string | null };
  /** Phase-3 evidence that fed the resolution (null if internal reuse applied, so external was not consulted) */
  external: { classification: ExternalSourcing; license: string; sovereign: string; scoreBand: string } | null;
  /** ALWAYS false — structural, re-derivable resolution, not advisory judgment */
  advisory: false;
}

const IDENTITY_REDACTOR: TextRedactor = { redact: (s) => s };
const INTERNAL_MATCH: readonly ReuseClassification[] = ['REUSE_INTERNAL', 'EXTEND_INTERNAL', 'FORK_INTERNAL', 'COPY_INTERNAL'];

/**
 * Resolves the internal (Phase-2) + external (Phase-3) legs into exactly ONE sourcing verdict — DETERMINISTIC.
 * Its only method is decide(). It writes nothing and reimplements neither leg.
 */
export class BuildBuyPartnerAcquireEngine {
  constructor(private readonly redactor: TextRedactor = IDENTITY_REDACTOR) {}

  decide(input: UnifiedSourcingInput): UnifiedSourcingDecision {
    const [verdict, reason] = this.resolve(input);
    // The external leg fed the resolution ONLY when internal reuse was genuinely absent (BUILD_CUSTOM). If an
    // internal match applied (REUSE) or internal was ambiguous, external was NOT consulted ⇒ report it as null.
    const consulted = input.internal.classification === 'BUILD_CUSTOM' ? input.external : undefined;
    return {
      capability: input.capability,
      verdict,
      reason: this.redactor.redact(reason),
      internal: { classification: input.internal.classification, topMatchId: input.internal.evidence[0]?.id ?? null },
      external: consulted ? { classification: consulted.classification, license: consulted.evidence.license, sovereign: consulted.evidence.sovereign, scoreBand: consulted.evidence.scoreBand } : null,
      advisory: false,
    };
  }

  /** The deterministic resolution of the two legs (order matters — internal reuse & vetoes first). */
  private resolve(input: UnifiedSourcingInput): [SourcingVerdict, string] {
    const internal = input.internal.classification;

    // 1. INTERNAL REUSE WINS (anti-rebuild). Any internal match ⇒ REUSE; external is not even consulted.
    if (INTERNAL_MATCH.includes(internal)) {
      return ['REUSE', `internal reuse applies (Phase-2 ${internal}, ${input.internal.evidence[0]?.id ?? 'match'}) — source internally, never rebuild`];
    }
    // 2. Ambiguous internal evidence ⇒ resolve the internal question first (deny-by-default).
    if (internal === 'NEEDS_REVIEW') {
      return ['NEEDS_REVIEW', 'Phase-2 internal reuse is ambiguous (NEEDS_REVIEW) — resolve internal reuse before external sourcing'];
    }
    // internal === 'BUILD_CUSTOM' — evidenced internal ABSENCE. Consult the external leg.
    const ext = input.external;
    if (!ext) {
      return ['NEEDS_REVIEW', 'internal reuse is absent (BUILD_CUSTOM) but the external harvest leg was not evaluated — incomplete evidence'];
    }
    const e = ext.evidence;
    const strat = input.strategic ?? {};

    switch (ext.classification) {
      // 3. Adoptable external ⇒ BUY (fork/extend external). (Phase-3 only adopts permissive + sovereign-ready.)
      case 'FORK_EXTERNAL':
      case 'EXTEND_EXTERNAL':
        return ['BUY', `internal absent + external adoptable (Phase-3 ${ext.classification}, license ${e.license}, ${e.scoreBand}, sovereign ${e.sovereign}) — BUY (adopt/fork external)`];

      // 4. External ambiguous ⇒ NEEDS_REVIEW.
      case 'NEEDS_REVIEW':
        return ['NEEDS_REVIEW', `internal absent + external sourcing ambiguous (Phase-3 NEEDS_REVIEW) — a human decides`];

      // 5. External REJECT — a hard veto (NEVER BUY). Distinguish WHY from the Phase-3 evidence:
      case 'REJECT': {
        if (e.license === 'REJECT' || e.sovereign === 'Rejected') {
          // exists externally but not forkable/adoptable under license/sovereignty ⇒ PARTNER/ACQUIRE, else REJECT.
          if (strat.acquisitionEligible) return ['ACQUIRE', `external exists but not adoptable (${e.license === 'REJECT' ? `non-permissive license ${e.licenseDetected}` : 'sovereign-unsafe'}); acquisition-eligible structural signal ⇒ ACQUIRE`];
          if (strat.partnershipViable) return ['PARTNER', `external exists but not adoptable (${e.license === 'REJECT' ? 'non-permissive license' : 'sovereign-unsafe'}); partnership-viable structural signal ⇒ PARTNER`];
          return ['REJECT', `external candidate REJECTED (${e.license === 'REJECT' ? 'non-permissive license' : 'sovereign-unsafe'}) and no structural partner/acquire signal — REJECT this candidate (never BUY a REJECT)`];
        }
        // license ACCEPT + sovereign ok but scoring band reject ⇒ poor quality; internal absent ⇒ BUILD custom.
        return ['BUILD', `internal absent + external candidate poor quality (permissive+sovereign-ok but band ${e.scoreBand}) — BUILD custom`];
      }

      // 6. REFERENCE_ONLY — useful but not adoptable. Distinguish exists-not-adoptable vs reference-material.
      case 'REFERENCE_ONLY': {
        if (e.sovereign === 'Non-sovereign-only' || e.whiteLabel === 'Blocked-by-legal-obligation') {
          if (strat.acquisitionEligible) return ['ACQUIRE', 'external exists + permissive but not sovereign/white-label-adoptable; acquisition-eligible ⇒ ACQUIRE'];
          if (strat.partnershipViable) return ['PARTNER', 'external exists + permissive but not sovereign/white-label-adoptable; partnership-viable ⇒ PARTNER'];
          return ['NEEDS_REVIEW', 'external exists but is not adoptable (sovereign/white-label) and partner-vs-acquire needs judgment — NEEDS_REVIEW (never guessed)'];
        }
        // usable only as reference (risky band / proposedVerdict BUILD) ⇒ BUILD custom, referencing it.
        return ['BUILD', `internal absent + external usable only as reference (band ${e.scoreBand}) — BUILD custom (reference the external approach)`];
      }
    }
  }
}

// ── audit tie-in (reuse) — record each unified sourcing verdict (allowlist-redacted; capability text inert) ──
export const BBPA_AUDIT_ALLOWLIST: readonly string[] = [
  'sourcing', 'event', 'capability', 'verdict', 'reason', 'internal', 'external', 'classification', 'topMatchId',
  'license', 'sovereign', 'scoreBand', 'advisory', 'environment',
];

export class UnifiedSourcingAuditor {
  constructor(
    private readonly sink: Pick<AuditSink, 'appendRead'>,
    private readonly redactor: Pick<RedactionEngine, 'redactSummary'>,
    private readonly organizationId: string,
    private readonly actor: HumanActor,
    private readonly environment: Environment = 'local',
    private readonly session: SessionInfo = { session_id: 'build-buy-partner-acquire' },
  ) {}

  async record(decision: UnifiedSourcingDecision): Promise<AppendResult> {
    const summary = this.redactor.redactSummary({
      sourcing: 'unified',
      event: 'sourcing.decided',
      capability: decision.capability,
      verdict: decision.verdict,
      reason: decision.reason,
      internal: { classification: decision.internal.classification, topMatchId: decision.internal.topMatchId },
      external: decision.external ? { classification: decision.external.classification, license: decision.external.license, sovereign: decision.external.sovereign, scoreBand: decision.external.scoreBand } : null,
      advisory: decision.advisory,
      environment: this.environment,
    });
    return this.sink.appendRead({ organization_id: this.organizationId, human_actor: this.actor, session: this.session, query_range: summary, rows_returned: 0 });
  }
}
