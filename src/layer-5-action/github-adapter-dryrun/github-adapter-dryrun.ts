// GitHub Adapter — DRY-RUN. The FIRST implementation of the GovernedAdapter contract.
//
// It IMPLEMENTS the contract (governed-adapter.ts) — it does NOT re-implement the gating, audit, attribution,
// intent-binding, or fail-closed logic. All of that is inherited. This file adds ONLY GitHub-specific PLAN
// SHAPING: the inert "POST /forks" descriptor plus an inert read-only existence-verify (GET) the real executor
// would run first. There is NO mutating fetch/POST executed anywhere — planned descriptors only. The subject is
// always a THROWAWAY SANDBOX target; never a real ECE/product target.

import {
  GovernedAdapter,
  canonicalPayload,
  PLANNED_ONLY_NOTE,
  type PlannedWrite,
  type ConsumedApproval,
  type ApprovalBinding,
} from '../governed-adapter/governed-adapter.js';

/** The single logical write this adapter plans. Bound to the approval by (tool, target, payload). */
export const GITHUB_FORK_TOOL = 'plan_github_fork_dryrun';

// TARGET DISCIPLINE: the subject is a THROWAWAY SANDBOX namespace only — never a real ECE/product target.
export interface GithubForkIntentDryRun {
  readonly kind: 'github-fork';
  readonly sourceOwner: string;
  readonly sourceRepo: string;
  /** A throwaway dry-run sandbox namespace (org/user) the fork WOULD land in. */
  readonly targetNamespace: string;
  /** Optional renamed target repo in the sandbox namespace. */
  readonly targetRepo?: string;
}

/** An inert read-only check the real executor WOULD run before the write. A GET descriptor — never fetched. */
export interface PlannedReadVerify {
  readonly method: 'GET';
  readonly endpoint: string;
  readonly purpose: string;
}

/** The GitHub-specific inert planned-write descriptor. Extends the contract's PlannedWrite. */
export interface PlannedGithubWrite extends PlannedWrite {
  readonly api: 'github';
  readonly method: 'POST';
  /** The API path template the real executor WOULD call — a string, never fetched. */
  readonly endpoint: string;
  /** The request body that WOULD be sent — inert data. */
  readonly payload: Record<string, unknown>;
  /** Inert read-only existence verify the executor would run FIRST (planned, not executed). */
  readonly preflight: PlannedReadVerify;
}

/** The request body the fork WOULD use. Pure data; also the per-action binding payload. */
export function forkPayload(intent: GithubForkIntentDryRun): Record<string, unknown> {
  return {
    organization: intent.targetNamespace,
    ...(intent.targetRepo ? { name: intent.targetRepo } : {}),
  };
}

export class GithubAdapterDryRun extends GovernedAdapter<GithubForkIntentDryRun, PlannedGithubWrite> {
  /** GitHub-specific: the (tool, target, payload) an approval must be bound to for this fork intent. */
  intentBinding(intent: GithubForkIntentDryRun): ApprovalBinding {
    return {
      tool: GITHUB_FORK_TOOL,
      target: `${intent.sourceOwner}/${intent.sourceRepo}`,
      payloadJson: canonicalPayload(forkPayload(intent)),
    };
  }

  /**
   * GitHub-specific INERT plan shaping. Type-gated by ConsumedApproval (the token is genuinely used for the
   * binding id). Performs NO I/O — returns data only. No fetch, no POST, no executor.
   */
  protected shapePlan(
    intent: GithubForkIntentDryRun,
    approval: ConsumedApproval,
    boundIntentHash: string,
  ): PlannedGithubWrite {
    const targetRepo = intent.targetRepo ?? intent.sourceRepo;
    return {
      dryRun: true,
      plannedOnly: true,
      api: 'github',
      method: 'POST',
      endpoint: `/repos/${intent.sourceOwner}/${intent.sourceRepo}/forks`,
      payload: forkPayload(intent),
      // Inert read-only existence verify the real executor would run first (planned only — never fetched here).
      preflight: {
        method: 'GET',
        endpoint: `/repos/${intent.targetNamespace}/${targetRepo}`,
        purpose: 'existence check — would confirm the target does not already exist before the fork',
      },
      boundIntentHash,
      boundToApprovalId: approval.approvalId,
      note: PLANNED_ONLY_NOTE,
    };
  }
}
