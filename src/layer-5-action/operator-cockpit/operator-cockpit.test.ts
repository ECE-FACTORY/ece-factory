import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { OperatorCockpit, type OperatorCockpitPorts, type ProposeSurface } from './operator-cockpit.js';
import { VentureOrchestrator } from './venture-orchestrator.js';
import { RedactionEngine } from '../../factory-shared/redaction-engine/redaction-engine.js';
import { SecretPatternRedactor } from '../../layer-4-build-harden/build-observer/build-observer.js';
import { factoryCapabilityGraph } from '../../mcp-server/live-capability-reuse-graph.js';
import { COCKPIT_AUDIT_ALLOWLIST } from './operator-cockpit.js';

// Operator Cockpit read-surface layer. Proves the binding boundary: (1) READ endpoints are PURE (existing state,
// no mutation); (2) the venture endpoint returns an INERT VentureBlueprint (executes/mutates nothing); (3) the ONE
// route endpoint ONLY enqueues to the EXISTING propose path and is STRUCTURALLY INCAPABLE of approve/mint/execute
// (type-level + source-scan); (4) redaction in depth (no secret in any response/audit); (5) reads have no side
// effects. It adds NO new action path and touches NO guard/gate-mint/gauntlet/external-adapter.

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const MODULE = path.join(REPO_ROOT, 'src/layer-5-action/operator-cockpit/operator-cockpit.ts');
const ORCH = path.join(REPO_ROOT, 'src/layer-5-action/operator-cockpit/venture-orchestrator.ts');

// ── in-memory fakes for the injected read ports (real orchestrator + real redactors) ──────────────────────────
let appended: Array<Record<string, unknown>> = [];
let proposeCalls: Array<{ tool: string; target?: unknown; payload?: unknown }> = [];

function ports(over: Partial<OperatorCockpitPorts> = {}): OperatorCockpitPorts {
  return {
    pendingQueue: { listPending: () => [{ actionId: 'a1', tool: 'create_ticket', target: 't', effect: 'e', descriptor: { tool: 'create_ticket', reversible: 'reversible' }, tier: 'APPROVAL_REQUIRED_WRITE (external)', blastRadius: 1, reversibility: 'reversible', proposingCaller: 'autopilot', requestedAtIso: '2026-07-06T00:00:00Z' }] as never },
    delivery: {
      latestObservation: () => ({ status: 'success', command: 'build --token ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345', artifacts: [{ path: 'dist/app', sha256: 'abc' }] }),
      latestPreview: () => ({ built: true, observedStatus: 'success' }),
      latestPackage: () => ({ version: '1.0.0', checksums: [{ path: 'app', sha256: 'def' }] }),
      latestRelease: () => ({ version: '1.0.0', verified: true }),
    },
    venture: new VentureOrchestrator(factoryCapabilityGraph(REPO_ROOT)),
    audit: {
      verifyChain: () => Promise.resolve({ ok: true, checked: 3 }),
      readEntries: () => Promise.resolve([{ kind: 'read', seq: 1, organization_id: 'org', ts: '2026-07-06T00:00:00Z', entry_hash: 'h' }]),
    },
    machine: { read: () => Promise.resolve({ status: 'FACTORY COMPLETE', wavesDone: 6, testCount: 927 }) },
    propose: { propose: (input) => { proposeCalls.push(input); return Promise.resolve({ status: 'STOP_FOR_APPROVAL', pendingActionId: 'p1' }); } },
    auditSink: { appendRead: (e) => { appended.push(e as unknown as Record<string, unknown>); return Promise.resolve({ seq: appended.length, entry_hash: 'h' }); } },
    summaryRedactor: new RedactionEngine(COCKPIT_AUDIT_ALLOWLIST),
    responseRedactor: SecretPatternRedactor,
    organizationId: 'orgCockpit',
    actor: { user_id: 'rashed', email: '', role: 'operator' },
    environment: 'local',
    ...over,
  };
}

function fresh(over: Partial<OperatorCockpitPorts> = {}) { appended = []; proposeCalls = []; return new OperatorCockpit(ports(over)); }

describe('Operator Cockpit — READ endpoints are pure (existing state, no mutation)', () => {
  it('console pending queue read returns the existing queue and calls listPending read-only', async () => {
    let calls = 0;
    const c = fresh({ pendingQueue: { listPending: () => { calls++; return [{ actionId: 'x', tool: 'create_ticket' }] as never; } } });
    const r = await c.route({ method: 'GET', path: '/api/console/pending' });
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body).items[0].actionId).toBe('x');
    expect(calls).toBe(1);             // read-through, exactly once
    expect(appended.length).toBe(0);   // a READ audits/mutates NOTHING here
    expect(proposeCalls.length).toBe(0);
  });

  it('delivery-chain read returns latest Observer/Preview/Package/Release, mutating nothing', async () => {
    const c = fresh();
    const r = await c.route({ method: 'GET', path: '/api/delivery/latest' });
    const b = JSON.parse(r.body);
    expect(b.package.version).toBe('1.0.0');
    expect(b.release.verified).toBe(true);
    expect(appended.length).toBe(0);
    expect(proposeCalls.length).toBe(0);
  });

  it('audit read returns verifyChain + recent entries, read-only', async () => {
    const c = fresh();
    const r = await c.route({ method: 'GET', path: '/api/audit/verify', query: { org: 'orgCockpit' } });
    const b = JSON.parse(r.body);
    expect(b.verify.ok).toBe(true);
    expect(b.recent.length).toBe(1);
    expect(appended.length).toBe(0);
  });

  it('machine status read returns completion state (waves/test count) read-only', async () => {
    const c = fresh();
    const r = await c.route({ method: 'GET', path: '/api/machine/status' });
    expect(JSON.parse(r.body).status.testCount).toBe(927);
    expect(appended.length).toBe(0);
  });
});

describe('Operator Cockpit — venture endpoint returns an INERT blueprint (executes/mutates nothing)', () => {
  it('composes a real inert VentureBlueprint: plan-only status literal, fact/opinion separated', async () => {
    const graph = factoryCapabilityGraph(REPO_ROOT);
    const before = graph.size.nodes;
    const c = fresh({ venture: new VentureOrchestrator(graph) });
    const r = await c.route({ method: 'GET', path: '/api/venture/blueprint', query: { concept: 'a sovereign audit API platform' } });
    const bp = JSON.parse(r.body).blueprint;
    expect(bp.status).toBe('VENTURE-BLUEPRINT-AWAITING-HUMAN-APPROVAL');      // the ONLY status
    expect(bp.routesNothing).toBe(true);
    expect(bp.whatWeKnow.every((x: { advisory: boolean }) => x.advisory === false)).toBe(true);  // facts
    expect(bp.whatWeBelieve.every((x: { advisory: boolean }) => x.advisory === true)).toBe(true); // opinions
    expect(bp.proposals.every((p: { inert: boolean }) => p.inert === true)).toBe(true);
    expect(graph.size.nodes).toBe(before);  // the graph was consumed READ-ONLY — nothing mutated
    expect(appended.length).toBe(0);        // producing the advisory artifact routes/records nothing
    expect(proposeCalls.length).toBe(0);
  });
});

describe('Operator Cockpit — the ONE route endpoint ONLY enqueues to the existing propose path', () => {
  it('routes intent to propose.propose and returns STOP_FOR_APPROVAL — never a commit', async () => {
    const c = fresh();
    const r = await c.route({ method: 'POST', path: '/api/route', body: { tool: 'create_ticket', target: 'repo#1', payload: { title: 't' } } });
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body).outcome.status).toBe('STOP_FOR_APPROVAL'); // only ever STOP+enqueue
    expect(proposeCalls).toEqual([{ tool: 'create_ticket', target: 'repo#1', payload: { title: 't' } }]); // reached the EXISTING propose path, verbatim
    expect(appended.length).toBe(1);                                    // the enqueue was audited (hash chain)
    expect(String(appended[0].query_range && JSON.stringify(appended[0].query_range))).toMatch(/cockpit\.routed/);
  });

  it('a non-STOP propose outcome is surfaced as 409 (the gauntlet refused / needs approval) — no commit path', async () => {
    const refusing: ProposeSurface = { propose: () => Promise.resolve({ status: 'refused', reason: 'forbidden' }) };
    const c = fresh({ propose: refusing });
    const r = await c.route({ method: 'POST', path: '/api/route', body: { tool: 'delete_repo' } });
    expect(r.status).toBe(409);
    expect(JSON.parse(r.body).ok).toBe(false);
  });

  it('the cockpit is STRUCTURALLY INCAPABLE of approve/mint/execute/mutate/deploy (type-level)', () => {
    const c = fresh();
    // @ts-expect-error there is no approve() — the cockpit cannot approve; a human does that at the gate
    void c.approve;
    // @ts-expect-error there is no mint() — the cockpit cannot mint an approval token
    void c.mint;
    // @ts-expect-error there is no execute() — the cockpit cannot execute an action
    void c.execute;
    // @ts-expect-error there is no deploy() — the cockpit cannot deploy
    void c.deploy;
    // @ts-expect-error there is no commit() — commit belongs to the gate path, not the cockpit
    void c.commit;
    expect(typeof c.routeForApproval).toBe('function'); // the ONLY action-adjacent method — and it only enqueues
  });
});

describe('Operator Cockpit — redaction in depth (no secret in any response)', () => {
  it('a secret in a delivery record is scrubbed from the response body', async () => {
    const c = fresh();
    const r = await c.route({ method: 'GET', path: '/api/delivery/latest' });
    expect(r.body).not.toMatch(/ghp_[A-Za-z0-9]{20,}/); // the fake token in latestObservation() is scrubbed
    expect(r.body).toMatch(/dist\/app/);                 // non-secret content survives
  });
});

describe('Operator Cockpit — source-scan: touches no guard/gate-mint/gauntlet/external-adapter', () => {
  // strip `//` line comments so the scan inspects real CODE/imports, not descriptive prose (which names the forbidden
  // surfaces precisely to say it avoids them). No `/* */` blocks are used in these files.
  const strip = (src: string) => src.split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
  const surface = strip(readFileSync(MODULE, 'utf8'));
  const orch = strip(readFileSync(ORCH, 'utf8'));

  it('the surface module imports/uses NOTHING from ApprovalGate-mint / mcp-bridge / external-gateways / kill-switch', () => {
    for (const forbidden of ['approval-gate', 'mcp-bridge', 'external-gateways', 'kill-switch', 'live-github', 'runExternalAction', 'runEncapsulatedExternal', 'mintExternalCapability', 'grantCreate', 'grantOpen', 'grantSend', 'grantDeploy']) {
      expect(surface.includes(forbidden)).toBe(false);
    }
  });

  it('the surface calls only the injected propose path for routing (no gate/gauntlet/external call)', () => {
    expect(surface).toMatch(/this\.p\.propose\.propose\(/);       // the ONLY action seam
    expect(surface).not.toMatch(/\.resolve\(|\.commit\(|\.approve\(/); // no mint/commit/approve call
    expect(surface).not.toMatch(/\beval\(|\bfetch\(|child_process|execSync/); // no ambient IO/exec
  });

  it('every cross-module import in the surface is import type (except node:http + the port types)', () => {
    const runtimeImports = surface.split('\n').filter((l) => /^import /.test(l) && !/^import type/.test(l));
    // the ONLY non-type import is the node:http transport primitive
    expect(runtimeImports.length).toBe(1);
    expect(runtimeImports[0]).toMatch(/from 'node:http'/);
  });

  it('the orchestrator imports only plan-only engines + the pure composer + the read-only graph — no guard/gate', () => {
    for (const forbidden of ['approval-gate', 'mcp-bridge', 'external-gateways', 'kill-switch', 'runExternalAction', 'mintExternalCapability']) {
      expect(orch.includes(forbidden)).toBe(false);
    }
    expect(orch).toMatch(/venture-blueprint-composer/); // uses the pure composer
  });
});
