import { describe, it, expect } from 'vitest';
import { DecisionConsoleServer, type OperatorSeat } from './decision-console-server.js';
import type { PendingItem, ConsoleDecisionOutcome } from '../layer-2-command/decision-console/decision-console.js';
import type { Principal } from '../layer-1-law/approval-gate/approval-gate.js';

// Wave 6 Piece 1 — the operator UI carries a REAL operator identity: established by explicit login, flowed to
// the seam as the approver. NEVER hardcoded, NEVER read from the request body, NEVER derived from the caller.
// Anonymous access is refused; a 'claude' login is refused.

// A recording seat — captures exactly which operator the UI passes to approve/refuse.
class RecordingSeat implements OperatorSeat {
  approvedBy: Principal[] = []; refusedBy: Principal[] = [];
  listPending(): PendingItem[] { return [{ actionId: 'a1', tool: 'create_ticket', target: 'ECE/x', effect: 'create issue', descriptor: {} as PendingItem['descriptor'], tier: 'external', blastRadius: 1, reversibility: 'soft-only', proposingCaller: 'claude', requestedAtIso: '2026-06-30T00:00:00.000Z' }]; }
  approve(_id: string, operator: Principal): ConsoleDecisionOutcome { this.approvedBy.push(operator); return { status: 'APPROVED', actionId: _id, approvalId: 'apr_1', approver: operator.user_id }; }
  refuse(_id: string, operator: Principal): ConsoleDecisionOutcome { this.refusedBy.push(operator); return { status: 'REFUSED', actionId: _id, approver: operator.user_id }; }
}
let n = 0;
function server(seat: OperatorSeat = new RecordingSeat()) {
  return new DecisionConsoleServer(seat, { idgen: () => `sess_${++n}` });
}

describe('Decision Console UI — explicit operator login (no anonymous, no AI)', () => {
  it('a login with an identity issues a session; the operator is remembered', () => {
    const s = server();
    const r = s.route({ method: 'POST', path: '/api/login', body: { operator: { user_id: 'op_jane', email: 'j@e', role: 'operator' } } });
    expect(r.status).toBe(200);
    expect(r.setSessionId).toBeTruthy();
    expect(s.operatorFor(r.setSessionId)!.user_id).toBe('op_jane');
  });
  it('login without a user_id ⇒ refused (no anonymous operator)', () => {
    expect(server().route({ method: 'POST', path: '/api/login', body: { operator: { user_id: '' } } }).status).toBe(400);
  });
  it('login as "claude" ⇒ refused (the AI cannot be an operator)', () => {
    expect(server().route({ method: 'POST', path: '/api/login', body: { operator: { user_id: 'claude' } } }).status).toBe(400);
  });
});

describe('Decision Console UI — protected routes require a real session', () => {
  it('pending / approve / refuse without a session ⇒ 401 (anonymous barred)', () => {
    const s = server();
    expect(s.route({ method: 'GET', path: '/api/pending' }).status).toBe(401);
    expect(s.route({ method: 'POST', path: '/api/approve', body: { actionId: 'a1', reason: 'x' } }).status).toBe(401);
    expect(s.route({ method: 'POST', path: '/api/refuse', body: { actionId: 'a1', reason: 'x' } }).status).toBe(401);
  });
});

describe('Decision Console UI — the approver is the SESSION operator, never the body / caller / a constant', () => {
  it('approve attributes to the logged-in operator; a body-supplied approver is IGNORED', () => {
    const seat = new RecordingSeat();
    const s = server(seat);
    const sid = s.route({ method: 'POST', path: '/api/login', body: { operator: { user_id: 'op_jane', role: 'operator' } } }).setSessionId!;
    // the body tries to inject a different approver — it must be ignored; the session operator is used.
    const r = s.route({ method: 'POST', path: '/api/approve', sessionId: sid, body: { actionId: 'a1', reason: 'ok', approver: { user_id: 'claude' }, operator: { user_id: 'admin1' } } });
    expect(r.status).toBe(200);
    expect(seat.approvedBy).toHaveLength(1);
    expect(seat.approvedBy[0].user_id).toBe('op_jane'); // NOT 'claude', NOT 'admin1' from the body
  });
  it('refuse attributes to the logged-in operator', () => {
    const seat = new RecordingSeat();
    const s = server(seat);
    const sid = s.route({ method: 'POST', path: '/api/login', body: { operator: { user_id: 'op_kai' } } }).setSessionId!;
    s.route({ method: 'POST', path: '/api/refuse', sessionId: sid, body: { actionId: 'a1', reason: 'no' } });
    expect(seat.refusedBy[0].user_id).toBe('op_kai');
  });
  it('GET /api/pending (with session) returns the queue', () => {
    const s = server();
    const sid = s.route({ method: 'POST', path: '/api/login', body: { operator: { user_id: 'op_jane' } } }).setSessionId!;
    const r = s.route({ method: 'GET', path: '/api/pending', sessionId: sid });
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body).items).toHaveLength(1);
  });
});

describe('Decision Console UI — serves a minimal operator page', () => {
  it('GET / ⇒ 200 HTML with login + queue', () => {
    const r = server().route({ method: 'GET', path: '/' });
    expect(r.status).toBe(200);
    expect(r.contentType).toBe('text/html');
    expect(r.body).toMatch(/Decision Console/);
  });
  it('Piece 1e render fix: login handler references no undefined identifier and removes the real login form, then refreshes', () => {
    const page = server().route({ method: 'GET', path: '/' }).body;
    expect(page).not.toMatch(/login_/);                           // the undefined identifier that threw is gone
    expect(page).toMatch(/getElementById\('login'\)\?\.remove\(\)/); // removes the real form by its id
    // login() still triggers the pending render (so the queue auto-loads after login — no DevTools needed)
    expect(page).toMatch(/document\.getElementById\('login'\)\?\.remove\(\);refresh\(\);/);
  });
});

describe('Decision Console UI — Piece 4: the EC design layer (presentation), behavior preserved', () => {
  const page = () => server().route({ method: 'GET', path: '/' }).body;
  it('serves the EC monogram (inline SVG, crossbar) and the Trusted-Layer register', () => {
    const p = page();
    expect(p).toMatch(/ec-mark/);                        // the EC monogram mark
    expect(p).toMatch(/<svg[^>]*aria-label="ECE"/);      // inline SVG, monochrome (currentColor)
    expect(p).toMatch(/The Trusted Layer — forty-eight years/); // institutional register line
    expect(p).toMatch(/ECE Decision Console/);
  });
  it('renders the queue card structure + the policy read with structural facts DISTINCT from the labeled advisory', () => {
    const p = page();
    expect(p).toMatch(/class=ec-card/);                  // structured action cards
    expect(p).toMatch(/class=ec-kv/);                    // tool/target/effect/tier/blast/reversibility/proposer
    expect(p).toMatch(/\[ADVISORY — informs, does not decide\]/); // advisory recommendation, labeled
    expect(p).toMatch(/structural checks/);              // structural facts region — distinct from the advisory
    expect(p).toMatch(/ec-check-ok|ec-check-no/);        // per-rule ✓/✗ classes
  });
  it('HARD-BLOCKED is shown unmistakably and disables APPROVE (behavior preserved)', () => {
    const p = page();
    expect(p).toMatch(/HARD-BLOCKED — not approvable/);
    expect(p).toMatch(/policyBlocked\?'disabled/);        // approve disabled when hard-blocked
  });
  it('air-gap-safe: no external CDN / webfont / network reference in the page', () => {
    const p = page();
    expect(p).not.toMatch(/https?:\/\//);                 // no external URL
    expect(p).not.toMatch(/fonts\.googleapis|cdn\.|@import|link[^>]+stylesheet/); // no remote fonts/styles
  });
  it('behavior preserved: same routes/fetches, session flow, auto-load on login', () => {
    const p = page();
    for (const route of ['/api/login', '/api/pending', '/api/approve', '/api/refuse']) expect(p).toContain(route);
    expect(p).not.toMatch(/login_/);
    expect(p).toMatch(/document\.getElementById\('login'\)\?\.remove\(\);refresh\(\);/); // Piece-1e auto-load not regressed
  });
});
