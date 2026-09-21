-- ============================================================================
-- 009d_admin_functions.sql
--
-- Sprint D6. Functions the Admin → Departments tab needs, so that editing
-- configuration is safe from a browser.
--
-- Additive under the same contract as 009 and 009c: new functions under new
-- names, nothing existing touched.
--
--   node scripts/migrate-file.mjs supabase/migrations/009d_admin_functions.sql --dry-run
--   node scripts/migrate-file.mjs supabase/migrations/009d_admin_functions.sql --confirm=<ref>
--
-- Rollback block at the foot.
-- ============================================================================

SET TimeZone = 'UTC';

-- ============================================================================
-- rename_funnel_stage(stage_id, new_key)
--
-- Renaming a stage key is the one configuration edit that touches LEAD DATA.
-- `leads.funnel_stage` stores the key as text, so renaming the config row
-- without migrating the leads would orphan every lead sitting at that stage:
-- their badge would fall back to a title-cased guess, the stage filter would
-- not find them, and rag_auto_flag_v2 would stop counting them as active
-- because the is_active_stage lookup joins on the key.
--
-- Two things make this delicate, and both are handled here rather than in the
-- browser, where a failed second request would leave the two out of step:
--
--  1. IT MUST BE ATOMIC. The config row and the lead rows move together or not
--     at all. That cannot be guaranteed across two PostgREST calls.
--
--  2. IT MUST NOT TOUCH updated_at. `leads` carries a BEFORE UPDATE trigger
--     that sets updated_at = now(). A bare migration UPDATE would stamp every
--     affected lead as "just touched", destroying the last-touched ordering the
--     queue sorts on and the team reads as "when did we last deal with this
--     client". Exactly the trap migration 009's backfill had to avoid. The
--     trigger is suppressed for the duration and restored in the same
--     transaction.
--
-- Returns the number of leads migrated so the UI can say "42 leads moved".
-- ============================================================================

CREATE OR REPLACE FUNCTION public.rename_funnel_stage(
  p_stage_id UUID,
  p_new_key  TEXT
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_dept UUID;
  v_old  TEXT;
  v_n    INT := 0;
BEGIN
  SELECT department_id, key INTO v_dept, v_old
  FROM funnel_stages WHERE id = p_stage_id;

  IF v_dept IS NULL THEN
    RAISE EXCEPTION 'funnel stage % not found', p_stage_id USING ERRCODE = 'no_data_found';
  END IF;

  p_new_key := btrim(p_new_key);
  IF p_new_key = '' THEN
    RAISE EXCEPTION 'stage key cannot be empty' USING ERRCODE = 'null_value_not_allowed';
  END IF;
  IF p_new_key !~ '^[a-z][a-z0-9_]*$' THEN
    RAISE EXCEPTION 'stage key must be snake_case: got %', p_new_key
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF p_new_key = v_old THEN
    RETURN jsonb_build_object('ok', true, 'unchanged', true, 'leads_migrated', 0);
  END IF;

  IF EXISTS (SELECT 1 FROM funnel_stages
             WHERE department_id = v_dept AND key = p_new_key) THEN
    RAISE EXCEPTION 'this department already has a stage called %', p_new_key
      USING ERRCODE = 'unique_violation';
  END IF;

  -- Migrate the leads first, with updated_at protected.
  ALTER TABLE leads DISABLE TRIGGER leads_updated_at;
  UPDATE leads SET funnel_stage = p_new_key
  WHERE department_id = v_dept AND funnel_stage = v_old;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  ALTER TABLE leads ENABLE TRIGGER leads_updated_at;

  -- Historical call logs record the stage a call moved a lead to. Leaving them
  -- on the old key would make the lead's own history unreadable.
  UPDATE call_logs c SET funnel_stage_after_call = p_new_key
  FROM leads l
  WHERE c.lead_id = l.id AND l.department_id = v_dept
    AND c.funnel_stage_after_call = v_old;

  UPDATE funnel_stages SET key = p_new_key WHERE id = p_stage_id;

  RAISE NOTICE 'renamed stage % -> % (% leads migrated)', v_old, p_new_key, v_n;

  RETURN jsonb_build_object(
    'ok', true, 'old_key', v_old, 'new_key', p_new_key, 'leads_migrated', v_n);
END;
$$;

-- ============================================================================
-- reorder_funnel_stages(stage_ids UUID[])
--
-- Applies a drag-and-drop ordering in one write. Takes the ids in their new
-- order and renumbers sort_order from 1. Rejects a list that does not cover
-- exactly one department's stages, so a partial array cannot silently leave
-- gaps or duplicates in the ordering.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.reorder_funnel_stages(p_stage_ids UUID[])
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_dept UUID; v_count INT; v_total INT;
BEGIN
  -- NB: there is no min(uuid) in PostgreSQL, so the department is taken from
  -- any one of the rows after confirming they all share it.
  SELECT count(DISTINCT department_id) INTO v_count
  FROM funnel_stages WHERE id = ANY(p_stage_ids);

  SELECT department_id INTO v_dept
  FROM funnel_stages WHERE id = ANY(p_stage_ids) LIMIT 1;

  IF v_count <> 1 THEN
    RAISE EXCEPTION 'all stages must belong to one department (found %)', v_count
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT count(*) INTO v_total FROM funnel_stages WHERE department_id = v_dept;
  IF v_total <> array_length(p_stage_ids, 1) THEN
    RAISE EXCEPTION 'expected all % stages of the department, got %',
      v_total, array_length(p_stage_ids, 1)
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  UPDATE funnel_stages f
  SET sort_order = o.ord
  FROM unnest(p_stage_ids) WITH ORDINALITY AS o(id, ord)
  WHERE f.id = o.id;

  RETURN jsonb_build_object('ok', true, 'reordered', v_total);
END;
$$;

-- ============================================================================
-- validate_academic_terms()
--
-- The term calendar drives billing dates, the RAG holiday hold and the
-- follow-up picker, so an overlapping or out-of-order calendar produces wrong
-- money rather than a visible error. This reports every problem it can find so
-- the Admin editor can refuse to save a bad calendar.
--
-- Returns an array of human-readable problems; empty means the calendar is sound.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.validate_academic_terms()
RETURNS jsonb
LANGUAGE plpgsql STABLE
SET search_path TO 'public'
AS $$
DECLARE v_problems TEXT[] := '{}'; r RECORD;
BEGIN
  -- Terms that overlap each other.
  FOR r IN
    SELECT a.name AS a_name, b.name AS b_name
    FROM academic_terms a JOIN academic_terms b ON a.id < b.id
    WHERE a.start_date <= b.end_date AND b.start_date <= a.end_date
  LOOP
    v_problems := v_problems || format('%s overlaps %s', r.a_name, r.b_name);
  END LOOP;

  -- A holiday must sit after its own term ends.
  FOR r IN
    SELECT name FROM academic_terms
    WHERE holiday_start IS NOT NULL AND holiday_start <= end_date
  LOOP
    v_problems := v_problems || format('%s: holiday starts before the term ends', r.name);
  END LOOP;

  FOR r IN
    SELECT name FROM academic_terms
    WHERE holiday_start IS NOT NULL AND holiday_end IS NOT NULL
      AND holiday_end < holiday_start
  LOOP
    v_problems := v_problems || format('%s: holiday ends before it starts', r.name);
  END LOOP;

  -- A holiday must not run past the start of the next term.
  FOR r IN
    SELECT a.name, b.name AS next_name
    FROM academic_terms a
    JOIN academic_terms b ON b.start_date > a.end_date
    WHERE a.holiday_end IS NOT NULL
      AND b.start_date = (SELECT min(start_date) FROM academic_terms c WHERE c.start_date > a.end_date)
      AND a.holiday_end >= b.start_date
  LOOP
    v_problems := v_problems || format('%s holiday runs into %s', r.name, r.next_name);
  END LOOP;

  RETURN jsonb_build_object(
    'ok', array_length(v_problems, 1) IS NULL,
    'problems', to_jsonb(v_problems));
END;
$$;

-- ============================================================================
-- Grants. Admin-only operations, but RLS is still open (tightened in 011), so
-- these are granted to authenticated and the UI is what gates them today. Once
-- 011 lands, is_admin() should guard the config tables and these functions
-- should be re-granted accordingly.
-- ============================================================================

GRANT EXECUTE ON FUNCTION public.rename_funnel_stage(UUID, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reorder_funnel_stages(UUID[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.validate_academic_terms() TO authenticated, service_role;

DO $$
BEGIN
  IF (SELECT tgenabled FROM pg_trigger WHERE tgname = 'leads_updated_at') <> 'O' THEN
    RAISE EXCEPTION 'leads_updated_at is not enabled';
  END IF;
  RAISE NOTICE 'OK: admin functions created; leads_updated_at still enabled';
END $$;

-- ============================================================================
-- ROLLBACK 009d
-- DROP FUNCTION IF EXISTS public.rename_funnel_stage(UUID, TEXT);
-- DROP FUNCTION IF EXISTS public.reorder_funnel_stages(UUID[]);
-- DROP FUNCTION IF EXISTS public.validate_academic_terms();
-- ============================================================================
