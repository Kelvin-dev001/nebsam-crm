-- ============================================================================
-- 009e_function_grants.sql   -- SECURITY FIX
--
-- Every SECURITY DEFINER function in `public` is currently executable by the
-- `anon` role. The anon key ships inside the browser bundle, so "anon" means
-- anyone on the internet who opens the app and reads its JavaScript.
--
-- HOW THIS HAPPENED
--
-- Supabase sets, on every project:
--     ALTER DEFAULT PRIVILEGES IN SCHEMA public
--       GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
--
-- so each new function is created with an EXPLICIT `anon=X` grant. A
-- `REVOKE ALL ... FROM PUBLIC` — which is what 009c did for rag_auto_flag_v2 —
-- removes only the PUBLIC pseudo-role grant and leaves the explicit anon grant
-- untouched. Confirmed on staging: with nothing but the public anon key it was
-- possible to call create_manual_lead and CREATE A LEAD, to read
-- check_phone_across_departments (which returns other departments' lead
-- summaries, including the rep's name), and to run rag_auto_flag_v2.
--
-- WHAT IS AFFECTED WHERE
--
--   Staging only : the seven functions from 009c and the three from 009d.
--                  Neither migration has been applied to production yet, so
--                  this is caught before it ships.
--   PRODUCTION   : assign_lead_round_robin and rag_auto_flag predate this work
--                  and are `(default: PUBLIC)` — executable by anon TODAY.
--                  assign_lead_round_robin inserts a lead and a webhook_event
--                  on each call; rag_auto_flag rewrites rag_status across every
--                  lead in the database. Both are reachable with a key that is,
--                  by design, public.
--
-- WHY THIS IS SAFE TO APPLY
--
--   · The WhatsApp webhook authenticates with SUPABASE_SERVICE_ROLE_KEY
--     (app/api/webhook/whatsapp/route.ts:85), so it keeps working.
--   · pg_cron runs `rag-auto-flag` as postgres, which OWNS the functions and
--     therefore always retains EXECUTE.
--   · The app calls create_manual_lead and friends as `authenticated`, which
--     keeps its grant.
--   · This migration only ever REMOVES access. It creates nothing and changes
--     no function body, so a rollback is simply re-granting.
--
--   node scripts/migrate-file.mjs supabase/migrations/009e_function_grants.sql --dry-run
--   node scripts/migrate-file.mjs supabase/migrations/009e_function_grants.sql --confirm=<ref>
-- ============================================================================

SET TimeZone = 'UTC';

DO $$
DECLARE
  r RECORD;
  v_sig TEXT;
BEGIN
  -- Strip anon (and PUBLIC) from EVERY function in public, then hand back only
  -- what each one genuinely needs. Iterating the catalogue rather than listing
  -- names means a function added later cannot be quietly missed... but note it
  -- will still be created with anon access by the default privileges, so this
  -- migration is a floor, not a ceiling. See the note at the foot.
  FOR r IN
    SELECT p.oid, p.proname,
           pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prokind = 'f'
  LOOP
    v_sig := format('public.%I(%s)', r.proname, r.args);

    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', v_sig);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', v_sig);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', v_sig);

    -- service_role is the server-side key: the webhook, the cron and any
    -- future job. It keeps everything.
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', v_sig);

    -- Signed-in users get exactly the functions the app calls from the browser...
    IF r.proname IN (
      'create_manual_lead',
      'check_phone_across_departments',
      'generate_term_billings',
      'is_school_holiday',
      'normalize_phone_ke',
      'rename_funnel_stage',
      'reorder_funnel_stages',
      'validate_academic_terms'
    )
    -- ...PLUS anything an RLS POLICY calls. This clause was added in U1 after
    -- re-running this file broke staging, and it is the more important half.
    --
    -- A policy expression is evaluated with the privileges of the QUERYING
    -- role. So if `authenticated` cannot EXECUTE a function a policy calls,
    -- every query by every signed-in user fails with
    --     permission denied for function ...
    -- rather than simply returning no rows. The app goes down for everyone.
    --
    -- That is exactly what happened: the hardcoded list above was written
    -- before migration 011, which added is_admin(), current_rep() and
    -- current_rep_department() and granted them to authenticated. This file
    -- revokes from EVERY function before re-granting, so re-running it stripped
    -- all three and broke all fifteen policies in 011. Production was spared
    -- only because 011 happened to be applied after the last run of this file.
    --
    -- Deriving it from pg_policies rather than adding three more names means a
    -- future helper cannot reintroduce the same outage.
       OR EXISTS (
         SELECT 1 FROM pg_policies pol
         WHERE pol.schemaname = 'public'
           AND (coalesce(pol.qual, '') || ' ' || coalesce(pol.with_check, ''))
               LIKE '%' || r.proname || '(%'
       )
    THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', v_sig);
    END IF;

    -- Nothing is granted to anon. The app requires a login, so no unauthenticated
    -- caller has business executing any of these.
    RAISE NOTICE 'locked down %', v_sig;
  END LOOP;
END $$;

-- ============================================================================
-- Verification 1: every function an RLS POLICY calls must still be executable
-- by `authenticated`, or the app is down for every signed-in user.
--
-- This check exists because this file caused exactly that outage on staging.
-- It is deliberately first: a missing anon revoke is a security hole, but a
-- missing authenticated grant is a total outage, and the outage should stop the
-- migration before anything else is reported.
-- ============================================================================

DO $$
DECLARE v_bad TEXT;
BEGIN
  SELECT string_agg(DISTINCT p.proname, ', ')
    INTO v_bad
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.prokind = 'f'
    AND EXISTS (
      SELECT 1 FROM pg_policies pol
      WHERE pol.schemaname = 'public'
        AND (coalesce(pol.qual, '') || ' ' || coalesce(pol.with_check, ''))
            LIKE '%' || p.proname || '(%'
    )
    AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE');

  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION
      'RLS policies call these functions but `authenticated` cannot execute them: %. Every signed-in query would fail with "permission denied for function".',
      v_bad;
  END IF;

  RAISE NOTICE 'OK: every policy-referenced function is executable by authenticated';
END $$;

-- ============================================================================
-- Verification: anon must hold EXECUTE on nothing in public.
-- ============================================================================

DO $$
DECLARE v_bad TEXT;
BEGIN
  SELECT string_agg(p.proname, ', ')
    INTO v_bad
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.prokind = 'f'
    AND has_function_privilege('anon', p.oid, 'EXECUTE');

  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'anon can still execute: %', v_bad;
  END IF;
  RAISE NOTICE 'OK: anon has EXECUTE on no function in public';

  -- The two the live system depends on must still be callable by their callers.
  IF NOT has_function_privilege('service_role', 'public.assign_lead_round_robin(text,text,text,text,jsonb)', 'EXECUTE')
    THEN RAISE EXCEPTION 'service_role lost EXECUTE on assign_lead_round_robin — the webhook would break'; END IF;

  IF NOT has_function_privilege('postgres', 'public.rag_auto_flag()', 'EXECUTE')
    THEN RAISE EXCEPTION 'postgres lost EXECUTE on rag_auto_flag — the cron would break'; END IF;

  RAISE NOTICE 'OK: webhook (service_role) and cron (postgres) retain what they need';
END $$;

-- ============================================================================
-- NOTE FOR FUTURE MIGRATIONS
--
-- Supabase's default privileges will grant anon EXECUTE on any function created
-- after this migration too. Every future CREATE FUNCTION in this project must
-- therefore be followed by:
--
--     REVOKE ALL ON FUNCTION public.<name>(<args>) FROM PUBLIC, anon;
--
-- A `REVOKE ... FROM PUBLIC` on its own is NOT enough. This is recorded in
-- CLAUDE.md as well, because it is invisible until someone tries the anon key.
--
-- ROLLBACK (restores the previous, permissive state — do not run casually):
-- DO $$ DECLARE r RECORD; BEGIN
--   FOR r IN SELECT p.oid, p.proname, pg_get_function_identity_arguments(p.oid) a
--            FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
--            WHERE n.nspname='public' AND p.prokind='f' LOOP
--     EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO anon, authenticated, service_role', r.proname, r.a);
--   END LOOP;
-- END $$;
-- ============================================================================
