-- ============================================================================
-- 010_departments_cutover.sql
--
-- The cutover. This is the ONLY destructive migration in the project, and the
-- only one that changes behaviour the live system depends on.
--
-- Spec: DEPARTMENTS-MASTER-PROMPT.md section 6B.
--
-- PRECONDITIONS, all enforced below and all fatal:
--   · the app is already deployed and writing department_id explicitly
--   · no NULL department_id anywhere
--   · leads_dept_phone_uniq exists and is VALID
--   · leads_updated_at is enabled
--   · no duplicate (department_id, phone_number) pairs
--   · rag_auto_flag_v2 exists (the cron is about to point at it)
--
-- WHAT IT DOES
--   1. SET NOT NULL on department_id across the five tables
--   2. Drop the GLOBAL unique on leads(phone_number) — decision D2
--   3. Repoint the pg_cron job to rag_auto_flag_v2
--   4. REPLICA IDENTITY FULL on leads, for filtered realtime subscriptions
--   5. Leaves the v1 functions in place; dropping them is a later cleanup
--
-- WHAT IT COSTS
--   Brief ACCESS EXCLUSIVE locks on leads, call_logs, sales, followup_schedule
--   and telemarketers. The NOT NULL is done via a NOT VALID CHECK that is then
--   VALIDATEd under a weak lock, so SET NOT NULL itself can skip the full scan
--   (PG12+) and the exclusive lock is held for milliseconds rather than seconds.
--   Run it in a quiet window anyway.
--
--   node scripts/migrate-file.mjs supabase/migrations/010_departments_cutover.sql --dry-run
--   node scripts/migrate-file.mjs supabase/migrations/010_departments_cutover.sql --confirm=<ref>
--
-- A rollback block is at the foot, and it contains the project's genuine point
-- of no return. Read it before running this.
-- ============================================================================

SET TimeZone = 'UTC';

-- ============================================================================
-- 1. PRECONDITIONS — abort the whole migration if any fails
-- ============================================================================

DO $$
DECLARE v_bad INT; v_trig "char";
BEGIN
  SELECT count(*) INTO v_bad FROM leads WHERE department_id IS NULL;
  IF v_bad > 0 THEN RAISE EXCEPTION 'leads has % NULL department_id — 009 incomplete', v_bad; END IF;

  SELECT count(*) INTO v_bad FROM call_logs WHERE department_id IS NULL;
  IF v_bad > 0 THEN RAISE EXCEPTION 'call_logs has % NULL department_id', v_bad; END IF;

  SELECT count(*) INTO v_bad FROM sales WHERE department_id IS NULL;
  IF v_bad > 0 THEN RAISE EXCEPTION 'sales has % NULL department_id', v_bad; END IF;

  SELECT count(*) INTO v_bad FROM followup_schedule WHERE department_id IS NULL;
  IF v_bad > 0 THEN RAISE EXCEPTION 'followup_schedule has % NULL department_id', v_bad; END IF;

  SELECT count(*) INTO v_bad FROM telemarketers WHERE department_id IS NULL;
  IF v_bad > 0 THEN RAISE EXCEPTION 'telemarketers has % NULL department_id', v_bad; END IF;

  -- The composite unique must exist AND be valid. A CONCURRENTLY build that
  -- failed leaves an INVALID index that silently enforces nothing — and we are
  -- about to drop the global constraint that is currently covering for it.
  IF NOT EXISTS (
    SELECT 1 FROM pg_index
    WHERE indexrelid = 'leads_dept_phone_uniq'::regclass AND indisvalid
  ) THEN
    RAISE EXCEPTION 'leads_dept_phone_uniq missing or INVALID — rebuild before cutover';
  END IF;

  SELECT tgenabled INTO v_trig FROM pg_trigger WHERE tgname = 'leads_updated_at';
  IF v_trig IS NULL OR v_trig <> 'O' THEN
    RAISE EXCEPTION 'leads_updated_at is missing or disabled (tgenabled=%)', v_trig;
  END IF;

  -- Should be impossible given the index, but prove it rather than assume it.
  SELECT count(*) INTO v_bad FROM (
    SELECT department_id, phone_number FROM leads GROUP BY 1, 2 HAVING count(*) > 1
  ) d;
  IF v_bad > 0 THEN RAISE EXCEPTION 'refusing cutover: % duplicate (department, phone) pairs', v_bad; END IF;

  -- The cron is about to be pointed at v2, so v2 had better exist.
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'rag_auto_flag_v2'
  ) THEN
    RAISE EXCEPTION 'rag_auto_flag_v2 does not exist — apply 009c first';
  END IF;

  RAISE NOTICE 'OK: all preconditions passed';
END $$;

-- ============================================================================
-- 2. SET NOT NULL on department_id
--
-- Adding a NOT VALID CHECK, validating it under a weak lock, then SET NOT NULL
-- lets PostgreSQL 12+ skip the full table scan it would otherwise do while
-- holding ACCESS EXCLUSIVE. leads is done LAST because it is the busiest table.
-- ============================================================================

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['telemarketers', 'call_logs', 'sales', 'followup_schedule', 'leads']
  LOOP
    EXECUTE format(
      'ALTER TABLE %I ADD CONSTRAINT %I CHECK (department_id IS NOT NULL) NOT VALID',
      t, t || '_dept_nn');
    EXECUTE format('ALTER TABLE %I VALIDATE CONSTRAINT %I', t, t || '_dept_nn');
    EXECUTE format('ALTER TABLE %I ALTER COLUMN department_id SET NOT NULL', t);
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', t, t || '_dept_nn');
    RAISE NOTICE 'department_id is now NOT NULL on %', t;
  END LOOP;
END $$;

-- round_robin_state carries one row per department and is tiny; no ceremony.
ALTER TABLE round_robin_state ALTER COLUMN department_id SET NOT NULL;

-- ============================================================================
-- 3. PHONE KEY SWAP  (decision D2)
--
-- Drop the GLOBAL unique on leads(phone_number). leads_dept_phone_uniq, built
-- CONCURRENTLY back in 009b, already enforces uniqueness per department, so
-- there is no unguarded moment — the global one was simply the stricter of the
-- two.
--
-- The name is looked up rather than assumed: it is declared inline in
-- 001_initial_schema.sql, so PostgreSQL generated it. (It happens to be
-- leads_phone_number_key, but a migration should not bet on that.)
-- ============================================================================

DO $$
DECLARE v_con TEXT;
BEGIN
  SELECT conname INTO v_con
  FROM pg_constraint
  WHERE conrelid = 'leads'::regclass
    AND contype = 'u'
    AND pg_get_constraintdef(oid) ILIKE '%(phone_number)%'
    AND conname <> 'leads_dept_phone_uniq';

  IF v_con IS NULL THEN
    RAISE NOTICE 'no global phone constraint found (already dropped?)';
  ELSE
    RAISE NOTICE 'dropping global phone constraint: %', v_con;
    EXECUTE format('ALTER TABLE leads DROP CONSTRAINT %I', v_con);
  END IF;
END $$;

-- ============================================================================
-- 4. REPOINT THE CRON TO v2
--
-- Same job name, so this replaces rather than duplicates. v1 stays in the
-- database untouched, so reverting is one line (see the rollback block).
-- ============================================================================

DO $$
BEGIN
  IF to_regclass('cron.job') IS NULL THEN
    RAISE NOTICE 'pg_cron not installed here — skipping the cron repoint (staging)';
  ELSE
    PERFORM cron.schedule('rag-auto-flag', '0 5 * * *', 'SELECT public.rag_auto_flag_v2();');
    RAISE NOTICE 'cron rag-auto-flag now calls rag_auto_flag_v2()';
  END IF;
END $$;

-- ============================================================================
-- 5. REALTIME
--
-- Filtered subscriptions (department_id=eq.X) need the full old row in the WAL
-- to match reliably on UPDATE. Deliberately left out of 009 because it raises
-- WAL volume on the busiest table in the system and only matters once the app
-- subscribes with a department filter — which it now does.
-- ============================================================================

ALTER TABLE leads REPLICA IDENTITY FULL;

-- ============================================================================
-- 6. VERIFICATION
-- ============================================================================

DO $$
DECLARE v_bad INT; v_cmd TEXT;
BEGIN
  SELECT count(*) INTO v_bad
  FROM information_schema.columns
  WHERE table_schema = 'public' AND column_name = 'department_id'
    AND table_name IN ('leads','call_logs','sales','followup_schedule','telemarketers','round_robin_state')
    AND is_nullable = 'YES';
  IF v_bad > 0 THEN RAISE EXCEPTION '% department_id columns are still nullable', v_bad; END IF;
  RAISE NOTICE 'OK: department_id is NOT NULL on all six tables';

  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'leads'::regclass AND contype = 'u'
      AND pg_get_constraintdef(oid) ILIKE '%(phone_number)%'
      AND conname <> 'leads_dept_phone_uniq'
  ) THEN
    RAISE EXCEPTION 'the global phone constraint is still present';
  END IF;
  RAISE NOTICE 'OK: global phone constraint dropped; per-department uniqueness remains';

  IF NOT EXISTS (
    SELECT 1 FROM pg_index WHERE indexrelid = 'leads_dept_phone_uniq'::regclass AND indisvalid
  ) THEN
    RAISE EXCEPTION 'leads_dept_phone_uniq is not valid AFTER the swap — uniqueness is unenforced';
  END IF;
  RAISE NOTICE 'OK: leads_dept_phone_uniq is valid and now the sole phone key';

  IF (SELECT relreplident FROM pg_class WHERE oid = 'leads'::regclass) <> 'f' THEN
    RAISE EXCEPTION 'leads REPLICA IDENTITY is not FULL';
  END IF;
  RAISE NOTICE 'OK: leads REPLICA IDENTITY FULL';

  IF (SELECT tgenabled FROM pg_trigger WHERE tgname = 'leads_updated_at') <> 'O'
    THEN RAISE EXCEPTION 'leads_updated_at is not enabled'; END IF;
  IF (SELECT tgenabled FROM pg_trigger WHERE tgname = 'sales_renewal_due_date') <> 'O'
    THEN RAISE EXCEPTION 'sales_renewal_due_date is not enabled'; END IF;
  RAISE NOTICE 'OK: both triggers still enabled';

  -- v1 must survive: it is the rollback path.
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                 WHERE n.nspname='public' AND p.proname='rag_auto_flag')
    THEN RAISE EXCEPTION 'rag_auto_flag v1 has gone — the rollback path is broken'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                 WHERE n.nspname='public' AND p.proname='assign_lead_round_robin')
    THEN RAISE EXCEPTION 'assign_lead_round_robin v1 has gone'; END IF;
  RAISE NOTICE 'OK: both v1 functions retained as the rollback path';

  IF to_regclass('cron.job') IS NOT NULL THEN
    SELECT command INTO v_cmd FROM cron.job WHERE jobname = 'rag-auto-flag';
    IF v_cmd NOT ILIKE '%rag_auto_flag_v2%' THEN
      RAISE EXCEPTION 'cron still points at %', v_cmd;
    END IF;
    RAISE NOTICE 'OK: cron points at rag_auto_flag_v2';
  END IF;
END $$;

-- ============================================================================
-- ROLLBACK 010  (paste into the SQL editor; safe to run any time after 010)
--
-- SELECT cron.schedule('rag-auto-flag', '0 5 * * *', 'SELECT public.rag_auto_flag();');
-- ALTER TABLE leads REPLICA IDENTITY DEFAULT;
-- ALTER TABLE leads             ALTER COLUMN department_id DROP NOT NULL;
-- ALTER TABLE call_logs         ALTER COLUMN department_id DROP NOT NULL;
-- ALTER TABLE sales             ALTER COLUMN department_id DROP NOT NULL;
-- ALTER TABLE followup_schedule ALTER COLUMN department_id DROP NOT NULL;
-- ALTER TABLE telemarketers     ALTER COLUMN department_id DROP NOT NULL;
-- ALTER TABLE round_robin_state ALTER COLUMN department_id DROP NOT NULL;
-- ALTER TABLE leads ADD CONSTRAINT leads_phone_number_key UNIQUE (phone_number);
--
-- ⚠ THE POINT OF NO RETURN IS THAT LAST LINE.
--
-- It only succeeds while no two departments share a phone number. The moment a
-- second department records a number telematics already holds, the global
-- constraint can never be restored, and this rollback becomes partial: the cron
-- and the NOT NULLs revert, the phone key does not.
--
-- Reaching that point is expected and fine — it is the whole purpose of
-- decision D2. Just know where it is. Today it has not been crossed: the three
-- new departments hold zero leads.
-- ============================================================================
