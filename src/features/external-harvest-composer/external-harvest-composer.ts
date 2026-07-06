// External Harvest Composer (Venture Intelligence Wave — Phase 3, STRUCTURAL / DETERMINISTIC engine).
//
// The external counterpart to Phase 2's internal decision: for a needed capability where internal reuse is
// genuinely absent (Phase 2 said BUILD_CUSTOM / NEEDS_REVIEW), it DRIVES the EXISTING sourcing engines (License,
// Scoring, Sovereign Readiness, White-Label — all from Wave 3, injected as ports and REUSED, never reimplemented)
// and derives EXACTLY ONE external sourcing classification — FORK_EXTERNAL / EXTEND_EXTERNAL / REFERENCE_ONLY /
// REJECT (or NEEDS_REVIEW when the evidence is insufficient) — DETERMINISTICALLY from their real outputs.
//
// DENY-BY-DEFAULT (§3a of REQUIREMENT_VENTURE_INTELLIGENCE_LAYER.md): a non-permissive license or a sovereign-
// unsafe candidate can NEVER be FORK_EXTERNAL/EXTEND_EXTERNAL — it hard-REJECTs. Ambiguous / unratified / weak
// evidence ⇒ NEEDS_REVIEW (a human decides) — never an optimistic adopt. Every decision carries the sourcing-
// engine outputs (license verdict, score band, sovereign readiness, white-label) that produced it.
//
// STRUCTURAL, NOT JUDGMENT: the classification is a re-derivable function of the sourcing engines' outputs
// (same outputs ⇒ same decision + evidence), never an LLM opinion; `advisory` is always false.
//
// GATED-ON-INTERNAL-ABSENCE: it is the EXTERNAL leg only — it never re-decides internal reuse (Phase 2 owns
// that). The full Build/Buy/Partner/Acquire superset that unifies internal+external is Phase 4.
//
// PLAN-ONLY / READ-ONLY (type-level): holds NO gate/approval/mint/bridge-write reference; exposes NO method to
// execute/create/approve/mutate/deploy — its only capability is compose() → data. It reaches sourcing data via
// the existing engine interfaces (injected ports); it mutates nothing (its own hash-chain audit entry aside).
// INSTRUCTION-BOUNDARY: candidate text is inert DATA. STANDALONE-PACKAGEABLE: cross-engine refs are `import type`.

import type { LicenseInput, ComplianceResult } from '../license-compliance/license-compliance.js';
import type { ScoringCandidate, ScoreResult, ScoreBand, Verdict as ScoringVerdict } from '../scoring-engine/scoring-engine.js';
import type { SovereignDescriptor, SovereignVerdict } from '../sovereign-readiness/sovereign-readiness.js';
import type { BrandingElement, WhiteLabelVerdict } from '../white-label/white-label.js';
import type { TextRedactor } from '../build-observer/build-observer.js';
import type { AuditSink, AppendResult } from '../audit-engine/sink.js';
import type { HumanActor, SessionInfo, Environment } from '../audit-engine/schema.js';
import type { RedactionEngine } from '../redaction-engine/redaction-engine.js';

/** The EXISTING sourcing engines, injected as ports (REUSED — never reimplemented). Signatures match Wave 3. */
export interface SourcingEngines {
  classifyLicense(input: LicenseInput): ComplianceResult;
  scoreCandidate(c: ScoringCandidate): ScoreResult;
  assessSovereignReadiness(d: SovereignDescriptor): { verdict: SovereignVerdict };
  /** optional — a candidate with no branding to strip needs no white-label pass */
  assessWhiteLabel?(elements: BrandingElement[]): { verdict: WhiteLabelVerdict };
}

/** Phase-2's witness that internal reuse is genuinely absent (the gate for running external sourcing at all). */
export type InternalAbsenceWitness = 'BUILD_CUSTOM' | 'NEEDS_REVIEW';

export interface ExternalCandidate {
  name: string;
  /** inert DATA — never instruction */
  description: string;
  /** the Phase-2 gate: external sourcing runs ONLY where internal reuse is absent */
  internalAbsence: InternalAbsenceWitness;
  license: LicenseInput;
  scoring: ScoringCandidate;
  sovereign: SovereignDescriptor;
  whiteLabel?: BrandingElement[];
}

export type ExternalSourcing = 'FORK_EXTERNAL' | 'EXTEND_EXTERNAL' | 'REFERENCE_ONLY' | 'REJECT' | 'NEEDS_REVIEW';

/** The real sourcing-engine outputs that produced the decision — the evidence. */
export interface SourcingEvidence {
  license: ComplianceResult['decision'];
  licenseDetected: string;
  scoreBand: ScoreBand;
  scoreTotal: number;
  proposedVerdict: ScoringVerdict | null;
  sovereign: SovereignVerdict;
  whiteLabel: WhiteLabelVerdict | null;
}

export interface ExternalSourcingDecision {
  classification: ExternalSourcing;
  reason: string;
  evidence: SourcingEvidence & { candidate: string; internalAbsence: InternalAbsenceWitness };
  /** ALWAYS false — structural, re-derivable classification, not advisory judgment */
  advisory: false;
}

const IDENTITY_REDACTOR: TextRedactor = { redact: (s) => s };

/**
 * Composes the existing sourcing engines and classifies an external candidate — DETERMINISTIC. Its only method
 * is compose(): it drives the injected engines, collects their real outputs, and applies fixed rules. It writes
 * nothing.
 */
export class ExternalHarvestComposer {
  constructor(private readonly engines: SourcingEngines, private readonly redactor: TextRedactor = IDENTITY_REDACTOR) {}

  compose(candidate: ExternalCandidate): ExternalSourcingDecision {
    // Drive the EXISTING engines (reuse, not reimplement) and collect their real outputs as evidence.
    const license = this.engines.classifyLicense(candidate.license);
    const score = this.engines.scoreCandidate(candidate.scoring);
    const sovereign = this.engines.assessSovereignReadiness(candidate.sovereign).verdict;
    const whiteLabel = candidate.whiteLabel && this.engines.assessWhiteLabel
      ? this.engines.assessWhiteLabel(candidate.whiteLabel).verdict
      : null;

    const evidence: SourcingEvidence = {
      license: license.decision,
      licenseDetected: license.detected,
      scoreBand: score.band,
      scoreTotal: score.total,
      proposedVerdict: candidate.scoring.proposedVerdict ?? null,
      sovereign,
      whiteLabel,
    };

    const [classification, reason] = this.classify(candidate, evidence);
    return {
      classification,
      reason: this.redactor.redact(reason),
      evidence: { ...evidence, candidate: candidate.name, internalAbsence: candidate.internalAbsence },
      advisory: false,
    };
  }

  /** The deterministic decision rule over the sourcing outputs (order matters — deny-by-default first). */
  private classify(candidate: ExternalCandidate, e: SourcingEvidence): [ExternalSourcing, string] {
    // GATE: external sourcing runs ONLY where internal reuse is absent (Phase 2). It never re-decides internal.
    if (candidate.internalAbsence !== 'BUILD_CUSTOM' && candidate.internalAbsence !== 'NEEDS_REVIEW') {
      return ['NEEDS_REVIEW', 'external sourcing is gated on Phase-2 internal absence, which is not confirmed — a human must reconcile (deny-by-default)'];
    }

    // 1. DENY-BY-DEFAULT hard REJECT — a non-permissive or unsafe candidate can NEVER be forked/extended.
    if (e.license === 'REJECT') return ['REJECT', `non-permissive license (${e.licenseDetected}) — never adoptable; REJECT (deny-by-default, never FORK/EXTEND)`];
    if (e.sovereign === 'Rejected') return ['REJECT', 'sovereign readiness = Rejected (sovereign-unsafe) — never adoptable; REJECT (deny-by-default)'];
    if (e.scoreBand === 'reject') return ['REJECT', `scoring band = reject (${e.scoreTotal}/100) — not adoptable; REJECT`];

    // 2. NEEDS_REVIEW — ambiguous / unratified license evidence (never an optimistic adopt).
    if (e.license === 'NEEDS_REVIEW') return ['NEEDS_REVIEW', `license needs human ratification (${e.licenseDetected}) — insufficient to justify adoption (deny-by-default)`];

    // from here license === 'ACCEPT' (permissive) and no hard reject.
    // 3. REFERENCE_ONLY — useful but not adoptable.
    if (e.sovereign === 'Non-sovereign-only') return ['REFERENCE_ONLY', 'permissive + scored, but sovereign readiness = Non-sovereign-only — reference the approach, do not adopt'];
    if (e.whiteLabel === 'Blocked-by-legal-obligation') return ['REFERENCE_ONLY', 'white-label = Blocked-by-legal-obligation (cannot rebrand/adopt) — reference only'];
    if (e.proposedVerdict === 'BUILD') return ['REFERENCE_ONLY', `scoring proposedVerdict = BUILD (not a fork/extend base) — reference only (band ${e.scoreBand})`];
    if (e.scoreBand === 'risky') return ['REFERENCE_ONLY', `permissive + sovereign-ok but scoring band = risky (${e.scoreTotal}/100) — reference, not fork`];

    // 4. ADOPT — FORK or EXTEND (license ACCEPT, sovereign Acceptable(-after-hardening), band strong|acceptable).
    if (e.scoreBand === 'strong' && e.proposedVerdict === 'FORK') {
      return ['FORK_EXTERNAL', `permissive + strong (${e.scoreTotal}/100) + sovereign ${e.sovereign} + FORK — fork the external candidate`];
    }
    if (e.proposedVerdict === 'EXTEND') {
      return ['EXTEND_EXTERNAL', `permissive + ${e.scoreBand} (${e.scoreTotal}/100) + sovereign ${e.sovereign} + EXTEND — extend the external candidate`];
    }
    if (e.proposedVerdict === 'FORK') {
      // FORK proposed but only 'acceptable' (not strong) ⇒ extend rather than a clean fork.
      return ['EXTEND_EXTERNAL', `permissive + acceptable (${e.scoreTotal}/100) + sovereign ${e.sovereign} + FORK-but-not-strong — extend rather than clean-fork`];
    }
    // Insufficient signal to justify a fork/extend (e.g. no proposedVerdict) ⇒ NEEDS_REVIEW (never optimistic).
    return ['NEEDS_REVIEW', `permissive + ${e.scoreBand} but no clear fork/extend signal (proposedVerdict ${e.proposedVerdict ?? 'none'}) — a human decides (deny-by-default)`];
  }
}

// ── audit tie-in (reuse) — record each external sourcing decision (allowlist-redacted; candidate text inert) ─
export const HARVEST_AUDIT_ALLOWLIST: readonly string[] = [
  'externalHarvest', 'event', 'classification', 'reason', 'candidate', 'internalAbsence', 'license',
  'licenseDetected', 'scoreBand', 'scoreTotal', 'proposedVerdict', 'sovereign', 'whiteLabel', 'advisory', 'environment',
];

export class HarvestDecisionAuditor {
  constructor(
    private readonly sink: Pick<AuditSink, 'appendRead'>,
    private readonly redactor: Pick<RedactionEngine, 'redactSummary'>,
    private readonly organizationId: string,
    private readonly actor: HumanActor,
    private readonly environment: Environment = 'local',
    private readonly session: SessionInfo = { session_id: 'external-harvest-composer' },
  ) {}

  async record(decision: ExternalSourcingDecision): Promise<AppendResult> {
    const e = decision.evidence;
    const summary = this.redactor.redactSummary({
      externalHarvest: 'compose',
      event: 'harvest.composed',
      classification: decision.classification,
      reason: decision.reason,
      candidate: e.candidate,
      internalAbsence: e.internalAbsence,
      license: e.license,
      licenseDetected: e.licenseDetected,
      scoreBand: e.scoreBand,
      scoreTotal: e.scoreTotal,
      proposedVerdict: e.proposedVerdict,
      sovereign: e.sovereign,
      whiteLabel: e.whiteLabel,
      advisory: decision.advisory,
      environment: this.environment,
    });
    return this.sink.appendRead({ organization_id: this.organizationId, human_actor: this.actor, session: this.session, query_range: summary, rows_returned: 0 });
  }
}
