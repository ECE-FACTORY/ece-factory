// Operator Cockpit — read-surface layer (INTERNAL factory operator infrastructure, NOT a product/client UI).
//
// A THIN surface over the finished machine: "glass + a routing slot, not a lever" (governance: FACTORY_COMPLETION_PLAN
// → Operator Cockpit). It exposes the EXISTING read functions as pure READ endpoints, plus EXACTLY ONE route endpoint
// that only ENQUEUES operator intent to the EXISTING propose/gate path. Binding boundary, realized here:
//
//   • READ endpoints are PURE — they call injected read PORTS (the real Console queue read, delivery-chain latest
//     records, the plan-only venture composer, the audit verifyChain/summary, machine status) and mutate NOTHING.
//     Every response is secret-scrubbed before it leaves the process (redaction in depth).
//
//   • The SINGLE ROUTE endpoint may ONLY hand intent to the injected `ProposeSurface` (the EXISTING propose path).
//     It is STRUCTURALLY INCAPABLE of approving, minting, executing, mutating, or deploying: there is no such method
//     and no such return (type-level), and this module imports/calls NOTHING from ApprovalGate-mint / the gauntlet /
//     the mcp-bridge / any external adapter / kill switch (source-scan). The gate still requires REAL human authority
//     downstream — this endpoint just gets the item in front of it. Its enqueue is recorded to the hash-chain audit.
//
// It ADDS NO new action path and BYPASSES NO guard. All ports are injected at the composition root; this module holds
// only the surface + its pure router. `import type` only — no runtime import of any engine/guard/gate/bridge/adapter.

import { createServer, type Server } from 'node:http';
import type { TextRedactor } from '../../layer-4-build-harden/build-observer/build-observer.js';
import type { AuditSink, AppendResult, VerifyResult, AuditRow } from '../../factory-shared/audit-engine/sink.js';
import type { HumanActor, SessionInfo, Environment } from '../../factory-shared/audit-engine/schema.js';
import type { RedactionEngine } from '../../factory-shared/redaction-engine/redaction-engine.js';
import type { PendingItem } from '../../layer-2-command/decision-console/decision-console.js';
import type { VentureBlueprint } from '../../layer-6-venture-intel/venture-blueprint-composer/venture-blueprint-composer.js';

// ── injected READ ports — each wraps an EXISTING read function; none mutates ──────────────────────────────────
/** The EXISTING Decision Console pending-queue read (bound to `DecisionConsole.listPending`). Read-only. */
export interface PendingQueueReader { listPending(): PendingItem[] }
/** Latest delivery-chain records (Observer / Preview / Package / Release). Opaque data — serialized + redacted. */
export interface DeliveryChainReader {
  latestObservation(): unknown;
  latestPreview(): unknown;
  latestPackage(): unknown;
  latestRelease(): unknown;
}
/** The plan-only venture composer — runs the (plan-only) engines + composer and returns the INERT blueprint. */
export interface VentureComposer { composeFromConcept(concept: string): VentureBlueprint }
/** The audit spine read (bound to the real hash-chain sink). Read-only. */
export interface AuditReader {
  verifyChain(organizationId: string): Promise<VerifyResult>;
  readEntries(organizationId: string, opts?: { limit?: number }): Promise<AuditRow[]>;
}
/** Machine-completion status (bound to the governance factory-status read). Read-only. */
export interface MachineStatusReader { read(): Promise<unknown> }

/**
 * The EXISTING propose path — the ONLY thing the route endpoint may reach. Structurally identical to the sanctioned
 * `ActionProposer` (Decision Console, Piece 1d): it can ONLY push intent into the unchanged gauntlet, which STOPs and
 * enqueues a pending item a REAL human must still approve. It has NO approve/mint/resolve/commit method — a cockpit
 * route can never approve or commit, only enqueue.
 */
export interface ProposeSurface {
  propose(input: { tool: string; target?: unknown; payload?: unknown }): Promise<{ status: string; pendingActionId?: string; reason?: string }>;
}

export interface CockpitResponse { status: number; contentType: string; body: string }
export interface CockpitRequest { method: string; path: string; query?: Record<string, string>; body?: Record<string, unknown> }

export interface OperatorCockpitPorts {
  pendingQueue: PendingQueueReader;
  delivery: DeliveryChainReader;
  venture: VentureComposer;
  audit: AuditReader;
  machine: MachineStatusReader;
  /** the EXISTING propose path — the route endpoint's ONLY reachable action seam. */
  propose: ProposeSurface;
  /** hash-chain audit sink (appendRead only — no gate/approval/bridge) for recording the route enqueue. */
  auditSink: Pick<AuditSink, 'appendRead'>;
  /** allowlist redactor for the route-audit summary (a real `RedactionEngine`). */
  summaryRedactor: Pick<RedactionEngine, 'redactSummary'>;
  /** secret scrubber applied to EVERY response body (redaction in depth). */
  responseRedactor: TextRedactor;
  organizationId: string;
  actor: HumanActor;
  environment?: Environment;
}

/** Allowlist for the route-enqueue audit summary — only safe routing metadata reaches the chain. */
export const COCKPIT_AUDIT_ALLOWLIST: readonly string[] = [
  'cockpit', 'event', 'tool', 'target', 'routedBy', 'outcomeStatus', 'pendingActionId', 'environment',
];

/**
 * The Operator Cockpit surface. Its methods are: the pure READ handlers + `routeForApproval` (enqueue-only) + the
 * pure `route(req)` dispatcher + a thin `listen()` transport. There is DELIBERATELY no approve/refuse/mint/execute/
 * mutate/deploy method — the cockpit cannot decide or act; a real human does that at the gate the propose path feeds.
 */
export class OperatorCockpit {
  private readonly session: SessionInfo = { session_id: 'operator-cockpit' };
  constructor(private readonly p: OperatorCockpitPorts) {}

  // ── PURE READ handlers — each returns EXISTING state, mutating nothing ──────────────────────────────────────
  /** Console pending-approval queue (id, action, tier/gateway, sole-authority proposer, content-binding descriptor). */
  readPending(): PendingItem[] { return this.p.pendingQueue.listPending(); }

  /** Latest delivery-chain records — Observer / Preview / Package / Release (status/artifacts+sha256/version). */
  readDelivery(): { observation: unknown; preview: unknown; package: unknown; release: unknown } {
    return {
      observation: this.p.delivery.latestObservation(),
      preview: this.p.delivery.latestPreview(),
      package: this.p.delivery.latestPackage(),
      release: this.p.delivery.latestRelease(),
    };
  }

  /** Compose an INERT Venture Blueprint from a concept (runs the plan-only engines + composer). Executes nothing. */
  readVentureBlueprint(concept: string): VentureBlueprint { return this.p.venture.composeFromConcept(String(concept ?? '')); }

  /** Audit spine: verifyChain state + recent (redacted) summary. Read-only. */
  async readAudit(organizationId: string): Promise<{ verify: VerifyResult; recent: AuditRow[] }> {
    const org = organizationId || this.p.organizationId;
    const [verify, recent] = await Promise.all([this.p.audit.verifyChain(org), this.p.audit.readEntries(org, { limit: 50 })]);
    return { verify, recent };
  }

  /** Machine-completion status (waves/capabilities/VI-phases + test count) from the governance status read. */
  readMachineStatus(): Promise<unknown> { return this.p.machine.read(); }

  // ── THE ONE ROUTE endpoint — enqueue-only; structurally cannot approve/mint/execute ─────────────────────────
  /**
   * Hand an operator's "route this for approval" intent to the EXISTING propose path. It ONLY calls
   * `propose.propose(...)` — which drives the action into the UNCHANGED gauntlet → STOP → auto-enqueue. It cannot
   * (and has no way to) approve, mint a token, execute, mutate, or deploy. The enqueue is recorded to the hash chain.
   */
  async routeForApproval(intent: { tool: string; target?: unknown; payload?: unknown }): Promise<{ status: string; pendingActionId?: string; reason?: string }> {
    const tool = String(intent?.tool ?? '');
    // forward VERBATIM to the existing propose surface — the gauntlet validates; the cockpit adds no logic.
    const outcome = await this.p.propose.propose({ tool, target: intent?.target, payload: intent?.payload });
    // record the routing intent to the hash-chain audit (like any routed intent). Allowlist-redact the KEYS, and
    // value-scrub the one free-text operator field (`target`) for secrets — key-allowlisting alone keeps an
    // allowlisted string verbatim, so a token embedded in `target` must be scrubbed in depth before it is written.
    const target = typeof intent?.target === 'string' ? this.p.responseRedactor.redact(intent.target) : undefined;
    const summary = this.p.summaryRedactor.redactSummary({
      cockpit: 'route',
      event: 'cockpit.routed',
      tool,
      target,
      routedBy: this.p.actor.user_id,
      outcomeStatus: outcome.status,
      pendingActionId: outcome.pendingActionId,
      environment: this.p.environment ?? 'local',
    });
    await this.p.auditSink.appendRead({ organization_id: this.p.organizationId, human_actor: this.p.actor, session: this.session, query_range: summary, rows_returned: 0 });
    return outcome;
  }

  // ── PURE dispatcher (no sockets) — GET reads + the single POST route ────────────────────────────────────────
  async route(req: CockpitRequest): Promise<CockpitResponse> {
    const { method, path } = req;
    if (method === 'GET' && path === '/api/console/pending') return this.ok({ items: this.readPending() });
    if (method === 'GET' && path === '/api/delivery/latest') return this.ok(this.readDelivery());
    if (method === 'GET' && path === '/api/venture/blueprint') return this.ok({ blueprint: this.readVentureBlueprint(String(req.query?.concept ?? '')) });
    if (method === 'GET' && path === '/api/audit/verify') return this.ok(await this.readAudit(String(req.query?.org ?? '')));
    if (method === 'GET' && path === '/api/machine/status') return this.ok({ status: await this.readMachineStatus() });
    if (method === 'POST' && path === '/api/route') {
      const body = req.body ?? {};
      const outcome = await this.routeForApproval({ tool: String(body.tool ?? ''), target: body.target, payload: body.payload });
      // a route can only ever STOP+enqueue — never a commit; non-STOP is a 409 (the gauntlet refused/needs approval).
      const ok = outcome.status === 'STOP_FOR_APPROVAL';
      return this.respond(ok ? 200 : 409, { ok, outcome });
    }
    return this.respond(404, { ok: false, error: `no route ${method} ${path}` });
  }

  /** Thin loopback transport. Reads/route only; binds 127.0.0.1 (no external exposure). */
  listen(port: number): Server {
    const server = createServer((reqMsg, res) => {
      const chunks: Buffer[] = [];
      reqMsg.on('data', (c: Buffer) => chunks.push(c));
      reqMsg.on('end', () => { void (async () => {
        let body: Record<string, unknown> | undefined;
        if (chunks.length) { try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>; } catch { body = undefined; } }
        const url = new URL(reqMsg.url ?? '/', 'http://localhost');
        const query: Record<string, string> = {};
        for (const [k, v] of url.searchParams) query[k] = v;
        const out = await this.route({ method: reqMsg.method ?? 'GET', path: url.pathname, query, body });
        res.writeHead(out.status, { 'content-type': out.contentType });
        res.end(out.body);
      })(); });
    });
    server.listen(port, '127.0.0.1'); // LOOPBACK-ONLY — operator-facing, never off-machine.
    return server;
  }

  private ok(payload: unknown): CockpitResponse { return this.respond(200, { ok: true, ...(payload as object) }); }
  /** Serialize THEN secret-scrub the whole body — no secret can leave in any response (redaction in depth). */
  private respond(status: number, payload: unknown): CockpitResponse {
    return { status, contentType: 'application/json', body: this.p.responseRedactor.redact(JSON.stringify(payload)) };
  }
}

/** Enqueue an appended route to the auditor (used at composition — kept here so the module owns its audit shape). */
export type { AppendResult };
