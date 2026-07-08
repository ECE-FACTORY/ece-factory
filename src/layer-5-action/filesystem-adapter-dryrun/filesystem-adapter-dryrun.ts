// Filesystem Adapter — DRY-RUN. The SECOND implementation of the GovernedAdapter contract.
//
// It IMPLEMENTS the contract (governed-adapter.ts) — it does NOT re-implement the gating, audit, attribution,
// intent-binding, or fail-closed logic. All of that is inherited. This file adds ONLY filesystem-specific PLAN
// SHAPING: an inert PlannedFilesystemWrite — a directory tree plus file contents, expressed purely as DATA.
//
// SAFETY BY CONSTRUCTION (this adapter, specifically):
//   • It imports NO node:fs (or fs, or node:fs/promises) — NONE. A filesystem adapter that cannot touch the
//     filesystem. There is no writeFile / mkdir / rm / cp / rename / appendFile call anywhere; the planner
//     returns inert data (dryRun / plannedOnly). There is no executor.
//   • The write-capable call `shapePlan(intent, approval: ConsumedApproval, …)` is type-gated by the REAL
//     branded ConsumedApproval (../mcp-bridge/tool-classes.ts:100-104). Its mint is module-private to the
//     bridge — this adapter mints NOTHING; it consumes the gate the contract runs for it.
//   • The subject is ALWAYS a THROWAWAY SANDBOX path under /tmp/ece-dryrun-… — never a real ECE/product path.
//   • Secrets are never logged; the adapter holds only an abstract scoped-credential reference (unused here).

import {
  GovernedAdapter,
  canonicalPayload,
  PLANNED_ONLY_NOTE,
  type PlannedWrite,
  type ConsumedApproval,
  type ApprovalBinding,
} from '../governed-adapter/governed-adapter.js';

/** The single logical write this adapter plans. Bound to the approval by (tool, target, payload). */
export const FILESYSTEM_SCAFFOLD_TOOL = 'plan_filesystem_scaffold_dryrun';

/**
 * The mandatory throwaway-sandbox prefix. A scaffold may only ever be PLANNED under a disposable dry-run
 * sandbox path — never a real product tree. (Enforcement of this prefix belongs to the future executor's
 * gate, not to inert planning; it is surfaced here so the human inspecting the plan can confirm the target.)
 */
export const SANDBOX_PATH_PREFIX = '/tmp/ece-dryrun-';

/** One node of the skeleton the caller asks to scaffold. A directory, or a file with inert `contents`. */
export interface ScaffoldEntrySpec {
  /** Path RELATIVE to the intent's basePath. */
  readonly path: string;
  readonly kind: 'dir' | 'file';
  /** Only for kind:'file' — the bytes the file WOULD contain. Inert data; never written in this build. */
  readonly contents?: string;
}

// TARGET DISCIPLINE: `basePath` is a THROWAWAY SANDBOX path only — never docassemble or any real ECE target.
export interface FilesystemScaffoldIntentDryRun {
  readonly kind: 'filesystem-scaffold';
  /** The already-approved decision this skeleton scaffolds (e.g. an approved harvest/build decision id/slug). */
  readonly approvedDecision: string;
  /** A throwaway dry-run sandbox base path the scaffold WOULD land in (/tmp/ece-dryrun-…). */
  readonly basePath: string;
  /** The skeleton to scaffold — directories and files, expressed purely as DATA. */
  readonly entries: readonly ScaffoldEntrySpec[];
}

/** An inert filesystem entry the real executor WOULD create. Data — never an fs call. */
export interface PlannedFilesystemEntry {
  readonly path: string;
  readonly kind: 'dir' | 'file';
  readonly contents?: string;
}

/**
 * The filesystem-specific inert planned-write descriptor. Extends the contract's PlannedWrite — so it carries
 * dryRun/plannedOnly/boundIntentHash/boundToApprovalId/note for free. The tree lives in `entries`; nothing is
 * ever created.
 */
export interface PlannedFilesystemWrite extends PlannedWrite {
  readonly api: 'filesystem';
  /** The throwaway sandbox base path the tree WOULD be materialized under — a string, never opened. */
  readonly basePath: string;
  /** The directory-and-file tree the executor WOULD create — inert data, never written here. */
  readonly entries: readonly PlannedFilesystemEntry[];
}

/**
 * THE SINGLE FUTURE-EXECUTOR SEAM — typed, gated, and DELIBERATELY ABSENT.
 *
 * A later, separate, human-approved build COULD attach a real executor with EXACTLY this signature. It would
 * be the ONE place node:fs is imported and the ONE place mkdir/writeFile run, and — like the write-capable
 * call — it would still REQUIRE a branded ConsumedApproval (so even the real executor is type-gated) and
 * would refuse any basePath not under SANDBOX_PATH_PREFIX.
 *
 * It does NOT exist in this build: there is no function of this type, no node:fs import, and no call site.
 * The adapter is READY BY ARCHITECTURE (one explicit, typed, gated seam) yet INCAPABLE BY CONSTRUCTION
 * (the seam is a type only — absent as a value). Attaching it is a future, reviewed, human-approved build.
 */
export type FutureFilesystemExecutor = (
  plan: PlannedFilesystemWrite,
  approval: ConsumedApproval,
) => Promise<never>; // return type is `never` on purpose — no executor is provided in this build.

/** The canonical binding payload: the exact tree an approval is bound to. Pure data. */
export function scaffoldPayload(intent: FilesystemScaffoldIntentDryRun): Record<string, unknown> {
  return {
    approvedDecision: intent.approvedDecision,
    basePath: intent.basePath,
    entries: intent.entries.map((e) =>
      e.kind === 'file'
        ? { path: e.path, kind: 'file', contents: e.contents ?? '' }
        : { path: e.path, kind: 'dir' },
    ),
  };
}

export class FilesystemAdapterDryRun extends GovernedAdapter<
  FilesystemScaffoldIntentDryRun,
  PlannedFilesystemWrite
> {
  /** Filesystem-specific: the (tool, target, payload) an approval must be bound to for this scaffold intent. */
  intentBinding(intent: FilesystemScaffoldIntentDryRun): ApprovalBinding {
    return {
      tool: FILESYSTEM_SCAFFOLD_TOOL,
      // The sandbox base path IS the target — so an approval for path A cannot authorize a scaffold at path B.
      target: intent.basePath,
      payloadJson: canonicalPayload(scaffoldPayload(intent)),
    };
  }

  /**
   * Filesystem-specific INERT plan shaping. Type-gated by ConsumedApproval (the token is genuinely used for the
   * binding id). Performs NO I/O — it copies the requested tree into an inert descriptor and returns data only.
   * No node:fs, no writeFile/mkdir, no executor.
   */
  protected shapePlan(
    intent: FilesystemScaffoldIntentDryRun,
    approval: ConsumedApproval,
    boundIntentHash: string,
  ): PlannedFilesystemWrite {
    return {
      dryRun: true,
      plannedOnly: true,
      api: 'filesystem',
      basePath: intent.basePath,
      entries: intent.entries.map((e): PlannedFilesystemEntry =>
        e.kind === 'file'
          ? { path: e.path, kind: 'file', contents: e.contents ?? '' }
          : { path: e.path, kind: 'dir' },
      ),
      boundIntentHash,
      boundToApprovalId: approval.approvalId,
      note: PLANNED_ONLY_NOTE,
    };
  }
}
