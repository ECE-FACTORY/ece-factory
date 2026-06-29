# Feature — MCP Server Entrypoint + READ_ONLY Live Wiring

**Path:** `src/mcp-server/` · **Phase:** 9.0 (Wave 5) · **Status:** **built & unit-tested** (connection = human's manual step)
**Governs:** `REQUIREMENT_MCP_SERVER_CONNECTION.md` + Layer A. **Run:** `npm run mcp:server` (Node v26 runs TS natively).

## Purpose
A runnable MCP server that connects Claude Code (and any MCP client) to the proven four-tier governed door. This phase makes **only the READ_ONLY tier live**; write/external/FORBIDDEN tiers stay on injected fakes.

## Design
- **`server.ts`** — a **dependency-free** MCP server over **stdio (JSON-RPC 2.0, newline-delimited)** — the standard Claude Code transport. No new dependency (no third-party SDK), which also suits the sovereign/air-gap posture. Handles `initialize`, `tools/list`, `tools/call`. Config comes from the **environment** at runtime (DB, principal, org) — **no credentials are committed**.
- **`server-core.ts`** — `McpServerCore`: a **pure transport adapter**. It lists the classified surface and routes each call to the correct bridge method **by class**. It adds **NO guard logic** — every call flows through the bridge's proven Registry → dispatch-by-class → Permission → Kill Switch → write-ahead Audit → Redaction stack. The core decides which method, never whether.
- **`live-read-adapters.ts`** — `LiveFactoryReadPorts`: read-only adapters over **live** sources (real risk/domain/project stores, the real audit sink, the real tool registry, real governance docs). No write path.

## What's live vs fake (current)
- **LIVE — READ_ONLY (Phase 9.0):** `search_clients` + the 15 factory/governance reads point at real stores; each flows the full guard stack (registered, permissioned, audited, redacted).
- **LIVE — internal-write (Phase 9.1):** the 6 internal-write tools land in **real append-only stores** (`review_log_entries`, `open_items`, `risk_register`) via `LiveWriteStores` behind the existing `WriteStores` ports. **The Phase 8.3 token gate is unchanged** — a live write executes only with a single-use, per-action-bound, human-approved, unforgeable `ConsumedApproval`; no token ⇒ STOP, nothing written. No new guard logic; the adapters are thin INSERT-only stores.
- **FAKE:** the DRAFT + external tiers remain on injected fakes (no live external action); FORBIDDEN registered-and-refused.
- **DB roles (minimally scoped):** the READ_ONLY tier uses `ece_app` (SELECT-only on the system of record — unchanged). The internal-write tier uses `ece_writer` with **INSERT (+SELECT) on exactly the 3 target tables and nothing else** — no UPDATE/DELETE/TRUNCATE (append-only at the privilege layer too), no access to `clients` or any external system. Append-only is also enforced by guard triggers (migration 0008). The audit role writes audit; `ece_writer` never touches it.

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
