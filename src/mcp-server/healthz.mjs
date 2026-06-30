// `npm run mcp:healthz` — print the MCP tier-status report (live/fake/disabled per tier; no secrets), then exit.
import { registerHooks } from 'node:module';
import { resolve, load } from './ts-load.mjs';
registerHooks({ resolve, load });
const { printHealth } = await import('./server.ts');
await printHealth().catch((e) => { process.stderr.write(`[ece-factory healthz] error: ${e?.message ?? e}\n`); process.exit(1); });
