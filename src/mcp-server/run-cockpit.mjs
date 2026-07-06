// Runnable launcher for the Operator Cockpit UI (`node src/mcp-server/run-cockpit.mjs`). Registers the dependency-free
// TypeScript loader, then serves the cockpit locally in PREVIEW mode (in-memory sample state + the real plan-only
// venture orchestrator) on a loopback port. PURE GLASS: the UI reaches only the read-surface layer's read+route
// endpoints. To serve against the LIVE factory, wire a live OperatorCockpit into factoryCockpitUiServer(...) instead.
import { registerHooks } from 'node:module';
import { resolve, load } from './ts-load.mjs';
registerHooks({ resolve, load });

const { factoryPreviewCockpitUiServer } = await import('./live-cockpit-ui.ts');
const port = Number(process.env.ECE_COCKPIT_PORT ?? 4400);
factoryPreviewCockpitUiServer().listen(port);
process.stderr.write(`[ece-factory cockpit] operator cockpit UI (PREVIEW — sample state) on http://127.0.0.1:${port}/  — READ + ROUTE only; the UI cannot approve/mint/execute.\n`);
