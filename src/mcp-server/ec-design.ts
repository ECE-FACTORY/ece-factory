// Shared ECE design layer (Wave 6, Piece 4) — PRESENTATION ONLY. Design tokens (palette, type scale, spacing),
// the EC monogram (inline monochrome SVG, mandatory crossbar), and the Console component styles, factored here
// so future factory UIs reuse them. SELF-CONTAINED / AIR-GAP-SAFE: no external CDN, no webfont fetch — a system
// font stack only. These are inert strings inlined into the served page; they contain no logic, no route, no
// network reference. The institutional register: monochromatic, high-contrast, typography-led, unshowy.

/** The EC monogram — E and C joined by the mandatory crossbar. Monochrome (inherits `currentColor`). */
export const EC_MONOGRAM = `<svg class="ec-mark" viewBox="0 0 64 64" width="36" height="36" role="img" aria-label="ECE" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="square"><path d="M29 15H15v34h14"/><path d="M15 32h28"/><path d="M56 22a16 16 0 1 0 0 20"/></svg>`;

/** The Console stylesheet — monochromatic/sovereign register. One restrained accent (oxblood) reserved for the
 *  critical HARD-BLOCKED / refuse state; everything else is ink-on-paper with hierarchy by weight and space. */
export const EC_STYLE = `
:root{
  --ink:#1b1a17; --paper:#f6f4ef; --panel:#fffefb; --line:#dcd8cf; --hair:#e7e3da;
  --muted:#6c675d; --faint:#928c80; --accent:#7a2018; --ok:#233b28;
  --serif:Georgia,'Times New Roman',Times,serif;
  --sans:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;
}
*{box-sizing:border-box}
html,body{margin:0}
body{background:var(--paper);color:var(--ink);font:15px/1.55 var(--sans);-webkit-font-smoothing:antialiased}
.ec-shell{max-width:52rem;margin:0 auto;padding:2.4rem 1.6rem 4rem}
.ec-header{display:flex;justify-content:space-between;align-items:flex-start;gap:1.5rem;padding-bottom:1.3rem;border-bottom:1px solid var(--ink)}
.ec-brand{display:flex;gap:.95rem;align-items:center}
.ec-mark{color:var(--ink);flex:none}
.ec-title{font:600 1.5rem/1.1 var(--serif);letter-spacing:.01em}
.ec-register{margin-top:.28rem;font:italic .86rem/1.4 var(--serif);color:var(--muted);max-width:26rem}
.ec-operator{text-align:right;font-size:.82rem;min-height:2rem}
.ec-op-label{display:block;color:var(--faint);text-transform:uppercase;letter-spacing:.09em;font-size:.66rem}
.ec-op-id{display:block;font-weight:600;font-size:1rem}
.ec-op-role{display:inline-block;margin-top:.15rem;color:var(--muted);border:1px solid var(--line);border-radius:2px;padding:.02rem .4rem;font-size:.7rem;text-transform:uppercase;letter-spacing:.06em}
main{margin-top:1.8rem}
.ec-login{display:flex;flex-wrap:wrap;gap:.6rem;align-items:center;padding:1.1rem 1.2rem;background:var(--panel);border:1px solid var(--line);border-radius:3px}
.ec-field{font:inherit;padding:.5rem .6rem;border:1px solid var(--line);border-radius:2px;background:#fff;color:var(--ink);min-width:11rem}
.ec-field:focus{outline:none;border-color:var(--ink)}
.ec-btn{font:600 .84rem/1 var(--sans);letter-spacing:.03em;padding:.6rem 1.05rem;border:1px solid var(--ink);border-radius:2px;background:var(--ink);color:var(--paper);cursor:pointer}
.ec-btn:hover{opacity:.9}
.ec-btn-refuse{background:transparent;color:var(--ink)}
.ec-btn-approve{background:var(--ink);color:var(--paper)}
.ec-btn[disabled]{cursor:not-allowed;opacity:.4;border-style:dashed;background:transparent;color:var(--muted)}
.ec-msg{margin:1rem 0;min-height:1.2rem;font-size:.85rem;color:var(--muted)}
.ec-queue{margin-top:.4rem;display:flex;flex-direction:column;gap:1.1rem}
.ec-empty{padding:2.4rem 1.4rem;text-align:center;color:var(--muted);border:1px dashed var(--line);border-radius:3px;font:italic 1rem/1.5 var(--serif)}
.ec-card{background:var(--panel);border:1px solid var(--line);border-left:3px solid var(--ink);border-radius:3px;padding:1.2rem 1.3rem}
.ec-card-head{display:flex;justify-content:space-between;align-items:baseline;gap:1rem;padding-bottom:.7rem;border-bottom:1px solid var(--hair)}
.ec-tool{font:600 1.12rem/1.2 var(--serif)}
.ec-tier{color:var(--muted);font-size:.74rem;text-transform:uppercase;letter-spacing:.08em}
.ec-kv{display:grid;grid-template-columns:auto 1fr;gap:.22rem 1.1rem;margin:.85rem 0 0}
.ec-kv dt{color:var(--faint);text-transform:uppercase;letter-spacing:.07em;font-size:.66rem;padding-top:.12rem}
.ec-kv dd{margin:0;font-size:.9rem;word-break:break-word}
.ec-policy{margin-top:1rem;padding:.85rem .95rem;background:#faf8f3;border:1px solid var(--hair);border-radius:3px}
.ec-policy-head{display:flex;flex-wrap:wrap;gap:.5rem;align-items:center;padding-bottom:.6rem;margin-bottom:.55rem;border-bottom:1px dotted var(--line)}
.ec-advisory{color:var(--faint);font-size:.68rem;text-transform:uppercase;letter-spacing:.08em}
.ec-rec{font:600 .9rem/1 var(--sans);letter-spacing:.02em;border:1px solid var(--muted);border-radius:2px;padding:.16rem .5rem}
.ec-hard{font:700 .78rem/1 var(--sans);letter-spacing:.04em;text-transform:uppercase;color:var(--accent);border:1px solid var(--accent);border-radius:2px;padding:.16rem .5rem}
.ec-checks-title{color:var(--faint);text-transform:uppercase;letter-spacing:.09em;font-size:.64rem;margin-bottom:.3rem}
.ec-checks{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:.28rem}
.ec-checks li{display:grid;grid-template-columns:1.1rem 4.5rem 9rem 1fr;gap:.55rem;align-items:baseline;font-size:.82rem}
.ec-tick{font-weight:700}
.ec-check-ok .ec-tick{color:var(--ok)}
.ec-check-no .ec-tick{color:var(--accent)}
.ec-sev{color:var(--muted);text-transform:uppercase;letter-spacing:.05em;font-size:.66rem}
.ec-dim{color:var(--muted)}
.ec-desc{color:var(--ink)}
.ec-actions{margin-top:1.05rem;display:flex;gap:.7rem}
@media(max-width:34rem){.ec-header{flex-direction:column}.ec-operator{text-align:left}.ec-checks li{grid-template-columns:1.1rem 1fr}}
`;
