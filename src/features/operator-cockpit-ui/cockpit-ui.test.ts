import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderCockpitPage, COCKPIT_CLIENT_JS, SURFACE_ENDPOINTS, PLAN_ONLY_STATUS } from './cockpit-ui.js';
import { CockpitUiServer, type SurfaceDispatcher } from './cockpit-ui-server.js';

// Operator Cockpit UI. Proves PURE GLASS: (1) the client data layer fetches ONLY the surface-layer endpoints
// (source-scan — no guard/gate/engine, no client action path); (2) the ONLY mutating control POSTs to the single
// route endpoint (cannot approve/mint/execute); (3) HONEST state (refused/awaiting/cleared rendered as they are);
// (4) redaction respected (the UI renders surface responses as-is, never un-redacts); (5) the local server serves
// the page + forwards /api/* to the injected surface dispatcher (mocked — no direct backend coupling).

const HERE = path.dirname(fileURLToPath(import.meta.url));
const clientSrc = COCKPIT_CLIENT_JS;
const serverSrc = readFileSync(path.join(HERE, 'cockpit-ui-server.ts'), 'utf8');

// a mock surface dispatcher — the ONLY backend the UI can reach. Records what the UI asked for.
function mockSurface(responses: Record<string, unknown>) {
  const calls: Array<{ method: string; path: string; body?: unknown }> = [];
  const surface: SurfaceDispatcher = {
    route: (req) => {
      calls.push({ method: req.method, path: req.path, body: req.body });
      const key = `${req.method} ${req.path}`;
      return Promise.resolve({ status: 200, contentType: 'application/json', body: JSON.stringify(responses[key] ?? { ok: true }) });
    },
  };
  return { surface, calls };
}

describe('Operator Cockpit UI — PURE GLASS: the data layer calls ONLY the surface-layer endpoints', () => {
  it('the client fetches ONLY the six surface endpoints — no other URL', () => {
    // every network call targets an API.<name> ref (the SURFACE_ENDPOINTS map); the readJSON/fetch helpers take
    // the API.* value as their argument. There is NO literal or external URL anywhere in the client.
    const netTargets = [...clientSrc.matchAll(/(?:fetch|readJSON)\(\s*([A-Za-z_.]+)/g)].map((m) => m[1]);
    expect(netTargets.length).toBeGreaterThan(0);
    for (const t of netTargets) expect(t === 'url' || /^API\./.test(t)).toBe(true); // API.* refs (or the readJSON(url) helper param)
    expect(clientSrc).not.toMatch(/https?:\/\//);                 // no external URL
    expect(clientSrc).not.toMatch(/fetch\(\s*['"`]/);             // no literal-URL fetch (all go through API.*)
    // the client references exactly the surface endpoint set and nothing outside it.
    for (const p of Object.values(SURFACE_ENDPOINTS)) expect(clientSrc).toContain(p);
    expect(new Set(Object.values(SURFACE_ENDPOINTS)).size).toBe(6);
  });

  it('the client references NOTHING from any guard / gate-mint / gauntlet / external-adapter / engine', () => {
    for (const forbidden of ['approval-gate', 'mcp-bridge', 'external-gateways', 'kill-switch', 'runExternalAction', 'runEncapsulatedExternal', 'mintExternalCapability', 'grantCreate', 'grantOpen', 'grantSend', 'grantDeploy', 'ApprovalGate', 'gauntlet']) {
      expect(clientSrc.includes(forbidden)).toBe(false);
    }
  });

  it('the client has NO action path — the only non-GET fetch is the single route endpoint', () => {
    // find every fetch with a method option; the ONLY POST is to API.route.
    expect(clientSrc).toMatch(/fetch\(API\.route,\s*\{\s*method:\s*'POST'/);
    const posts = [...clientSrc.matchAll(/fetch\(([^,]+),\s*\{\s*method:\s*'(\w+)'/g)];
    expect(posts.length).toBe(1);                       // exactly one mutating call
    expect(posts[0][1]).toBe('API.route');              // ...and it targets the route endpoint
    expect(posts[0][2]).toBe('POST');
    // no approve/mint/execute/commit/deploy client verb anywhere.
    expect(clientSrc).not.toMatch(/\/api\/(approve|refuse|mint|execute|commit|deploy)/);
  });
});

describe('Operator Cockpit UI — route-not-act + honest state', () => {
  it('the route control forwards to the surface route endpoint and reports STOP as "awaiting a human"', async () => {
    const { surface, calls } = mockSurface({ 'POST /api/route': { ok: true, outcome: { status: 'STOP_FOR_APPROVAL', pendingActionId: 'p9' } } });
    const s = new CockpitUiServer(surface);
    const res = await s.handle({ method: 'POST', path: '/api/route', body: { tool: 'create_ticket', target: 't' } });
    expect(calls).toEqual([{ method: 'POST', path: '/api/route', body: { tool: 'create_ticket', target: 't' } }]); // reached ONLY the surface route
    expect(JSON.parse(res.body).outcome.status).toBe('STOP_FOR_APPROVAL');
    // the client renders STOP honestly as AWAITING, never as a success/approval. (APPROVED/CREATED/EXECUTED appear
    // ONLY inside the "these are NOT representable" note — the UI never claims the action succeeded.)
    expect(clientSrc).toMatch(/AWAITING a human at the gate/);
    expect(clientSrc).toMatch(/did not approve or execute/);
    expect(clientSrc).not.toMatch(/textContent\s*=\s*'[^']*\b(approved|executed|deployed)\b/i); // no fake-success message
  });

  it('honest gate-state: refused/cleared/awaiting derive from REAL status (never fabricated)', () => {
    expect(clientSrc).toMatch(/honestState/);
    expect(clientSrc).toMatch(/refuse.*reject|reject.*refuse|indexOf\('refuse'\)/); // refused mapping
    expect(clientSrc).toMatch(/awaiting human/);                                     // default is awaiting, not success
    // a non-STOP route outcome is surfaced as the gate's real word, never a fake success.
    expect(clientSrc).toMatch(/Gate did not enqueue/);
  });

  it('the venture view carries the plan-only status literal and marks approved/created/executed unrepresentable', () => {
    expect(clientSrc).toContain(PLAN_ONLY_STATUS);
    expect(clientSrc).toMatch(/NOT representable/);
    expect(clientSrc).toMatch(/whatWeKnow/);   // fact column
    expect(clientSrc).toMatch(/whatWeBelieve/); // opinion column — separated
  });
});

describe('Operator Cockpit UI — redaction respected + self-contained', () => {
  it('the client renders surface responses via text-escaping and never un-redacts a secret', () => {
    expect(clientSrc).toMatch(/const esc =/);            // all rendered values pass through esc()
    // the UI does not strip/replace redaction markers or reconstruct secrets — no such logic exists.
    expect(clientSrc).not.toMatch(/\[redacted\]|un-?redact|reveal|decrypt/i);
  });

  it('the page is self-contained + air-gap-safe: no external CDN/webfont/script src', () => {
    const page = renderCockpitPage({ preview: true, organizationId: 'preview' });
    expect(page).not.toMatch(/src=["']https?:|@import|cdn\.|googleapis|unpkg|jsdelivr/);
    expect(page).toMatch(/READ \+ ROUTE ONLY/);          // legible read/route-only nature
    expect(page).toMatch(/PREVIEW MODE/);                // honest preview labeling
    expect(page).toMatch(/viewBox="0 0 64 64"/);         // the EC monogram (mandatory crossbar) is present
  });
});

describe('Operator Cockpit UI — the local server serves the page + forwards /api to the surface only', () => {
  it('GET / serves the cockpit page (html); /api/* forwards VERBATIM to the surface dispatcher', async () => {
    const { surface, calls } = mockSurface({ 'GET /api/machine/status': { ok: true, status: { status: 'FACTORY COMPLETE', testCount: 943 } } });
    const s = new CockpitUiServer(surface, { preview: true });
    const page = await s.handle({ method: 'GET', path: '/' });
    expect(page.contentType).toMatch(/text\/html/);
    expect(page.body).toMatch(/Operator Cockpit/);
    const api = await s.handle({ method: 'GET', path: '/api/machine/status' });
    expect(JSON.parse(api.body).status.testCount).toBe(943);
    expect(calls).toEqual([{ method: 'GET', path: '/api/machine/status', body: undefined }]); // forwarded, unmodified
  });

  it('the UI server source imports NOTHING from any guard/gate/engine — only the page renderer + node:http', () => {
    const strip = serverSrc.split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
    for (const forbidden of ['approval-gate', 'mcp-bridge', 'external-gateways', 'kill-switch', 'operator-cockpit/operator-cockpit', 'runExternalAction', 'mintExternalCapability']) {
      expect(strip.includes(forbidden)).toBe(false);
    }
    const runtimeImports = strip.split('\n').filter((l) => /^import /.test(l) && !/^import type/.test(l));
    // only node:http (transport) + the page renderer (presentation) are runtime imports.
    expect(runtimeImports.length).toBe(2);
    expect(runtimeImports.some((l) => /node:http/.test(l))).toBe(true);
    expect(runtimeImports.some((l) => /cockpit-ui\.js/.test(l))).toBe(true);
  });
});
