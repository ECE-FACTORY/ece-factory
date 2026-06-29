-- 0002_audit_refusal.sql — Module 23 Audit Engine, refusal-audit path (Phase 3.5).
-- Denied attempts ("who tried what they weren't allowed to, and when") are recorded as a
-- DISTINCT record kind in their OWN table — never as an audit_intent row. This is what keeps
-- refusals structurally separate from true orphans: the orphan reconciler only ever scans
-- audit_intent LEFT JOIN audit_result, so a refusal can never be mistaken for a result-less intent.
-- Same guarantees as the other audit tables: append-only (privilege + trigger), per-org RLS (FORCE),
-- and hash-chained (seq/prev_hash/entry_hash continue the same per-org chain).
-- Idempotent.

CREATE TABLE IF NOT EXISTS audit_refusal (
  refusal_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seq              bigint      NOT NULL,
  ts               timestamptz NOT NULL DEFAULT now(),
  organization_id  text        NOT NULL,
  human_actor      jsonb       NOT NULL,
  via              text,
  session          jsonb       NOT NULL,
  tool             jsonb       NOT NULL,            -- the tool/target that was attempted
  stage            text        NOT NULL,            -- where it was refused (e.g. 'authorize')
  decision         text        NOT NULL CHECK (decision IN ('REFUSE','STOP_FOR_APPROVAL')),
  reason           text,
  environment      text        NOT NULL CHECK (environment IN ('local','staging','production')),
  prev_hash        text,
  entry_hash       text,
  CONSTRAINT audit_refusal_actor_not_claude CHECK (lower(coalesce(human_actor->>'user_id','')) <> 'claude')
);

-- Append-only at the privilege layer.
GRANT INSERT, SELECT ON audit_refusal TO ece_app;
REVOKE UPDATE, DELETE, TRUNCATE ON audit_refusal FROM ece_app;
REVOKE UPDATE, DELETE, TRUNCATE ON audit_refusal FROM PUBLIC;

-- Append-only guard trigger (reuses the function from 0001) — defense-in-depth.
CREATE OR REPLACE TRIGGER audit_refusal_no_mutate   BEFORE UPDATE OR DELETE ON audit_refusal FOR EACH ROW       EXECUTE FUNCTION audit_append_only_guard();
CREATE OR REPLACE TRIGGER audit_refusal_no_truncate BEFORE TRUNCATE        ON audit_refusal FOR EACH STATEMENT EXECUTE FUNCTION audit_append_only_guard();

-- Per-org RLS (FORCE), same model as the other audit tables.
ALTER TABLE audit_refusal ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_refusal FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS audit_refusal_org_isolation ON audit_refusal;
CREATE POLICY audit_refusal_org_isolation ON audit_refusal
  USING      (organization_id = current_setting('app.current_org', true))
  WITH CHECK (organization_id = current_setting('app.current_org', true));
