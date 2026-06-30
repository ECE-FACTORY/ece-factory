# ECE Factory — Deployment Helper Scripts

Operator tooling for local deployment on your Mac. **These scripts touch no factory engine code, no guard
logic, no MCP bridge, and no migrations** — they apply the existing migrations, set role login passwords, and
verify the result. Plain bash + `psql` + `node` (nothing new installed).

> Full narrative: [`docs/LOCAL_DEPLOYMENT_RUNBOOK.md`](../../docs/LOCAL_DEPLOYMENT_RUNBOOK.md). These scripts
> automate the two fiddly snags it flagged (the migration loop, and the no-password roles) plus the verify.

## Run order

```
1. createdb ece_audit                                  # one-time (see runbook §4)
2. scripts/deploy/apply-migrations.sh                  # applies the 10 migrations in order (creates the roles)
3. scripts/deploy/setup-roles.sh                       # sets LOGIN passwords for ece_app / ece_writer (no grant change)
4. scripts/deploy/verify-deployment.sh                 # grants + /healthz + principal ⇒ one green/red verdict
5. (manual)  claude mcp add ece-factory -- node src/mcp-server/run.mjs   # + claude mcp get/list, + in-session tool call
```

## Env vars each needs

| Script | Reads | Notes |
|---|---|---|
| `apply-migrations.sh` | `PGHOST` `PGPORT` `PGDATABASE`(=`ece_audit`) `PGADMINUSER`(superuser, optional) | connect as a **superuser/owner** (the migrations create roles) — NOT `ece_app`/`ece_writer`. `--check` / `--reapply` flags. |
| `setup-roles.sh` | `ECE_APP_PASSWORD` `ECE_WRITER_PASSWORD` (+ `PG*`, `PGADMINUSER`) | passwords **from env only, never echoed**. `--write-pgpass` appends to `~/.pgpass` (chmod 600) with consent; otherwise prints the lines to add. Changes **no grant**. |
| `verify-deployment.sh` | `PG*` `ECE_DB_USER` `ECE_WRITE_DB_USER` `ECE_PRINCIPAL_USER_ID` `ECE_PRINCIPAL_EMAIL` `ECE_PRINCIPAL_ROLE` `ECE_ORG` | read-only; DB auth for `mcp:healthz` via `~/.pgpass`/`PGPASSWORD`. |

## Snags each handles

- **apply-migrations.sh** → the "10 raw `.sql` applied in order via psql" loop, with `ON_ERROR_STOP=1`, fresh-DB
  detection (skips if already applied; `--reapply` to force), and a clear `N/10` summary.
- **setup-roles.sh** → the **no-password login** snag: the migration-created roles have `LOGIN` but no password,
  so they can't authenticate over TCP. Sets a password (from env) without echoing it, optionally writes `~/.pgpass`,
  and re-prints the (unchanged) grants so you can confirm least privilege.
- **verify-deployment.sh** → one **green/red** answer: grant verification (`ece_app` SELECT-only, `ece_writer`
  append-only, none on `clients`) + `/healthz` (reachable, core tables, `read_only`/`internal_write` = live,
  draft/external = fake) + principal (`ECE_PRINCIPAL_USER_ID` set and not `claude`). Then prints the manual
  `claude mcp add` + in-session steps. **It does not register MCP or call Claude Code.**

## Safety

No secrets are echoed or committed. Passwords come **only** from env. `~/.pgpass` is never silently edited
(`--write-pgpass` requires the explicit flag). No script widens any role grant. `verify-deployment.sh` is
read-only; `apply-migrations.sh` is idempotent and fresh-DB-aware; `setup-roles.sh` only sets login/password.
