import { describe, it, expect, afterAll } from 'vitest';
import pkg from 'pg';
const { Pool } = pkg;
import { AutopilotScheduler, type SchedulerAuditHook, type SchedulerAuditEvent, type SchedulerKillReader, type ConfigChangeAuthorizer } from './autopilot-scheduler.js';
import { AutopilotRunner } from '../autopilot/autopilot.js';
import { McpBridge, type BridgeCallContext } from '../../layer-5-action/mcp-bridge/mcp-bridge.js';
import { createDefaultToolRegistry } from '../../layer-5-action/tool-registry/tool-registry.js';
import { registerFactoryReadTools, type FactoryReadPorts } from '../../layer-5-action/mcp-bridge/factory-read-tools.js';
import { registerDraftTools, type DraftPorts } from '../../layer-5-action/mcp-bridge/draft-tools.js';
import { PostgresHashChainSink } from '../../factory-shared/audit-engine/postgres-sink.js';
import { WriteAheadSequencer } from '../../factory-shared/audit-engine/sequencer.js';
import { PermissionEngine } from '../../layer-1-law/permission-engine/permission-engine.js';
import { RedactionEngine } from '../../factory-shared/redaction-engine/redaction-engine.js';

// Autopilot Scheduler — real PostgreSQL: a scheduled fire's run activity is AUDITED (the fired Autopilot run's
// reads/drafts produce intents+results in the audit log) — a scheduled run is as auditable as a manual one.

const cfg = { host: process.env.PGHOST ?? '127.0.0.1', port: Number(process.env.PGPORT ?? 55432), database: process.env.PGDATABASE ?? 'ece_audit_test' };
const appPool = new Pool({ ...cfg, user: 'ece_app' });
afterAll(async () => { await appPool.end(); });

const FACTORY: FactoryReadPorts = {
  factoryStatus: async () => ({ nextAction: 'Phase 9: next module', consequential: true }),
  waveStatus: async () => [], moduleStatus: async () => [], openGates: async () => [],
  reviewLog: async () => [], evidencePack: async () => ({}), openItems: async () => [], domainRegistry: async () => [],
  projectRegistry: async () => [], featureRegistry: async () => [], riskRegister: async () => [], productCreationPlan: async () => ({}),
  repoBuildPlan: async () => ({}), toolRegistry: async () => [], auditSummary: async () => [],
};
const DRAFTS: DraftPorts = {
  nextPrompt: async () => ({ body: 'proposed' }), reviewDecision: async () => ({}), waveReport: async () => ({}),
  productPlan: async () => ({}), riskSummary: async () => ({}), openItemsSummary: async () => ({}), repoPlan: async () => ({}),
};

class RecordingAudit implements SchedulerAuditHook {
  events: SchedulerAuditEvent[] = [];
  async record(e: SchedulerAuditEvent): Promise<void> { this.events.push(e); }
}
const noKill: SchedulerKillReader = { isKilled: () => false };
const allow: ConfigChangeAuthorizer = { authorize: () => true };
const kinds = (rows: { kind: string }[], k: string) => rows.filter((r) => r.kind === k).length;

describe('Autopilot Scheduler — every trigger is audited (real PostgreSQL)', () => {
  it('a scheduled fire runs Autopilot; the run\'s reads/drafts are audited, and the trigger is recorded', async () => {
    const ORG = `orgSCH-${Date.now()}`;
    const registry = createDefaultToolRegistry();
    registerFactoryReadTools(registry); registerDraftTools(registry);
    const sink = new PostgresHashChainSink(appPool, new RedactionEngine());
    const sequencer = new WriteAheadSequencer(sink, new PermissionEngine(registry));
    const redactor = new RedactionEngine(['nextAction', 'consequential', 'gate', 'state', 'body', 'wave', 'status']);
    const bridge = new McpBridge(registry, sequencer, { searchClients: async () => [] }, redactor, { factoryPorts: FACTORY, draftPorts: DRAFTS });
    const runner = new AutopilotRunner(bridge);

    const audit = new RecordingAudit();
    const scheduler = new AutopilotScheduler(runner, () => 1_000_000, audit, noKill, { minIntervalMs: 1000, enabled: true }, allow);
    const ctx: BridgeCallContext = { principal: { user_id: 'op_real', email: 'op@ece.ae', role: 'operator' }, organization_id: ORG, session: { session_id: 's-sch' }, environment: 'local', via: 'autopilot' };

    const out = await scheduler.tick(ctx);
    expect(out.status).toBe('fired');
    if (out.status === 'fired') expect(out.outcome.status).toBe('AUTOPILOT-PROPOSED-AWAITING-APPROVAL'); // bounded — proposed, not executed

    // the fired run's activity is audited in real PostgreSQL
    const entries = await sink.readEntries(ORG);
    expect(kinds(entries, 'intent')).toBeGreaterThanOrEqual(1);
    expect(kinds(entries, 'result')).toBeGreaterThanOrEqual(1);
    // the scheduler's own trigger record
    expect(audit.events.some((e) => e.kind === 'trigger-fired' && e.outcomeStatus === 'AUTOPILOT-PROPOSED-AWAITING-APPROVAL')).toBe(true);
  });
});
