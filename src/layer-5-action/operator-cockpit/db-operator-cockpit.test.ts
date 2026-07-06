import { describe, it, expect, afterAll } from 'vitest';
import pkg from 'pg';
const { Pool, Client } = pkg;
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PostgresHashChainSink } from '../../factory-shared/audit-engine/postgres-sink.js';
import { RedactionEngine } from '../../factory-shared/redaction-engine/redaction-engine.js';
import { factoryCapabilityGraph } from '../../mcp-server/live-capability-reuse-graph.js';
import { factoryOperatorCockpit, factoryVentureOrchestrator } from '../../mcp-server/live-operator-cockpit.js';
import type { ProposeSurface } from './operator-cockpit.js';

// Operator Cockpit read-surface, against REAL PostgreSQL. Proves: the ONE route endpoint's enqueue records to the
// hash chain (verifyChain ok), the audit trail is SECRET-FREE even when the routed payload carries a fake token
// (redaction), and the read endpoints (audit summary, venture blueprint) return real state read-only. The route
// endpoint reaches ONLY the injected propose path (a fake here — we never drive the real gauntlet/external in a test).

const cfg = { host: process.env.PGHOST ?? '127.0.0.1', port: Number(process.env.PGPORT ?? 55432), database: process.env.PGDATABASE ?? 'ece_audit_test' };
const pool = new Pool({ ...cfg, user: 'ece_app' });
const sink = new PostgresHashChainSink(pool, new RedactionEngine());
afterAll(async () => { await pool.end(); });

const ORG = `orgCockpit-${process.pid}`;
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

// A propose surface that ONLY reports STOP_FOR_APPROVAL — it stands in for the real propose path (which drives the
// unchanged gauntlet). The cockpit reaches THIS; it never touches a real gate/gauntlet/external adapter in the test.
const stopProposer: ProposeSurface = { propose: () => Promise.resolve({ status: 'STOP_FOR_APPROVAL', pendingActionId: 'pending-1' }) };

function cockpit() {
  return factoryOperatorCockpit({
    pendingQueue: { listPending: () => [] },
    venture: factoryVentureOrchestrator(factoryCapabilityGraph(REPO_ROOT)),
    audit: { verifyChain: (o) => sink.verifyChain(o), readEntries: (o, opts) => sink.readEntries(o, opts) },
    machine: { read: () => Promise.resolve({ status: 'FACTORY COMPLETE' }) },
    propose: stopProposer,
    auditSink: sink,
    organizationId: ORG,
    actor: { user_id: 'rashed', email: '', role: 'operator' },
  });
}

describe('operator-cockpit — route enqueue audited to the hash-chain (verifyChain ok), secret-free', () => {
  it('routing intent records to the chain, verifies, and scrubs a fake token from the audit trail', async () => {
    const c = cockpit();
    // route an intent whose payload carries a FAKE token — it is inert data and must be scrubbed from the audit.
    const r1 = await c.route({ method: 'POST', path: '/api/route', body: { tool: 'create_ticket', target: 'repo#1 token=ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345', payload: { title: 't' } } });
    expect(JSON.parse(r1.body).outcome.status).toBe('STOP_FOR_APPROVAL');
    await c.route({ method: 'POST', path: '/api/route', body: { tool: 'create_ticket', target: 'repo#2', payload: { title: 'u' } } });

    const v = await sink.verifyChain(ORG);
    expect(v.ok).toBe(true);

    const client = new Client({ ...cfg, user: 'ece_app' });
    await client.connect();
    try {
      await client.query(`SET app.current_org = '${ORG}'`);
      const raw = await client.query<{ query_range: unknown }>(`SELECT query_range FROM audit_read_log WHERE organization_id = $1`, [ORG]);
      const dump = JSON.stringify(raw.rows);
      expect(dump).not.toMatch(/ghp_[A-Za-z0-9]{20,}|PGPASSWORD|privateKey/); // routed token scrubbed
      expect(dump).toMatch(/cockpit\.routed/);
      expect(dump).toMatch(/create_ticket/);
    } finally { await client.end(); }
  });

  it('the audit-read endpoint returns verifyChain + recent entries read-only', async () => {
    const c = cockpit();
    await c.route({ method: 'POST', path: '/api/route', body: { tool: 'create_ticket', target: 'repo#3' } });
    const r = await c.route({ method: 'GET', path: '/api/audit/verify', query: { org: ORG } });
    const b = JSON.parse(r.body);
    expect(b.verify.ok).toBe(true);
    expect(b.recent.length).toBeGreaterThan(0);
    expect(b.recent.every((row: { organization_id: string }) => row.organization_id === ORG)).toBe(true);
  });

  it('the venture endpoint returns a real INERT blueprint from the live graph (executes/mutates nothing)', async () => {
    const graph = factoryCapabilityGraph(REPO_ROOT);
    const before = graph.size.nodes;
    const c = factoryOperatorCockpit({
      pendingQueue: { listPending: () => [] },
      venture: factoryVentureOrchestrator(graph),
      audit: { verifyChain: (o) => sink.verifyChain(o), readEntries: (o, opts) => sink.readEntries(o, opts) },
      machine: { read: () => Promise.resolve({}) },
      propose: stopProposer,
      auditSink: sink,
      organizationId: ORG,
    });
    const r = await c.route({ method: 'GET', path: '/api/venture/blueprint', query: { concept: 'a sovereign audit API platform' } });
    const bp = JSON.parse(r.body).blueprint;
    expect(bp.status).toBe('VENTURE-BLUEPRINT-AWAITING-HUMAN-APPROVAL');
    expect(bp.whatWeKnow.every((x: { advisory: boolean }) => x.advisory === false)).toBe(true);
    expect(bp.whatWeBelieve.every((x: { advisory: boolean }) => x.advisory === true)).toBe(true);
    expect(graph.size.nodes).toBe(before); // read-only consumption
  });
});
