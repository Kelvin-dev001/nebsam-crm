-- ============================================================================
-- 009b_departments_indexes_concurrent.sql
--
-- The indexes on the live `leads` table. Split out of 009 because
-- CREATE INDEX CONCURRENTLY cannot run inside a transaction block, and 009
-- must be transactional -- its backfill disables leads_updated_at, and that
-- suppression is only safe if a failure rolls the whole thing back.
--
-- Run AFTER 009 has been applied:
--   node scripts/migrate-file.mjs supabase/migrations/009b_departments_indexes_concurrent.sql \
--        --no-transaction --confirm=<project-ref>
--
-- CONCURRENTLY builds without an exclusive lock, so the telematics team keeps
-- working while these are created. The cost is that a failed build leaves an
-- INVALID index behind that silently does nothing -- hence the check at the
-- foot of this file, which raises rather than reporting quietly.
--
-- There is deliberately no --dry-run for this file: a CONCURRENTLY build
-- cannot be rolled back, so a dry run of it would be meaningless. The runner
-- refuses the combination.
--
-- Note on `leads_dept_phone_uniq`: it is created here but the existing global
-- UNIQUE on leads(phone_number) is NOT dropped. Both coexist happily -- the
-- global one is simply stricter. Dropping it is a cutover operation and
-- belongs in 010, after the app is deployed.
--
-- idx_leads_department is deliberately absent: leads_dept_phone_uniq and the
-- composites below all lead with department_id already, so a standalone index
-- on it would never be chosen.
-- ============================================================================

-- @statement
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS leads_dept_phone_uniq
  ON leads(department_id, phone_number);

-- @statement
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_leads_dept_stage
  ON leads(department_id, funnel_stage);

-- @statement
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_leads_dept_rag
  ON leads(department_id, rag_status);

-- @statement
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_leads_dept_assigned
  ON leads(department_id, assigned_to);

-- @statement
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_leads_company_name
  ON leads(company_name);

-- @statement
-- Every index above must be VALID. An invalid index is not an error condition
-- Postgres reports on its own: it simply sits there being ignored by the
-- planner, so the composite lookups quietly fall back to sequential scans and
-- leads_dept_phone_uniq quietly stops enforcing uniqueness. Migration 010's
-- preconditions check leads_dept_phone_uniq specifically for this reason.
DO $$
DECLARE r RECORD; v_bad TEXT := '';
BEGIN
  FOR r IN
    SELECT c.relname, i.indisvalid
    FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
    WHERE c.relname IN ('leads_dept_phone_uniq','idx_leads_dept_stage','idx_leads_dept_rag',
                        'idx_leads_dept_assigned','idx_leads_company_name')
  LOOP
    IF r.indisvalid THEN
      RAISE NOTICE 'index % is VALID', r.relname;
    ELSE
      v_bad := v_bad || r.relname || ' ';
    END IF;
  END LOOP;

  IF v_bad <> '' THEN
    RAISE EXCEPTION 'INVALID index(es): % -- DROP INDEX CONCURRENTLY each one and rebuild', v_bad;
  END IF;

  IF (SELECT count(*) FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
      WHERE c.relname IN ('leads_dept_phone_uniq','idx_leads_dept_stage','idx_leads_dept_rag',
                          'idx_leads_dept_assigned','idx_leads_company_name')) <> 5
  THEN
    RAISE EXCEPTION 'expected 5 indexes, some were not created';
  END IF;

  RAISE NOTICE 'OK: all 5 indexes present and valid';
END $$;
