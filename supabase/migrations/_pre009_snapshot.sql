-- ============================================================================
-- _pre009_snapshot.sql  -- READ-ONLY. Sprint D0.
--
-- The "before" picture of production, captured before migration 009 touches
-- anything. DEPARTMENTS-MASTER-PROMPT.md section 10 compares against this output
-- after 009 and again after 010. If row counts or max(updated_at) move, the
-- backfill's trigger suppression failed and production must be restored from
-- the pg_dump rather than repaired by hand.
--
-- Contains no DDL and no writes. Safe to run any time, against any environment.
-- Run it with:
--   node scripts/migrate-file.mjs supabase/migrations/_pre009_snapshot.sql --dry-run
--
-- Deviation from section 6.3, deliberate: the prompt's top-20 query selects
-- phone_number. This file selects id instead. The ordering is what section 10
-- compares, and the ids preserve it exactly, so there is no reason to commit
-- twenty live customer phone numbers to git history.
-- ============================================================================

-- 1. Row counts and time bounds for every table 009 backfills.
SELECT 'leads'             AS t, count(*) AS rows, max(updated_at)::text  AS hi, min(created_at)::text AS lo FROM leads
UNION ALL
SELECT 'call_logs',             count(*),          max(called_at)::text,        min(created_at)::text FROM call_logs
UNION ALL
SELECT 'sales',                 count(*),          max(created_at)::text,       min(created_at)::text FROM sales
UNION ALL
SELECT 'followup_schedule',     count(*),          max(created_at)::text,       min(created_at)::text FROM followup_schedule
UNION ALL
SELECT 'telemarketers',         count(*),          max(created_at)::text,       min(created_at)::text FROM telemarketers
UNION ALL
SELECT 'round_robin_state',     count(*),          max(updated_at)::text,       NULL FROM round_robin_state
UNION ALL
SELECT 'webhook_events',        count(*),          max(received_at)::text,      min(received_at)::text FROM webhook_events
ORDER BY 1;

-- 2. Last-touched ordering. Section 10 requires this list to match row for row
--    after the migration. id is the stable identifier; the tiebreak makes the
--    ordering deterministic when two rows share a timestamp.
--    updated_at is cast to text so the captured value is byte-comparable and
--    independent of the client's timezone and locale.
SELECT id, updated_at::text AS updated_at
FROM leads
ORDER BY updated_at DESC, id
LIMIT 20;

-- 3. Trigger state. Both must report 'O' (enabled) before and after 009.
--    A leads_updated_at left disabled by a failed backfill means updated_at
--    silently stops advancing, which quietly breaks RAG and the queue ordering.
SELECT tgname, tgenabled, tgrelid::regclass::text AS on_table
FROM pg_trigger
WHERE tgname IN ('leads_updated_at', 'sales_renewal_due_date')
ORDER BY tgname;

-- 4. The global phone UNIQUE constraint, by its real name. 001_initial_schema.sql
--    declares it inline, so the name is auto-generated -- migration 010 must look
--    it up rather than assume 'leads_phone_number_key'. This records what it
--    actually is today.
SELECT conname, contype, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'leads'::regclass AND contype IN ('u', 'p')
ORDER BY conname;

-- 5. Indexes on leads, so 009's new composites can be shown to be additions
--    rather than replacements.
SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public' AND tablename = 'leads'
ORDER BY indexname;

-- 6. Distinct funnel_stage and product_interested values in live data. These are
--    exactly what the section 6.3 config-coverage checks must find a seeded row
--    for, or the telematics team's badges and dropdowns lose their values the
--    moment the new app deploys.
SELECT 'funnel_stage' AS field, funnel_stage AS value, count(*) AS leads
FROM leads GROUP BY funnel_stage
UNION ALL
SELECT 'product_interested', coalesce(product_interested, '(null)'), count(*)
FROM leads GROUP BY product_interested
ORDER BY 1, 3 DESC, 2;

-- 7. Columns 009 will add. Every one of these must currently be absent; if any
--    already exists, 009 has been run before and its ADD COLUMN IF NOT EXISTS
--    guards are what stop it being applied twice.
SELECT table_name, column_name, data_type, column_default, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND column_name IN ('department_id', 'kyc', 'company_name', 'created_by',
                      'job_title', 'contract_start', 'contract_end', 'billing_cycle')
ORDER BY table_name, column_name;

-- 8. Tables 009 will create. Expect zero rows on a pre-009 database.
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('departments', 'funnel_stages', 'kyc_fields', 'department_products',
                     'service_orders', 'academic_terms', 'school_buses', 'term_billings')
ORDER BY table_name;

-- 9. The pg_cron schedule. Section 10 requires proof that 009 left the cron pointing
--    at rag_auto_flag v1; migration 010 is the only thing allowed to repoint it.
--
--    Reported through RAISE NOTICE rather than a plain SELECT on cron.job, because
--    a staging project may not have pg_cron enabled. A direct reference to a missing
--    relation fails at parse time and would abort every statement in this file, which
--    would make the snapshot unusable exactly where it is needed most.
DO $$
DECLARE r RECORD;
BEGIN
  IF to_regclass('cron.job') IS NULL THEN
    RAISE NOTICE 'pg_cron: not installed on this database';
  ELSE
    FOR r IN EXECUTE
      'SELECT jobid, jobname, schedule, command, active FROM cron.job ORDER BY jobid'
    LOOP
      RAISE NOTICE 'cron job % (%): schedule=% active=% command=%',
        r.jobid, r.jobname, r.schedule, r.active, r.command;
    END LOOP;
  END IF;
END $$;
