-- 0001_audit_schema.sql — Module 23 Audit Engine, append-only schema
-- ARCHITECTURE §3 (schema), §4 (append-only), §6 (per-org RLS).
-- DB STRUCTURE ONLY. No sequencer (§2), no hash-chain computation, no AuditSink bodies.
-- Idempotent: safe to re-apply (IF NOT EXISTS / CREATE OR REPLACE / DROP POLICY IF EXISTS).

-- ---------------------------------------------------------------------------
-- Application role: least privilege. INSERT/SELECT only; subject to RLS.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'ece_app') THEN
    CREATE ROLE ece_app LOGIN;
  END IF;
END $$;
GRANT USAGE ON SCHEMA public TO ece_app;

-- ---------------------------------------------------------------------------
-- Tables. seq + prev_hash + entry_hash columns exist now; they are POPULATED
-- by the sequencer/hash-chain in a later phase. No hashing logic lives here.
-- 'authz' is used instead of the SQL-reserved word 'authorization'.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_intent (
  intent_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seq              bigint      NOT NULL,
  ts               timestamptz NOT NULL DEFAULT now(),
  organization_id  text        NOT NULL,
  human_actor      jsonb       NOT NULL,
  via              text,
  session          jsonb       NOT NULL,
  tool             jsonb       NOT NULL,
  request_summary  jsonb,
  authz            jsonb       NOT NULL,
  approval         jsonb,
  dashboard        jsonb,
  environment      text        NOT NULL CHECK (environment IN ('local','staging','production')),
  prev_hash        text,
  entry_hash       text,
  status           text        NOT NULL DEFAULT 'intent' CHECK (status = 'intent'),
  -- Human attribution guarantee: the actor is never the model.
  CONSTRAINT audit_intent_actor_not_claude CHECK (lower(coalesce(human_actor->>'user_id','')) <> 'claude')
);

CREATE TABLE IF NOT EXISTS audit_result (
  result_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  intent_id        uuid        NOT NULL REFERENCES audit_intent(intent_id),
  seq              bigint      NOT NULL,
  ts               timestamptz NOT NULL DEFAULT now(),
  organization_id  text        NOT NULL,
  result           jsonb       NOT NULL,
  prev_hash        text,
  entry_hash       text,
  status           text        NOT NULL CHECK (status IN ('success','error'))
);

CREATE TABLE IF NOT EXISTS audit_read_log (
  read_id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seq              bigint      NOT NULL,
  ts               timestamptz NOT NULL DEFAULT now(),
  organization_id  text        NOT NULL,
  human_actor      jsonb       NOT NULL,
  session          jsonb       NOT NULL,
  query_range      jsonb,
  rows_returned    integer,
  prev_hash        text,
  entry_hash       text
);

-- ---------------------------------------------------------------------------
-- §4 Append-only at the DB PRIVILEGE layer (not app convention).
-- ---------------------------------------------------------------------------
GRANT INSERT, SELECT ON audit_intent, audit_result, audit_read_log TO ece_app;
REVOKE UPDATE, DELETE, TRUNCATE ON audit_intent, audit_result, audit_read_log FROM ece_app;
REVOKE UPDATE, DELETE, TRUNCATE ON audit_intent, audit_result, audit_read_log FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- §4 Append-only GUARD TRIGGER (defense-in-depth: fires even for a role that
-- still holds the privilege, e.g. a future misconfiguration or a superuser).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION audit_append_only_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'append-only: % on % is prohibited (Module 23 ARCHITECTURE §4 / blueprint §23.4)',
        TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE OR REPLACE TRIGGER audit_intent_no_mutate   BEFORE UPDATE OR DELETE ON audit_intent   FOR EACH ROW       EXECUTE FUNCTION audit_append_only_guard();
CREATE OR REPLACE TRIGGER audit_intent_no_truncate BEFORE TRUNCATE        ON audit_intent   FOR EACH STATEMENT EXECUTE FUNCTION audit_append_only_guard();
CREATE OR REPLACE TRIGGER audit_result_no_mutate   BEFORE UPDATE OR DELETE ON audit_result   FOR EACH ROW       EXECUTE FUNCTION audit_append_only_guard();
CREATE OR REPLACE TRIGGER audit_result_no_truncate BEFORE TRUNCATE        ON audit_result   FOR EACH STATEMENT EXECUTE FUNCTION audit_append_only_guard();
CREATE OR REPLACE TRIGGER audit_read_no_mutate     BEFORE UPDATE OR DELETE ON audit_read_log FOR EACH ROW       EXECUTE FUNCTION audit_append_only_guard();
CREATE OR REPLACE TRIGGER audit_read_no_truncate   BEFORE TRUNCATE        ON audit_read_log FOR EACH STATEMENT EXECUTE FUNCTION audit_append_only_guard();

-- ---------------------------------------------------------------------------
-- §6 Per-org Row-Level Security. FORCE so even the table owner is subject;
-- only superusers / BYPASSRLS roles bypass (used for migration + seeding).
-- current_setting('app.current_org', true) returns NULL when unset → sees nothing.
-- ---------------------------------------------------------------------------
ALTER TABLE audit_intent   ENABLE ROW LEVEL SECURITY;  ALTER TABLE audit_intent   FORCE ROW LEVEL SECURITY;
ALTER TABLE audit_result   ENABLE ROW LEVEL SECURITY;  ALTER TABLE audit_result   FORCE ROW LEVEL SECURITY;
ALTER TABLE audit_read_log ENABLE ROW LEVEL SECURITY;  ALTER TABLE audit_read_log FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS audit_intent_org_isolation   ON audit_intent;
DROP POLICY IF EXISTS audit_result_org_isolation   ON audit_result;
DROP POLICY IF EXISTS audit_read_org_isolation     ON audit_read_log;

CREATE POLICY audit_intent_org_isolation ON audit_intent
  USING      (organization_id = current_setting('app.current_org', true))
  WITH CHECK (organization_id = current_setting('app.current_org', true));
CREATE POLICY audit_result_org_isolation ON audit_result
  USING      (organization_id = current_setting('app.current_org', true))
  WITH CHECK (organization_id = current_setting('app.current_org', true));
CREATE POLICY audit_read_org_isolation ON audit_read_log
  USING      (organization_id = current_setting('app.current_org', true))
  WITH CHECK (organization_id = current_setting('app.current_org', true));
