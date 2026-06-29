# Feature — MCP Server Entrypoint + READ_ONLY Live Wiring

**Path:** `src/mcp-server/` · **Phase:** 9.0 (Wave 5) · **Status:** **built & unit-tested** (connection = human's manual step)
**Governs:** `REQUIREMENT_MCP_SERVER_CONNECTION.md` + Layer A. **Run:** `npm run mcp:server` (Node v26 runs TS natively).

## Purpose
A runnable MCP server that connects Claude Code (and any MCP client) to the proven four-tier governed door. This phase makes **only the READ_ONLY tier live**; write/external/FORBIDDEN tiers stay on injected fakes.

## Design
- **`server.ts`** — a **dependency-free** MCP server over **stdio (JSON-RPC 2.0, newline-delimited)** — the standard Claude Code transport. No new dependency (no third-party SDK), which also suits the sovereign/air-gap posture. Handles `initialize`, `tools/list`, `tools/call`. Config comes from the **environment** at runtime (DB, principal, org) — **no credentials are committed**.
- **`server-core.ts`** — `McpServerCore`: a **pure transport adapter**. It lists the classified surface and routes each call to the correct bridge method **by class**. It adds **NO guard logic** — every call flows through the bridge's proven Registry → dispatch-by-class → Permission → Kill Switch → write-ahead Audit → Redaction stack. The core decides which method, never whether.
- **`live-read-adapters.ts`** — `LiveFactoryReadPorts`: read-only adapters over **live** sources (real risk/domain/project stores, the real audit sink, the real tool registry, real governance docs). No write path.

## What's live vs fake (this phase)
- **LIVE:** the READ_ONLY tier — `search_clients` + the 15 factory/governance reads point at real stores. Each live read still flows the **full guard stack** (registered, permissioned, audited, redacted; governance reads audited+redacted+permissioned — no internal exemption).
- **FAKE:** the DRAFT/internal-write/external tiers remain on injected fakes — driving them still STOPs/refuses exactly as proven (no live write, no live external action).
- **DB role:** the server connects as a **SELECT-only** role on the system of record — structurally cannot write it, even though write tools exist (on fakes).

## Tests
- `server-core.test.ts` (pure): exposes exactly the 35 classified tools (4 tiers, no FORBIDDEN/unknown); routes by class to the right bridge method; write/external STOP on fakes; FORBIDDEN/unregistered refused.
- `db-mcp-server.test.ts` (real PostgreSQL): a live `read_risk_register` returns the real seeded risk, audited (intent+result), with non-allowlisted fields redacted out; `read_tool_registry` (permissioned) returns the live tool map; the server role cannot write the system of record (denied at the DB layer); write/external tools STOP on fakes (fakes never reached); `tools/list`/`tools/call` over the JSON-RPC transport.

## Connection (Part 3)
The `claude mcp` CLI is available, but the server points at a **non-persistent test database** in this build — registering it into the user's real config would create an unhealthy entry. So the connection is recorded as the **human's manual step** with exact commands (see the evidence pack), not faked. The entrypoint is proven to speak MCP and serve a live audited read via its own stdio/JSON-RPC path.

## Status
**Built & unit-tested (Phase 9.0).** Full accumulated suite green vs real PostgreSQL 16.14. Connection to Claude Code is the remaining manual action for the human (commands provided).

## Open Items
- Live wiring of the internal-write tier (then external) is a later, **separately-gated** phase.
- A persistent production database + secret-managed credentials + the `claude mcp add` registration are deployment-time actions for the human's machine.
