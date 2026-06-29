-- 0005_project_registry.sql — Module 5 Project Registry: every project repo in the org (blueprint §5 /
-- ORG_PROJECT_REGISTRY.md). Append-only: each registration / status transition is a new snapshot row,
-- so the record of what was registered when (and the harvest-before-build gate) cannot be silently
-- rewritten. Self-contained (own guard). No RLS — factory-internal registry, not per-tenant client data.

CREATE TABLE IF NOT EXISTS project_registration (
  record_id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  registered_at          timestamptz NOT NULL DEFAULT now(),
  project                text NOT NULL,
  repo                   text NOT NULL,
  domain                 text NOT NULL,
  purpose                text NOT NULL,
  owner                  text NOT NULL,
  stack                  text NOT NULL,
  deployment             text NOT NULL,
  status                 text NOT NULL CHECK (status IN ('Phase 0 inspection','Phase 1 build','Harvest pending','Harvest approved','In build','In review','Live','Paused','Deprecated')),
  maturity               text,
  open_risks             jsonb,
  last_review_decision   text,
  next_gate              text,
  harvest_approval_status text NOT NULL CHECK (harvest_approval_status IN ('not-started','pending','approved','rejected'))
);

CREATE INDEX IF NOT EXISTS project_registration_name_idx ON project_registration (project, registered_at DESC);

GRANT INSERT, SELECT ON project_registration TO ece_app;
REVOKE UPDATE, DELETE, TRUNCATE ON project_registration FROM ece_app;
REVOKE UPDATE, DELETE, TRUNCATE ON project_registration FROM PUBLIC;

CREATE OR REPLACE FUNCTION project_append_only_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'append-only: % on % is prohibited (Module 5 project registry history)', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE OR REPLACE TRIGGER project_registration_no_mutate   BEFORE UPDATE OR DELETE ON project_registration FOR EACH ROW       EXECUTE FUNCTION project_append_only_guard();
CREATE OR REPLACE TRIGGER project_registration_no_truncate BEFORE TRUNCATE        ON project_registration FOR EACH STATEMENT EXECUTE FUNCTION project_append_only_guard();
