// Operator Cockpit UI server — the local transport that SERVES the cockpit page and forwards its API calls to the
// read-surface layer. PURE GLASS: it serves inert HTML and, for `/api/*`, calls ONLY the injected surface-layer
// dispatcher (`SurfaceDispatcher.route`). It holds NO guard / gate-mint / gauntlet / external-adapter / engine
// reference — the surface layer is the only thing it can reach, and that layer can only READ + ROUTE. Loopback-only.

import { createServer, type Server } from 'node:http';
import { renderCockpitPage, type RenderOptions } from './cockpit-ui.js';

/** The read-surface layer's public dispatcher — the ONLY backend seam the UI server touches (the OperatorCockpit). */
export interface SurfaceDispatcher {
  route(req: { method: string; path: string; query?: Record<string, string>; body?: Record<string, unknown> }): Promise<{ status: number; contentType: string; body: string }>;
}

export interface CockpitUiServerOptions extends RenderOptions {
  /** injectable page renderer (defaults to the real one) — kept for deterministic tests. */
  render?: (opts: RenderOptions) => string;
}

/**
 * Serves the cockpit UI + proxies `/api/*` to the surface layer. The API dispatch is a VERBATIM forward to
 * `surface.route(...)` — the UI server neither approves, mints, executes, nor interprets; it cannot (it holds only
 * the surface dispatcher). Every consequential move is executed by the governed backend via the gate, never here.
 */
export class CockpitUiServer {
  private readonly render: (opts: RenderOptions) => string;
  constructor(private readonly surface: SurfaceDispatcher, private readonly opts: CockpitUiServerOptions = {}) {
    this.render = opts.render ?? renderCockpitPage;
  }

  /** Pure request handler (no sockets) — GET '/' serves the page; '/api/*' forwards to the surface dispatcher. */
  async handle(req: { method: string; path: string; query?: Record<string, string>; body?: Record<string, unknown> }): Promise<{ status: number; contentType: string; body: string }> {
    if (req.method === 'GET' && (req.path === '/' || req.path === '/index.html')) {
      return { status: 200, contentType: 'text/html; charset=utf-8', body: this.render({ preview: this.opts.preview, organizationId: this.opts.organizationId }) };
    }
    if (req.path.startsWith('/api/')) {
      // VERBATIM forward to the read-surface layer — the ONLY backend the UI server can reach.
      return this.surface.route(req);
    }
    return { status: 404, contentType: 'application/json', body: JSON.stringify({ ok: false, error: `no route ${req.method} ${req.path}` }) };
  }

  /** Thin loopback transport (operator-facing, never off-machine). */
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
        const out = await this.handle({ method: reqMsg.method ?? 'GET', path: url.pathname, query, body });
        res.writeHead(out.status, { 'content-type': out.contentType });
        res.end(out.body);
      })(); });
    });
    server.listen(port, '127.0.0.1'); // LOOPBACK-ONLY — operator app, never exposed off-machine.
    return server;
  }
}
