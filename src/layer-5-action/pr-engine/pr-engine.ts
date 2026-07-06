// PR Engine (Module 30, Wave 5) — a workflow OVER the one guarded door. It composes existing tiers; it does
// NOT get privileged access and contains NO approval/token/external-call logic of its own.
//
// TWO STRUCTURALLY-SEPARATED STAGES:
//   • DRAFT (DRAFT_ONLY): assemble a proposed PR (title/body/branch/base/file-change summary) and route it
//     through the bridge's DRAFT_ONLY path. The draft outcome has NO opened/committed variant — drafting a
//     PR opens NOTHING. A draft is a proposal a human turns into an open-request; it never escalates itself.
//   • OPEN (external, APPROVAL_REQUIRED_WRITE): route through the bridge's `open_pull_request` (Tier 4) under
//     the FULL Phase 8.4 external gauntlet — specific-target binding (exact repo+branch+base), single-use
//     human token, no-bulk (one PR per approval), production gate, blast-radius audit, kill-beats-approval,
//     self-approval-rejected. The open stage's safety IS the 8.4 gauntlet reached through the bridge.
//
// INHERITS THE GATES — NO RE-IMPLEMENTATION: the only way this engine opens a PR is `externalActionWithTool`;
// there is no parallel approval/token/external path. EXTERNAL STAYS ON FAKES this phase — the bridge's
// open_pull_request is wired to the injected fake; real GitHub wiring waits for the separately-gated
// external-tier live wiring.
//
// STANDALONE-PACKAGEABLE: the bridge's draft + external ports and the repo lookup are injected; every
// cross-engine reference is `import type` (zero runtime coupling).

import type { BridgeCallContext, DraftOutcome, ExternalOutcome, OpenPrCapability } from '../mcp-bridge/mcp-bridge.js';
import type { DraftTool, DraftParams } from '../mcp-bridge/draft-tools.js';
import type { ExternalParams, ExternalTarget } from '../mcp-bridge/external-tools.js';

/**
 * The slice of the bridge the PR Engine composes — DRAFT_ONLY + the capability-gated PR-open path. `McpBridge`
 * satisfies it. Note: there is NO generic external method here, and `openPullRequest` REQUIRES the unforgeable
 * `OpenPrCapability` — so only a capability holder (this engine) can open a PR (8.8b: sole authority).
 */
export interface PrEngineBridge {
  draftWithTool(name: DraftTool, ctx: BridgeCallContext, params?: DraftParams): Promise<DraftOutcome>;
  grantPrOpenCapability(): OpenPrCapability;
  openPullRequest(capability: OpenPrCapability, ctx: BridgeCallContext, params?: ExternalParams): Promise<ExternalOutcome>;
}

/** Injected: is this a real / registered repo target? (Consumes the repo registry by use — deny-by-default.) */
export type RepoLookup = (repo: string) => Promise<boolean>;

export interface PrTarget {
  repo: string;   // e.g. "ECE-FACTORY/x"
  branch: string; // head
  base: string;   // base
  environment?: string;
}

export interface PrDraftInput {
  target: PrTarget;
  changeDescription: string;
  fileChangeSummary?: string[];
}

export interface ProposedPr {
  title: string;
  body: string;
  repo: string;
  branch: string;
  base: string;
  fileChangeSummary: string[];
}

/**
 * Draft outcome — a proposal awaiting human review, or a refusal. There is intentionally NO 'PR-OPENED'/
 * 'opened'/'committed' member: the draft stage cannot open a PR.
 */
export type PrDraftOutcome =
  | { status: 'PR-DRAFT-AWAITING-HUMAN-REVIEW'; proposedPr: ProposedPr; auditSeq?: number }
  | { status: 'refused'; stage: 'draft'; reason: string };

/**
 * The typed seam other modules consume. A consumer assembles a `PrRequest` and hands it to a `PrOpener`
 * (the PR Engine) — it has NO way to call open_pull_request itself (no bridge, no capability).
 */
export interface PrRequest {
  target: PrTarget;
  title: string;
  body: string;
  /** The Approval Gate action id whose single-use, specific-target human approval authorizes opening THIS PR. */
  approvalActionId?: string;
}
/** @deprecated alias for PrRequest (the public open seam). */
export type PrOpenInput = PrRequest;

/** The narrow surface other modules receive — they can hand a PrRequest to openPr; nothing else. */
export interface PrOpener {
  openPr(request: PrRequest, ctx: BridgeCallContext): Promise<PrOpenOutcome>;
}

/**
 * Open outcome — opened, withheld for approval, or refused. PR-OPENED is reachable ONLY from the bridge's
 * EXTERNAL-ACTION-COMMITTED, which requires the full 8.4 gauntlet (consumed specific-target human token).
 */
export type PrOpenOutcome =
  | { status: 'PR-OPENED'; repo: string; branch: string; base: string; committed: unknown; approvalId: string }
  | { status: 'STOP_FOR_APPROVAL'; reason: string }
  | { status: 'refused'; stage: 'open'; reason: string };

export class PrEngine implements PrOpener {
  /** The sole-held, unforgeable PR-open capability — granted once at construction. No other module has one. */
  private readonly prOpenCapability: OpenPrCapability;

  constructor(
    private readonly bridge: PrEngineBridge,
    private readonly repoLookup: RepoLookup,
  ) {
    this.prOpenCapability = bridge.grantPrOpenCapability();
  }

  /** DRAFT stage (DRAFT_ONLY) — assemble + route through the bridge's draft path. Opens nothing. */
  async draftPr(input: PrDraftInput, ctx: BridgeCallContext): Promise<PrDraftOutcome> {
    const v = await this.verifyTarget(input.target);
    if (!v.ok) return { status: 'refused', stage: 'draft', reason: v.reason };
    if (!input.changeDescription?.trim()) return { status: 'refused', stage: 'draft', reason: 'missing change description (deny-by-default)' };

    const proposed = assembleProposedPr(input);
    // Route through the bridge's DRAFT_ONLY path so the proposal is audited and structurally inert.
    const d = await this.bridge.draftWithTool('draft_repo_plan', ctx, { ref: `PR ${proposed.repo} ${proposed.branch}->${proposed.base}: ${proposed.title}` });
    if (d.status === 'refused') return { status: 'refused', stage: 'draft', reason: `draft refused: ${d.reason}` };
    // d.status is DRAFT-AWAITING-HUMAN-REVIEW — inert. Surface the assembled proposal (the change description
    // sits in the PR body as INERT content; it is never actioned).
    return { status: 'PR-DRAFT-AWAITING-HUMAN-REVIEW', proposedPr: proposed, auditSeq: d.auditSeq };
  }

  /** OPEN stage (external) — route through the bridge's capability-gated open_pull_request (full 8.4 gauntlet). */
  async openPr(input: PrRequest, ctx: BridgeCallContext): Promise<PrOpenOutcome> {
    const v = await this.verifyTarget(input.target);
    if (!v.ok) return { status: 'refused', stage: 'open', reason: v.reason };

    const target: ExternalTarget = {
      system: 'github',
      targetId: `${input.target.repo}#${input.target.branch}->${input.target.base}`, // the EXACT PR target
      environment: input.target.environment,
      effect: `open PR on ${input.target.repo}: ${input.target.branch} -> ${input.target.base} — ${input.title}`,
      reversible: 'soft-only',
    };
    // ONE target per approval (no bulk by construction). Requires the unforgeable PR-open capability — the
    // ONLY way to reach open_pull_request. The bridge applies the full 8.4 gauntlet.
    const out = await this.bridge.openPullRequest(this.prOpenCapability, ctx, {
      approvalActionId: input.approvalActionId,
      target,
      payload: { title: input.title, body: input.body },
    });

    if (out.status === 'EXTERNAL-ACTION-COMMITTED') {
      return { status: 'PR-OPENED', repo: input.target.repo, branch: input.target.branch, base: input.target.base, committed: out.committed, approvalId: out.approvalId };
    }
    if (out.status === 'STOP_FOR_APPROVAL') return { status: 'STOP_FOR_APPROVAL', reason: out.reason };
    return { status: 'refused', stage: 'open', reason: out.reason };
  }

  private async verifyTarget(target: PrTarget | undefined): Promise<{ ok: true } | { ok: false; reason: string }> {
    if (!target?.repo?.trim() || !target.branch?.trim() || !target.base?.trim()) {
      return { ok: false, reason: 'unverifiable repo target — repo, branch and base are required (deny-by-default)' };
    }
    if (!(await this.repoLookup(target.repo))) {
      return { ok: false, reason: `unregistered/non-existent repo "${target.repo}" — a PR can only target a registered repo (deny-by-default)` };
    }
    return { ok: true };
  }
}

function assembleProposedPr(input: PrDraftInput): ProposedPr {
  const t = input.target;
  // The change description is INERT content placed in the PR body — never interpreted as a command.
  return {
    title: firstLine(input.changeDescription) || `Update ${t.repo}`,
    body: input.changeDescription,
    repo: t.repo,
    branch: t.branch,
    base: t.base,
    fileChangeSummary: input.fileChangeSummary ?? [],
  };
}

function firstLine(s: string): string {
  const line = s.split('\n')[0]?.trim() ?? '';
  return line.length > 120 ? line.slice(0, 117) + '…' : line;
}
