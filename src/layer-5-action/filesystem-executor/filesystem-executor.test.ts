// Filesystem Executor — the ONLY real-write module, so its test uses a REAL temp sandbox and asserts on ACTUAL
// disk state, then cleans up. It proves, end-to-end through the REAL Approval Gate + dispatcher (genuine minted
// ConsumedApproval — never a forged token): an approved in-jail plan really creates the files; every escape
// (absolute / ../ / symlink / out-of-jail base) is REFUSED with nothing written; a missing/mismatched approval
// is refused; validation is all-or-nothing; refuse-on-exist holds; the audit is written BEFORE any fs call; and
// the executor mints nothing. Every test that creates a directory removes it in afterEach.

import { describe, it, expect, afterEach } from 'vitest';
import {
  existsSync, readFileSync, mkdirSync, writeFileSync, symlinkSync, rmSync, statSync,
} from 'node:fs';
import { join } from 'node:path';
import { ApprovalGate } from '../../layer-1-law/approval-gate/approval-gate.js';
import { BridgeApprovalGate, ClassDispatcher } from '../mcp-bridge/tool-classes.js';
import { canonicalPayload } from '../governed-adapter/governed-adapter.js';
import type { ConsumedApproval } from '../governed-adapter/governed-adapter.js';
import type { PlannedFilesystemWrite, PlannedFilesystemEntry } from '../filesystem-adapter-dryrun/filesystem-adapter-dryrun.js';
import {
  executeFilesystemPlan,
  JAIL_PREFIX,
  FILESYSTEM_EXECUTE_TOOL,
  type ExecuteContext,
  type FilesystemExecutorAudit,
} from './filesystem-executor.js';

// ── temp-sandbox bookkeeping (unique, deterministic, cleaned up) ────────────────────────────────────────
let counter = 0;
const toClean: string[] = [];
function uniqueJailBase(tag: string): string {
  const p = `${JAIL_PREFIX}exec-${tag}-${process.pid}-${++counter}`;
  toClean.push(p);
  return p;
}
function trackForCleanup(p: string): string {
  toClean.push(p);
  return p;
}
afterEach(() => {
  while (toClean.length) {
    const p = toClean.pop()!;
    try { rmSync(p, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});

// ── a genuine ConsumedApproval, minted ONLY by the real dispatcher after a real human APPROVE ────────────
// This is the sole legitimate way to obtain the branded token — the executor cannot be reached without it.
async function withGenuineApproval<T>(
  target: string,
  after: unknown,
  use: (approval: ConsumedApproval) => Promise<T>,
): Promise<{ status: string; value: T | undefined }> {
  const tool = FILESYSTEM_EXECUTE_TOOL;
  const gate = new ApprovalGate();
  const binding = { tool, target, payloadJson: canonicalPayload(after) };
  const actionId = gate.request({
    tool, target, after, risk: 'high', reversible: 'no', requestedBy: { user_id: 'orchestrator-agent' },
  }).actionId;
  gate.resolve({ actionId, approver: { user_id: 'alice', role: 'admin' }, decision: 'APPROVE', reason: 'execute scaffold approved' });
  const bridge = new BridgeApprovalGate(gate, 'orchestrator-agent'); // single-use, per-action, no self-approval
  const dispatcher = new ClassDispatcher(bridge);
  let value: T | undefined;
  const outcome = await dispatcher.dispatch(
    'APPROVAL_REQUIRED_WRITE',
    { approvalWrite: async (approval) => { value = await use(approval); return value; } },
    { approvalActionId: actionId, approvalBinding: binding, tool },
  );
  return { status: outcome.status, value };
}

function planFor(basePath: string, entries: readonly PlannedFilesystemEntry[], boundToApprovalId: string): PlannedFilesystemWrite {
  return {
    dryRun: true, plannedOnly: true, api: 'filesystem',
    basePath, entries,
    boundIntentHash: 'testfingerprint', boundToApprovalId,
    note: 'test plan',
  };
}

function recordingCtx(overrides: Partial<ExecuteContext> = {}): { ctx: ExecuteContext; order: string[]; intents: unknown[]; refusals: unknown[] } {
  const order: string[] = [];
  const intents: unknown[] = [];
  const refusals: unknown[] = [];
  const audit: FilesystemExecutorAudit = {
    appendIntent(e) { order.push('intent'); intents.push(e); },
    appendResult() { order.push('result'); },
    appendRefusal(e) { order.push('refusal'); refusals.push(e); },
  };
  const ctx: ExecuteContext = {
    audit, human: { user_id: 'alice', email: 'alice@example.com', role: 'admin' },
    organizationId: 'org_1', environment: 'local', ...overrides,
  };
  return { ctx, order, intents, refusals };
}

const FILES: readonly PlannedFilesystemEntry[] = [
  { path: 'README.md', kind: 'file', contents: '# real\n' },
  { path: 'src', kind: 'dir' },
  { path: 'src/index.ts', kind: 'file', contents: 'export const X = 1;\n' },
];

describe('FilesystemExecutor — REAL disk writes, only inside the jail, only from an approval-bound plan', () => {
  it('APPROVED + in-jail ⇒ the files are REALLY created on disk (asserted, then cleaned up)', async () => {
    const base = uniqueJailBase('happy');
    const { ctx } = recordingCtx();
    const { status, value } = await withGenuineApproval(base, { base }, (approval) =>
      executeFilesystemPlan(planFor(base, FILES, approval.approvalId), approval, ctx));

    expect(status).toBe('executed'); // genuine dispatcher path ran
    expect(value?.ok).toBe(true);
    // Files EXIST on the real filesystem.
    expect(existsSync(join(base, 'README.md'))).toBe(true);
    expect(readFileSync(join(base, 'README.md'), 'utf8')).toBe('# real\n');
    expect(statSync(join(base, 'src')).isDirectory()).toBe(true);
    expect(readFileSync(join(base, 'src/index.ts'), 'utf8')).toBe('export const X = 1;\n');
  });

  it('mismatched approval ⇒ REFUSED, nothing written (the token is not bound to this plan)', async () => {
    const base = uniqueJailBase('mismatch');
    const { ctx, refusals } = recordingCtx();
    const { value } = await withGenuineApproval(base, { base }, (approval) =>
      // plan is bound to a DIFFERENT approval id than the genuine token presented
      executeFilesystemPlan(planFor(base, FILES, approval.approvalId + '-WRONG'), approval, ctx));

    expect(value?.ok).toBe(false);
    if (value?.ok) throw new Error('unreachable');
    expect(value?.status).toBe('refused');
    expect(existsSync(base)).toBe(false); // NOTHING written
    expect(refusals[0]).toMatchObject({ stage: 'approval-binding', decision: 'REFUSE' });
  });

  it('absolute entry path ⇒ REFUSED, nothing written', async () => {
    const base = uniqueJailBase('abs');
    const evil = trackForCleanup('/tmp/ece-outside-abs-' + process.pid);
    const { ctx } = recordingCtx();
    const { value } = await withGenuineApproval(base, { base }, (approval) =>
      executeFilesystemPlan(planFor(base, [{ path: `${evil}/pwn.txt`, kind: 'file', contents: 'x' }], approval.approvalId), approval, ctx));

    expect(value?.ok).toBe(false);
    expect(existsSync(base)).toBe(false);
    expect(existsSync(evil)).toBe(false);
  });

  it("'..' traversal entry ⇒ REFUSED, nothing written", async () => {
    const base = uniqueJailBase('dotdot');
    const { ctx, refusals } = recordingCtx();
    const { value } = await withGenuineApproval(base, { base }, (approval) =>
      executeFilesystemPlan(planFor(base, [{ path: '../escape.txt', kind: 'file', contents: 'x' }], approval.approvalId), approval, ctx));

    expect(value?.ok).toBe(false);
    expect(existsSync(base)).toBe(false);
    expect(refusals[0]).toMatchObject({ stage: 'jail-validation' });
  });

  it('symlink escape (an in-jail base whose real path leaves the jail) ⇒ REFUSED, nothing written', async () => {
    // A real jail container with a symlink that points OUT of the jail to a real directory.
    const container = uniqueJailBase('sym');
    const outside = trackForCleanup('/tmp/ece-outside-sym-' + process.pid + '-' + counter);
    mkdirSync(container, { recursive: true });
    mkdirSync(outside, { recursive: true });
    symlinkSync(outside, join(container, 'esc')); // container/esc -> outside (outside the jail)

    // base literally starts with the jail prefix, but its REAL canonical path is `outside` — the escape.
    const base = join(container, 'esc', 'fresh'); // 'fresh' does not exist yet ⇒ refuse-on-exist does not preempt
    const { ctx, refusals } = recordingCtx();
    const { value } = await withGenuineApproval(base, { base }, (approval) =>
      executeFilesystemPlan(planFor(base, [{ path: 'landed.txt', kind: 'file', contents: 'x' }], approval.approvalId), approval, ctx));

    expect(value?.ok).toBe(false);
    expect(refusals[0]).toMatchObject({ stage: 'jail-validation' });
    // NOTHING landed outside the jail.
    expect(existsSync(join(outside, 'fresh'))).toBe(false);
    expect(existsSync(join(outside, 'fresh', 'landed.txt'))).toBe(false);
  });

  it('final-component symlink RACED IN after validation (the audit-before-write window) ⇒ REFUSED at the syscall, nothing written outside, all-or-nothing', async () => {
    // The residual final-component TOCTOU the O_NOFOLLOW/O_EXCL open closes — and the reason the realCanonical
    // pre-check alone is not enough. A symlink whose destination does NOT exist is invisible to existsSync AND to
    // realCanonical (both follow the link to nothing), so it slips past validation; then it is swapped onto the
    // EXACT final target path BEFORE the write. We reproduce that precise window: the intent-audit hook is
    // guaranteed to run AFTER validation and BEFORE any fs write (the audit-before-write law), so we plant the
    // escaping symlink there. This exercises the FINAL component specifically — not an ancestor.
    const base = uniqueJailBase('finalsym');                 // does NOT exist at validation ⇒ base checks pass
    const outside = trackForCleanup('/tmp/ece-outside-finalsym-' + process.pid + '-' + counter); // non-existent, out of jail
    const target = join(base, 'README.md');

    let planted = false;
    const order: string[] = [];
    const audit: FilesystemExecutorAudit = {
      appendIntent() {
        order.push('intent');
        // RACE: post-validation, pre-write — create the base, then plant a symlink at the exact final target
        // path pointing OUTSIDE the jail to a path that does not exist (which is why validation let it through).
        mkdirSync(base, { recursive: true });
        symlinkSync(outside, target);
        planted = true;
      },
      appendResult() { order.push('result'); },
      appendRefusal() { order.push('refusal'); },
    };
    const ctx: ExecuteContext = { audit, human: { user_id: 'alice' }, organizationId: 'org_1', environment: 'local' };
    const { value } = await withGenuineApproval(base, { base }, (approval) =>
      executeFilesystemPlan(planFor(base, [{ path: 'README.md', kind: 'file', contents: 'PWNED' }], approval.approvalId), approval, ctx));

    expect(planted).toBe(true);                    // the race window actually fired (symlink planted post-validation)
    expect(value?.ok).toBe(false);
    if (value?.ok) throw new Error('unreachable');
    expect(value?.status).toBe('error');           // openSync threw (ELOOP from O_NOFOLLOW / EEXIST from O_EXCL)
    expect(order).toEqual(['intent', 'result']);   // intent audited, then the error outcome
    // The kernel refused to FOLLOW the symlink: NOTHING landed at its out-of-jail, previously-non-existent target.
    expect(existsSync(outside)).toBe(false);
    // …and the executor reports creating nothing — all-or-nothing holds through the syscall failure.
    expect(value?.created.length).toBe(0);
  });

  it('out-of-jail base (does not start with the jail prefix) ⇒ REFUSED', async () => {
    const base = trackForCleanup('/tmp/not-a-jail-' + process.pid);
    const { ctx } = recordingCtx();
    const { value } = await withGenuineApproval(base, { base }, (approval) =>
      executeFilesystemPlan(planFor(base, [{ path: 'a.txt', kind: 'file', contents: 'x' }], approval.approvalId), approval, ctx));

    expect(value?.ok).toBe(false);
    expect(existsSync(base)).toBe(false);
  });

  it('all-or-nothing — ONE bad path among good ones ⇒ ZERO files written (validation precedes any write)', async () => {
    const base = uniqueJailBase('allornothing');
    const entries: readonly PlannedFilesystemEntry[] = [
      { path: 'good1.txt', kind: 'file', contents: 'a' },
      { path: '../bad.txt', kind: 'file', contents: 'b' }, // the one bad path
      { path: 'good2.txt', kind: 'file', contents: 'c' },
    ];
    const { ctx } = recordingCtx();
    const { value } = await withGenuineApproval(base, { base }, (approval) =>
      executeFilesystemPlan(planFor(base, entries, approval.approvalId), approval, ctx));

    expect(value?.ok).toBe(false);
    // The base dir was never even created — nothing partial.
    expect(existsSync(base)).toBe(false);
    expect(existsSync(join(base, 'good1.txt'))).toBe(false);
    expect(existsSync(join(base, 'good2.txt'))).toBe(false);
  });

  it('refuse-on-exist (default) — an already-existing base is REFUSED and left untouched', async () => {
    const base = uniqueJailBase('exists');
    mkdirSync(base, { recursive: true });
    writeFileSync(join(base, 'README.md'), 'ORIGINAL\n'); // pre-existing content
    const { ctx, refusals } = recordingCtx();
    const { value } = await withGenuineApproval(base, { base }, (approval) =>
      executeFilesystemPlan(planFor(base, FILES, approval.approvalId), approval, ctx));

    expect(value?.ok).toBe(false);
    expect(refusals[0]).toMatchObject({ stage: 'refuse-on-exist' });
    // The original file is untouched — NO overwrite.
    expect(readFileSync(join(base, 'README.md'), 'utf8')).toBe('ORIGINAL\n');
  });

  it('create-fresh in an EMPTY sandbox ⇒ allowed; a NON-empty sandbox ⇒ refused', async () => {
    // empty existing base + opt-in ⇒ writes succeed
    const emptyBase = uniqueJailBase('fresh-empty');
    mkdirSync(emptyBase, { recursive: true });
    const okRun = await withGenuineApproval(emptyBase, { base: emptyBase }, (approval) =>
      executeFilesystemPlan(planFor(emptyBase, FILES, approval.approvalId), approval,
        recordingCtx({ createFreshInEmptySandbox: true }).ctx));
    expect(okRun.value?.ok).toBe(true);
    expect(existsSync(join(emptyBase, 'README.md'))).toBe(true);

    // non-empty existing base + opt-in ⇒ still refused
    const dirtyBase = uniqueJailBase('fresh-dirty');
    mkdirSync(dirtyBase, { recursive: true });
    writeFileSync(join(dirtyBase, 'preexisting.txt'), 'x');
    const badRun = await withGenuineApproval(dirtyBase, { base: dirtyBase }, (approval) =>
      executeFilesystemPlan(planFor(dirtyBase, FILES, approval.approvalId), approval,
        recordingCtx({ createFreshInEmptySandbox: true }).ctx));
    expect(badRun.value?.ok).toBe(false);
    expect(existsSync(join(dirtyBase, 'README.md'))).toBe(false); // nothing new written
  });

  it('audit is written BEFORE any fs write (intent recorded while no target yet exists; order intent→result)', async () => {
    const base = uniqueJailBase('audit');
    const order: string[] = [];
    let targetsExistedAtIntent = true;
    const audit: FilesystemExecutorAudit = {
      appendIntent() { order.push('intent'); targetsExistedAtIntent = existsSync(join(base, 'README.md')); },
      appendResult() { order.push('result'); },
      appendRefusal() { order.push('refusal'); },
    };
    const ctx: ExecuteContext = { audit, human: { user_id: 'alice' }, organizationId: 'org_1', environment: 'local' };
    const { value } = await withGenuineApproval(base, { base }, (approval) =>
      executeFilesystemPlan(planFor(base, FILES, approval.approvalId), approval, ctx));

    expect(value?.ok).toBe(true);
    expect(order).toEqual(['intent', 'result']);       // audit-before-write, then outcome
    expect(targetsExistedAtIntent).toBe(false);         // no file existed at the moment of the intent audit
    expect(existsSync(join(base, 'README.md'))).toBe(true); // …and it exists after
  });
});

describe('FilesystemExecutor — source discipline (sole sanctioned writer, gated, no destructive ops, mints nothing)', () => {
  const RAW = readFileSync(join(__dirname, 'filesystem-executor.ts'), 'utf8');
  const SRC = RAW.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1'); // strip comments

  it('imports node:fs — the ONE sanctioned place a real write may originate', () => {
    expect(/from\s*['"]node:fs['"]/.test(SRC)).toBe(true);
  });

  it('the sandbox jail is a HARD-CODED constant (not a parameter)', () => {
    expect(/export const JAIL_PREFIX\s*=\s*['"]\/tmp\/ece-dryrun-['"]/.test(SRC)).toBe(true);
    expect(JAIL_PREFIX).toBe('/tmp/ece-dryrun-');
  });

  it('the write requires a ConsumedApproval (type-gated) and mints NOTHING', () => {
    expect(/executeFilesystemPlan\s*\([\s\S]*?approval:\s*ConsumedApproval/.test(SRC)).toBe(true);
    expect(/\bmintConsumedApproval\b/.test(SRC)).toBe(false);
    expect(/\bmint[A-Za-z]*\s*\(/.test(SRC)).toBe(false);
  });

  it('contains NO destructive fs op — only mkdir / fd-create (creates), never delete/overwrite/rename', () => {
    for (const re of [/\brm\s*\(/, /\brmSync\s*\(/, /\brmdir\s*\(/, /\bunlink\s*\(/, /\brename\s*\(/,
                      /\btruncate\s*\(/, /\bcopyFile\s*\(/]) {
      expect({ pattern: String(re), hit: re.test(SRC) }).toEqual({ pattern: String(re), hit: false });
    }
    // The real write is an explicit fd open guarded at the syscall level, never writeFileSync.
    expect(/\bwriteFileSync\b/.test(SRC)).toBe(false);
    // O_EXCL makes it fail-if-exists (never overwrites); O_NOFOLLOW makes the kernel refuse a final-component
    // symlink (closes the final-component TOCTOU race). Both flags must be present on the real open.
    expect(/openSync\s*\(/.test(SRC)).toBe(true);
    expect(/constants\.O_EXCL\b/.test(SRC)).toBe(true);
    expect(/constants\.O_NOFOLLOW\b/.test(SRC)).toBe(true);
  });
});
