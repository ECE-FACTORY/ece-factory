// Emitters (Design §2) — TOTAL store-backed sinks + thin wrappers. The whole safety argument lives here:
//   • DOWNSTREAM — every emit runs AFTER the gate/mint/write outcome is computed (wrappers await the real call
//     first and return its result).
//   • TOTAL — every write goes through `write()`, which catches ALL errors into an in-memory failure log and
//     NEVER throws. This is load-bearing for the executor, which AWAITS its audit hook (filesystem-executor.ts:
//     341,346) — a throwing sink there would break the write; a never-throw sink cannot.
//   • RETURN-IGNORED — the sinks return void (the host `void`s them); the wrappers return the HOST's own result
//     regardless of the emit. So no emit success/failure/latency can enter a gate, mint, or write decision.
//
// This module edits NO gated file. It is wired at composition: injected as the gate/console/executor audit
// hooks, and wrapped around each seam's assemble / the orchestrator's planOnly / executeFilesystemPlan.

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { appendRecord, storeFilePath, type StoreName } from './store.js';
import type { ApprovalAuditHook, ApprovalAuditEvent } from '../layer-1-law/approval-gate/approval-gate.js';
import type { ConsoleAuditSink, ConsoleAuditEvent } from '../layer-2-command/decision-console/decision-console.js';
import type { FilesystemExecutorAudit, ExecuteOutcome, FsExecutorAuditIntent, FsExecutorAuditResult, FsExecutorAuditRefusal } from '../layer-5-action/filesystem-executor/filesystem-executor.js';
import type { PlanOnlyResult } from '../layer-4-build-harden/build-chain-orchestrator/build-chain-orchestrator.js';
import type { ApprovedBuildDecision } from '../layer-4-build-harden/build-planner/build-planner.js';

export interface PersistFailure { at: string; store: string; error: string; }

/** The assemble outcome shape shared by BOTH decision seams (sovereign + subscription). */
type AssembleOutcome =
  | { status: 'APPROVED-BUILD-DECISION'; approved: ApprovedBuildDecision }
  | { status: 'refused'; stage: string; reason: string };

export interface MakeEmittersOpts {
  root: string;
  now?: () => string;
  /** Injectable writer (default: append to factory-state/<store>). A throwing writer proves failure-isolation. */
  writer?: (store: StoreName, payload: unknown) => void;
}

export interface Emitters {
  approvalsSink: ApprovalAuditHook;          // wire into ApprovalGate.audit (gate lifecycle → approvals.jsonl)
  consoleSink: ConsoleAuditSink;             // wire into DecisionConsole (seat lifecycle → audit.jsonl)
  executorAudit: FilesystemExecutorAudit;    // wire into ExecuteContext.audit (executor lifecycle → audit.jsonl)
  instrumentAssemble: <O extends AssembleOutcome>(assemble: (prepared: unknown) => Promise<O>) => (prepared: unknown) => Promise<O>;
  instrumentPlanOnly: <R extends PlanOnlyResult>(planOnly: (input: unknown) => Promise<R>) => (input: unknown) => Promise<R>;
  instrumentExecute: <O extends ExecuteOutcome>(execute: (...args: never[]) => Promise<O>) => (...args: never[]) => Promise<O>;
  failures: () => PersistFailure[];
}

const sha256File = (abs: string): string => createHash('sha256').update(readFileSync(abs)).digest('hex');

export function makeEmitters(opts: MakeEmittersOpts): Emitters {
  const now = opts.now ?? (() => new Date().toISOString());
  const failures: PersistFailure[] = [];
  const rawWrite = opts.writer ?? ((store: StoreName, payload: unknown) => { appendRecord(storeFilePath(store, opts.root), payload, now); });

  // TOTAL write — the single choke point that makes every emitter never-throw. The failure log is in-memory and
  // cannot itself throw, so recording a persistence failure can never propagate into the host.
  const write = (store: StoreName, payload: unknown): void => {
    try { rawWrite(store, payload); }
    catch (e) { failures.push({ at: safeNow(), store, error: e instanceof Error ? e.message : String(e) }); }
  };
  const safeNow = (): string => { try { return now(); } catch { return ''; } };

  const approvalsSink: ApprovalAuditHook = {
    record(e: ApprovalAuditEvent): void { write('approvals', { event: e.type, actionId: e.actionId, tool: e.tool, approver: e.approver, reason: e.reason, atIso: e.atIso }); },
  };
  const consoleSink: ConsoleAuditSink = {
    append(e: ConsoleAuditEvent): void { write('audit', { event: e.type, actionId: e.actionId, tool: e.tool, detail: e.operator ? `operator=${e.operator}` : e.reason, atIso: e.atIso }); },
  };
  const executorAudit: FilesystemExecutorAudit = {
    // NOTE: the executor AWAITS these — they return void and `write` never throws, so the await never rejects.
    appendIntent(e: FsExecutorAuditIntent): void { write('audit', { event: 'execute-intent', approvalId: e.approvalId, tool: e.tool, detail: e.basePath, atIso: safeNow() }); },
    appendResult(e: FsExecutorAuditResult): void { write('audit', { event: `files-${e.status}`, approvalId: e.approvalId, tool: e.tool, detail: `created=${e.created}`, atIso: safeNow() }); },
    appendRefusal(e: FsExecutorAuditRefusal): void { write('audit', { event: 'execute-refused', tool: e.tool, detail: e.reason, atIso: safeNow() }); },
  };

  const instrumentAssemble = <O extends AssembleOutcome>(assemble: (p: unknown) => Promise<O>) => async (prepared: unknown): Promise<O> => {
    const outcome = await assemble(prepared); // the REAL seam runs; the decision is the seam's, computed first
    if (outcome.status === 'APPROVED-BUILD-DECISION') {
      const d = outcome.approved;
      const gateActionId = d.airGapAssessment?.gateActionId ?? d.multiTenancyAssessment?.gateActionId ?? '';
      const productMode = d.airGapAssessment ? 'sovereign' : 'subscription';
      const tool = d.airGapAssessment ? 'approve_build_decision' : 'approve_build_decision_subscription';
      write('approvals', { event: 'consumed', actionId: gateActionId, approvalId: d.approval.approvalId, boundIntentHash: d.approval.boundIntentHash, approver: d.approvedBy, tool, atIso: now() });
      write('audit', { event: 'decision-assembled', actionId: gateActionId, approvalId: d.approval.approvalId, decision: d.decision.decision, productMode, detail: d.decision.subDomain.key, atIso: now() });
      write('evidence', { kind: 'decision', ref: d.approval.approvalId, usedBy: [gateActionId], atIso: now() });
    }
    return outcome; // ALWAYS the seam's outcome — the emit cannot change it
  };

  const instrumentPlanOnly = <R extends PlanOnlyResult>(planOnly: (i: unknown) => Promise<R>) => async (input: unknown): Promise<R> => {
    const result = await planOnly(input);
    write('audit', { event: 'plan-created', detail: result.buildPlan.sandbox.basePath, atIso: now() });
    if (result.plannedWrite) write('audit', { event: 'planned-write', detail: `${result.targetPaths.length} targets @ ${result.buildPlan.sandbox.basePath}`, atIso: now() });
    write('evidence', { kind: 'build-plan', ref: result.buildPlan.sandbox.basePath, usedBy: [], atIso: now() });
    return result;
  };

  const instrumentExecute = <O extends ExecuteOutcome>(execute: (...args: never[]) => Promise<O>) => async (...args: never[]): Promise<O> => {
    const outcome = await execute(...args); // the REAL write already happened
    if (outcome.ok && outcome.status === 'written') {
      let manifest: { path: string; sha256: string }[] = [];
      try { manifest = outcome.created.filter((c) => c.kind === 'file').map((c) => ({ path: c.path, sha256: sha256File(c.path) })); }
      catch (e) { failures.push({ at: safeNow(), store: 'executions:manifest', error: e instanceof Error ? e.message : String(e) }); }
      write('executions', { status: 'written', basePath: outcome.basePath, approvalId: outcome.approvalId, created: outcome.created, manifest, atIso: now() });
      write('audit', { event: 'files-written', approvalId: outcome.approvalId, detail: `${outcome.created.length} nodes @ ${outcome.basePath}`, atIso: now() });
    } else {
      write('executions', { status: outcome.status, basePath: '', created: outcome.created, manifest: [], reason: 'reason' in outcome ? outcome.reason : undefined, atIso: now() });
    }
    return outcome; // ALWAYS the executor's outcome
  };

  return { approvalsSink, consoleSink, executorAudit, instrumentAssemble, instrumentPlanOnly, instrumentExecute, failures: () => failures.slice() };
}
