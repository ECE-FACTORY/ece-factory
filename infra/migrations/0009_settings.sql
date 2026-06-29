-- 0009_settings.sql — Module 25 Settings: governed factory configuration state (blueprint §25).
-- Append-only: a setting change is a new snapshot; the current value is the latest snapshot and the change
-- history is never rewritten. Reading is READ_ONLY; changing is an APPROVAL_REQUIRED_WRITE (token-gated by
-- the bridge). Self-contained (own guard). Human attribution enforced (never "claude").

CREATE TABLE IF NOT EXISTS settings (
  record_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  registered_at   timestamptz NOT NULL DEFAULT now(),
  key             text NOT NULL,
  value           jsonb NOT NULL,
  scope           text NOT NULL CHECK (scope IN ('factory-wide','per-domain','per-project')),
  scope_ref       text,
  classification  text NOT NULL CHECK (classification IN ('OPERATIONAL','SECURITY_CRITICAL')),
  value_type      text NOT NULL CHECK (value_type IN ('boolean','string','number','enum')),
  changed_by      text NOT NULL CHECK (changed_by <> 'claude'),  -- attribution is a real human, never the model
  reason          text
);

CREATE INDEX IF NOT EXISTS settings_key_scope_idx ON settings (key, scope_ref, registered_at DESC);

GRANT INSERT, SELECT ON settings TO ece_app;
REVOKE UPDATE, DELETE, TRUNCATE ON settings FROM ece_app;
REVOKE UPDATE, DELETE, TRUNCATE ON settings FROM PUBLIC;

CREATE OR REPLACE FUNCTION settings_append_only_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'append-only: % on % is prohibited (Module 25 settings history)', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE OR REPLACE TRIGGER settings_no_mutate   BEFORE UPDATE OR DELETE ON settings FOR EACH ROW       EXECUTE FUNCTION settings_append_only_guard();
CREATE OR REPLACE TRIGGER settings_no_truncate BEFORE TRUNCATE        ON settings FOR EACH STATEMENT EXECUTE FUNCTION settings_append_only_guard();
