// Operator Cockpit UI — the internal operator app (glass over the machine). PRESENTATION + a data layer that calls
// ONLY the read-surface layer's endpoints. INTERNAL factory operator infrastructure, NOT a product/client UI.
//
// PURE GLASS (the binding boundary, embodied here):
//   • the client data layer (COCKPIT_CLIENT_JS) fetches ONLY the six surface-layer endpoints (SURFACE_ENDPOINTS).
//     It holds NO direct reference to any guard / gate-mint / gauntlet / external-adapter / engine, and NO client
//     action path — the ONLY mutating control ("Route to gate") POSTs to the single route endpoint, which merely
//     enqueues to the EXISTING gate (that still requires real human authority). The UI cannot approve/mint/execute.
//   • HONEST STATE — it renders exactly what the reads return (refused / awaiting / cleared as they truly are); it
//     never fabricates a success. Responses are already redacted by the surface layer; the UI renders text as-is and
//     never un-redacts.
//   • ECE-LOCKED DESIGN — the shared monochrome palette + EC monogram (mandatory crossbar); fact(structural) vs
//     opinion(judgment) vs gate-state are the only semantic accents. Air-gap-safe: no CDN, no webfont, no external
//     reference. Self-contained inert strings — no logic runs at import; the page script runs in the browser only.
//
// This module is inlined-strings only. It imports NOTHING at runtime (no engine/guard/gate) — source-scan clean.

/** The EXACT set of surface-layer endpoints the UI may call. The client fetches ONLY these (source-scan enforced). */
export const SURFACE_ENDPOINTS = {
  machine: '/api/machine/status',
  pending: '/api/console/pending',
  delivery: '/api/delivery/latest',
  venture: '/api/venture/blueprint',
  audit: '/api/audit/verify',
  route: '/api/route',
} as const;

/** The single plan-only status literal the venture blueprint carries — surfaced so the operator sees it is inert. */
export const PLAN_ONLY_STATUS = 'VENTURE-BLUEPRINT-AWAITING-HUMAN-APPROVAL';

// EC monogram (mandatory crossbar) — inlined so the UI is self-contained (no import at runtime).
const EC_MONOGRAM = `<svg class="ec-mark" viewBox="0 0 64 64" width="34" height="34" role="img" aria-label="ECE" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="square"><path d="M29 15H15v34h14"/><path d="M15 32h28"/><path d="M56 22a16 16 0 1 0 0 20"/></svg>`;

const COCKPIT_STYLE = `
:root{
  --ink:#1b1a17;--paper:#f6f4ef;--panel:#fffefb;--line:#dcd8cf;--hair:#e7e3da;
  --muted:#6c675d;--faint:#928c80;--accent:#7a2018;--ok:#233b28;--fact:#233b28;--opinion:#4a3f6b;
  --sans:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;
  --serif:Georgia,'Times New Roman',Times,serif;
}
*{box-sizing:border-box}html,body{margin:0}
body{background:var(--paper);color:var(--ink);font:15px/1.55 var(--sans);-webkit-font-smoothing:antialiased}
.ec-shell{max-width:60rem;margin:0 auto;padding:2.2rem 1.6rem 4rem}
.ec-header{display:flex;justify-content:space-between;align-items:flex-start;gap:1.4rem;padding-bottom:1.1rem;border-bottom:1px solid var(--ink)}
.ec-brand{display:flex;gap:.9rem;align-items:center}.ec-mark{color:var(--ink);flex:none}
.ec-title{font:600 1.42rem/1.1 var(--serif);letter-spacing:.01em}
.ec-register{margin-top:.24rem;font:italic .84rem/1.4 var(--serif);color:var(--muted);max-width:30rem}
.ec-glass{text-align:right;font-size:.72rem;color:var(--faint);text-transform:uppercase;letter-spacing:.09em}
.ec-glass b{display:block;color:var(--muted);font-size:.82rem;letter-spacing:.04em}
.ec-preview{margin:1rem 0 0;padding:.55rem .85rem;background:#fbf6ea;border:1px solid #e6d9b8;border-radius:3px;font-size:.8rem;color:#6b5a2a}
.ec-grid{margin-top:1.5rem;display:flex;flex-direction:column;gap:1.6rem}
.ec-panel{background:var(--panel);border:1px solid var(--line);border-radius:3px;padding:1.15rem 1.25rem}
.ec-panel-head{display:flex;justify-content:space-between;align-items:baseline;gap:1rem;padding-bottom:.6rem;margin-bottom:.75rem;border-bottom:1px solid var(--hair)}
.ec-h{font:600 1.02rem/1.2 var(--serif);letter-spacing:.01em}
.ec-note{color:var(--faint);font-size:.7rem;text-transform:uppercase;letter-spacing:.08em}
.ec-kv{display:grid;grid-template-columns:auto 1fr;gap:.24rem 1.1rem;margin:0}
.ec-kv dt{color:var(--faint);text-transform:uppercase;letter-spacing:.07em;font-size:.64rem;padding-top:.14rem}
.ec-kv dd{margin:0;font-size:.88rem;word-break:break-word}
.ec-empty{padding:1.6rem 1rem;text-align:center;color:var(--muted);border:1px dashed var(--line);border-radius:3px;font:italic .95rem/1.5 var(--serif)}
.ec-card{background:#fff;border:1px solid var(--line);border-left:3px solid var(--ink);border-radius:3px;padding:.9rem 1rem;margin-bottom:.8rem}
.ec-card-head{display:flex;justify-content:space-between;align-items:baseline;gap:.8rem}
.ec-tool{font:600 1rem/1.2 var(--serif)}
.ec-tier{color:var(--muted);font-size:.68rem;text-transform:uppercase;letter-spacing:.07em}
.ec-state{display:inline-block;font:700 .66rem/1 var(--sans);text-transform:uppercase;letter-spacing:.06em;padding:.2rem .45rem;border-radius:2px;border:1px solid var(--muted);color:var(--muted)}
.ec-state.awaiting{color:#6b5a2a;border-color:#c9b48a}
.ec-state.cleared{color:var(--ok);border-color:var(--ok)}
.ec-state.refused{color:var(--accent);border-color:var(--accent)}
.ec-gatemark{margin-top:.5rem;font-size:.72rem;color:var(--faint);font-style:italic}
.ec-btn{font:600 .78rem/1 var(--sans);letter-spacing:.03em;padding:.5rem .9rem;border:1px solid var(--ink);border-radius:2px;background:var(--ink);color:var(--paper);cursor:pointer}
.ec-btn:hover{opacity:.9}.ec-btn[disabled]{cursor:not-allowed;opacity:.4;border-style:dashed;background:transparent;color:var(--muted)}
.ec-route{margin-top:.7rem}
.ec-field{font:inherit;padding:.5rem .6rem;border:1px solid var(--line);border-radius:2px;background:#fff;color:var(--ink);width:100%}
.ec-field:focus{outline:none;border-color:var(--ink)}
.ec-two{display:grid;grid-template-columns:1fr 1fr;gap:1rem}
.ec-col-fact{border-top:2px solid var(--fact)}.ec-col-op{border-top:2px solid var(--opinion)}
.ec-col h4{margin:.5rem 0 .4rem;font:700 .7rem/1 var(--sans);text-transform:uppercase;letter-spacing:.08em}
.ec-col-fact h4{color:var(--fact)}.ec-col-op h4{color:var(--opinion)}
.ec-item{font-size:.82rem;padding:.35rem 0;border-bottom:1px dotted var(--hair)}
.ec-cite{color:var(--muted);font-size:.72rem}
.ec-flag{display:inline-block;font-size:.64rem;color:var(--accent);border:1px solid var(--accent);border-radius:2px;padding:0 .3rem;margin-left:.3rem;text-transform:uppercase;letter-spacing:.05em}
.ec-status-lit{margin-top:.8rem;font:600 .8rem/1.3 var(--sans);color:var(--ink);background:#f2efe7;border:1px solid var(--hair);border-radius:2px;padding:.5rem .65rem}
.ec-unrep{margin-top:.4rem;font-size:.72rem;color:var(--faint)}
.ec-chain{font:600 .8rem/1 var(--sans)}
.ec-chain.ok{color:var(--ok)}.ec-chain.broken{color:var(--accent)}
.ec-msg{min-height:1.1rem;font-size:.8rem;color:var(--muted);margin-top:.5rem}
.ec-mono{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:.76rem}
@media(max-width:44rem){.ec-two{grid-template-columns:1fr}.ec-header{flex-direction:column}.ec-glass{text-align:left}}
`;

/**
 * The client data layer + view. Runs in the BROWSER only. It fetches ONLY the six surface-layer endpoints and posts
 * the route intent ONLY to the route endpoint. There is NO other network call and NO action path: it cannot approve,
 * mint, execute, mutate, or deploy — the surface layer is the only thing it can reach, and it can only READ + ROUTE.
 */
export const COCKPIT_CLIENT_JS = `
"use strict";
// The ONLY endpoints this UI may touch — the read-surface layer. No guard/gate/engine is reachable from the client.
const API = ${JSON.stringify(SURFACE_ENDPOINTS)};
const PLAN_ONLY = ${JSON.stringify(PLAN_ONLY_STATUS)};
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
async function readJSON(url){ const r = await fetch(url, { headers:{ 'accept':'application/json' } }); try { return await r.json(); } catch { return { ok:false, error:'bad response' }; } }

// ── READ: machine completion status ──
async function loadMachine(){
  const d = await readJSON(API.machine); const s = (d && d.status) || {};
  $('machine').innerHTML = '<dl class="ec-kv">' +
    kv('Status', s.status) + kv('Waves done', s.wavesDone) + kv('Capabilities', s.capabilities) +
    kv('VI phases', s.viPhases) + kv('Tests green', s.testCount) + '</dl>';
}
// ── READ: Decision Console pending queue (+ route-to-gate control per item) ──
async function loadPending(){
  const d = await readJSON(API.pending); const items = (d && d.items) || [];
  if(!items.length){ $('pending').innerHTML = '<div class="ec-empty">Queue empty — nothing awaiting human authority.</div>'; return; }
  $('pending').innerHTML = items.map(function(it){
    const state = honestState(it.status);
    return '<div class="ec-card"><div class="ec-card-head"><span class="ec-tool">'+esc(it.tool)+'</span>'+
      '<span class="ec-state '+state.cls+'">'+esc(state.label)+'</span></div>'+
      '<dl class="ec-kv">'+kv('Target', it.target)+kv('Gateway / tier', it.tier)+
      kv('Sole authority', it.proposingCaller)+kv('Blast radius', it.blastRadius)+kv('Reversibility', it.reversibility)+'</dl>'+
      '<div class="ec-gatemark">This control ROUTES to the gate; it never approves or executes — a human decides at the gate.</div>'+
      '<div class="ec-route"><button class="ec-btn" data-route="'+esc(it.tool)+'" data-target="'+esc(it.target||'')+'">Route to gate</button></div>'+
      '</div>';
  }).join('');
  Array.prototype.forEach.call(document.querySelectorAll('[data-route]'), function(b){
    b.addEventListener('click', function(){ routeToGate(b.getAttribute('data-route'), b.getAttribute('data-target')); });
  });
}
// honest gate-state from REAL status — never fabricated.
function honestState(status){
  const s = String(status||'').toLowerCase();
  if(s.indexOf('refuse')>=0 || s.indexOf('reject')>=0) return { cls:'refused', label:'refused' };
  if(s.indexOf('approve')>=0 || s.indexOf('clear')>=0 || s.indexOf('commit')>=0) return { cls:'cleared', label:'gate-cleared' };
  return { cls:'awaiting', label:'awaiting human' };
}
// ── ROUTE (the ONLY mutating control): enqueue to the existing gate via the single route endpoint. ──
async function routeToGate(tool, target){
  $('routeMsg').textContent = 'Routing "'+tool+'" to the gate…';
  const r = await fetch(API.route, { method:'POST', headers:{ 'content-type':'application/json' }, body: JSON.stringify({ tool: tool, target: target }) });
  const d = await r.json().catch(function(){ return { ok:false }; });
  const o = (d && d.outcome) || {};
  // HONEST: report exactly what the gate said — STOP/awaiting, refused — never a fake success.
  if(o.status === 'STOP_FOR_APPROVAL'){ $('routeMsg').textContent = 'Enqueued — now AWAITING a human at the gate (pending '+esc(o.pendingActionId||'?')+'). The UI did not approve or execute.'; }
  else { $('routeMsg').textContent = 'Gate did not enqueue: '+esc(o.status || 'refused')+(o.reason?(' — '+esc(o.reason)):''); }
  loadPending();
}
// ── READ: delivery chain (Observer → Preview → Package → Release) ──
async function loadDelivery(){
  const d = await readJSON(API.delivery);
  const row = function(name, rec){
    if(!rec) return '<div class="ec-item"><b>'+name+'</b> — <span class="ec-cite">no record yet (honest: nothing observed)</span></div>';
    const bits=[]; if(rec.status!=null)bits.push('status='+esc(rec.status)); if(rec.version!=null)bits.push('v'+esc(rec.version));
    if(rec.built!=null)bits.push('built='+esc(rec.built)); if(rec.verified!=null)bits.push('verified='+esc(rec.verified));
    if(rec.compliant!=null)bits.push('compliant='+esc(rec.compliant));
    const arts=(rec.artifacts||rec.checksums||[]).map(function(a){ return '<div class="ec-cite ec-mono">'+esc(a.path)+' · sha256:'+esc(String(a.sha256||'').slice(0,16))+'…</div>'; }).join('');
    return '<div class="ec-item"><b>'+name+'</b> — '+esc(bits.join(' · '))+arts+'</div>';
  };
  $('delivery').innerHTML = row('Observer', d.observation)+row('Preview', d.preview)+row('Package', d.package)+row('Release', d.release);
}
// ── READ: create-a-venture → render the INERT blueprint (fact/opinion separated) ──
async function loadVenture(){
  const concept = $('concept').value || '';
  $('ventureMsg').textContent = 'Composing an ADVISORY blueprint (inert — executes nothing)…';
  const d = await readJSON(API.venture + '?concept=' + encodeURIComponent(concept));
  const bp = (d && d.blueprint) || {};
  const know = (bp.whatWeKnow||[]), believe = (bp.whatWeBelieve||[]);
  const factCol = know.map(function(x){ return '<div class="ec-item">'+esc(x.engine)+' <span class="ec-note">advisory:false</span>'+cites(x.groundedOn)+'</div>'; }).join('') || '<div class="ec-cite">—</div>';
  const opCol = believe.map(function(x){ return '<div class="ec-item">'+esc(x.engine)+' <span class="ec-note">advisory:true</span>'+cites(x.groundedOn)+extFlag(x)+'</div>'; }).join('') || '<div class="ec-cite">—</div>';
  $('venture').innerHTML =
    '<div class="ec-two"><div class="ec-col ec-col-fact"><h4>What we KNOW · structural fact</h4>'+factCol+'</div>'+
    '<div class="ec-col ec-col-op"><h4>What we BELIEVE · advisory judgment</h4>'+opCol+'</div></div>'+
    '<div class="ec-status-lit">status: '+esc(bp.status || PLAN_ONLY)+'</div>'+
    '<div class="ec-unrep">APPROVED · CREATED · EXECUTED · DEPLOYED are NOT representable — this artifact is a plan awaiting a human. routesNothing='+esc(bp.routesNothing)+'</div>';
  $('ventureMsg').textContent = '';
}
function cites(g){ if(!g||!g.length) return ''; return '<div class="ec-cite">cites: '+g.map(function(f){return esc(f.ref);}).join(', ')+'</div>'; }
function extFlag(x){ return (x.externalNote||x.external) ? '<span class="ec-flag">external data flagged</span>' : ''; }
// ── READ: audit / verifyChain ──
async function loadAudit(){
  const d = await readJSON(API.audit + '?org=' + encodeURIComponent(window.__ECE_ORG__ || ''));
  const v = (d && d.verify) || {}; const recent = (d && d.recent) || [];
  const cls = v.ok ? 'ok' : 'broken';
  $('audit').innerHTML = '<div class="ec-chain '+cls+'">hash-chain verifyChain: '+(v.ok?'OK':'BROKEN')+' ('+esc(v.checked)+' entries checked)</div>'+
    '<dl class="ec-kv" style="margin-top:.6rem">'+recent.slice(0,6).map(function(r){ return '<dt>seq '+esc(r.seq)+'</dt><dd class="ec-mono">'+esc(r.kind)+' · '+esc(String(r.entry_hash||'').slice(0,16))+'…</dd>'; }).join('')+'</dl>';
}
function kv(k,v){ return v==null||v===''?'':'<dt>'+esc(k)+'</dt><dd>'+esc(v)+'</dd>'; }

function refreshAll(){ loadMachine(); loadPending(); loadDelivery(); loadAudit(); }
document.addEventListener('DOMContentLoaded', function(){
  refreshAll();
  $('composeBtn').addEventListener('click', loadVenture);
  $('refreshBtn').addEventListener('click', refreshAll);
});
`;

export interface RenderOptions {
  /** true ⇒ show the PREVIEW banner (sample state, not live). Honest labeling of local-preview mode. */
  preview?: boolean;
  /** the org used by the audit read (inert). */
  organizationId?: string;
}

/** Render the full, self-contained cockpit page. Inert HTML — the data layer runs only in the browser. */
export function renderCockpitPage(opts: RenderOptions = {}): string {
  const previewBanner = opts.preview
    ? `<div class="ec-preview"><b>PREVIEW MODE</b> — showing sample state from an in-memory wiring, not the live factory. Point the cockpit server at the live surface layer for real state.</div>`
    : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ECE Operator Cockpit</title><style>${COCKPIT_STYLE}</style></head><body>
<div class="ec-shell">
  <header class="ec-header">
    <div class="ec-brand">${EC_MONOGRAM}<div><div class="ec-title">Operator Cockpit</div>
      <div class="ec-register">Glass over the machine. This instrument READS the factory and ROUTES intent to the gate — it never approves, mints, or executes.</div></div></div>
    <div class="ec-glass"><b>READ + ROUTE ONLY</b>no action path · gate holds authority</div>
  </header>
  ${previewBanner}
  <div class="ec-grid">
    <section class="ec-panel"><div class="ec-panel-head"><span class="ec-h">Machine completion</span><span class="ec-note">machine-status read</span></div><div id="machine"></div></section>
    <section class="ec-panel"><div class="ec-panel-head"><span class="ec-h">Decision Console — pending human authority</span><span class="ec-note">console read · route-only</span></div><div id="pending"></div><div id="routeMsg" class="ec-msg"></div></section>
    <section class="ec-panel"><div class="ec-panel-head"><span class="ec-h">Delivery chain</span><span class="ec-note">observer→preview→package→release</span></div><div id="delivery"></div></section>
    <section class="ec-panel"><div class="ec-panel-head"><span class="ec-h">Create a venture — advisory blueprint</span><span class="ec-note">inert data · never instruction</span></div>
      <input id="concept" class="ec-field" placeholder="A concept (inert data — describes; never an instruction to act)…" value="a sovereign audit API platform">
      <div class="ec-route"><button id="composeBtn" class="ec-btn">Compose advisory blueprint</button></div>
      <div id="ventureMsg" class="ec-msg"></div><div id="venture" style="margin-top:.8rem"></div></section>
    <section class="ec-panel"><div class="ec-panel-head"><span class="ec-h">Audit — hash chain</span><span class="ec-note">verifyChain · redacted</span></div><div id="audit"></div></section>
    <div style="margin-top:.4rem"><button id="refreshBtn" class="ec-btn">Refresh reads</button></div>
  </div>
</div>
<script>window.__ECE_ORG__=${JSON.stringify(opts.organizationId ?? '')};</script>
<script>${COCKPIT_CLIENT_JS}</script>
</body></html>`;
}
