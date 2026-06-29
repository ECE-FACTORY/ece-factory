// Runnable launcher for the MCP server (`npm run mcp:server`). Registers the dependency-free TypeScript
// loader (transpiles .ts via the bundled `typescript` devDependency, maps .js→.ts), then starts the server.
import { registerHooks } from 'node:module';
import { resolve, load } from './ts-load.mjs';
registerHooks({ resolve, load });
const { main } = await import('./server.ts');
await main().catch((e) => { process.stderr.write(`[ece-factory mcp] fatal: ${e?.message ?? e}\n`); process.exit(1); });
