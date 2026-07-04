-- ECE Factory — TEST-ONLY seed fixture (NOT a migration, NOT for the deploy DB).
--
-- WHY THIS EXISTS (resolves OPEN_ITEM #7): two read-only cross-org tests assert per-org RLS isolation over
-- pre-existing rows they cannot create themselves (each app connection is RLS-scoped to a single org, so a
-- test cannot seed two orgs through the app path):
--   • src/features/audit-engine/db-rls.test.ts      (T8 — orgA/orgB each see ONLY their own audit_intent rows)
--   • src/features/audit-engine/db-readaudit.test.ts (T7 — an orgA viewer never sees orgB rows, and vice versa)
-- Both expect exactly the fixture the test comments name: "orgA has 1 intent row, orgB has 1 intent row."
-- That seed used to be an EXTERNAL orchestration step that was never checked in, so a clean bootstrap failed
-- these two tests identically every time. This file makes the fixture reproducible and committed.
--
-- APPLIED ONLY to a throwaway TEST database (ece_audit_test) by scripts/deploy/bootstrap-test-db.sh, AFTER the
-- migrations. It is NEVER applied by scripts/deploy/apply-migrations.sh and MUST NEVER touch the deploy DB
-- (ece_audit) — the bootstrap script guards the target name before running this.
--
-- IDEMPOTENT: fixed intent_id UUIDs + ON CONFLICT DO NOTHING, so re-running seeds nothing new. Run as a
-- SUPERUSER/OWNER (the bootstrap uses PGADMINUSER) so the inserts bypass RLS deterministically — no per-org
-- session context needed. These are inert fixture rows: status='intent', a non-'claude' human actor, an ALLOW
-- authz stub; they carry no hash-chain (prev_hash/entry_hash stay NULL) because the two tests assert per-org
-- SCOPING of these rows, not chain validity (chain verification in T7 targets a different org, orgT7).

INSERT INTO audit_intent (intent_id, seq, organization_id, human_actor, via, session, tool, request_summary, authz, environment, status)
VALUES
  ('00000000-0000-4000-8000-0000000000a1', 1000001, 'orgA',
   '{"user_id":"seed_human_a","email":"a@ece.ae","role":"admin"}', 'test-seed',
   '{"session_id":"seed-a"}', '{"name":"read_audit_log"}', '{}', '{"decision":"ALLOW"}', 'local', 'intent'),
  ('00000000-0000-4000-8000-0000000000b1', 1000002, 'orgB',
   '{"user_id":"seed_human_b","email":"b@ece.ae","role":"admin"}', 'test-seed',
   '{"session_id":"seed-b"}', '{"name":"read_audit_log"}', '{}', '{"decision":"ALLOW"}', 'local', 'intent')
ON CONFLICT (intent_id) DO NOTHING;
