# ECE Factory Local Deployment Runbook — Persistent DB + Claude MCP Registration

> **Run this on YOUR Mac.** It is copy-paste-ready. It changes no factory code — it provisions a persistent
> PostgreSQL, applies the migrations, creates the least-privilege roles, verifies tier status, registers the
> MCP server with Claude Code, and verifies the safe live tiers.
> **Honesty:** commands below were derived from the actual repo (`package.json` scripts, `infra/migrations/`,
> `src/mcp-server/server.ts`). Where a thing genuinely can't be scripted from the repo, it is marked **TODO**.

---

## 1. What this runbook does

Converts the factory from **built & tested** → **running locally through Claude Code MCP**, and verifies the safe live tiers:

- **READ_ONLY = live** (real stores, SELECT-only role)
- **internal-write = live behind a single-use human token** (append-only, INSERT-only role)
- **draft = fake-backed** · **external = fake-backed** · **FORBIDDEN = refused**

It does **not** enable any live external action (GitHub/email/CRM/deploy stay on fakes — separately gated).

---

## 2. Prerequisites

- macOS
- repo cloned locally and on the latest commit:
  ```bash
  cd /path/to/ece-factory
  git pull
  git log -1 --oneline
  ```
- Node + npm available: `node --version` (Node 26+ expected), `npm --version`
- Claude Code CLI available: `claude --version` (and `claude mcp list` works)
- PostgreSQL installed or installable (Homebrew below)
- **No secrets committed** to the repo (env-only; never commit passwords)

---

## 3. Install / start persistent PostgreSQL (Homebrew)

```bash
# install (version may differ — postgresql@16 recommended; plain 'postgresql' also fine)
brew install postgresql@16        # or: brew install postgresql

# start it as a persistent background service (NOT a throwaway cluster)
brew services start postgresql@16 # or: brew services start postgresql

# confirm it is up
pg_isready                        # expect: "accepting connections"
```

**If PostgreSQL is already installed**, check it instead of reinstalling:
```bash
brew services list | grep postgres   # look for 'started'
pg_isready
psql -l                               # lists databases; confirms you can connect as a superuser
```
> On a default Homebrew install your macOS user (`whoami`) is the PostgreSQL **superuser** and local connections use trust auth. The migration commands below assume you can run `psql`/`createdb` as that superuser.

---

## 4. Create the database

Database name: **`ece_audit`** (the server's default `PGDATABASE`).

```bash
createdb ece_audit
# or, equivalently:
# psql -d postgres -c "CREATE DATABASE ece_audit;"
psql -d ece_audit -c "SELECT current_database();"   # expect: ece_audit
```

---

## 5. Apply migrations (and seed)

**There is no `npm run migrate` / `npm run seed` script** — migrations are raw SQL files applied in order, and the roles are created **by the migrations themselves**. Apply all 10 as a superuser:

```bash
cd /path/to/ece-factory
for f in infra/migrations/*.sql; do
  echo ">> applying $f"
  psql -d ece_audit -v ON_ERROR_STOP=1 -f "$f" || { echo "FAILED on $f"; break; }
done
```
Files applied (order matters): `0001_audit_schema … 0010_field_definitions`.

**Seed:** there is **no production seed script**, and none is required — the live stores (audit log, registries, settings, fields) start **empty** and populate through governed tool calls. Empty arrays from a read tool are valid *live* data.
*(Optional, to make `read_risk_register` return a row)* seed one sample risk **as the superuser** (never as `ece_app`/`ece_writer`):
```bash
psql -d ece_audit -c "INSERT INTO risk_register (risk_key, title, type, owner, severity, status) VALUES ('RISK-DEMO','demo','security','ECE','low','open');"
```
> **TODO (if your repo later adds one):** a dedicated migrate/seed npm script. As of this commit, none exists — use the `psql` loop above.

---

## 6. Create / verify least-privilege roles

The roles are **created and granted by the migrations** (`ece_app` in `0001`, `ece_writer` in `0008`). You do not create them by hand. **Verify** their privileges:

```bash
# ece_app must be SELECT-only on the system of record (clients) — NO write verbs
psql -d ece_audit -c "SELECT privilege_type FROM information_schema.role_table_grants WHERE grantee='ece_app' AND table_name='clients';"
# expect: only SELECT (no INSERT/UPDATE/DELETE/TRUNCATE)

# ece_writer must be INSERT,SELECT on the 3 append-only write tables — and nothing else
psql -d ece_audit -c "SELECT table_name, string_agg(privilege_type,',' ORDER BY privilege_type) FROM information_schema.role_table_grants WHERE grantee='ece_writer' AND table_name IN ('review_log_entries','open_items','risk_register') GROUP BY table_name;"
# expect each: INSERT,SELECT  (NO UPDATE/DELETE/TRUNCATE)

# ece_writer must have NO grant on clients (system of record)
psql -d ece_audit -c "SELECT count(*) FROM information_schema.role_table_grants WHERE grantee='ece_writer' AND table_name='clients';"
# expect: 0
```

**Prove the append-only triggers are active** (these should ERROR with "permission denied"/"append-only"):
```bash
# as ece_app: cannot write the system of record
PGUSER=ece_app psql -h localhost -d ece_audit -c "INSERT INTO clients (client_id, organization_id, name) VALUES ('x','y','z');"   # expect: permission denied
# as ece_writer: cannot mutate the append-only write tables
PGUSER=ece_writer psql -h localhost -d ece_audit -c "UPDATE open_items SET target='x';"     # expect: permission denied / append-only
PGUSER=ece_writer psql -h localhost -d ece_audit -c "DELETE FROM review_log_entries;"        # expect: permission denied / append-only
```
> **Do NOT weaken any privilege to make a command "work".** The expected outcome of the three commands above is **denial** — that is the guarantee.

**Login note (TCP):** `npm run mcp:healthz` / `mcp:server` connect over `host=localhost` (TCP). The migration-created roles have `LOGIN` but no password. For TCP scram auth, give them a **dev-local password** (never committed) and provide it via `PGPASSWORD`/`~/.pgpass`:
```bash
psql -d ece_audit -c "ALTER ROLE ece_app   PASSWORD '<dev-local-pw-app>';"
psql -d ece_audit -c "ALTER ROLE ece_writer PASSWORD '<dev-local-pw-writer>';"
# then put them in ~/.pgpass (chmod 600), lines:  localhost:5432:ece_audit:ece_app:<pw>   /  ...:ece_writer:<pw>
```
> Dev alternative (less secure, local only): add `host ece_audit ece_app,ece_writer 127.0.0.1/32 trust` to `pg_hba.conf` and `brew services restart postgresql@16`. Prefer the password + `~/.pgpass` approach.

---

## 7. Environment variables

Create a local, **uncommitted** env (e.g. `~/.ece-factory.env` or shell exports). **No real secrets in the repo.**

```bash
export PGHOST=localhost
export PGPORT=5432
export PGDATABASE=ece_audit
export ECE_DB_USER=ece_app          # SELECT-only read role
export ECE_WRITE_DB_USER=ece_writer # INSERT-append-only write role
export ECE_PRINCIPAL_USER_ID=<your-human-id-not-claude>
export ECE_PRINCIPAL_EMAIL=<your-email>
export ECE_PRINCIPAL_ROLE=operator
export ECE_ORG=<your-org>
# DB password (if you set one in §6): export PGPASSWORD=<dev-local-pw>   — OR use ~/.pgpass (preferred). Never commit.
```
> ⚠️ **`ECE_PRINCIPAL_USER_ID` must NOT be `claude`.** The server refuses an empty or `claude` principal by design (attribution must be a real human). Use your own id.

---

## 8. Run `/healthz`

```bash
npm run mcp:healthz
```
**Expected** (JSON to stdout, **no secrets** — only role names / booleans / counts / backings):
```jsonc
{
  "tiers": { "read_only": "live", "draft_only": "fake", "internal_write": "live", "external": "fake", "forbidden": "registered-and-refused" },
  "database": { "reachable": true, "persistenceKnown": false, "coreTablesPresent": 13, "coreTablesExpected": 13 },
  "dbRoles": { "read": "ece_app", "write": "ece_writer" },
  "claudeCodeRegistration": "unknown/external"
}
```
- `database.reachable: true` and `coreTablesPresent == coreTablesExpected` ⇒ DB + migrations OK.
- `read_only: live`, `internal_write: live` ⇒ the safe live tiers are wired.
- `draft_only: fake`, `external: fake` ⇒ correct (those tiers are intentionally fake).
- **If healthz fails:** `reachable:false` ⇒ check §3/§7 (service up? env vars exported in THIS shell? password/pg_hba?). `coreTablesPresent < expected` ⇒ re-run §5. A tier shows `not-wired`/`fake` where you expect `live` ⇒ you're on an old commit or env is misconfigured.

---

## 9. Register the MCP server in Claude Code

```bash
cd /path/to/ece-factory      # cwd MUST be the repo root (the server resolves repo paths relative to it)
claude mcp add ece-factory -- node src/mcp-server/run.mjs
```
> The env vars from §7 must be visible to the process Claude Code launches. If your Claude Code session doesn't inherit your shell env, either start Claude Code from a shell where they're exported, or use your Claude Code MCP env configuration to set them for the `ece-factory` server.

Then confirm:
```bash
claude mcp get ece-factory     # command = node src/mcp-server/run.mjs, cwd = THIS repo, healthy
claude mcp list                # 'ece-factory' present and healthy (not a global/old/third-party server)
```

---

## 10. Verify a live READ_ONLY tool through Claude Code

In a **Claude Code chat session** (in this repo), ask it to call the `ece-factory` MCP tool **`read_factory_status`** (and/or **`read_tool_registry`** — operator-permissioned).
**Expected:**
- real data returned (factory/governance state; possibly small/empty arrays — still real, live data)
- an audit **intent** + **result** pair recorded for the call
- redaction applied (only allowlisted fields)
- **no write** occurred

Confirm the audit rows landed (as superuser):
```bash
psql -d ece_audit -c "SELECT kind, count(*) FROM (SELECT 'intent' kind FROM audit_intent UNION ALL SELECT 'result' FROM audit_result) t GROUP BY kind;"
```

---

## 11. Verify the write gate (negative — no token)

In Claude Code, request **`create_open_item`** (an internal write) **without an approval**.
**Expected:** `STOP_FOR_APPROVAL` (or `refused`), **no row written**, and the refusal path recorded as expected.
Confirm nothing was written:
```bash
psql -d ece_audit -c "SELECT count(*) FROM open_items;"   # unchanged (e.g. still 0)
```

---

## 12. Optional positive internal-write test (only if you explicitly choose)

> **Optional.** Only do this if you want to confirm the *happy path*. It requires minting a **single-use human approval token** for the exact action (the bridge's Approval Gate). The token cannot be `claude`-granted or self-granted.

- Obtain/mint a valid single-use human approval for the specific `create_open_item` action.
- Call `create_open_item` with that approval ⇒ expect `WRITE-COMMITTED`.
- Verify exactly **one** append-only row:
  ```bash
  psql -d ece_audit -c "SELECT count(*) FROM open_items;"   # exactly +1
  ```
- Replay the same token ⇒ expect refused, **no second row**.
- Confirm append-only at the DB layer: `PGUSER=ece_writer psql -h localhost -d ece_audit -c "DELETE FROM open_items;"` ⇒ denied.

---

## 13. External tier check (must remain fake)

In Claude Code, request an external action — e.g. **`open_pull_request`** (or any external tool) **without approval**.
**Expected:** `STOP_FOR_APPROVAL` / `refused`, **no live GitHub call**, **no external credentials used**. The `/healthz` report must still show `external: "fake"`. There must be **no real external side effect** at this stage.

---

## 14. Troubleshooting

| Symptom | Fix |
|---|---|
| PostgreSQL not running | `brew services start postgresql@16`; `pg_isready` |
| DB missing | `createdb ece_audit` (§4) |
| Migrations not applied / `coreTablesPresent` low | re-run the §5 `psql` loop with `ON_ERROR_STOP=1`; read the first failing file |
| Wrong role privileges | re-apply `0001`/`0007`/`0008`; verify with §6 — **do not** hand-grant extra privileges |
| Env vars not visible to Claude MCP | export them in the shell that launches Claude Code, or set them in the MCP server's env config (§7/§9) |
| `ECE_PRINCIPAL_USER_ID=claude` | the server refuses it — set your real human id |
| `claude mcp add` points to wrong cwd | run `claude mcp add` from the repo root; verify `claude mcp get ece-factory` shows the right cwd |
| MCP server unhealthy | run `npm run mcp:server` directly and read stderr; confirm Node 26+, env vars, DB reachable |
| `/healthz` reports `fake`/`not-wired` where you expect `live` | wrong commit (`git pull`), or wiring/env misconfigured |
| Claude CLI unavailable | install/enable the Claude Code CLI; `claude --version`, `claude mcp list` |

---

## 15. Final verification checklist

```
[ ] persistent DB running (brew services; pg_isready)
[ ] migrations applied (0001–0010)
[ ] seed present (optional; empty is valid live data)
[ ] ece_app SELECT-only verified (no write on clients)
[ ] ece_writer append-only verified (INSERT,SELECT only; UPDATE/DELETE denied; none on clients)
[ ] npm run mcp:healthz passes (reachable:true, coreTablesPresent==expected, read_only/internal_write live, draft/external fake)
[ ] claude mcp get ece-factory points to this repo (cwd, command)
[ ] claude mcp list shows ece-factory healthy
[ ] READ_ONLY call returns real data
[ ] audit intent/result recorded
[ ] redaction confirmed
[ ] write without token STOPs/refuses (no row written)
[ ] external remains fake/disabled (no live GitHub call)
```

**On all green:**

> **MCP READ+INTERNAL-WRITE LIVE CONNECTION VERIFIED**
