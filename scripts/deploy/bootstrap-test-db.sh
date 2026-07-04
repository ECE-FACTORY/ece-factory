#!/usr/bin/env bash
# ECE Factory — bootstrap-test-db.sh (TEST tooling; not factory/product code)
#
# WHAT IT DOES: makes a truly fresh TEST database green in ONE command — resolves OPEN_ITEM #7. It:
#   1. GUARDS the target is a throwaway TEST DB (name must contain "test"; NEVER the deploy DB "ece_audit").
#   2. drops + recreates the test DB (as a superuser/owner),
#   3. applies the raw-SQL migrations (via apply-migrations.sh),
#   4. applies the committed TEST-ONLY seed fixtures in infra/testseed/*.sql (the orgA/orgB audit_intent rows
#      the RLS / read-audit tests require — previously an uncommitted external orchestration step),
#   5. unless --no-test is passed, runs the FULL vitest suite once.
#
# So a fresh-DB run is simply:  scripts/deploy/bootstrap-test-db.sh    (drop → migrate → seed → test, green)
# There is NO separate manual inject step. The seed is committed, idempotent, and test-DB-isolated.
#
# SAFETY: the seed and the drop/recreate ONLY ever touch a database whose name contains "test" and is not the
# deploy DB. The deploy path (apply-migrations.sh against ece_audit) is untouched and never sees these fixtures.
#
# USAGE:
#   [PGHOST=127.0.0.1] [PGPORT=55432] [PGDATABASE=ece_audit_test] [PGADMINUSER=postgres] \
#     scripts/deploy/bootstrap-test-db.sh [--no-test]
#
# NO SECRETS: never echoes a password. Provide DB auth via ~/.pgpass or PGPASSWORD in your env.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PGHOST="${PGHOST:-127.0.0.1}"
PGPORT="${PGPORT:-55432}"
PGDATABASE="${PGDATABASE:-ece_audit_test}"
PGADMINUSER="${PGADMINUSER:-postgres}"
SEED_DIR="$REPO_ROOT/infra/testseed"
RUN_TESTS=1
[ "${1:-}" = "--no-test" ] && RUN_TESTS=0

fail() { echo "❌ $*" >&2; exit 1; }

# ── SAFETY GUARD: only a throwaway TEST DB may be dropped/seeded here ──────────────────────────────────────
case "$PGDATABASE" in
  ece_audit) fail "refusing: PGDATABASE='ece_audit' is the DEPLOY database — this script is for a THROWAWAY test DB only." ;;
  *test*) : ;; # ok — a test database
  *) fail "refusing: PGDATABASE='$PGDATABASE' does not look like a test DB (name must contain 'test'). Set PGDATABASE=ece_audit_test." ;;
esac

ADMIN=(psql -h "$PGHOST" -p "$PGPORT" -U "$PGADMINUSER")

echo "ECE Factory — bootstrapping FRESH test DB '$PGDATABASE' on $PGHOST:$PGPORT (admin: $PGADMINUSER)"
"${ADMIN[@]}" -d postgres -tAc "SELECT 1" >/dev/null 2>&1 || fail "cannot connect to '$PGADMINUSER'@$PGHOST:$PGPORT — is the test PostgreSQL cluster running?"

echo ">> dropping + recreating '$PGDATABASE'"
"${ADMIN[@]}" -d postgres -v ON_ERROR_STOP=1 -q -c "DROP DATABASE IF EXISTS $PGDATABASE WITH (FORCE);" || fail "could not drop '$PGDATABASE'"
"${ADMIN[@]}" -d postgres -v ON_ERROR_STOP=1 -q -c "CREATE DATABASE $PGDATABASE;" || fail "could not create '$PGDATABASE'"

echo ">> applying migrations"
PGHOST="$PGHOST" PGPORT="$PGPORT" PGDATABASE="$PGDATABASE" PGADMINUSER="$PGADMINUSER" \
  bash "$REPO_ROOT/scripts/deploy/apply-migrations.sh" >/dev/null || fail "migrations failed"
echo "   migrations applied."

echo ">> applying committed TEST seed fixtures ($SEED_DIR/*.sql)"
[ -d "$SEED_DIR" ] || fail "seed dir not found: $SEED_DIR"
SEEDS=("$SEED_DIR"/*.sql)
[ -e "${SEEDS[0]}" ] || fail "no seed .sql files in $SEED_DIR"
for s in "${SEEDS[@]}"; do
  echo "   seed: $(basename "$s")"
  "${ADMIN[@]}" -d "$PGDATABASE" -v ON_ERROR_STOP=1 -q -f "$s" || fail "seed failed on $(basename "$s")"
done
echo "✅ fresh test DB ready (migrated + seeded), no manual inject."

if [ "$RUN_TESTS" = 1 ]; then
  echo ">> running full vitest suite once against the fresh DB"
  cd "$REPO_ROOT"
  PGHOST="$PGHOST" PGPORT="$PGPORT" PGDATABASE="$PGDATABASE" exec npm test
fi
