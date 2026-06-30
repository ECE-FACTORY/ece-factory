#!/usr/bin/env bash
# ECE Factory — apply-migrations.sh (operator tooling; not factory code)
#
# WHAT IT DOES: applies the 10 infra/migrations/*.sql files IN ORDER to the target database, stopping on the
#   first error. The migrations CREATE the roles (ece_app in 0001, ece_writer in 0008) and the append-only
#   tables/triggers — so you must connect as a SUPERUSER/OWNER, NOT one of the app roles.
#
# IDEMPOTENCY: the migrations use `CREATE TABLE IF NOT EXISTS`, `CREATE OR REPLACE FUNCTION/TRIGGER`,
#   `CREATE ROLE ... IF NOT EXISTS` (DO-block), and idempotent GRANT/REVOKE — so re-running is SAFE. It is
#   nonetheless intended for a FRESH `ece_audit` DB. If all core tables already exist this script reports
#   "already applied" and exits 0 unless you pass --reapply.
#
# USAGE:
#   PGHOST=localhost PGPORT=5432 PGDATABASE=ece_audit [PGADMINUSER=<superuser>] scripts/deploy/apply-migrations.sh [--reapply|--check]
#     PGDATABASE defaults to ece_audit. PGADMINUSER is the admin/owner role (default: libpq default = your macOS
#     user on Homebrew). Do NOT set it to ece_app/ece_writer.
#   --check    : report applied state only; apply nothing.
#   --reapply  : apply even if all core tables already exist.
#
# NO SECRETS: this script never echoes a password. Provide DB auth via ~/.pgpass or PGPASSWORD in your env.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
MIG_DIR="$REPO_ROOT/infra/migrations"
PGDATABASE="${PGDATABASE:-ece_audit}"
MODE="${1:-}"

PSQL=(psql -h "${PGHOST:-localhost}" -p "${PGPORT:-5432}" -d "$PGDATABASE")
[ -n "${PGADMINUSER:-}" ] && PSQL+=(-U "$PGADMINUSER")

fail() { echo "❌ $*" >&2; exit 1; }

[ -d "$MIG_DIR" ] || fail "migrations dir not found: $MIG_DIR"
MIGRATIONS=("$MIG_DIR"/*.sql)
TOTAL=${#MIGRATIONS[@]}
[ "$TOTAL" -gt 0 ] || fail "no .sql migrations found in $MIG_DIR"

echo "ECE Factory — applying $TOTAL migrations to DB '$PGDATABASE' (admin: ${PGADMINUSER:-<libpq default>})"

# reachability + already-applied detection (read-only)
"${PSQL[@]}" -tAc "SELECT 1" >/dev/null 2>&1 || fail "cannot connect to '$PGDATABASE' as the admin user — is PostgreSQL running and the DB created (createdb $PGDATABASE)?"
CORE_TABLES="audit_intent,audit_result,audit_refusal,audit_read_log,repo_evaluation,domain_registration,project_registration,risk_register,clients,review_log_entries,open_items,settings,field_definitions"
PRESENT="$("${PSQL[@]}" -tAc "SELECT count(*) FROM pg_catalog.pg_tables WHERE schemaname='public' AND tablename = ANY(string_to_array('$CORE_TABLES',','))" || echo 0)"
EXPECTED=13
echo "core tables present: ${PRESENT}/${EXPECTED}"

if [ "$MODE" = "--check" ]; then
  [ "$PRESENT" = "$EXPECTED" ] && echo "✅ all core tables present (migrations appear applied)" || echo "⚠️  not fully applied (${PRESENT}/${EXPECTED})"
  exit 0
fi
if [ "$PRESENT" = "$EXPECTED" ] && [ "$MODE" != "--reapply" ]; then
  echo "✅ already applied (${PRESENT}/${EXPECTED} core tables) — nothing to do. Pass --reapply to force."
  exit 0
fi

APPLIED=0
for f in "${MIGRATIONS[@]}"; do
  echo ">> applying $(basename "$f")"
  "${PSQL[@]}" -v ON_ERROR_STOP=1 -q -f "$f" || fail "failed on $(basename "$f") — fix it and re-run (the IF-NOT-EXISTS guards make re-running safe)."
  APPLIED=$((APPLIED + 1))
done

echo "✅ ${APPLIED}/${TOTAL} migrations applied to '$PGDATABASE'."
echo "   Next: scripts/deploy/setup-roles.sh (set login passwords for ece_app / ece_writer), then verify-deployment.sh"
