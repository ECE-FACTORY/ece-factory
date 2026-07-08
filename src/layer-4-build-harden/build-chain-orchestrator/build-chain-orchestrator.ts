// Layer-4 BUILD CHAIN ORCHESTRATOR — the FIRST end-to-end composition of the three proven, committed pieces:
//   • build-planner            (Layer 4)  ApprovedBuildDecision → inert BuildPlan → gated dry-run PlannedFilesystemWrite
//   • filesystem-adapter-dryrun(Layer 5)  shapes the inert PlannedFilesystemWrite (no node:fs)
//   • filesystem-executor      (Layer 5)  the SOLE real writer — jailed to /tmp/ece-dryrun-, approval-gated, mints nothing
//
// It COMPOSES them. It does NOT reimplement, modify, or re-bind any of them. It imports each as a black box.
//
// SAFETY MODEL — the entire point (two phases, a plan-then-confirm gate between them):
//   PHASE A — planOnly(input): AUTOMATIC and safe to run freely. Drives the full chain UP TO (but never into)
//     the real write: ApprovedBuildDecision → build-planner → BuildPlan → filesystem-adapter-dryrun →
//     PlannedFilesystemWrite. Returns the plan + the exact target paths for human inspection. NO real write —
//     this file imports NO node:fs and never calls the executor from planOnly.
//   PHASE B — execute(plannedWrite, approval, confirm, ctx): DOUBLY GATED. It performs a real write ONLY when
//     BOTH are present: (1) a genuine branded `ConsumedApproval` (unforgeable — the mint is module-private to
//     the bridge; this orchestrator mints NOTHING and can only RECEIVE one), AND (2) an explicit human
//     `HumanExecuteConfirm` token the orchestrator CANNOT supply itself (no self-confirm — same discipline as
//     no-self-mint). Missing approval OR missing/invalid confirm ⇒ REFUSE, write nothing. Only then does it
//     delegate to the filesystem-executor — the already-jailed, already-gated, sole real writer.
//
// SAFETY BY CONSTRUCTION (this orchestrator, specifically):
//   • NO node:fs / fs import anywhere — only the executor (a black box it calls in Phase B) touches disk.
//   • MINTS NOTHING — it never constructs a ConsumedApproval and never constructs a passing HumanExecuteConfirm;
//     both are RECEIVED. There is no `mint…(` call and no `{ token: EXECUTE_CONFIRM_TOKEN }` construction here.
//   • CANNOT SELF-CONFIRM — `execute` requires the confirm as a mandatory argument (no default); `planOnly`
//     (the free phase) never calls the executor; the SOLE executor call site sits AFTER the confirm gate.
//   • The real write is still fenced by the executor's own hard jail (/tmp/ece-dryrun-), approval-binding
//     (approval.approvalId === plan.boundToApprovalId), all-or-nothing validation, and O_EXCL/O_NOFOLLOW open.

import {
  planBuild,
  type BuildPlan,
  type BuildPlannerInput,
  type BuildPlannerResult,
} from '../build-planner/build-planner.js';
import type { PlannedFilesystemWrite } from '../../layer-5-action/filesystem-adapter-dryrun/filesystem-adapter-dryrun.js';
import {
  executeFilesystemPlan,
  type ExecuteContext,
  type ExecuteOutcome,
} from '../../layer-5-action/filesystem-executor/filesystem-executor.js';
// The approval type comes from the governed-adapter CONTRACT (which re-exports the bridge's module-private
// branded token). Imported as a TYPE only — this orchestrator consumes the gate; it constructs no token.
import type { ConsumedApproval } from '../../layer-5-action/governed-adapter/governed-adapter.js';

/**
 * THE EXPLICIT HUMAN CONFIRM TOKEN — the SECOND gate of Phase B, separate from the ApprovalGate approval.
 * It is a fixed sentinel a human must pass verbatim. The orchestrator only ever COMPARES against it (below);
 * it never assigns it into a `token:` field, so the orchestrator cannot fabricate a passing confirm for itself.
 */
export const EXECUTE_CONFIRM_TOKEN = 'HUMAN-CONFIRM-EXECUTE-REAL-WRITE';

/** The explicit, human-supplied go-ahead to materialize a planned scaffold. Never constructed by this module. */
export interface HumanExecuteConfirm {
  /** Must strictly equal EXECUTE_CONFIRM_TOKEN, or the write is refused. */
  readonly token: string;
  /** The real human confirming the write — attributed downstream. Never "claude". */
  readonly confirmedBy: string;
}

/** One exact path the executor WOULD create, surfaced from the plan for human inspection before Phase B. */
export interface TargetPath {
  readonly relPath: string;
  readonly absPath: string;
  readonly kind: 'dir' | 'file';
}

/** Phase A output: the inert plan, the (possibly-null) dry-run planned write, and the exact target paths. */
export interface PlanOnlyResult {
  /** The inert BuildPlan — always emitted (pure, deterministic data from the planner). */
  readonly buildPlan: BuildPlan;
  /** The inert PlannedFilesystemWrite — or null when the scaffold gate was absent (fail-closed; no write possible). */
  readonly plannedWrite: PlannedFilesystemWrite | null;
  /** The exact directory/file paths Phase B WOULD create — empty when there is no plan. NO write performed here. */
  readonly targetPaths: readonly TargetPath[];
  /** The full gated dry-run outcome from the planner (ok:false ⇒ STOP_FOR_APPROVAL/refused), for transparency. */
  readonly scaffold: BuildPlannerResult['scaffold'];
}

/** Why an execute confirm was rejected, or null if the confirm is a valid, human-attributed go-ahead. */
function confirmRejectionReason(confirm: HumanExecuteConfirm | undefined): string | null {
  if (!confirm) return 'missing human confirm token — Phase B requires an explicit human confirm (refuse)';
  if (confirm.token !== EXECUTE_CONFIRM_TOKEN) return 'invalid human confirm token — refuse (write nothing)';
  const who = confirm.confirmedBy?.trim().toLowerCase();
  if (!who) return 'confirm carries no human attribution — refuse (a real human must confirm)';
  if (who === 'claude') return 'confirm attributed to "claude" — refuse (must be a real human, never the AI)';
  return null;
}

/**
 * Composes the three proven pieces into the first end-to-end build chain. Holds no capability of its own: it
 * imports no node:fs, mints nothing, and cannot self-confirm. Phase A plans (no write); Phase B executes real
 * files only with a genuine approval AND an explicit human confirm, delegating to the jailed/gated executor.
 */
export class BuildChainOrchestrator {
  /**
   * PHASE A (plan, automatic). Runs the FULL chain to a PlannedFilesystemWrite — and STOPS. Returns the inert
   * BuildPlan, the dry-run planned write, and the exact target paths for human inspection. NO real write happens
   * here: this method never calls the executor, and this file imports no node:fs. Safe to run freely.
   *
   * (planOnly takes the full BuildPlannerInput — the approved decision AND the scaffold-planning grant — because
   * the dry-run adapter is itself gated: absent the scaffold approval it fail-closes and plannedWrite is null.)
   */
  async planOnly(input: BuildPlannerInput): Promise<PlanOnlyResult> {
    const { buildPlan, scaffold }: BuildPlannerResult = await planBuild(input);
    const plannedWrite = scaffold.ok ? scaffold.planned : null;
    const targetPaths = plannedWrite ? this.targetPathsOf(plannedWrite) : [];
    return { buildPlan, plannedWrite, targetPaths, scaffold };
  }

  /**
   * PHASE B (execute, doubly-gated). Performs a REAL write ONLY when BOTH a genuine ConsumedApproval and a valid
   * HumanExecuteConfirm are presented. Missing/invalid confirm ⇒ refuse; missing approval ⇒ refuse; in both cases
   * NOTHING is written. With both, it delegates to the filesystem-executor — the sole real writer, already jailed
   * to /tmp/ece-dryrun- and already binding-checked (approval.approvalId === plan.boundToApprovalId).
   */
  async execute(
    plannedWrite: PlannedFilesystemWrite,
    approval: ConsumedApproval | undefined,
    confirm: HumanExecuteConfirm | undefined,
    ctx: ExecuteContext,
  ): Promise<ExecuteOutcome> {
    // GATE 2 — the explicit human confirm. Checked FIRST so a valid approval without a confirm still writes nothing.
    const confirmError = confirmRejectionReason(confirm);
    if (confirmError !== null) {
      return { ok: false, status: 'refused', reason: confirmError, created: [] };
    }
    // GATE 1 — a genuine ConsumedApproval must be presented. Deny-by-default when no token is supplied at all.
    if (!approval) {
      return { ok: false, status: 'refused', reason: 'missing ConsumedApproval — refuse (deny-by-default)', created: [] };
    }
    // GATE 1b — APPROVAL-BINDING (defense in depth). The executor is the last line of defense and re-checks this
    // itself, but the orchestrator refuses a mismatched approval BEFORE reaching it: the presented token must be
    // bound to THIS plan on BOTH axes — the plan's approval id (plannedWrite.boundToApprovalId) AND the plan's
    // content fingerprint (plannedWrite.boundIntentHash, which the token carries from mint). The second is what
    // makes an approval non-transferable — approvalId is a per-gate counter that can collide across gates. A
    // genuine approval minted for a DIFFERENT plan mismatches the intent hash ⇒ refuse here, write nothing.
    if (approval.approvalId !== plannedWrite.boundToApprovalId || approval.boundIntentHash !== plannedWrite.boundIntentHash) {
      return {
        ok: false, status: 'refused', created: [],
        reason:
          `approval is not bound to this plan — refuse (defense in depth) ` +
          `(approvalId "${approval.approvalId}" vs plan.boundToApprovalId "${plannedWrite.boundToApprovalId}"; ` +
          `boundIntentHash "${approval.boundIntentHash}" vs plan.boundIntentHash "${plannedWrite.boundIntentHash}")`,
      };
    }
    // ALL gates satisfied ⇒ the SOLE real writer (jailed + approval-bound + all-or-nothing) materializes the plan.
    return executeFilesystemPlan(plannedWrite, approval, ctx);
  }

  /** Surface the exact paths the executor WOULD create — pure string derivation, never an fs call. */
  private targetPathsOf(plannedWrite: PlannedFilesystemWrite): readonly TargetPath[] {
    return plannedWrite.entries.map((e): TargetPath => ({
      relPath: e.path,
      absPath: `${plannedWrite.basePath}/${e.path}`,
      kind: e.kind,
    }));
  }
}
