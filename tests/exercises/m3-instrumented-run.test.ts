// M3 instrumented-run harness (reusable): wrap the M3 emitters (makeEmitters) around the subscription seam→scaffold
// loop and run the full two-gate loop, producing persisted records; verify each store's chain; correlate the
// execution manifest sha256s with the written sandbox files. The gated code is UNTOUCHED — the emitters wrap at
// composition (constructor injection + wrappers).
//
// STORE ROOT — this is the safety knob. By DEFAULT (no M3_STORE_ROOT env) the run writes to an ISOLATED mkdtemp
// root that is rmSync'd in `finally`, so a normal `vitest run` NEVER touches the committed factory-state/. Set
// M3_STORE_ROOT=. to point it at the repo root and persist real records into factory-state/ (how c4e7cb5 was made).

import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ApprovalGate } from '../../src/layer-1-law/approval-gate/approval-gate.js';
import { DecisionConsole } from '../../src/layer-2-command/decision-console/decision-console.js';
import { scoreCandidate } from '../../src/layer-3-harvest/scoring-engine/scoring-engine.js';
import type { ScoringCandidate } from '../../src/layer-3-harvest/scoring-engine/scoring-engine.js';
import type { GradedCandidate, HarvestReport, SubDomainResult } from '../../src/layer-3-harvest/harvest-orchestrator/harvest-orchestrator.js';
import type { RepoEvaluationRecord } from '../../src/layer-3-harvest/repo-intelligence/repo-intelligence.js';
import { SubscriptionDecisionSeam } from '../../src/layer-2-command/subscription-decision-seam/subscription-decision-seam.js';
import { buildPlanFor, toScaffoldIntent, type ScaffoldGrant, type BuildPlannerInput } from '../../src/layer-4-build-harden/build-planner/build-planner.js';
import { BuildChainOrchestrator, EXECUTE_CONFIRM_TOKEN, type HumanExecuteConfirm } from '../../src/layer-4-build-harden/build-chain-orchestrator/build-chain-orchestrator.js';
import { FilesystemAdapterDryRun, scaffoldPayload } from '../../src/layer-5-action/filesystem-adapter-dryrun/filesystem-adapter-dryrun.js';
import { BridgeApprovalGate, ClassDispatcher } from '../../src/layer-5-action/mcp-bridge/tool-classes.js';
import type { ConsumedApproval, ApprovalBinding } from '../../src/layer-5-action/mcp-bridge/tool-classes.js';
import type { ExecuteContext } from '../../src/layer-5-action/filesystem-executor/filesystem-executor.js';
import type { ScopedCredentialRef } from '../../src/layer-5-action/governed-adapter/governed-adapter.js';
import { makeEmitters } from '../../src/factory-persistence/instrument.js';
import { storeFilePath, readRecords, type StoreName } from '../../src/factory-persistence/store.js';
import { verifyChain } from '../../src/factory-persistence/verify.js';

const log = (...a: unknown[]) => console.log(...a); // eslint-disable-line no-console
const CRED: ScopedCredentialRef = { ref: 'sandbox-filesystem-credential-handle', scopes: ['fs:sandbox'] };
const OPERATOR = { user_id: 'bitez', email: 'Bitez@admin.ae', role: 'admin' as const };
const sha256File = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex');

const MEDUSA: ScoringCandidate = {
  license: { decision: 'ACCEPT', detected: 'MIT' }, maturity: { stars: 25000, activelyMaintained: true },
  archFit: { rating: 'possible' }, maintainability: { rating: 'maintainable' },
  cloudNative: 'partial', billingHooks: 'integratable', multiTenancy: 'unknown',
};
function reconstruct(): GradedCandidate {
  const score = scoreCandidate(MEDUSA, 'subscription');
  expect(score.total).toBe(74.1);
  const identity = { host: 'github.com', owner: 'medusajs', name: 'medusa' };
  const record: RepoEvaluationRecord = { evaluatedAtIso: '2026-07-09T00:00:00.000Z', identity, licenseDetected: 'MIT', licenseDecision: 'ACCEPT', eligibility: 'eligible', provenanceVerified: true, maturity: MEDUSA.maturity ?? null, airGapSuitability: 'unknown', whiteLabelFit: 'unknown', multiTenancy: 'unknown', cloudNative: MEDUSA.cloudNative, billingHooks: MEDUSA.billingHooks, architectureFitNotes: null, priorVerdict: null, readme: null, description: null, status: 'recorded' };
  return { repoUrl: 'https://github.com/medusajs/medusa', identity, record, score, licenseOneLine: 'MIT License', licenseVerified: true, licenseDisagreement: false, rawLicenseText: 'MIT', notes: [], enrichment: { applied: false, status: 'NONE', totalBefore: score.total, totalAfter: score.total, bandBefore: score.band, bandAfter: score.band, dimensions: [] } };
}
function report(spine: GradedCandidate): HarvestReport {
  const sub: SubDomainResult = { subDomain: { key: 'commerce-core', title: 'Commerce Core (headless)', query: 'q' }, candidates: [spine], spine, decision: 'EXTEND', decisionEvidence: ['EXTEND — multi-tenancy UNMEASURED'] };
  return { domain: 'Vertical SaaS Commerce', productMode: 'subscription', generatedAtIso: '2026-07-09T12:00:00.000Z', subDomains: [sub], sovereign: {} as HarvestReport['sovereign'], reviewer: [], redTeam: [], moat: [], marketPosition: [], limitations: [], status: 'STOP-AWAITING-HUMAN-APPROVAL' };
}
async function tokenFor(gate: ApprovalGate, actionId: string, binding: ApprovalBinding): Promise<ConsumedApproval> {
  const dispatcher = new ClassDispatcher(new BridgeApprovalGate(gate, 'orchestrator-agent'));
  let t: ConsumedApproval | undefined;
  await dispatcher.dispatch<never, never, ConsumedApproval>('APPROVAL_REQUIRED_WRITE', { approvalWrite: async (a) => { t = a; return a; } }, { approvalActionId: actionId, approvalBinding: binding, tool: binding.tool });
  if (!t) throw new Error('no token'); return t;
}

describe('M3 instrumented-run harness — subscription two-gate loop persists to a store root', () => {
  it('the two-gate loop persists approvals/audit/executions/evidence; chains verify; manifest matches the files', async () => {
    // DEFAULT: ISOLATED temp root (rmSync'd below) so a normal run never touches committed factory-state/.
    // Set M3_STORE_ROOT=. to persist real records into the repo's factory-state/.
    const envRoot = process.env.M3_STORE_ROOT;
    const isTemp = !envRoot;
    const root = envRoot ? join(process.cwd(), envRoot) : mkdtempSync(join(tmpdir(), 'ece-m3-store-'));
    const emitters = makeEmitters({ root });
    log(`[m3-run] store root = ${root}${isTemp ? ' (isolated temp)' : ' (COMMITTED repo store)'}`);
    try {
      // ── GATE 1 — build-decision (gate + console wired with the total sinks) ──
      const spine = reconstruct();
      const gate = new ApprovalGate({ audit: emitters.approvalsSink });
      const seat = new DecisionConsole(gate, emitters.consoleSink);
      const seam = new SubscriptionDecisionSeam({ gate, console: seat, proposingCaller: 'orchestrator-agent' });
      const prep = seam.prepare({ report: report(spine), subDomainKey: 'commerce-core', multiTenancy: { value: 'full', rationale: 'multi-store/multi-region tenant isolation' } });
      if (prep.status !== 'PENDING-APPROVAL') throw new Error('prepare did not pend');
      expect(seat.approve(prep.prepared.actionId, OPERATOR, 'approve subscription FORK of medusajs/medusa').status).toBe('APPROVED');
      const asm = await emitters.instrumentAssemble((p: unknown) => seam.assemble(p as never))(prep.prepared);
      const approved = (asm as { status: string; approved: Parameters<typeof buildPlanFor>[0] }).approved;
      expect((asm as { status: string }).status).toBe('APPROVED-BUILD-DECISION');

      // ── Phase A (planOnly) wrapped, with GATE 2 (scaffold-write) approved by bitez ──
      const plan = buildPlanFor(approved);
      const base = plan.sandbox.basePath;
      rmSync(base, { recursive: true, force: true }); // O_EXCL re-runnability (jail path)
      const intent = toScaffoldIntent(plan, `${(approved as { sourceReport: { domain: string } }).sourceReport.domain}/${(approved as { decision: { subDomain: { key: string } } }).decision.subDomain.key}`);
      const binding = new FilesystemAdapterDryRun(CRED).intentBinding(intent);
      const scaffoldGate = new ApprovalGate({ audit: emitters.approvalsSink });
      const scaffoldActionId = scaffoldGate.request({ tool: binding.tool, target: binding.target, after: scaffoldPayload(intent), risk: 'high', reversible: 'no', requestedBy: { user_id: 'orchestrator-agent' } }).actionId;
      expect(scaffoldGate.resolve({ actionId: scaffoldActionId, approver: OPERATOR, decision: 'APPROVE', reason: 'approve sandbox scaffold write' }).ok).toBe(true);
      const scaffoldGrant: ScaffoldGrant = { approvalActionId: scaffoldActionId, gate: scaffoldGate, caller: 'orchestrator-agent', audit: { appendIntent() {}, appendResult() {}, appendRefusal() {} }, human: OPERATOR, organizationId: 'org_ece', environment: 'local' };
      const input: BuildPlannerInput = { approved, scaffoldGrant, credential: CRED };
      const orch = new BuildChainOrchestrator();
      const planned = await emitters.instrumentPlanOnly((i: unknown) => orch.planOnly(i as BuildPlannerInput))(input);
      const plannedWrite = (planned as { plannedWrite: NonNullable<Awaited<ReturnType<BuildChainOrchestrator['planOnly']>>['plannedWrite']> }).plannedWrite;
      expect(plannedWrite).not.toBeNull();

      // ── Phase B (execute) — DEDUPED to ONE observer: instrumentExecute is the SOLE executions+audit emitter for
      //    the write (it produces the richer record with the manifest). The executor gets a NO-OP ctx.audit so it
      //    does not double-emit — exactly one 'files-written' audit record + one executions record per write.
      const token = await tokenFor(scaffoldGate, scaffoldActionId, binding);
      const confirm: HumanExecuteConfirm = { token: EXECUTE_CONFIRM_TOKEN, confirmedBy: 'bitez' };
      const noopAudit = { appendIntent() {}, appendResult() {}, appendRefusal() {} };
      const ctx: ExecuteContext = { audit: noopAudit, human: OPERATOR, organizationId: 'org_ece', environment: 'local' };
      const out = await emitters.instrumentExecute(() => orch.execute(plannedWrite, token, confirm, ctx))();
      expect((out as { ok: boolean; status: string }).ok).toBe(true);
      expect((out as { status: string }).status).toBe('written');
      expect(emitters.failures().length).toBe(0);

      // ── SHOW: records per store + chain verification ──
      log(`\n[stage1] RECORDS PER STORE (isolated root):`);
      for (const name of ['approvals', 'audit', 'executions', 'evidence'] as const) {
        const path = storeFilePath(name as StoreName, root);
        const recs = readRecords(path);
        const v = verifyChain(path);
        log(`  ${name.padEnd(10)} ${recs.length} record(s) · verifyChain ok=${v.ok} length=${v.length}`);
        for (const r of recs) log(`      seq=${r.seq} ${JSON.stringify(r.payload)}`);
        expect(v.ok).toBe(true);
        expect(recs.length).toBeGreaterThan(0);
      }
      // DEDUP: exactly ONE files-written audit record + ONE executions record per write.
      const auditEvents = readRecords(storeFilePath('audit', root)).map((r) => (r.payload as { event: string }).event);
      expect(auditEvents.filter((e) => e === 'files-written').length).toBe(1);
      expect(readRecords(storeFilePath('executions', root)).length).toBe(1);
      log(`[stage1] DEDUP OK — exactly 1 files-written audit + 1 executions record.`);

      // ── manifest sha256 correlation: the executions record's manifest == shasum of the written sandbox files ──
      const execRec = readRecords(storeFilePath('executions', root)).at(-1)!.payload as { manifest: { path: string; sha256: string }[] };
      log(`\n[stage1] EXECUTION MANIFEST vs on-disk sha256 (${execRec.manifest.length} files):`);
      for (const m of execRec.manifest) {
        const disk = existsSync(m.path) ? sha256File(m.path) : '(missing)';
        log(`  ${m.sha256 === disk ? 'MATCH' : 'MISMATCH'}  ${m.sha256}  ${m.path}`);
        expect(m.sha256).toBe(disk);
      }
      expect(execRec.manifest.length).toBeGreaterThan(0);
      log(`\n[stage1] sandbox skeleton left at ${base} (disposable); store root ${root} (isolated, not committed).`);
    } finally {
      if (isTemp) rmSync(root, { recursive: true, force: true }); // Stage 1 temp — cleaned up; Stage 2 repo store — KEPT
    }
  });
});
