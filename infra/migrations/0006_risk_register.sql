-- 0006_risk_register.sql — Module 31 Risk Register: risks across the factory/products (blueprint §31).
-- Append-only: each registration / status transition is a new snapshot row, so the risk history and
-- the open-risk record cannot be silently rewritten (a high/critical risk must not be quietly closed
-- off the books). Self-contained (own guard). No RLS — factory-internal register.

CREATE TABLE IF NOT EXISTS risk_register (
  record_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  registered_at    timestamptz NOT NULL DEFAULT now(),
  risk_key         text NOT NULL,
  title            text,
  type             text NOT NULL CHECK (type IN ('license','air-gap','white-label','security','MCP','audit','verification','dependency','upstream-abandonment','human-approval','production','sensitive-data','architecture','integration')),
  owner            text NOT NULL,
  severity         text NOT NULL CHECK (severity IN ('low','medium','high','critical')),
  mitigation       text,
  status           text NOT NULL CHECK (status IN ('open','mitigating','accepted','closed')),
  linked_project   text,
  linked_repo      text,
  linked_decision  text,
  linked_evidence  text
);

CREATE INDEX IF NOT EXISTS risk_register_key_idx ON risk_register (risk_key, registered_at DESC);

GRANT INSERT, SELECT ON risk_register TO ece_app;
REVOKE UPDATE, DELETE, TRUNCATE ON risk_register FROM ece_app;
REVOKE UPDATE, DELETE, TRUNCATE ON risk_register FROM PUBLIC;

CREATE OR REPLACE FUNCTION risk_append_only_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'append-only: % on % is prohibited (Module 31 risk register history)', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE OR REPLACE TRIGGER risk_register_no_mutate   BEFORE UPDATE OR DELETE ON risk_register FOR EACH ROW       EXECUTE FUNCTION risk_append_only_guard();
CREATE OR REPLACE TRIGGER risk_register_no_truncate BEFORE TRUNCATE        ON risk_register FOR EACH STATEMENT EXECUTE FUNCTION risk_append_only_guard();
