-- 0004_domain_registry.sql — Module 4 Domain Registry: the factory's record of the domains it
-- processes (blueprint §4.1). A domain registration is an institutional decision — durable and
-- traceable. Append-only: each registration / status transition is a new snapshot row, so the
-- history of what was registered when cannot be silently rewritten. Self-contained (own guard).
-- No RLS — factory-internal registry, not per-tenant client data.

CREATE TABLE IF NOT EXISTS domain_registration (
  record_id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  registered_at       timestamptz NOT NULL DEFAULT now(),
  name                text NOT NULL,
  business_objective  text NOT NULL,
  sovereignty         text NOT NULL CHECK (sovereignty IN ('sovereign','non-sovereign')),
  air_gap             text NOT NULL CHECK (air_gap IN ('required','optional','not-required')),
  arabic_first        text NOT NULL CHECK (arabic_first IN ('required','optional','not-required')),
  sub_domains         jsonb,
  target_clients      jsonb,
  owner               text NOT NULL,
  risk_level          text NOT NULL CHECK (risk_level IN ('low','medium','high')),
  status              text NOT NULL CHECK (status IN ('idea','registered','harvesting','in-build','productized','live','deprecated')),
  linked_harvest_ref  text,
  linked_project_refs jsonb
);

CREATE INDEX IF NOT EXISTS domain_registration_name_idx ON domain_registration (name, registered_at DESC);

GRANT INSERT, SELECT ON domain_registration TO ece_app;
REVOKE UPDATE, DELETE, TRUNCATE ON domain_registration FROM ece_app;
REVOKE UPDATE, DELETE, TRUNCATE ON domain_registration FROM PUBLIC;

CREATE OR REPLACE FUNCTION domain_append_only_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'append-only: % on % is prohibited (Module 4 domain registry history)', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE OR REPLACE TRIGGER domain_registration_no_mutate   BEFORE UPDATE OR DELETE ON domain_registration FOR EACH ROW       EXECUTE FUNCTION domain_append_only_guard();
CREATE OR REPLACE TRIGGER domain_registration_no_truncate BEFORE TRUNCATE        ON domain_registration FOR EACH STATEMENT EXECUTE FUNCTION domain_append_only_guard();
