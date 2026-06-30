-- 0010_field_definitions.sql — Module 20 Field Creation: custom field definitions on a target (blueprint §20).
-- Append-only: a definition / change is a new snapshot; the current definition is the latest snapshot and the
-- history is never rewritten. Reading is READ_ONLY; creating/changing is an APPROVAL_REQUIRED_WRITE
-- (token-gated by the bridge). A field definition is INERT declarative data — `constraints` is a closed
-- declarative vocabulary stored as jsonb, never executed. Self-contained (own guard). Human attribution.

CREATE TABLE IF NOT EXISTS field_definitions (
  record_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  registered_at  timestamptz NOT NULL DEFAULT now(),
  key            text NOT NULL,
  label          text NOT NULL,
  data_type      text NOT NULL CHECK (data_type IN ('string','number','boolean','date','enum','text')),
  target         text NOT NULL CHECK (target IN ('domain','project','product')),
  target_ref     text NOT NULL,
  required       boolean NOT NULL DEFAULT false,
  field_default  jsonb,                 -- an inert scalar value (validated at the engine layer; never executed)
  constraints    jsonb NOT NULL DEFAULT '{}'::jsonb,  -- closed declarative vocabulary (min/max/regex/enum/length)
  sensitivity    text NOT NULL DEFAULT 'NORMAL' CHECK (sensitivity IN ('NORMAL','SENSITIVE')),
  changed_by     text NOT NULL CHECK (changed_by <> 'claude'),  -- attribution is a real human, never the model
  reason         text
);

CREATE INDEX IF NOT EXISTS field_definitions_target_key_idx ON field_definitions (target, target_ref, key, registered_at DESC);

GRANT INSERT, SELECT ON field_definitions TO ece_app;
REVOKE UPDATE, DELETE, TRUNCATE ON field_definitions FROM ece_app;
REVOKE UPDATE, DELETE, TRUNCATE ON field_definitions FROM PUBLIC;

CREATE OR REPLACE FUNCTION field_definitions_append_only_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'append-only: % on % is prohibited (Module 20 field-definition history)', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE OR REPLACE TRIGGER field_definitions_no_mutate   BEFORE UPDATE OR DELETE ON field_definitions FOR EACH ROW       EXECUTE FUNCTION field_definitions_append_only_guard();
CREATE OR REPLACE TRIGGER field_definitions_no_truncate BEFORE TRUNCATE        ON field_definitions FOR EACH STATEMENT EXECUTE FUNCTION field_definitions_append_only_guard();
