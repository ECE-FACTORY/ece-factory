-- 0007_clients_readmodel.sql — a READ-ONLY client read model (the system-of-record stand-in the
-- MCP Bridge's search_clients tool queries). Module 1 (MCP Bridge) is read-only; this migration makes
-- that STRUCTURAL at the database-privilege layer: the application role `ece_app` (the role the bridge
-- connects as) is granted SELECT ONLY. It has no INSERT/UPDATE/DELETE/TRUNCATE on this table — so even a
-- bug or a malicious instruction cannot mutate the system of record through the bridge's connection.
--
-- Write access to a system of record is a later, separately-gated phase with per-action human approval;
-- it is intentionally absent here.

CREATE TABLE IF NOT EXISTS clients (
  client_id        text PRIMARY KEY,
  organization_id  text NOT NULL,
  name             text NOT NULL,
  email            text,
  ssn              text,                 -- sensitive: must be redacted out before leaving the bridge
  notes            text,                 -- free text; may contain instruction-looking content — inert data
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS clients_org_name_idx ON clients (organization_id, name);

-- READ-ONLY for the application role: SELECT only, no mutation verbs. (Seeding is done by the table
-- owner / superuser, never by ece_app.)
GRANT SELECT ON clients TO ece_app;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON clients FROM ece_app;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON clients FROM PUBLIC;
