# Operator Cockpit (UI) — internal factory operator app

**Classification (binding):** INTERNAL factory operator infrastructure — *glass over the machine*. **NOT** a product/client UI, not a sellable product. It is **pure glass**: it may only READ the factory and ROUTE intent to the existing gate; it holds **no action path** and cannot approve, mint, execute, mutate, or deploy.

## What it is

One live view over the whole factory, wired **only** to the read-surface layer's endpoints:

| Panel | Surface endpoint (read) | Shows |
|---|---|---|
| Machine completion | `GET /api/machine/status` | waves / capabilities / VI phases done + test count |
| Decision Console | `GET /api/console/pending` | pending-approval queue: action, gateway/tier, sole-authority, honest gate-state (awaiting / cleared / refused) + a **Route to gate** control |
| Delivery chain | `GET /api/delivery/latest` | latest Observer → Preview → Package → Release records (status / artifacts + sha256 / version / compliance) |
| Create a venture | `GET /api/venture/blueprint?concept=` | the inert `VentureBlueprint`: `whatWeKnow` (advisory:false, cited) separated from `whatWeBelieve` (advisory:true, grounded, external-flagged), carrying the status literal |
| Audit | `GET /api/audit/verify?org=` | `verifyChain` state + recent (redacted) audit summary |

The **only** mutating control — *Route to gate* — POSTs to the single route endpoint `POST /api/route`, which merely **enqueues** to the existing propose/gate path. A real human still decides at the gate. The UI never approves, mints, or executes.

## Run it locally (one command)

```
node src/mcp-server/run-cockpit.mjs
```

Serves the cockpit on **`http://127.0.0.1:4400/`** (loopback-only; override with `ECE_COCKPIT_PORT`). This is **PREVIEW mode** — honestly labeled in the UI — showing in-memory sample state plus the **real** plan-only venture orchestrator over the real Capability Reuse Graph. No database required.

To serve against the **live** factory, wire a live `OperatorCockpit` (the read-surface layer, composed with the real Console queue / delivery / audit / propose backends) into `factoryCockpitUiServer(surface)` in `src/mcp-server/live-cockpit-ui.ts` and start it the same way.

## Pure-glass guarantees (enforced by tests)

- The client data layer fetches **only** the six surface endpoints — no guard / gate-mint / gauntlet / external-adapter / engine reference; no other URL (source-scan).
- The only non-GET call is the single route endpoint; there is **no** client approve/mint/execute/commit/deploy path.
- **Honest state** — refused / awaiting / cleared are rendered from the real status; the UI never fabricates a success.
- **Redaction respected** — the UI renders surface responses as text (escaped) and never un-redacts.
- The UI server forwards `/api/*` **verbatim** to the injected surface dispatcher and touches no backend directly.

## Design

ECE-locked: monochrome palette + the EC monogram (mandatory crossbar, never removed). The only semantic accents are **fact (structural, green)** vs **opinion (judgment, violet)** vs **gate-state** (awaiting / cleared / refused). Air-gap-safe: no CDN, no webfont, no external reference — self-contained inline CSS/JS.

## Current vs missing (honest)

- **Current:** all five live views wired to the surface layer; route-to-gate; local preview run; ECE-locked design; verified rendering.
- **Missing / follow-on:** (1) live-backend wiring is a composition step (documented above), not yet a turnkey command, because it requires the factory's DB + gate wiring; (2) delivery-chain history is limited to the latest record the surface exposes; (3) **Mac-app packaging** — the cockpit is shaped as a self-contained local app so the factory's own **App Packaging Flow (capability #4)** can later package it into a Mac `.app` (the factory packages its own cockpit); not yet packaged.
