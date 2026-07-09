// Emitters — the TOTAL guarantee (no sink/wrapper ever throws, even with a failing writer) and the execution
// manifest. Writes to an isolated tmp dir. The critical case is the executor sink, which the executor AWAITS.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { makeEmitters } from './instrument.js';
import { readRecords, storeFilePath } from './store.js';

const tmps: string[] = [];
function tmpRoot(): string { const d = mkdtempSync(join(tmpdir(), 'ece-inst-')); tmps.push(d); return d; }
afterEach(() => { while (tmps.length) { try { rmSync(tmps.pop()!, { recursive: true, force: true }); } catch { /* best effort */ } } });

const BOOM = () => { throw new Error('disk full'); };
const at = () => '2026-07-09T00:00:00.000Z';

describe('emitters — TOTAL: a failing writer never throws, and the failure is recorded', () => {
  it('the gate/console sinks never throw with a failing writer', () => {
    const e = makeEmitters({ root: tmpRoot(), now: at, writer: BOOM });
    expect(() => e.approvalsSink.record({ type: 'approved', actionId: 'act_1', tool: 't', approver: 'bitez', atIso: at() })).not.toThrow();
    expect(() => e.consoleSink.append({ type: 'enqueued', actionId: 'act_1', tool: 't', atIso: at() })).not.toThrow();
    expect(e.failures().length).toBe(2);
  });

  it('CRITICAL — the executor sink (which the executor AWAITS) never rejects with a failing writer', async () => {
    const e = makeEmitters({ root: tmpRoot(), now: at, writer: BOOM });
    // Both the sync-call form and the awaited form must be safe (the executor does `await ctx.audit.appendResult`).
    expect(() => e.executorAudit.appendResult({ tool: 't', organization_id: 'o', status: 'written', approvalId: 'apr_1', created: 14 })).not.toThrow();
    await expect(Promise.resolve(e.executorAudit.appendResult({ tool: 't', organization_id: 'o', status: 'written', approvalId: 'apr_1', created: 14 }))).resolves.toBeUndefined();
    expect(e.failures().length).toBeGreaterThan(0);
  });
});

describe('emitters — wrappers return the host result; execution manifest hashes the written files', () => {
  it('instrumentExecute persists an ExecutionResult whose manifest sha256 matches the written file', async () => {
    const root = tmpRoot();
    const base = mkdtempSync(join(tmpdir(), 'ece-sbx-')); tmps.push(base);
    const file = join(base, 'README.md'); writeFileSync(file, 'hello world');
    const e = makeEmitters({ root, now: at });
    const fakeExec = async () => ({ ok: true as const, status: 'written' as const, basePath: base, approvalId: 'apr_1', created: [{ path: file, kind: 'file' as const }, { path: base, kind: 'dir' as const }] });
    const out = await e.instrumentExecute(fakeExec)();
    expect(out.ok).toBe(true); // the wrapper returns the executor's own outcome

    const rec = readRecords(storeFilePath('executions', root)).at(-1)!.payload as { status: string; manifest: { path: string; sha256: string }[] };
    expect(rec.status).toBe('written');
    expect(rec.manifest.length).toBe(1); // files only (the dir is excluded)
    expect(rec.manifest[0]!.sha256).toBe(createHash('sha256').update('hello world').digest('hex'));
  });

  it('instrumentExecute is TOTAL even if a created file cannot be read (manifest failure recorded, outcome unchanged)', async () => {
    const e = makeEmitters({ root: tmpRoot(), now: at });
    const fakeExec = async () => ({ ok: true as const, status: 'written' as const, basePath: '/nope', approvalId: 'apr_1', created: [{ path: '/nope/missing.txt', kind: 'file' as const }] });
    const out = await e.instrumentExecute(fakeExec)();
    expect(out.ok).toBe(true); // still returns the outcome
    expect(e.failures().some((f) => f.store.includes('manifest'))).toBe(true);
  });

  it('instrumentPlanOnly records a plan-created audit event and returns the plan', async () => {
    const root = tmpRoot();
    const e = makeEmitters({ root, now: at });
    const fakePlan = async () => ({ buildPlan: { sandbox: { basePath: '/tmp/ece-dryrun-x' } }, plannedWrite: null, targetPaths: [], scaffold: { ok: false } });
    const res = await e.instrumentPlanOnly(fakePlan as never)({});
    expect((res as { buildPlan: { sandbox: { basePath: string } } }).buildPlan.sandbox.basePath).toBe('/tmp/ece-dryrun-x');
    const audit = readRecords(storeFilePath('audit', root)).map((r) => (r.payload as { event: string }).event);
    expect(audit).toContain('plan-created');
  });
});
