// Decision Console — minimal local operator UI (Wave 6, Piece 1). The first UI in the factory: an operator
// SEAT that lists the pending-approval queue and lets a real, identified human APPROVE/REFUSE each item.
//
// OPERATOR IDENTITY IS REAL: the approver is the LOGGED-IN operator carried by the session — established by an
// explicit login (the operator supplies their identity). It is NEVER a hardcoded constant, NEVER read from the
// request body, and NEVER derived from the proposing caller. Approve/refuse always attribute to the session
// operator; a request without a session is refused (no anonymous approval). A login AS 'claude' is refused.
//
// DEPENDENCY-FREE: Node's built-in `http` + `crypto.randomUUID` only — no framework, no new dependency. The
// routing core (`route`) is pure and unit-testable without sockets; `listen` is a thin transport wrapper.
// This UI only READS the queue and DRIVES the approve/refuse seam — it adds NO guard logic and no approval
// path of its own (the seam mints through the gate).

import { createServer, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { PendingItem, ConsoleDecisionOutcome } from '../features/decision-console/decision-console.js';
import type { Principal } from '../features/approval-gate/approval-gate.js';

/** The seat the UI drives. `DecisionConsole` satisfies it structurally. */
export interface OperatorSeat {
  listPending(): PendingItem[];
  approve(actionId: string, operator: Principal, reason: string): ConsoleDecisionOutcome;
  refuse(actionId: string, operator: Principal, reason: string): ConsoleDecisionOutcome;
}

export interface RouteRequest {
  method: string;
  path: string;
  sessionId?: string;
  /** Shared-secret for the (unprivileged) propose surface — env-only, NOT an operator session. Never logged. */
  proposeToken?: string;
  body?: Record<string, unknown>;
}
export interface RouteResponse {
  status: number;
  contentType: 'application/json' | 'text/html';
  body: string;
  /** Set when a login succeeds — the transport should hand this back to the client (cookie/header). */
  setSessionId?: string;
}

/**
 * INITIATE-ONLY port (Wave 6, Piece 1d — Design 2, strict). Given a tool + target/payload it drives the action
 * into its gateway → the UNCHANGED 8.4 gauntlet → STOP → auto-enqueue, and reports the resulting pending id.
 * Its input has NO `approvalActionId` field — a propose call cannot reference, carry, or supply an approval.
 * It has NO approve/refuse/resolve method and NO gate reference: the type itself cannot mint a token or commit.
 */
export interface ActionProposer {
  propose(input: { tool: string; target?: unknown; payload?: unknown }): Promise<{ status: string; pendingActionId?: string; reason?: string }>;
}

/**
 * The commit-on-approve seam (Design 2). A real operator's APPROVE (which mints the gate's own single-use token)
 * triggers this to re-drive the already-approved action through its gateway → the unchanged gauntlet consumes
 * the token → commit. It is invoked ONLY from `approveRoute` AFTER a genuine mint; the propose surface holds no
 * reference to it. Returns undefined when the action is not a committable proposed external action.
 */
export interface ApprovedActionCommitter {
  commit(actionId: string): Promise<{ status: string; committed?: unknown; reason?: string } | undefined>;
}

export interface DecisionConsoleServerOptions {
  idgen?: () => string; // injectable for deterministic tests
  /** Enables POST /api/propose (initiate-only). Omit ⇒ the route returns 404 (surface off). */
  proposer?: ActionProposer;
  /** Required shared secret for /api/propose (env-only). Unset ⇒ the propose route is locked (404). Never logged. */
  proposeToken?: string;
  /** Design 2 commit-on-approve seam. Omit ⇒ APPROVE only mints (no auto-commit). */
  committer?: ApprovedActionCommitter;
}

export class DecisionConsoleServer {
  private readonly sessions = new Map<string, Principal>(); // sessionId → the logged-in operator identity
  private readonly idgen: () => string;
  private readonly proposer?: ActionProposer;       // initiate-only surface (Piece 1d) — never approves/commits
  private readonly proposeToken?: string;           // env-only shared secret for /api/propose (never logged)
  private readonly committer?: ApprovedActionCommitter; // commit-on-approve seam (Design 2)

  constructor(private readonly seat: OperatorSeat, opts: DecisionConsoleServerOptions = {}) {
    this.idgen = opts.idgen ?? (() => randomUUID());
    this.proposer = opts.proposer;
    this.proposeToken = opts.proposeToken;
    this.committer = opts.committer;
  }

  /** Establish an operator session from an EXPLICIT identity. Refuses anonymous or 'claude'. */
  login(operator: Principal | undefined): { ok: true; sessionId: string } | { ok: false; error: string } {
    const id = operator?.user_id?.trim();
    if (!id) return { ok: false, error: 'operator identity (user_id) is required to log in — no anonymous operator' };
    if (id.toLowerCase() === 'claude') return { ok: false, error: 'the AI ("claude") cannot log in as an operator — a real human is required' };
    const sessionId = this.idgen();
    this.sessions.set(sessionId, { user_id: id, email: operator?.email, role: operator?.role });
    return { ok: true, sessionId };
  }

  operatorFor(sessionId: string | undefined): Principal | undefined {
    return sessionId ? this.sessions.get(sessionId) : undefined;
  }

  /** Pure routing core — no sockets. Approver is ALWAYS the session operator (never the body, never a caller). */
  route(req: RouteRequest): RouteResponse {
    const { method, path } = req;
    if (method === 'GET' && (path === '/' || path === '/index.html')) {
      return { status: 200, contentType: 'text/html', body: OPERATOR_PAGE };
    }
    if (method === 'POST' && path === '/api/login') {
      const operator = (req.body?.operator ?? req.body) as Principal | undefined;
      const r = this.login(operator);
      return r.ok
        ? { status: 200, contentType: 'application/json', body: json({ ok: true, operator: this.sessions.get(r.sessionId) }), setSessionId: r.sessionId }
        : { status: 400, contentType: 'application/json', body: json({ ok: false, error: r.error }) };
    }

    // ── everything below REQUIRES a real operator session (no anonymous access) ──
    const operator = this.operatorFor(req.sessionId);
    if (!operator) return { status: 401, contentType: 'application/json', body: json({ ok: false, error: 'not logged in — an authenticated operator identity is required' }) };

    if (method === 'GET' && path === '/api/pending') {
      return { status: 200, contentType: 'application/json', body: json({ ok: true, operator: operator.user_id, items: this.seat.listPending() }) };
    }
    if (method === 'POST' && (path === '/api/approve' || path === '/api/refuse')) {
      const actionId = String(req.body?.actionId ?? '');
      const reason = String(req.body?.reason ?? '');
      // The approver is the SESSION operator — NOT anything in the body. A body-supplied approver is ignored.
      const outcome = path === '/api/approve'
        ? this.seat.approve(actionId, operator, reason)
        : this.seat.refuse(actionId, operator, reason);
      const status = outcome.status === 'rejected' ? 409 : 200;
      return { status, contentType: 'application/json', body: json({ ok: outcome.status !== 'rejected', approver: operator.user_id, outcome }) };
    }
    return { status: 404, contentType: 'application/json', body: json({ ok: false, error: `no route ${method} ${path}` }) };
  }

  /**
   * POST /api/propose (Piece 1d, Design 2 — INITIATE-ONLY). Gated by a shared secret (env-only), NOT an operator
   * session: proposing is unprivileged — it can only push an action into the unchanged gauntlet, which STOPs and
   * auto-enqueues a pending item a REAL human must still approve. It forwards tool/target/payload VERBATIM to the
   * proposer and does NO validation of its own (the gauntlet validates). There is NO `approvalActionId` here — a
   * propose call cannot reference, carry, or supply an approval, and it holds no gate/committer: it cannot approve,
   * mint, bypass, or commit. Its ONLY success is STOP_FOR_APPROVAL (never a commit).
   */
  async proposeRoute(req: RouteRequest): Promise<RouteResponse> {
    if (!this.proposer || !this.proposeToken) {
      return { status: 404, contentType: 'application/json', body: json({ ok: false, error: 'propose surface is not enabled' }) };
    }
    if (!req.proposeToken || req.proposeToken !== this.proposeToken) {
      return { status: 401, contentType: 'application/json', body: json({ ok: false, error: 'invalid or missing propose token' }) };
    }
    const tool = String(req.body?.tool ?? '');
    // NOTE: only tool/target/payload are forwarded — approvalActionId is structurally never read on this path.
    const out = await this.proposer.propose({ tool, target: req.body?.target, payload: req.body?.payload });
    const ok = out.status === 'STOP_FOR_APPROVAL'; // a propose can only ever STOP+enqueue, never commit
    return { status: ok ? 200 : 409, contentType: 'application/json', body: json({ ok, outcome: out }) };
  }

  /**
   * POST /api/approve (Design 2). Delegates auth + token MINT to the pure, tested `route` (session operator only,
   * body-approver ignored, self/AI/anonymous barred). ONLY on a genuine APPROVED mint does the operator's approval
   * trigger the commit re-drive through the committer → the UNCHANGED gauntlet consumes the token → commit. The
   * propose surface can never reach this path (it holds no committer and no approvalActionId).
   */
  async approveRoute(req: RouteRequest): Promise<RouteResponse> {
    const minted = this.route({ method: 'POST', path: '/api/approve', sessionId: req.sessionId, body: req.body });
    if (minted.status !== 200 || !this.committer) return minted;
    const parsed = JSON.parse(minted.body) as { outcome?: { status?: string } };
    if (parsed.outcome?.status !== 'APPROVED') return minted; // rejected mint ⇒ no commit
    const commit = await this.committer.commit(String(req.body?.actionId ?? ''));
    return commit ? { ...minted, body: json({ ...parsed, commit }) } : minted;
  }

  /** Thin transport: parse method/path/session/body, delegate to `route`/`proposeRoute`/`approveRoute`, write it. */
  listen(port: number): Server {
    const server = createServer((reqMsg, res) => {
      const chunks: Buffer[] = [];
      reqMsg.on('data', (c: Buffer) => chunks.push(c));
      reqMsg.on('end', () => { void (async () => {
        let body: Record<string, unknown> | undefined;
        if (chunks.length) { try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>; } catch { body = undefined; } }
        const url = new URL(reqMsg.url ?? '/', 'http://localhost');
        const sessionId = headerSession(reqMsg.headers['x-session-id']) ?? cookieSession(reqMsg.headers.cookie);
        const proposeToken = headerSession(reqMsg.headers['x-propose-token']);
        const rq: RouteRequest = { method: reqMsg.method ?? 'GET', path: url.pathname, sessionId, proposeToken, body };
        const out = (rq.method === 'POST' && url.pathname === '/api/propose') ? await this.proposeRoute(rq)
          : (rq.method === 'POST' && url.pathname === '/api/approve') ? await this.approveRoute(rq)
          : this.route(rq);
        const headers: Record<string, string> = { 'content-type': out.contentType };
        if (out.setSessionId) headers['set-cookie'] = `ece_session=${out.setSessionId}; HttpOnly; SameSite=Strict; Path=/`;
        res.writeHead(out.status, headers);
        res.end(out.body);
      })(); });
    });
    // LOOPBACK-ONLY bind (Piece 1d hardening): the Console + propose surface are not reachable off-machine.
    server.listen(port, '127.0.0.1');
    return server;
  }
}

function json(v: unknown): string { return JSON.stringify(v); }
function headerSession(h: string | string[] | undefined): string | undefined {
  return typeof h === 'string' && h.trim() ? h.trim() : undefined;
}
function cookieSession(cookie: string | undefined): string | undefined {
  const m = cookie && /(?:^|;\s*)ece_session=([^;]+)/.exec(cookie);
  return m ? m[1] : undefined;
}

// Minimal functional operator page (the shared ECE design layer is a later piece). Login → list → approve/refuse.
const OPERATOR_PAGE = `<!doctype html><meta charset=utf-8><title>ECE Decision Console</title>
<style>body{font:14px system-ui;margin:2rem;max-width:60rem}.item{border:1px solid #ccc;border-radius:6px;padding:1rem;margin:.5rem 0}.k{color:#666}button{margin-right:.5rem}</style>
<h1>ECE Decision Console <span class=k>— operator seat (piece 1)</span></h1>
<div id=login><input id=uid placeholder="operator user_id"> <input id=email placeholder="email"> <input id=role placeholder="role"> <button onclick=login()>Log in</button></div>
<div id=who class=k></div><div id=queue></div>
<script>
let sid=null;
async function login(){const operator={user_id:uid.value,email:email.value,role:role.value};const r=await fetch('/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({operator})});const j=await r.json();if(!j.ok){who.textContent=j.error;return;}who.textContent='operator: '+j.operator.user_id;login_.remove?.();refresh();}
async function refresh(){const r=await fetch('/api/pending');const j=await r.json();if(!j.ok){who.textContent=j.error;return;}queue.innerHTML=j.items.map(it=>'<div class=item><b>'+it.tool+'</b> <span class=k>'+(it.tier||'')+' · blast '+it.blastRadius+' · '+it.reversibility+'</span><br>target: '+(it.target||'')+'<br>effect: '+(it.effect||'')+'<br><span class=k>proposed by '+it.proposingCaller+' at '+it.requestedAtIso+'</span><br><button onclick="decide(\\''+it.actionId+'\\',true)">APPROVE</button><button onclick="decide(\\''+it.actionId+'\\',false)">REFUSE</button></div>').join('')||'<i>queue empty</i>';}
async function decide(actionId,ok){const reason=prompt((ok?'APPROVE':'REFUSE')+' reason:');if(!reason)return;const r=await fetch(ok?'/api/approve':'/api/refuse',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({actionId,reason})});const j=await r.json();alert(JSON.stringify(j.outcome));refresh();}
</script>`;
