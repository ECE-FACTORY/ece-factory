// Live Operator Cockpit UI wiring (composition root). Wraps the read-surface layer's OperatorCockpit as the UI
// server's ONLY backend seam, and provides a clearly-labeled PREVIEW wiring (in-memory sample state + the REAL
// plan-only venture orchestrator) so the cockpit runs locally without a database. PURE GLASS end to end: the UI
// server touches only the surface dispatcher; the surface layer can only READ + ROUTE. Adds no action path.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CockpitUiServer, type SurfaceDispatcher, type CockpitUiServerOptions } from '../layer-5-action/operator-cockpit-ui/cockpit-ui-server.js';
import { factoryOperatorCockpit, factoryVentureOrchestrator } from './live-operator-cockpit.js';
import type { OperatorCockpit } from '../layer-5-action/operator-cockpit/operator-cockpit.js';
import { factoryCapabilityGraph } from './live-capability-reuse-graph.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Serve a cockpit UI over a LIVE (or any) surface dispatcher — the wired OperatorCockpit. */
export function factoryCockpitUiServer(surface: SurfaceDispatcher, opts: CockpitUiServerOptions = {}): CockpitUiServer {
  return new CockpitUiServer(surface, opts);
}

/**
 * A PREVIEW cockpit — the real read-surface layer wired to in-memory SAMPLE state (Console queue, delivery records,
 * machine status, audit) plus the REAL plan-only venture orchestrator over the real Capability Reuse Graph. It is
 * honestly labeled PREVIEW in the UI (sample state, not the live factory). It reaches no DB, no gate, no external
 * adapter — the route endpoint forwards to a stub propose that only reports STOP_FOR_APPROVAL.
 */
export function previewCockpit(): OperatorCockpit {
  const sampleObservation = { status: 'success', command: 'node scripts/build', durationMs: 1240, artifacts: [{ path: 'dist/cockpit', sha256: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6' }] };
  return factoryOperatorCockpit({
    pendingQueue: {
      listPending: () => [
        { actionId: 'sample-1', tool: 'create_ticket', target: 'ECE-FACTORY/ece-factory#new', effect: 'open an issue', descriptor: { tool: 'create_ticket', reversible: 'reversible' }, tier: 'APPROVAL_REQUIRED_WRITE (external)', blastRadius: 1, reversibility: 'reversible', proposingCaller: 'autopilot', requestedAtIso: '2026-07-06T12:00:00Z' },
      ] as never,
    },
    delivery: {
      latestObservation: () => sampleObservation,
      latestPreview: () => ({ built: true, status: 'success', compliant: true }),
      latestPackage: () => ({ version: '0.1.0', checksums: [{ path: 'ECE-Cockpit.app', sha256: 'f00dfeedcafebabe0011223344556677' }] }),
      latestRelease: () => ({ version: '0.1.0', verified: true }),
    },
    venture: factoryVentureOrchestrator(factoryCapabilityGraph(REPO_ROOT)),
    audit: {
      verifyChain: () => Promise.resolve({ ok: true, checked: 3 }),
      readEntries: () => Promise.resolve([{ kind: 'read', seq: 3, organization_id: 'preview', ts: '2026-07-06T12:00:00Z', entry_hash: 'deadbeefdeadbeefdeadbeefdeadbeef' }]),
    },
    machine: { read: () => Promise.resolve({ status: 'FACTORY COMPLETE', wavesDone: 6, capabilities: 5, viPhases: '14/14', testCount: 943 }) },
    // stub propose — reports STOP_FOR_APPROVAL only; reaches no real gauntlet/gate/external in preview.
    propose: { propose: () => Promise.resolve({ status: 'STOP_FOR_APPROVAL', pendingActionId: 'pending-preview' }) },
    // in-memory audit sink for preview (records nowhere durable).
    auditSink: { appendRead: () => Promise.resolve({ seq: 1, entry_hash: 'preview' }) },
    organizationId: 'preview',
  });
}

/** Build a locally-runnable PREVIEW cockpit UI server (sample state, honestly labeled). Loopback-only. */
export function factoryPreviewCockpitUiServer(): CockpitUiServer {
  return new CockpitUiServer(previewCockpit(), { preview: true, organizationId: 'preview' });
}
