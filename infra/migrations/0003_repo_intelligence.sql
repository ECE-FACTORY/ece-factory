-- 0003_repo_intelligence.sql — Module 9 Repo Intelligence: the factory's accumulating MEMORY of
-- repos it has evaluated (institutional knowledge that informs future sourcing decisions).
-- Append-only: a repo evaluation is a decision input that must be durable and traceable, and must
-- not be silently rewritten. Self-contained (own guard function). No RLS — this is factory-internal
-- sourcing memory, not per-tenant client data.
--
-- IMPORTANT (instruction boundary): the `readme` and `description` columns hold REPO-SOURCED TEXT.
-- That text is INERT DATA — it is stored and echoed, never interpreted as an instruction or command.

CREATE TABLE IF NOT EXISTS repo_evaluation (
  record_id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  evaluated_at           timestamptz NOT NULL DEFAULT now(),
  host                   text NOT NULL,
  owner                  text NOT NULL,
  name                   text NOT NULL,
  license_detected       text NOT NULL,
  license_decision       text NOT NULL CHECK (license_decision IN ('ACCEPT','REJECT','NEEDS_REVIEW')),
  eligibility            text NOT NULL CHECK (eligibility IN ('eligible','not-eligible','needs-review')),
  provenance_verified    boolean NOT NULL,
  maturity               jsonb,
  air_gap                text,
  white_label            text,
  architecture_fit_notes text,
  prior_verdict          text,
  readme                 text, -- repo-sourced TEXT stored as INERT DATA (never an instruction)
  description            text, -- repo-sourced TEXT stored as INERT DATA
  status                 text NOT NULL DEFAULT 'recorded'
);

GRANT INSERT, SELECT ON repo_evaluation TO ece_app;
REVOKE UPDATE, DELETE, TRUNCATE ON repo_evaluation FROM ece_app;
REVOKE UPDATE, DELETE, TRUNCATE ON repo_evaluation FROM PUBLIC;

CREATE OR REPLACE FUNCTION repo_intel_append_only_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'append-only: % on % is prohibited (Module 9 institutional memory)', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE OR REPLACE TRIGGER repo_evaluation_no_mutate   BEFORE UPDATE OR DELETE ON repo_evaluation FOR EACH ROW       EXECUTE FUNCTION repo_intel_append_only_guard();
CREATE OR REPLACE TRIGGER repo_evaluation_no_truncate BEFORE TRUNCATE        ON repo_evaluation FOR EACH STATEMENT EXECUTE FUNCTION repo_intel_append_only_guard();
