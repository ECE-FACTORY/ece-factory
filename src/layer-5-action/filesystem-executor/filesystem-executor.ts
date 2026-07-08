// Layer-5 FILESYSTEM EXECUTOR — the FIRST and ONLY module in the factory that performs a REAL filesystem write.
//
// Every other write-capable module in this repo is incapable BY CONSTRUCTION: the dry-run filesystem adapter
// (../filesystem-adapter-dryrun/) and the GitHub adapter import NO node:fs and emit inert plans; the Build
// Planner (../../layer-4-build-harden/build-planner/) returns DATA and delegates. Law 4e/4f freeze that. This
// module is the deliberate, guarded carve-out (Law 4g): it imports node:fs — the ONE sanctioned place — and it
// materializes an already-approved, already-planned scaffold onto disk. Because it CAN write, it is the most
// dangerous file in the tree, so it is fenced on every side:
//
//   1. SANDBOX JAIL (hard, non-configurable) — it writes ONLY inside /tmp/ece-dryrun-… . The jail prefix is a
//      module constant; it is NOT a parameter, NOT overridable. Every target is resolved to its REAL canonical
//      path (realpath, following symlinks) and must live inside the canonicalized sandbox base, which must
//      itself sit under the canonical jail prefix. Absolute paths, ../ traversal, and symlink escapes are all
//      rejected. There is no code path that writes outside the jail.
//   2. APPROVAL-GATED — it requires a genuine branded ConsumedApproval (../mcp-bridge/tool-classes.ts:100-104,
//      re-exported by the governed-adapter contract). That token's mint is module-private to the bridge, so this
//      executor CANNOT be reached without a real, dispatcher-minted approval, and it MINTS NOTHING itself. The
//      presented token must be the one THIS plan is bound to, on TWO independent axes that must BOTH hold:
//      approval.approvalId === plan.boundToApprovalId AND approval.boundIntentHash === plan.boundIntentHash. The
//      second is essential: approvalId is a per-gate counter that collides across gates, so a genuine approval
//      minted for a DIFFERENT plan could share the id — only the content-derived intent hash makes the approval
//      NON-TRANSFERABLE between plans. A mismatch on either ⇒ REFUSE, write nothing, audit the refusal.
//   3. ALL-OR-NOTHING — the ENTIRE plan is validated (approval bound, every path in-jail, nothing pre-exists)
//      BEFORE a single byte is written. If any check fails, it aborts and writes NOTHING (no partial scaffold).
//   4. AUDIT BEFORE WRITE — the intent (which plan, which approval, which paths) is recorded and AWAITED BEFORE
//      any real fs call; the outcome is recorded after; a refusal is recorded when denied.
//   5. NO DESTRUCTIVE OPS — it only creates directories and writes NEW files. It never deletes, renames,
//      truncates, or overwrites. If a target already exists it REFUSES (default refuse-on-exist); the sole
//      relaxation is an explicitly opted-in already-EMPTY sandbox base — individual targets must still not exist.
//   6. SYSCALL-LEVEL SYMLINK/RACE DEFENSE (belt AND suspenders, closing the final-component TOCTOU) — the
//      realCanonical pre-check (see validatePlan) resolves symlinks that exist at validation time, but a symlink
//      raced onto the target path AFTER that check and BEFORE the write could still redirect a naive write. So
//      the write itself is fenced at the OS boundary, not just by the earlier check:
//        • FILE WRITE — a NEW file is created via an explicit fd: openSync(target, O_WRONLY|O_CREAT|O_EXCL|
//          O_NOFOLLOW). O_EXCL refuses an existing target (no overwrite); O_NOFOLLOW makes the KERNEL refuse a
//          symlink at the final component; and because bytes are written to the returned fd, the write cannot be
//          redirected after the atomic open. writeFileSync is never used.
//        • DIRECTORY CREATE — directories are created ONE component at a time (never a blind recursive mkdir
//          through a possibly-symlinked ancestor). Every already-existing component is lstat'd (NO symlink
//          follow) and REFUSED if it is a symlink, so a symlink raced into an ancestor cannot redirect the walk.

import { mkdirSync, existsSync, realpathSync, readdirSync, statSync, lstatSync, openSync, writeSync, closeSync, constants } from 'node:fs';
import { resolve, dirname, basename, join, sep, isAbsolute } from 'node:path';
import type { PlannedFilesystemWrite } from '../filesystem-adapter-dryrun/filesystem-adapter-dryrun.js';
// The approval type comes from the governed-adapter CONTRACT (which re-exports the bridge's module-private
// branded token). Imported as a TYPE only — this executor consumes the gate; it constructs no token.
import type { ConsumedApproval } from '../governed-adapter/governed-adapter.js';

/**
 * THE HARD SANDBOX JAIL. Every real write this module performs lands under a path with this exact prefix.
 * It is a module constant — NOT a parameter, NOT a field, NOT overridable. There is no other write root.
 */
export const JAIL_PREFIX = '/tmp/ece-dryrun-';

/** The tool name this executor's real write is attributed to in the audit. */
export const FILESYSTEM_EXECUTE_TOOL = 'execute_filesystem_scaffold';

// ── audit seam (the real Audit Engine attaches here at composition) ─────────────────────────────────────
export interface ExecutorHumanActor {
  readonly user_id: string;
  readonly email?: string;
  readonly role?: string;
}
export interface FsExecutorAuditIntent {
  readonly tool: string;
  readonly organization_id: string;
  readonly human_actor: ExecutorHumanActor;
  /** The approval the write is authorized by — the id only, never a secret. */
  readonly approvalId: string;
  /** The plan's stable intent fingerprint (echoed for human/audit correlation). */
  readonly boundIntentHash: string;
  readonly basePath: string;
  readonly targets: readonly { readonly path: string; readonly kind: 'dir' | 'file' }[];
  readonly environment: 'local' | 'staging' | 'production';
}
export interface FsExecutorAuditResult {
  readonly tool: string;
  readonly organization_id: string;
  readonly status: 'written' | 'error';
  readonly approvalId: string;
  readonly created: number;
  readonly reason?: string;
}
export interface FsExecutorAuditRefusal {
  readonly tool: string;
  readonly organization_id: string;
  readonly human_actor: ExecutorHumanActor;
  readonly stage: 'approval-binding' | 'jail-validation' | 'refuse-on-exist';
  readonly decision: 'REFUSE';
  readonly reason: string;
  readonly environment: 'local' | 'staging' | 'production';
}
export interface FilesystemExecutorAudit {
  appendIntent(entry: FsExecutorAuditIntent): Promise<void> | void;
  appendResult(entry: FsExecutorAuditResult): Promise<void> | void;
  appendRefusal(entry: FsExecutorAuditRefusal): Promise<void> | void;
}

export interface ExecuteContext {
  readonly audit: FilesystemExecutorAudit;
  /** The human on whose behalf this runs — attributed in the audit. Never "claude". */
  readonly human: ExecutorHumanActor;
  readonly organizationId: string;
  readonly environment: 'local' | 'staging' | 'production';
  /**
   * The ONLY relaxation of refuse-on-exist: permit an ALREADY-EXISTING but EMPTY sandbox directory as the base
   * (create-fresh in an empty sandbox). Individual target files/dirs must STILL not pre-exist. Default false —
   * if the base path exists at all, refuse.
   */
  readonly createFreshInEmptySandbox?: boolean;
}

export interface CreatedNode {
  readonly path: string;
  readonly kind: 'dir' | 'file';
}
export type ExecuteOutcome =
  | { readonly ok: true; readonly status: 'written'; readonly basePath: string; readonly approvalId: string; readonly created: readonly CreatedNode[] }
  | { readonly ok: false; readonly status: 'refused' | 'error'; readonly reason: string; readonly created: readonly CreatedNode[] };

// ── jail canonicalization ───────────────────────────────────────────────────────────────────────────────
/**
 * The canonical form of the jail prefix. On some platforms /tmp is itself a symlink (macOS: /tmp → /private/tmp),
 * so a naive startsWith('/tmp/…') on a realpath'd target would wrongly fail. We canonicalize the jail's parent
 * (/tmp) via realpath and re-attach the 'ece-dryrun-' name prefix, so the canonical check compares like-with-like.
 * Reading the real /tmp here (not a caller-supplied root) is what makes the jail unspoofable.
 */
function canonicalJailPrefix(): string {
  const tmpReal = realpathSync('/tmp'); // e.g. /private/tmp on macOS, /tmp on Linux
  return join(tmpReal, 'ece-dryrun-'); // trailing '-' preserved — this is a NAME prefix, not a directory
}

/**
 * Canonical absolute path of `p`, resolving every symlink in its EXISTING ancestry. `p` need not exist yet:
 * we walk up to the deepest existing ancestor, realpath THAT (collapsing any symlink), then re-append the
 * not-yet-existing tail. Since the executor never creates symlinks, the tail can only be plain new segments.
 */
function realCanonical(p: string): string {
  let cur = resolve(p);
  const missing: string[] = [];
  while (!existsSync(cur)) {
    const parent = dirname(cur);
    if (parent === cur) break; // reached the filesystem root
    missing.unshift(basename(cur));
    cur = parent;
  }
  const realBase = realpathSync(cur); // resolves ALL symlinks in the portion that exists
  return missing.length ? join(realBase, ...missing) : realBase;
}

/** Reject absolute paths, empty paths, and any '..' traversal segment. Returns an error string or null. */
function entryPathError(rel: unknown): string | null {
  if (typeof rel !== 'string' || rel.trim() === '') return `empty or non-string entry path`;
  if (isAbsolute(rel)) return `absolute entry path is not allowed: "${rel}"`;
  const segs = rel.split(/[\\/]+/);
  if (segs.some((s) => s === '..')) return `path traversal ('..') is not allowed: "${rel}"`;
  return null;
}

interface ValidatedTarget {
  readonly abs: string;
  readonly kind: 'dir' | 'file';
  readonly contents: string;
}
type Validation =
  | { readonly ok: true; readonly base: string; readonly targets: readonly ValidatedTarget[] }
  | { readonly ok: false; readonly reason: string };

/**
 * ALL-OR-NOTHING validation of the ENTIRE plan against the jail — performed BEFORE any write. Every base and
 * target must (a) pass the literal jail-prefix check on its resolved logical path, and (b) canonicalize to a
 * real path inside the canonicalized sandbox base (catching symlink escapes). Refuse-on-exist is enforced here.
 */
function validatePlan(plan: PlannedFilesystemWrite, ctx: ExecuteContext): Validation {
  const base = plan.basePath;
  if (typeof base !== 'string' || !base.startsWith(JAIL_PREFIX)) {
    return { ok: false, reason: `basePath is outside the sandbox jail (must start with "${JAIL_PREFIX}"): "${base}"` };
  }
  if (!isAbsolute(base)) {
    return { ok: false, reason: `basePath must be an absolute jail path: "${base}"` };
  }
  const canonJail = canonicalJailPrefix();
  const canonBase = realCanonical(base);
  if (!(canonBase === canonJail || canonBase.startsWith(canonJail))) {
    return { ok: false, reason: `basePath canonical path escapes the jail (symlink?): "${base}" -> "${canonBase}"` };
  }

  // refuse-on-exist for the base: default refuses if it exists at all; the sole relaxation is an EMPTY dir.
  if (existsSync(base)) {
    if (!ctx.createFreshInEmptySandbox) {
      return { ok: false, reason: `refuse-on-exist: sandbox base already exists (no overwrite): "${base}"` };
    }
    const st = statSync(base);
    if (!st.isDirectory() || readdirSync(base).length !== 0) {
      return { ok: false, reason: `create-fresh requires an EMPTY sandbox directory: "${base}"` };
    }
  }

  const targets: ValidatedTarget[] = [];
  for (const e of plan.entries) {
    const perr = entryPathError(e.path);
    if (perr) return { ok: false, reason: perr };

    const logical = resolve(base, e.path);
    // defense in depth: the resolved logical path must remain within the (literal) base and jail.
    if (!(logical === base || logical.startsWith(base + sep))) {
      return { ok: false, reason: `entry escapes its sandbox base: "${e.path}"` };
    }
    if (!logical.startsWith(JAIL_PREFIX)) {
      return { ok: false, reason: `entry escapes the sandbox jail: "${e.path}"` };
    }
    // canonical check: the real path (symlinks resolved) must live inside the canonicalized base.
    const canon = realCanonical(logical);
    if (!(canon === canonBase || canon.startsWith(canonBase + sep))) {
      return { ok: false, reason: `entry canonical path escapes the jail (symlink?): "${e.path}" -> "${canon}"` };
    }
    // refuse-on-exist for every target — never overwrite anything.
    if (existsSync(logical)) {
      return { ok: false, reason: `refuse-on-exist: target already exists (no overwrite): "${logical}"` };
    }
    targets.push({ abs: logical, kind: e.kind, contents: e.kind === 'file' ? e.contents ?? '' : '' });
  }
  return { ok: true, base, targets };
}

/**
 * The literal parent of the jail prefix (e.g. '/tmp'). This is OS-owned ground: on macOS it is itself a symlink
 * (/tmp → /private/tmp), which realCanonical already accounts for. We NEVER create it and NEVER lstat-refuse it;
 * the symlink-checked descent starts at the first component BELOW it (the 'ece-dryrun-…' name we introduce).
 */
const JAIL_PARENT = dirname(JAIL_PREFIX);

/**
 * Create `dir` as a real directory by descending from `floor` ONE component at a time — the symlink-safe
 * replacement for a blind `mkdir(..., { recursive: true })`. `dir` must be `floor` or a descendant of it.
 * For every intermediate component that ALREADY exists we lstatSync it (which NEVER follows symlinks) and THROW
 * if it is a symbolic link — so a symlink raced into an ancestor AFTER the realCanonical pre-check cannot redirect
 * the descent out of the jail. Truly-missing components are created with a plain, non-recursive mkdir; a broken
 * symlink squatting on a component name is caught as a symlink (lstat) and refused. `floor` and everything above
 * it are NOT re-checked (that is the OS temp ancestry realCanonical already validated as resolving in-jail).
 */
function mkdirDescendingNoSymlink(dir: string, floor: string): void {
  if (dir === floor) return;
  if (!dir.startsWith(floor + sep)) {
    throw new Error(`refusing to create a directory outside the validated floor: "${dir}" (floor "${floor}")`);
  }
  let cur = floor;
  for (const seg of dir.slice(floor.length + 1).split(sep)) {
    cur = join(cur, seg);
    let st: ReturnType<typeof lstatSync> | null;
    try { st = lstatSync(cur); } catch { st = null; } // ENOENT ⇒ nothing there (not even a broken symlink)
    if (st) {
      if (st.isSymbolicLink()) throw new Error(`refuse: ancestor component is a symlink (raced?): "${cur}"`);
      if (!st.isDirectory()) throw new Error(`refuse: ancestor component exists and is not a directory: "${cur}"`);
    } else {
      mkdirSync(cur); // non-recursive: parent already checked/created in a prior iteration
    }
  }
}

/**
 * Materialize an already-approved, already-planned scaffold onto REAL disk — the factory's sole real-write path.
 *
 * Requires a genuine branded `ConsumedApproval` (unforgeable — mint is module-private to the bridge) that is
 * BOUND to this plan (approval.approvalId === plan.boundToApprovalId). Validates the WHOLE plan against the hard
 * sandbox jail BEFORE writing anything (all-or-nothing), audits the intent BEFORE the first fs call, then creates
 * directories and NEW files only (never overwrites/deletes). Any failed check ⇒ writes nothing.
 */
export async function executeFilesystemPlan(
  plan: PlannedFilesystemWrite,
  approval: ConsumedApproval,
  ctx: ExecuteContext,
): Promise<ExecuteOutcome> {
  const tool = FILESYSTEM_EXECUTE_TOOL;

  // 1. APPROVAL BINDING — the presented (genuine) token must be the one THIS plan was bound to. Two independent
  //    bindings must BOTH hold, so a genuine approval minted for a DIFFERENT plan cannot be stapled to this one:
  //      (a) approvalId — the plan records the approval id it was bound to (filesystem-adapter-dryrun.ts:141,
  //          `boundToApprovalId: approval.approvalId`), matched against approval.approvalId. NECESSARY but NOT
  //          sufficient: `approvalId` is a per-gate-instance counter (approval-gate.ts:141, `apr_${++counter}`),
  //          so `apr_1` from one gate collides with `apr_1` from another — a valid approval for an unrelated
  //          action can share this id. This check alone is transferable; it is kept (not weakened) and joined by:
  //      (b) boundIntentHash — the CONTENT-derived fingerprint of the exact (tool, target, payload) the human
  //          approved. The plan records it (filesystem-adapter-dryrun.ts:140, `boundIntentHash`) and the token
  //          carries it (stamped at mint from the SAME binding — tool-classes.ts, ClassDispatcher.consume). It
  //          does NOT collide across gates, so it is what makes an approval NON-TRANSFERABLE between plans.
  //    Either mismatch ⇒ REFUSE, write nothing, audit the refusal.
  if (!approval || approval.approvalId !== plan.boundToApprovalId || approval.boundIntentHash !== plan.boundIntentHash) {
    const reason =
      `approval is missing or not bound to this plan ` +
      `(approvalId "${approval?.approvalId ?? '<none>'}" vs plan.boundToApprovalId "${plan.boundToApprovalId}"; ` +
      `boundIntentHash "${approval?.boundIntentHash ?? '<none>'}" vs plan.boundIntentHash "${plan.boundIntentHash}")`;
    await ctx.audit.appendRefusal({
      tool, organization_id: ctx.organizationId, human_actor: ctx.human,
      stage: 'approval-binding', decision: 'REFUSE', reason, environment: ctx.environment,
    });
    return { ok: false, status: 'refused', reason, created: [] };
  }

  // 2. ALL-OR-NOTHING VALIDATION — the entire plan is checked before a single byte is written.
  const v = validatePlan(plan, ctx);
  if (!v.ok) {
    await ctx.audit.appendRefusal({
      tool, organization_id: ctx.organizationId, human_actor: ctx.human,
      stage: v.reason.startsWith('refuse-on-exist') ? 'refuse-on-exist' : 'jail-validation',
      decision: 'REFUSE', reason: v.reason, environment: ctx.environment,
    });
    return { ok: false, status: 'refused', reason: v.reason, created: [] };
  }

  // 3. AUDIT BEFORE WRITE — recorded and AWAITED before ANY real fs call.
  await ctx.audit.appendIntent({
    tool, organization_id: ctx.organizationId, human_actor: ctx.human,
    approvalId: approval.approvalId, boundIntentHash: plan.boundIntentHash, basePath: v.base,
    targets: plan.entries.map((e) => ({ path: e.path, kind: e.kind })),
    environment: ctx.environment,
  });

  // 4. MATERIALIZE — every real fs op is fenced at the syscall boundary (see the file header, point 6):
  //    directories are created ONE component at a time with a symlink refusal on each existing ancestor; new
  //    files are created via openSync with O_EXCL|O_NOFOLLOW so the kernel refuses both an existing target and a
  //    final-component symlink. No deletes/renames/overwrites; a symlink raced onto any path cannot be followed.
  const created: CreatedNode[] = [];
  try {
    mkdirDescendingNoSymlink(v.base, JAIL_PARENT); // create (or accept the empty, non-symlink) sandbox base
    for (const t of v.targets) {
      if (t.kind === 'dir') {
        mkdirDescendingNoSymlink(t.abs, v.base);
        created.push({ path: t.abs, kind: 'dir' });
      } else {
        mkdirDescendingNoSymlink(dirname(t.abs), v.base); // ensure parent dirs of the file exist (symlink-safe)
        // Explicit fd open: O_EXCL refuses an existing target; O_NOFOLLOW makes the KERNEL refuse a symlink at
        // the final component (closes the final-component TOCTOU); the fd write cannot be redirected after open.
        const fd = openSync(t.abs, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o644);
        try { writeSync(fd, t.contents); } finally { closeSync(fd); }
        created.push({ path: t.abs, kind: 'file' });
      }
    }
  } catch (err) {
    const reason = `materialization error after validation: ${err instanceof Error ? err.message : String(err)}`;
    await ctx.audit.appendResult({ tool, organization_id: ctx.organizationId, status: 'error', approvalId: approval.approvalId, created: created.length, reason });
    return { ok: false, status: 'error', reason, created };
  }

  // 5. AUDIT OUTCOME.
  await ctx.audit.appendResult({ tool, organization_id: ctx.organizationId, status: 'written', approvalId: approval.approvalId, created: created.length });
  return { ok: true, status: 'written', basePath: v.base, approvalId: approval.approvalId, created };
}
