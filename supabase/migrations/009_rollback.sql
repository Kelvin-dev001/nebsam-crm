-- ============================================================================
-- 009_rollback.sql
--
-- Undoes 009_departments_additive.sql, 009b_departments_indexes_concurrent.sql
-- and seed_departments.sql, completely.
--
--   node scripts/migrate-file.mjs supabase/migrations/009_rollback.sql --dry-run
--   node scripts/migrate-file.mjs supabase/migrations/009_rollback.sql --confirm=<project-ref>
--
-- This is safe to run on production at any point BEFORE the new app code is
-- deployed. Every object it drops was created by 009; not one pre-existing row
-- is touched, and not one pre-existing column, constraint, index, trigger,
-- function or policy is altered.
--
-- After the app is deployed it is no longer a rollback but a breaking change:
-- the deployed app reads leads.department_id and the config tables. Roll the
-- app back first, then run this.
--
-- Note on indexes: the five CONCURRENTLY-built indexes from 009b are NOT
-- dropped explicitly. Four of them are on leads.department_id and one is on
-- leads.company_name, so DROP COLUMN removes them automatically. Dropping a
-- column takes the same ACCESS EXCLUSIVE lock either way, so there is nothing
-- to gain from DROP INDEX CONCURRENTLY first.
--
-- Wrapped in a single transaction by the runner: it either fully reverts or
-- changes nothing.
-- ============================================================================

SET TimeZone = 'UTC';

-- 1. Config rows. Deleted before the tables so the intent is explicit; the
--    DROP TABLE below would remove them anyway.
DELETE FROM kyc_fields;
DELETE FROM department_products;
DELETE FROM funnel_stages;

-- 2. Tables created by 009. CASCADE clears the FKs between them.
DROP TRIGGER IF EXISTS school_buses_updated_at ON school_buses;
DROP TABLE IF EXISTS term_billings       CASCADE;
DROP TABLE IF EXISTS school_buses        CASCADE;
DROP TABLE IF EXISTS academic_terms      CASCADE;
DROP TABLE IF EXISTS service_orders      CASCADE;
DROP TABLE IF EXISTS department_products CASCADE;
DROP TABLE IF EXISTS kyc_fields          CASCADE;
DROP TABLE IF EXISTS funnel_stages       CASCADE;

-- 3. Indexes on existing tables that DROP COLUMN will not remove.
DROP INDEX IF EXISTS idx_sales_contract_end;
DROP INDEX IF EXISTS round_robin_state_dept_uniq;
DROP INDEX IF EXISTS idx_call_logs_department;
DROP INDEX IF EXISTS idx_sales_department;

-- 4. Columns added by 009. Dropping leads.department_id also drops
--    leads_dept_phone_uniq, idx_leads_dept_stage, idx_leads_dept_rag and
--    idx_leads_dept_assigned; dropping company_name drops idx_leads_company_name.
ALTER TABLE leads             DROP COLUMN IF EXISTS department_id,
                              DROP COLUMN IF EXISTS kyc,
                              DROP COLUMN IF EXISTS created_by,
                              DROP COLUMN IF EXISTS company_name;
ALTER TABLE call_logs         DROP COLUMN IF EXISTS department_id;
ALTER TABLE sales             DROP COLUMN IF EXISTS department_id,
                              DROP COLUMN IF EXISTS contract_start,
                              DROP COLUMN IF EXISTS contract_end,
                              DROP COLUMN IF EXISTS billing_cycle;
ALTER TABLE followup_schedule DROP COLUMN IF EXISTS department_id;
ALTER TABLE telemarketers     DROP COLUMN IF EXISTS department_id,
                              DROP COLUMN IF EXISTS job_title;
ALTER TABLE round_robin_state DROP COLUMN IF EXISTS department_id;

-- 5. The departments table itself, last: everything referencing it is gone.
DROP TABLE IF EXISTS departments CASCADE;

-- ============================================================================
-- Verify the database is back to its pre-009 shape.
-- ============================================================================

DO $$
DECLARE v_bad INT;
BEGIN
  SELECT count(*) INTO v_bad FROM information_schema.tables
   WHERE table_schema = 'public'
     AND table_name IN ('departments','funnel_stages','kyc_fields','department_products',
                        'service_orders','academic_terms','school_buses','term_billings');
  IF v_bad > 0 THEN RAISE EXCEPTION '% of the 8 new tables still exist', v_bad; END IF;

  SELECT count(*) INTO v_bad FROM information_schema.columns
   WHERE table_schema = 'public'
     AND column_name IN ('department_id','kyc','company_name','created_by','job_title',
                         'contract_start','contract_end','billing_cycle');
  IF v_bad > 0 THEN RAISE EXCEPTION '% of the new columns still exist', v_bad; END IF;

  -- What must have SURVIVED: the pre-existing objects 009 promised not to touch.
  IF (SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public') <> 7
    THEN RAISE EXCEPTION 'expected the original 7 public tables to remain'; END IF;

  IF (SELECT tgenabled FROM pg_trigger WHERE tgname = 'leads_updated_at') <> 'O'
    THEN RAISE EXCEPTION 'leads_updated_at is missing or disabled'; END IF;

  IF (SELECT tgenabled FROM pg_trigger WHERE tgname = 'sales_renewal_due_date') <> 'O'
    THEN RAISE EXCEPTION 'sales_renewal_due_date is missing or disabled'; END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'leads'::regclass AND contype = 'u'
                   AND pg_get_constraintdef(oid) ILIKE '%(phone_number)%')
    THEN RAISE EXCEPTION 'the global phone UNIQUE constraint is gone'; END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname='public' AND p.proname='assign_lead_round_robin')
    THEN RAISE EXCEPTION 'assign_lead_round_robin is gone'; END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname='public' AND p.proname='rag_auto_flag')
    THEN RAISE EXCEPTION 'rag_auto_flag is gone'; END IF;

  RAISE NOTICE 'OK: rolled back to the pre-009 shape. 7 original tables, both triggers';
  RAISE NOTICE 'OK: enabled, global phone constraint intact, both v1 functions present.';
END $$;
