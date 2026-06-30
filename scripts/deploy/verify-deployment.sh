#!/usr/bin/env bash
# ECE Factory — verify-deployment.sh (operator tooling; not factory code)
#
# WHAT IT DOES: the ONE green/red check before you register MCP. READ-ONLY — it writes nothing, registers no
#   MCP server, and calls no Claude Code. Three checks:
#     (a) grant verification — ece_app SELECT-only on the system of record; ece_writer INSERT+SELECT on the
#         3 append-only write tables, NO UPDATE/DELETE/TRUNCATE, and NOTHING on clients. ✅/❌ per role.
#     (b) tier-status — runs `npm run mcp:healthz` and checks database.reachable, coreTablesPresent, and that
#         read_only + internal_write report 'live' (draft/external should be 'fake'). ✅/❌.
#     (c) principal — ECE_PRINCIPAL_USER_ID is set and is NOT "claude" (the server refuses it). ✅/❌.
#   Then it prints the REMAINING MANUAL STEPS (claude mcp add + the in-session tool call) — yours to run.
#
# USAGE:
#   PGHOST=... PGPORT=... PGDATABASE=ece_audit ECE_DB_USER=ece_app ECE_WRITE_DB_USER=ece_writer \
#   ECE_PRINCIPAL_USER_ID=<your-human-id> ECE_PRINCIPAL_EMAIL=<you> ECE_PRINCIPAL_ROLE=operator ECE_ORG=<org> \
#   [PGADMINUSER=<superuser>]  scripts/deploy/verify-deployment.sh
#   (DB auth for healthz comes from ~/.pgpass or PGPASSWORD — never committed.)
set -uo pipefail   # not -e: we want to run all checks and tally, not abort on the first ❌

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PGDATABASE="${PGDATABASE:-ece_audit}"
PSQL=(psql -h "${PGHOST:-localhost}" -p "${PGPORT:-5432}" -d "$PGDATABASE")
[ -n "${PGADMINUSER:-}" ] && PSQL+=(-U "$PGADMINUSER")
FAILS=0
ok()  { echo "✅ $*"; }
bad() { echo "❌ $*"; FAILS=$((FAILS + 1)); }

echo "── (a) grant verification (read-only) ─────────────────────────────"
if ! "${PSQL[@]}" -tAc "SELECT 1" >/dev/null 2>&1; then
  bad "cannot connect to '$PGDATABASE' as the admin user (run apply-migrations.sh; check PostgreSQL is up)"
else
  APP_CLIENTS="$("${PSQL[@]}" -tAc "SELECT COALESCE(string_agg(privilege_type,',' ORDER BY privilege_type),'') FROM information_schema.role_table_grants WHERE grantee='ece_app' AND table_name='clients'")"
  if [ "$APP_CLIENTS" = "SELECT" ]; then ok "ece_app on clients = SELECT only"; else bad "ece_app on clients = '${APP_CLIENTS:-<none>}' (expected exactly SELECT — too broad/narrow)"; fi

  WRITER_BAD=0
  for t in review_log_entries open_items risk_register; do
    G="$("${PSQL[@]}" -tAc "SELECT COALESCE(string_agg(privilege_type,',' ORDER BY privilege_type),'') FROM information_schema.role_table_grants WHERE grantee='ece_writer' AND table_name='$t'")"
    case ",$G," in
      *",UPDATE,"*|*",DELETE,"*|*",TRUNCATE,"*) bad "ece_writer on $t has a mutation grant ('$G') — must be INSERT,SELECT only"; WRITER_BAD=1 ;;
      *",INSERT,"*) : ;;  # ok: has INSERT (and SELECT)
      *) bad "ece_writer on $t = '${G:-<none>}' (expected INSERT,SELECT)"; WRITER_BAD=1 ;;
    esac
  done
  [ "$WRITER_BAD" = 0 ] && ok "ece_writer = INSERT,SELECT only on review_log_entries/open_items/risk_register (no UPDATE/DELETE/TRUNCATE)"

  WRITER_CLIENTS="$("${PSQL[@]}" -tAc "SELECT count(*) FROM information_schema.role_table_grants WHERE grantee='ece_writer' AND table_name='clients'")"
  if [ "$WRITER_CLIENTS" = "0" ]; then ok "ece_writer has NO grant on clients (system of record)"; else bad "ece_writer has $WRITER_CLIENTS grant(s) on clients — must be none"; fi
fi

echo ""
echo "── (b) tier-status (npm run mcp:healthz) ──────────────────────────"
HEALTH="$(cd "$REPO_ROOT" && npm run --silent mcp:healthz 2>/tmp/ece_healthz.err)"; HZ_RC=$?
if [ $HZ_RC -ne 0 ] || [ -z "$HEALTH" ]; then
  bad "mcp:healthz did not produce output (rc=$HZ_RC) — see /tmp/ece_healthz.err (env vars set? DB reachable? Node 26+?)"
else
  printf '%s' "$HEALTH" | node -e '
let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
  let r; try{r=JSON.parse(s)}catch(e){console.log("__PARSE_FAIL__");process.exit(2)}
  const t=r.tiers||{},db=r.database||{};
  console.log("   database.reachable     = "+db.reachable);
  console.log("   coreTablesPresent      = "+db.coreTablesPresent+"/"+db.coreTablesExpected);
  console.log("   tiers.read_only        = "+t.read_only);
  console.log("   tiers.internal_write   = "+t.internal_write);
  console.log("   tiers.draft_only       = "+t.draft_only+"   (expected fake)");
  console.log("   tiers.external         = "+t.external+"   (expected fake)");
  console.log("   tiers.forbidden        = "+t.forbidden);
  console.log("   dbRoles                = "+JSON.stringify(r.dbRoles||{}));
  const ok = db.reachable===true && db.coreTablesPresent===db.coreTablesExpected && t.read_only==="live" && t.internal_write==="live";
  process.exit(ok?0:1);
});'
  HZ_CHECK=$?
  if [ $HZ_CHECK -eq 0 ]; then ok "healthz: DB reachable, all core tables present, read_only=live, internal_write=live (draft/external fake)"
  elif [ $HZ_CHECK -eq 2 ]; then bad "healthz output was not valid JSON — see /tmp/ece_healthz.err"
  else bad "healthz: a required field is not green (DB unreachable, missing tables, or a live tier reports fake/not-wired)"; fi
fi

echo ""
echo "── (c) principal check ────────────────────────────────────────────"
PID="${ECE_PRINCIPAL_USER_ID:-}"
if [ -z "$PID" ]; then bad "ECE_PRINCIPAL_USER_ID is not set (the server requires a real human id)"
elif [ "$(printf '%s' "$PID" | tr '[:upper:]' '[:lower:]')" = "claude" ]; then bad "ECE_PRINCIPAL_USER_ID is 'claude' — the server refuses it; use your real human id"
else ok "ECE_PRINCIPAL_USER_ID is set and is not 'claude'"; fi

echo ""
echo "═══════════════════════════════════════════════════════════════════"
if [ "$FAILS" -eq 0 ]; then
  echo "READY TO REGISTER ✅"
  echo ""
  echo "Remaining MANUAL steps (yours — this script does not perform them):"
  echo "  1) cd $REPO_ROOT && claude mcp add ece-factory -- node src/mcp-server/run.mjs"
  echo "  2) claude mcp get ece-factory   # confirm command + cwd = this repo, healthy"
  echo "     claude mcp list              # confirm ece-factory present and healthy"
  echo "  3) In a Claude Code session: call read_factory_status (real data, audited, redacted);"
  echo "     call create_open_item WITHOUT approval ⇒ STOP_FOR_APPROVAL / refused (no row);"
  echo "     external (open_pull_request) ⇒ refused/STOP, no live call (external stays fake)."
  exit 0
else
  echo "NOT READY — fix the $FAILS ❌ item(s) above, then re-run scripts/deploy/verify-deployment.sh"
  exit 1
fi
