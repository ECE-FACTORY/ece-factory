#!/usr/bin/env bash
# ECE Factory — setup-roles.sh (operator tooling; not factory code)
#
# WHAT IT DOES: the migration-created roles (ece_app, ece_writer) have LOGIN but NO password, so they can't
#   authenticate over TCP. This sets a LOGIN PASSWORD for each (from env — never hardcoded, never echoed). It
#   does NOT GRANT anything — privileges stay exactly as the migrations set them (it echoes them so you can see
#   ece_app = SELECT-only, ece_writer = INSERT-append-only, unchanged).
#
# USAGE:
#   ECE_APP_PASSWORD=<pw> ECE_WRITER_PASSWORD=<pw> [PGHOST=... PGPORT=... PGDATABASE=ece_audit PGADMINUSER=<superuser>] \
#     scripts/deploy/setup-roles.sh [--write-pgpass]
#   --write-pgpass : with your explicit consent, APPEND the matching lines to ~/.pgpass and chmod 600 it
#                    (the password values are taken from env and never printed). Without the flag, the exact
#                    lines to add (with <pw> placeholders) are PRINTED for you to add yourself.
#
# SAFETY: refuses if either role is missing (run apply-migrations.sh first). Connect as a SUPERUSER (PGADMINUSER
#   or the libpq default), NOT ece_app/ece_writer. The password is passed via a psql variable (`:'pw'`), not
#   interpolated into an echoed SQL string. It widens NO grant.
set -euo pipefail

PGDATABASE="${PGDATABASE:-ece_audit}"
WRITE_PGPASS=0; [ "${1:-}" = "--write-pgpass" ] && WRITE_PGPASS=1

PSQL=(psql -h "${PGHOST:-localhost}" -p "${PGPORT:-5432}" -d "$PGDATABASE")
[ -n "${PGADMINUSER:-}" ] && PSQL+=(-U "$PGADMINUSER")

fail() { echo "❌ $*" >&2; exit 1; }

[ -n "${ECE_APP_PASSWORD:-}" ]    || fail "ECE_APP_PASSWORD is not set (provide via env; never hardcode)."
[ -n "${ECE_WRITER_PASSWORD:-}" ] || fail "ECE_WRITER_PASSWORD is not set (provide via env; never hardcode)."
"${PSQL[@]}" -tAc "SELECT 1" >/dev/null 2>&1 || fail "cannot connect to '$PGDATABASE' as the admin user."

role_exists() { [ "$("${PSQL[@]}" -tAc "SELECT 1 FROM pg_roles WHERE rolname='$1'" || true)" = "1" ]; }
role_exists ece_app    || fail "role 'ece_app' does not exist — run scripts/deploy/apply-migrations.sh first."
role_exists ece_writer || fail "role 'ece_writer' does not exist — run scripts/deploy/apply-migrations.sh first."

echo "Setting LOGIN + password for ece_app and ece_writer (no grants changed)…"
# password passed as a psql variable and quoted with :'pw' — not echoed, not interpolated into a printed string.
ECE_PW="$ECE_APP_PASSWORD"    "${PSQL[@]}" -q -v ON_ERROR_STOP=1 -v pw="$ECE_APP_PASSWORD"    -c "ALTER ROLE ece_app    WITH LOGIN PASSWORD :'pw';"
ECE_PW="$ECE_WRITER_PASSWORD" "${PSQL[@]}" -q -v ON_ERROR_STOP=1 -v pw="$ECE_WRITER_PASSWORD" -c "ALTER ROLE ece_writer WITH LOGIN PASSWORD :'pw';"
echo "✅ login passwords set."

echo ""
echo "Current grants (unchanged by this script — for your confirmation):"
"${PSQL[@]}" -tAc "SELECT 'ece_app on clients: '||COALESCE(string_agg(privilege_type,',' ORDER BY privilege_type),'(none)') FROM information_schema.role_table_grants WHERE grantee='ece_app' AND table_name='clients'"
"${PSQL[@]}" -tAc "SELECT 'ece_writer on '||table_name||': '||string_agg(privilege_type,',' ORDER BY privilege_type) FROM information_schema.role_table_grants WHERE grantee='ece_writer' AND table_name IN ('review_log_entries','open_items','risk_register') GROUP BY table_name ORDER BY table_name"
"${PSQL[@]}" -tAc "SELECT 'ece_writer on clients: '||COALESCE(string_agg(privilege_type,','),'(none)') FROM information_schema.role_table_grants WHERE grantee='ece_writer' AND table_name='clients'"

PGP_HOST="${PGHOST:-localhost}"; PGP_PORT="${PGPORT:-5432}"
echo ""
if [ "$WRITE_PGPASS" = "1" ]; then
  PGPASS="$HOME/.pgpass"
  touch "$PGPASS"; chmod 600 "$PGPASS"
  # append (idempotent-ish: remove any prior lines for these role+db first)
  TMP="$(mktemp)"; grep -vE ":${PGDATABASE}:(ece_app|ece_writer):" "$PGPASS" > "$TMP" || true
  { printf '%s:%s:%s:ece_app:%s\n'    "$PGP_HOST" "$PGP_PORT" "$PGDATABASE" "$ECE_APP_PASSWORD";
    printf '%s:%s:%s:ece_writer:%s\n' "$PGP_HOST" "$PGP_PORT" "$PGDATABASE" "$ECE_WRITER_PASSWORD"; } >> "$TMP"
  mv "$TMP" "$PGPASS"; chmod 600 "$PGPASS"
  echo "✅ appended 2 entries to ~/.pgpass (chmod 600). Passwords were NOT printed."
else
  echo "Add these lines to ~/.pgpass (replace <…pw> with your env values), then: chmod 600 ~/.pgpass"
  echo "  ${PGP_HOST}:${PGP_PORT}:${PGDATABASE}:ece_app:<your-ECE_APP_PASSWORD>"
  echo "  ${PGP_HOST}:${PGP_PORT}:${PGDATABASE}:ece_writer:<your-ECE_WRITER_PASSWORD>"
  echo "(or re-run with --write-pgpass to append them for you — values from env, never printed.)"
fi
echo ""
echo "Next: scripts/deploy/verify-deployment.sh"
