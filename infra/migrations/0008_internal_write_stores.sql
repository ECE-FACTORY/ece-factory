-- 0008_internal_write_stores.sql — Phase 9.1: LIVE append-only stores for the internal-write tier.
--
-- The 6 internal-write tools land here (record_review_decision / record_human_signoff / record_approval_gate
-- / record_wave_signoff → review_log_entries; create_open_item → open_items; update_risk_status → the
-- existing risk_register, 0006). Each store is APPEND-ONLY at the DB layer (REVOKE UPDATE/DELETE/TRUNCATE +
-- guard trigger) — a live write is a new snapshot, never an overwrite.
--
-- A dedicated, minimally-scoped role `ece_writer` performs the live writes: INSERT (+SELECT for RETURNING /
-- history) on EXACTLY these target tables, and NOTHING else — no UPDATE/DELETE/TRUNCATE, no access to the
-- system of record (clients) or any external system. The READ_ONLY tier's SELECT-only role (ece_app) is
-- unchanged. The audit tables remain written by the audit role; this role never touches them.

-- ── review log (governance decisions / sign-offs / approval-gate outcomes) ──
CREATE TABLE IF NOT EXISTS review_log_entries (
  record_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  registered_at  timestamptz NOT NULL DEFAULT now(),
  kind           text NOT NULL CHECK (kind IN ('review_decision','human_signoff','approval_gate','wave_signoff')),
  actor          text,
  target         text,
  payload        jsonb
);
CREATE INDEX IF NOT EXISTS review_log_entries_kind_idx ON review_log_entries (kind, registered_at DESC);

-- ── open-items store ──
CREATE TABLE IF NOT EXISTS open_items (
  record_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  registered_at  timestamptz NOT NULL DEFAULT now(),
  target         text,
  payload        jsonb
);
CREATE INDEX IF NOT EXISTS open_items_registered_idx ON open_items (registered_at DESC);

-- ── shared append-only guard (mirrors the registry pattern) ──
CREATE OR REPLACE FUNCTION factory_append_only_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'append-only: % on % is prohibited (Phase 9.1 live internal-write store)', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE OR REPLACE TRIGGER review_log_entries_no_mutate   BEFORE UPDATE OR DELETE ON review_log_entries FOR EACH ROW       EXECUTE FUNCTION factory_append_only_guard();
CREATE OR REPLACE TRIGGER review_log_entries_no_truncate BEFORE TRUNCATE        ON review_log_entries FOR EACH STATEMENT EXECUTE FUNCTION factory_append_only_guard();
CREATE OR REPLACE TRIGGER open_items_no_mutate           BEFORE UPDATE OR DELETE ON open_items         FOR EACH ROW       EXECUTE FUNCTION factory_append_only_guard();
CREATE OR REPLACE TRIGGER open_items_no_truncate         BEFORE TRUNCATE        ON open_items         FOR EACH STATEMENT EXECUTE FUNCTION factory_append_only_guard();

-- ── the minimally-scoped live-write role ──
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'ece_writer') THEN
    CREATE ROLE ece_writer LOGIN;
  END IF;
END
$$;
GRANT USAGE ON SCHEMA public TO ece_writer;

-- INSERT (append) + SELECT (RETURNING / read history) on EXACTLY the internal-write target tables. No more.
GRANT INSERT, SELECT ON review_log_entries, open_items, risk_register TO ece_writer;
-- Append-only enforced at the privilege layer too: no mutation verbs, ever.
REVOKE UPDATE, DELETE, TRUNCATE ON review_log_entries, open_items, risk_register FROM ece_writer;
REVOKE UPDATE, DELETE, TRUNCATE ON review_log_entries, open_items FROM PUBLIC;
-- ece_writer gets NOTHING on the system of record (clients) — it cannot touch it.
REVOKE ALL ON clients FROM ece_writer;
