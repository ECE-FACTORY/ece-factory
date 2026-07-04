# Testing — ECE Factory

The suite is `vitest`. Most engines are unit-tested with in-memory fakes; the **DB-integration tests**
(`src/**/db-*.test.ts`, plus the audit-engine RLS/read-audit tests) run against a **real, throwaway
PostgreSQL** so RLS, append-only triggers, and the hash-chain are exercised for real.

## Fresh-DB bootstrap — one command

The DB-integration suite assumes a **fresh database per run** (see OPEN_ITEM #7 below): several tests assert
exact row counts and per-org RLS isolation, so accumulated rows from a previous run would cause spurious
failures. One committed command provisions a clean DB and runs the whole suite:

```bash
# defaults: PGHOST=127.0.0.1 PGPORT=55432 PGDATABASE=ece_audit_test PGADMINUSER=postgres
scripts/deploy/bootstrap-test-db.sh
```

It **drops → recreates → migrates → seeds → runs** the full suite, with **no manual inject step**. Expected:

```
Test Files  84 passed | 1 skipped (85)
     Tests  600 passed | 2 skipped (602)
```

Prep the DB without running the suite (e.g. to run a subset yourself afterwards):

```bash
scripts/deploy/bootstrap-test-db.sh --no-test
PGHOST=127.0.0.1 PGPORT=55432 PGDATABASE=ece_audit_test npm test
```

Because the suite wants a fresh DB per run, **re-run the bootstrap command for each full run** — it is the single
step that resets and reseeds. (`npm test` alone re-runs against the *same* DB and will accumulate rows.)

### What the bootstrap seeds — and why it's committed

Two read-only cross-org tests assert per-org RLS isolation over rows they cannot create themselves (each app
connection is RLS-scoped to a single org, so a test cannot seed two orgs through the app path):

- `src/features/audit-engine/db-rls.test.ts` (T8 — orgA/orgB each see ONLY their own `audit_intent` rows)
- `src/features/audit-engine/db-readaudit.test.ts` (T7 — an orgA viewer never sees orgB rows, and vice versa)

They require the fixture their comments name: *"orgA has 1 intent row, orgB has 1 intent row."* That seed used
to be an **external orchestration step that was never checked into the repo**, so a clean bootstrap failed those
two tests identically every time and every run needed a manual reseed+inject. The fixture is now committed at
[`infra/testseed/0001_rls_readaudit_fixture.sql`](../infra/testseed/0001_rls_readaudit_fixture.sql) and applied
by the bootstrap **after** the migrations.

The seed is **idempotent** (fixed `intent_id` UUIDs + `ON CONFLICT DO NOTHING`) and **test-DB-isolated**: the
bootstrap refuses to run against the deploy DB `ece_audit` or any database whose name doesn't contain `test`,
and the seed is **never** applied by the deploy migration path (`scripts/deploy/apply-migrations.sh`).

## Prerequisites

A local PostgreSQL cluster reachable at `PGHOST:PGPORT` (the CI/test cluster convention is `127.0.0.1:55432`),
with `PGADMINUSER` (default `postgres`) able to create databases. The `ece_app` / `ece_writer` app roles are
created **by the migrations themselves**; provide DB auth via `~/.pgpass` or `PGPASSWORD` (never committed).

## Non-DB tests

Pure unit tests need no database and run under the same `npm test`; they pass regardless of DB state.
