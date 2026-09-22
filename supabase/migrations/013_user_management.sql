-- ============================================================================
-- 013_user_management.sql
--
-- Sprint U1. Spec: USER-MANAGEMENT-PROMPT.md §7.
--
-- Additive only. Two new columns on telemarketers (nullable, no backfill), one
-- new table, and six new functions. NOTHING existing is modified: no row is
-- touched, no function is replaced, no constraint is changed.
--
-- Everything here is INERT until the U2-U4b routes call it. Applying it changes
-- no behaviour on its own, which is why it is safe to apply ahead of the UI.
--
-- SAFE TO RE-RUN.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. telemarketers — deactivation bookkeeping (§7.1)
-- ----------------------------------------------------------------------------
-- Nullable with no default, so existing rows are untouched and no rewrite
-- happens. is_active already exists and keeps its meaning; these only record
-- WHEN and WHY, which nothing captures today.
ALTER TABLE telemarketers ADD COLUMN IF NOT EXISTS deactivated_at     TIMESTAMPTZ;
ALTER TABLE telemarketers ADD COLUMN IF NOT EXISTS deactivated_reason TEXT;

-- ----------------------------------------------------------------------------
-- 2. user_admin_audit (§7.2)
-- ----------------------------------------------------------------------------
-- With named admins (U4b), "who did this?" becomes answerable. Today every
-- admin action is anonymous because everyone shares one login.
--
-- performed_by_name and performed_by_email are SNAPSHOTS, not joins. The log
-- has to keep reading correctly after an admin is renamed, deactivated or has
-- their email changed — which is the entire point of having named admins. A
-- join would silently rewrite history.
CREATE TABLE IF NOT EXISTS user_admin_audit (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  action             TEXT        NOT NULL,
    -- Reps:   user_created | login_created | password_reset | password_change_required
    --         | password_changed | profile_updated | department_changed
    --         | deactivated | reactivated | work_reassigned
    -- Admins: admin_created | admin_profile_updated | admin_password_reset
    --         | admin_password_change_required | admin_deactivated
    --         | admin_reactivated | shared_admin_retired | step_up_failed
  target_kind        TEXT        NOT NULL DEFAULT 'rep',   -- 'rep' | 'admin'
  target_user_id     UUID,                                 -- auth.users.id; NULL for a rep with no login
  target_rep_id      UUID        REFERENCES telemarketers(id),
  performed_by       UUID,                                 -- auth.uid() of the actor
  performed_by_name  TEXT,                                 -- snapshot, see above
  performed_by_email TEXT,                                 -- snapshot, from getUser() — never from the request body
  details            JSONB       NOT NULL DEFAULT '{}'::jsonb,
    -- e.g. {"from_department":"…","to_department":"…","leads_moved":412,"inheritor":"…"}
    -- NEVER a password, temporary or otherwise.
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_admin_audit_target  ON user_admin_audit(target_rep_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_admin_audit_created ON user_admin_audit(created_at DESC);

ALTER TABLE user_admin_audit ENABLE ROW LEVEL SECURITY;

-- Admin-readable. There is deliberately NO INSERT/UPDATE/DELETE policy for
-- `authenticated`: rows are written only by the API routes through the service
-- role, which makes the log append-only from the application's point of view.
-- An audit log an admin can edit from the browser is not an audit log.
DROP POLICY IF EXISTS "user_admin_audit_read_admin" ON user_admin_audit;
CREATE POLICY "user_admin_audit_read_admin" ON user_admin_audit
  FOR SELECT TO authenticated USING (public.is_admin());

GRANT SELECT ON TABLE public.user_admin_audit TO authenticated;
GRANT ALL    ON TABLE public.user_admin_audit TO service_role;

-- ----------------------------------------------------------------------------
-- 3. reassign_rep_open_work (§7.3) — the heart of deactivate and move
-- ----------------------------------------------------------------------------
-- Moves a rep's OPEN work to an inheritor. Past work stays attributed to the
-- person who did it: call logs, sales and service orders are never touched,
-- because they record who made the call, not who owns the lead now.
--
-- "Open" is defined by the department's own configuration —
-- funnel_stages.is_active_stage — not by a hardcoded list, so a department that
-- adds a stage through Admin gets the right answer with no code change.
-- Terminal leads (lost, unqualified) stay with the person who worked them.
-- Verified before writing this: every lead's funnel_stage resolves to a row for
-- its own department, so the join never silently drops a lead.
--
-- THE BACKLOG FALLBACK, AND A DEVIATION FROM §7.3
-- -----------------------------------------------
-- p_to_rep may be NULL, meaning "return to the department backlog". That works
-- for leads, where assigned_to is nullable. It does NOT work for follow-ups:
-- followup_schedule.telemarketer_id is NOT NULL, so a pending follow-up cannot
-- be orphaned. §7.3 does not account for this.
--
-- Leaving them pending on a deactivated rep would be worse than either option:
-- current_rep() filters on is_active, so they become invisible to every user
-- while still sitting in the follow-up book — which is already 120-overdue-of-
-- 125 without help. So when there is no inheritor, pending follow-ups are
-- CANCELLED and counted separately, and the dialog must say so out loud.
-- 'cancelled' is added to FollowUpStatus in types/crm.ts; every existing
-- consumer filters for 'pending' or treats status as an opaque string, so
-- nothing breaks.
--
-- PRESERVING updated_at
-- ---------------------
-- leads carries a BEFORE UPDATE trigger setting updated_at = now(). The queue
-- sorts on it and the team reads it as "when did we last deal with this
-- client". A reassignment is not someone dealing with the client. Without the
-- suppression below, hundreds of leads jump to the top of the inheritor's queue
-- and that ordering is destroyed permanently. Same pattern as
-- rename_funnel_stage (009d:85-89).
CREATE OR REPLACE FUNCTION public.reassign_rep_open_work(p_from_rep UUID, p_to_rep UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_from_dept UUID;
  v_to_dept   UUID;
  v_to_active BOOLEAN;
  v_leads     INT := 0;
  v_moved_fu  INT := 0;
  v_cancel_fu INT := 0;
BEGIN
  SELECT department_id INTO v_from_dept FROM telemarketers WHERE id = p_from_rep;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That sales rep no longer exists.';
  END IF;

  IF p_to_rep IS NOT NULL THEN
    IF p_to_rep = p_from_rep THEN
      RAISE EXCEPTION 'A rep cannot inherit their own work.';
    END IF;

    SELECT department_id, is_active INTO v_to_dept, v_to_active
    FROM telemarketers WHERE id = p_to_rep;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'The rep chosen to inherit this work no longer exists.';
    END IF;
    IF NOT v_to_active THEN
      RAISE EXCEPTION 'The rep chosen to inherit this work is deactivated.';
    END IF;
    -- Cross-department inheritance would hand someone leads that RLS then hides
    -- from them (leads_dept_scoped requires department_id = current_rep_department()).
    -- The work would belong to nobody who can see it.
    IF v_to_dept IS DISTINCT FROM v_from_dept THEN
      RAISE EXCEPTION 'The inheriting rep must be in the same department, or the leads would be hidden from them.';
    END IF;
  END IF;

  ALTER TABLE leads DISABLE TRIGGER leads_updated_at;

  UPDATE leads l SET assigned_to = p_to_rep
  WHERE l.assigned_to = p_from_rep
    AND EXISTS (
      SELECT 1 FROM funnel_stages fs
      WHERE fs.department_id = l.department_id
        AND fs.key           = l.funnel_stage
        AND fs.is_active_stage
    );
  GET DIAGNOSTICS v_leads = ROW_COUNT;

  ALTER TABLE leads ENABLE TRIGGER leads_updated_at;

  IF p_to_rep IS NOT NULL THEN
    UPDATE followup_schedule SET telemarketer_id = p_to_rep
    WHERE telemarketer_id = p_from_rep AND status = 'pending';
    GET DIAGNOSTICS v_moved_fu = ROW_COUNT;
  ELSE
    UPDATE followup_schedule SET status = 'cancelled'
    WHERE telemarketer_id = p_from_rep AND status = 'pending';
    GET DIAGNOSTICS v_cancel_fu = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object(
    'leads_moved',          v_leads,
    'followups_moved',      v_moved_fu,
    'followups_cancelled',  v_cancel_fu,
    'to_backlog',           (p_to_rep IS NULL)
  );
END $$;

-- ----------------------------------------------------------------------------
-- 4. rep_workload (§7.4) — fixes defect 7
-- ----------------------------------------------------------------------------
-- The Telemarketers tab currently does `select("assigned_to")` and counts the
-- rows in the browser. PostgREST caps responses at the project's max-rows
-- setting (1,000 by default) and there are 3,458 leads, so those counts are
-- silently truncated — wrong, with no error. Counting in SQL removes the cap
-- from the equation entirely.
--
-- "Open" uses the same is_active_stage definition as reassign_rep_open_work, so
-- the number the admin sees before reassigning is the number that moves.
CREATE OR REPLACE FUNCTION public.rep_workload()
RETURNS TABLE (rep_id UUID, open_leads BIGINT, pending_followups BIGINT)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    t.id,
    (SELECT count(*) FROM leads l
      WHERE l.assigned_to = t.id
        AND EXISTS (SELECT 1 FROM funnel_stages fs
                    WHERE fs.department_id = l.department_id
                      AND fs.key = l.funnel_stage
                      AND fs.is_active_stage)),
    (SELECT count(*) FROM followup_schedule f
      WHERE f.telemarketer_id = t.id AND f.status = 'pending')
  FROM telemarketers t;
$$;

-- ----------------------------------------------------------------------------
-- 5. revoke_user_sessions (§7.5) — VERIFY BEFORE RELYING ON IT
-- ----------------------------------------------------------------------------
-- Ends every session for a user, so a login left open on a shared office
-- computer stops working after a password reset or a deactivation.
--
-- This writes to the `auth` schema, which Supabase does not formally support.
-- §7.5 is explicit that it must be PROVEN on staging — sign in, confirm a row
-- appears, revoke, confirm the next refresh fails — and DROPPED if it does not
-- work, falling back to ban plus the is_active RLS check. Do not work around a
-- failure here.
CREATE OR REPLACE FUNCTION public.revoke_user_sessions(p_user_id UUID)
RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $$
DECLARE v_n INT;
BEGIN
  DELETE FROM auth.sessions WHERE user_id = p_user_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $$;

-- ----------------------------------------------------------------------------
-- 6. deactivate_admin_guarded (§7.6) — the last-admin rule, race-safe
-- ----------------------------------------------------------------------------
-- Checking "are there other admins?" in the API route and then deactivating is
-- a race: two admins deactivating each other at the same instant both see a
-- count of 2, both proceed, and the system ends with ZERO administrators. Only
-- the break-glass script could recover from that.
--
-- The advisory lock serialises every admin deactivation for the life of the
-- transaction, so the check and the write cannot be interleaved.
CREATE OR REPLACE FUNCTION public.deactivate_admin_guarded(
  p_target UUID, p_actor UUID, p_reason TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $$
DECLARE v_active BOOLEAN; v_others INT;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('nebsam_admin_roster'));

  IF p_target = p_actor THEN
    RAISE EXCEPTION 'You cannot deactivate your own account.';
  END IF;

  SELECT is_active INTO v_active FROM admin_profiles WHERE user_id = p_target;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'That administrator does not exist.';
  END IF;

  -- Idempotent: a retry of a call that already succeeded is not an error.
  IF NOT v_active THEN
    RETURN jsonb_build_object('ok', true, 'already', true);
  END IF;

  SELECT count(*) INTO v_others
  FROM admin_profiles p JOIN auth.users u ON u.id = p.user_id
  WHERE p.is_active
    AND p.user_id <> p_target
    AND u.raw_app_meta_data->>'role' = 'admin'
    AND (u.banned_until IS NULL OR u.banned_until <= now());

  IF v_others = 0 THEN
    RAISE EXCEPTION 'At least one active administrator must remain.';
  END IF;

  UPDATE admin_profiles
     SET is_active = FALSE, deactivated_at = now(), deactivated_reason = p_reason
   WHERE user_id = p_target;

  -- is_admin() reads is_active live, so the target loses all admin data access
  -- at this moment — before the route has even called the Auth API to ban them.
  RETURN jsonb_build_object('ok', true, 'already', false, 'remaining_admins', v_others);
END $$;

-- Reactivation needs no guard: it can never reduce the administrator count.
CREATE OR REPLACE FUNCTION public.reactivate_admin(p_target UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE admin_profiles
     SET is_active = TRUE, deactivated_at = NULL, deactivated_reason = NULL
   WHERE user_id = p_target;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'That administrator does not exist.';
  END IF;

  RETURN jsonb_build_object('ok', true);
END $$;

-- ----------------------------------------------------------------------------
-- 7. Grants — the 009e rule
-- ----------------------------------------------------------------------------
-- Supabase's ALTER DEFAULT PRIVILEGES grants anon EXECUTE on every function
-- created in public, and REVOKE ... FROM PUBLIC does NOT remove that explicit
-- grant. Every one of these functions is SECURITY DEFINER and bypasses RLS, so
-- anon holding EXECUTE on them would be worse than the hole 012 just closed.
--
-- All six are service_role only: they are called by API routes behind
-- requireAdmin(), never from the browser.
DO $$
DECLARE f TEXT;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.reassign_rep_open_work(uuid,uuid)',
    'public.rep_workload()',
    'public.revoke_user_sessions(uuid)',
    'public.deactivate_admin_guarded(uuid,uuid,text)',
    'public.reactivate_admin(uuid)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
  END LOOP;
END $$;

-- ----------------------------------------------------------------------------
-- 8. Verification — fails the migration rather than reporting a problem
-- ----------------------------------------------------------------------------
DO $$
DECLARE v_n INT; v_rls BOOLEAN; v_pol INT; v_src TEXT;
BEGIN
  -- Every function exists.
  SELECT count(*) INTO v_n FROM pg_proc
  WHERE pronamespace = 'public'::regnamespace
    AND proname IN ('reassign_rep_open_work','rep_workload','revoke_user_sessions',
                    'deactivate_admin_guarded','reactivate_admin');
  IF v_n <> 5 THEN RAISE EXCEPTION 'expected 5 new functions, found %', v_n; END IF;

  -- anon can execute none of them.
  SELECT count(*) INTO v_n FROM information_schema.routine_privileges
  WHERE routine_schema = 'public' AND grantee IN ('anon','authenticated')
    AND routine_name IN ('reassign_rep_open_work','rep_workload','revoke_user_sessions',
                         'deactivate_admin_guarded','reactivate_admin');
  IF v_n > 0 THEN RAISE EXCEPTION 'anon/authenticated still hold EXECUTE on % new function(s)', v_n; END IF;

  -- The audit table is neither open nor unreadable.
  SELECT relrowsecurity INTO v_rls FROM pg_class WHERE oid = 'public.user_admin_audit'::regclass;
  IF NOT v_rls THEN RAISE EXCEPTION 'RLS is not enabled on user_admin_audit'; END IF;

  SELECT count(*) INTO v_pol FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'user_admin_audit';
  IF v_pol = 0 THEN RAISE EXCEPTION 'user_admin_audit has RLS on but no policy - it would deny everything'; END IF;

  -- No write policy for authenticated: the log must be append-only from the app.
  SELECT count(*) INTO v_n FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'user_admin_audit' AND cmd <> 'SELECT';
  IF v_n > 0 THEN RAISE EXCEPTION 'user_admin_audit has % non-SELECT policy(ies)', v_n; END IF;

  -- The new columns landed.
  SELECT count(*) INTO v_n FROM information_schema.columns
  WHERE table_schema='public' AND table_name='telemarketers'
    AND column_name IN ('deactivated_at','deactivated_reason');
  IF v_n <> 2 THEN RAISE EXCEPTION 'telemarketers is missing the deactivation columns'; END IF;

  -- The reassign function must restore the trigger it disables. Catch a future
  -- edit that drops the ENABLE line, which would silently destroy the queue's
  -- ordering on every reassignment.
  SELECT pg_get_functiondef('public.reassign_rep_open_work(uuid,uuid)'::regprocedure) INTO v_src;
  IF v_src NOT LIKE '%ENABLE TRIGGER leads_updated_at%' THEN
    RAISE EXCEPTION 'reassign_rep_open_work does not re-enable leads_updated_at';
  END IF;

  -- And the trigger is enabled right now.
  SELECT count(*) INTO v_n FROM pg_trigger
  WHERE tgrelid = 'public.leads'::regclass AND tgname = 'leads_updated_at' AND tgenabled = 'O';
  IF v_n <> 1 THEN RAISE EXCEPTION 'leads_updated_at is not enabled'; END IF;

  RAISE NOTICE 'OK: 5 functions, audit table RLS + read-only policy, deactivation columns';
  RAISE NOTICE 'OK: anon and authenticated hold EXECUTE on none of the new functions';
  RAISE NOTICE 'REMINDER: revoke_user_sessions must be PROVEN on staging or dropped (7.5)';
END $$;

-- ============================================================================
-- ROLLBACK 013 — everything here is additive and unused until U2+, so this is
-- clean. Paste into the SQL editor.
--
-- DROP FUNCTION IF EXISTS public.reassign_rep_open_work(uuid,uuid);
-- DROP FUNCTION IF EXISTS public.rep_workload();
-- DROP FUNCTION IF EXISTS public.revoke_user_sessions(uuid);
-- DROP FUNCTION IF EXISTS public.deactivate_admin_guarded(uuid,uuid,text);
-- DROP FUNCTION IF EXISTS public.reactivate_admin(uuid);
-- DROP TABLE IF EXISTS public.user_admin_audit;
-- ALTER TABLE telemarketers DROP COLUMN IF EXISTS deactivated_at,
--                           DROP COLUMN IF EXISTS deactivated_reason;
--
-- Dropping the columns discards any deactivation reasons recorded by then. If
-- anyone has been deactivated through the UI, keep the columns and drop only
-- the functions.
-- ============================================================================
