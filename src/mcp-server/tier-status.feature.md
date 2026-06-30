# Feature — Tier-Status Health Check (`/healthz`)

**Path:** `src/mcp-server/tier-status.ts` · **Phase:** 9.2 (deployment track) · **OPEN_ITEM:** #10 · **Status:** **built & tested**
**Run:** `npm run mcp:healthz` (prints the report JSON) · also a `health` JSON-RPC method on the MCP server.

## Purpose
An operational, READ-ONLY reporter that makes each MCP tier's **backing** explicit (live / fake / disabled / not-wired), so an operator can never mistake a fake response for a live one (OPEN_ITEM #10).

## The core — status derived from the real injection, not a label
`deriveBacking(injected, liveClasses)` reports a tier `live` **only if** the injected port is an `instanceof` that tier's known live adapter class (`LiveFactoryReadPorts` for READ_ONLY, `LiveWriteStores` for internal-write). A plain-object/closure fake — or any object carrying a forged `backing: 'live'` label — is **not** an instance of the live class and is therefore reported `fake`. `undefined` ⇒ `not-wired`. Draft and external have **no** live adapter class yet, so any injected backing for them is reported `fake` — they can never be reported `live` until a real adapter class exists. **A fake can never be reported as live.**

## What it reports
Per tier: READ_ONLY · DRAFT_ONLY · internal-write · external (live/fake/disabled/not-wired) · FORBIDDEN (registered-and-refused). Plus: tool counts per tier; DB reachability (boolean from a read-only `SELECT 1`, or `unknown` with no probe); core-table count present (proxy for migrations applied) vs expected; DB role **names** in use (`ece_app` / `ece_writer`); Claude Code registration as `unknown/external` (not introspectable from the process — reported honestly); `persistenceKnown: false` (throwaway vs persistent can't be introspected).

## Observational — no side effects, no new authority, no secrets
The reporter performs no writes, consumes no token, calls no external system, changes no state. The DB probe is read-only (`SELECT 1` + an `information_schema` count). The output contains **only** role names, booleans, counts, and backings — **never** connection strings, passwords, principal-email values, or any secret. Exposed as a server-local `health` method (not a registered tool — not a side-channel; returns only tier-status).

## Boundary
Lives at the **composition root** (`src/mcp-server/`), where live-vs-fake is wired — so it legitimately inspects concrete injections. It does not pollute the engines and adds no guard logic.

## Tests
Pure-logic: fakes ⇒ `draft: fake`/`external: fake`; live adapters ⇒ `read_only: live`/`internal_write: live`; a fake in the read slot ⇒ `fake` (cannot claim live); a forged label ⇒ `fake`; unwired ⇒ `not-wired`; FORBIDDEN reported; no-probe ⇒ no I/O + `unknown`; a failing probe ⇒ `reachable: false` (never assumed live); **no secrets** in the serialized output. Real PostgreSQL: the probe reports `reachable: true` + all 12 core tables + role names with no writes; `buildServer().tierStatus()` and the `health` method report live reads/writes + fake draft/external and write nothing.

## Status
**Built & tested (Phase 9.2).** Full accumulated suite green vs real PostgreSQL 16.14. **OPEN_ITEM #10 addressed.**

## Open Items
- The actual Claude Code registration + whether the DB is persistent are external to the process — reported honestly as `unknown/external` and `persistenceKnown: false`. A deployment health wrapper can combine this report with `claude mcp get` output.
