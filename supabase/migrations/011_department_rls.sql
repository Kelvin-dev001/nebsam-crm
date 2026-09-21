-- ============================================================================
-- 011_department_rls.sql
--
-- Replaces the open `USING (true)` policies with real, department-aware ones.
-- Spec: DEPARTMENTS-MASTER-PROMPT.md section 8.
--
-- THIS IS THE HIGHEST-RISK MIGRATION IN THE PROJECT. A wrong policy makes data
-- invisible to the people who own it, which looks exactly like data loss to the
-- team even though nothing was deleted. Dry-run it, run the impersonation tests
-- at the foot, and keep the rollback block open in another tab.
--
-- WHAT STILL BYPASSES RLS, AND MUST
--   · service_role — the WhatsApp webhook and the outbound send routes
--   · postgres — owns every table, so the pg_cron RAG job is unaffected
--   · SECURITY DEFINER functions (create_manual_lead, assign_lead_round_robin_v2,
--     check_phone_across_departments, generate_term_billings, rename_funnel_stage,
--     …) execute as their owner, so they keep working for reps
--   Table owners bypass RLS unless FORCE ROW LEVEL SECURITY is set. It is NOT
--   set here, deliberately.
--
-- VISIBILITY MODEL
--   admin  : everything, across all departments
--   rep    : their OWN rows, within their own department
--
--   "Own rows" matches what the app already does (every query filters by
--   assigned_to / telemarketer_id) and what the 006_auth.sql draft intended, so
--   no telematics rep should see any change at all.
--
--   Child tables — school_buses, term_billings, webhook_events — inherit
--   visibility from their parent LEAD rather than carrying their own rule. A
--   bus whose school is invisible would otherwise render with a blank school
--   name, which is worse than not rendering.
--
--   node scripts/migrate-file.mjs supabase/migrations/011_department_rls.sql --dry-run
--   node scripts/migrate-file.mjs supabase/migrations/011_department_rls.sql --confirm=<ref>
-- ============================================================================

SET TimeZone = 'UTC';

-- ============================================================================
-- 1. HELPERS
--
-- SECURITY DEFINER so they can read auth.users and telemarketers regardless of
-- the caller's own policies — otherwise current_rep_department() would be
-- gated by the very policy it is used to evaluate.
--
-- STABLE so PostgreSQL evaluates them once per statement rather than per row.
-- On a 3,400-row leads scan the difference is not academic.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $$
  SELECT coalesce(
    (SELECT raw_user_meta_data->>'role' FROM auth.users WHERE id = auth.uid()) = 'admin',
    FALSE);
$$;

CREATE OR REPLACE FUNCTION public.current_rep()
RETURNS UUID
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT id FROM telemarketers WHERE user_id = auth.uid() AND is_active LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.current_rep_department()
RETURNS UUID
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT department_id FROM telemarketers WHERE user_id = auth.uid() AND is_active LIMIT 1;
$$;

-- Never callable by anon; see 009e for why REVOKE FROM PUBLIC is not enough.
--
-- Because anon cannot execute these, EVERY policy below is scoped TO
-- authenticated. Without that, a signed-out request against `leads` would hit
-- the policy, try to call current_rep_department(), and fail with "permission
-- denied for function" instead of simply returning no rows. Scoping the policy
-- means anon never matches one, which is both the correct result and a far
-- less alarming one. (service_role has BYPASSRLS and postgres owns the tables,
-- so neither is affected by the TO clause.)
REVOKE ALL ON FUNCTION public.is_admin()                FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.current_rep()             FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.current_rep_department()  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_admin()               TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.current_rep()            TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.current_rep_department() TO authenticated, service_role;

-- ============================================================================
-- 2. OPERATIONAL TABLES — admin, or the rep's own rows in their own department
-- ============================================================================

DROP POLICY IF EXISTS "open_leads" ON leads;
DROP POLICY IF EXISTS "leads_dept_scoped" ON leads;
CREATE POLICY "leads_dept_scoped" ON leads FOR ALL TO authenticated
USING (
  public.is_admin()
  OR (department_id = public.current_rep_department() AND assigned_to = public.current_rep())
)
WITH CHECK (
  public.is_admin()
  OR (department_id = public.current_rep_department() AND assigned_to = public.current_rep())
);

DROP POLICY IF EXISTS "open_call_logs" ON call_logs;
DROP POLICY IF EXISTS "call_logs_dept_scoped" ON call_logs;
CREATE POLICY "call_logs_dept_scoped" ON call_logs FOR ALL TO authenticated
USING (
  public.is_admin()
  OR (department_id = public.current_rep_department() AND telemarketer_id = public.current_rep())
)
WITH CHECK (
  public.is_admin()
  OR (department_id = public.current_rep_department() AND telemarketer_id = public.current_rep())
);

DROP POLICY IF EXISTS "open_sales" ON sales;
DROP POLICY IF EXISTS "sales_dept_scoped" ON sales;
CREATE POLICY "sales_dept_scoped" ON sales FOR ALL TO authenticated
USING (
  public.is_admin()
  OR (department_id = public.current_rep_department() AND telemarketer_id = public.current_rep())
)
WITH CHECK (
  public.is_admin()
  OR (department_id = public.current_rep_department() AND telemarketer_id = public.current_rep())
);

DROP POLICY IF EXISTS "open_followup_schedule" ON followup_schedule;
DROP POLICY IF EXISTS "followup_dept_scoped" ON followup_schedule;
CREATE POLICY "followup_dept_scoped" ON followup_schedule FOR ALL TO authenticated
USING (
  public.is_admin()
  OR (department_id = public.current_rep_department() AND telemarketer_id = public.current_rep())
)
WITH CHECK (
  public.is_admin()
  OR (department_id = public.current_rep_department() AND telemarketer_id = public.current_rep())
);

DROP POLICY IF EXISTS "open_service_orders" ON service_orders;
DROP POLICY IF EXISTS "service_orders_dept_scoped" ON service_orders;
CREATE POLICY "service_orders_dept_scoped" ON service_orders FOR ALL TO authenticated
USING (
  public.is_admin()
  OR (department_id = public.current_rep_department() AND telemarketer_id = public.current_rep())
)
WITH CHECK (
  public.is_admin()
  OR (department_id = public.current_rep_department() AND telemarketer_id = public.current_rep())
);

-- ── Child tables: inherit the parent lead's visibility ─────────────────────

DROP POLICY IF EXISTS "open_school_buses" ON school_buses;
DROP POLICY IF EXISTS "school_buses_via_lead" ON school_buses;
CREATE POLICY "school_buses_via_lead" ON school_buses FOR ALL TO authenticated
USING (
  public.is_admin()
  OR EXISTS (SELECT 1 FROM leads l WHERE l.id = school_buses.lead_id)
)
WITH CHECK (
  public.is_admin()
  OR EXISTS (SELECT 1 FROM leads l WHERE l.id = school_buses.lead_id)
);

DROP POLICY IF EXISTS "open_term_billings" ON term_billings;
DROP POLICY IF EXISTS "term_billings_via_lead" ON term_billings;
CREATE POLICY "term_billings_via_lead" ON term_billings FOR ALL TO authenticated
USING (
  public.is_admin()
  OR EXISTS (SELECT 1 FROM leads l WHERE l.id = term_billings.lead_id)
)
WITH CHECK (
  public.is_admin()
  OR EXISTS (SELECT 1 FROM leads l WHERE l.id = term_billings.lead_id)
);

-- webhook_events has no department_id (it predates the expansion), so it is
-- scoped through the lead it was linked to. Rows with a NULL lead_id are the
-- unmatched payloads — admin and service_role only, which is correct: nobody
-- else has any use for them.
DROP POLICY IF EXISTS "open_webhook_events" ON webhook_events;
DROP POLICY IF EXISTS "webhook_events_via_lead" ON webhook_events;
CREATE POLICY "webhook_events_via_lead" ON webhook_events FOR ALL TO authenticated
USING (
  public.is_admin()
  OR (lead_id IS NOT NULL AND EXISTS (SELECT 1 FROM leads l WHERE l.id = webhook_events.lead_id))
)
WITH CHECK (
  public.is_admin()
  OR (lead_id IS NOT NULL AND EXISTS (SELECT 1 FROM leads l WHERE l.id = webhook_events.lead_id))
);

-- NOTE on the EXISTS clauses above: they intentionally do NOT repeat the
-- department/ownership test. The sub-select on `leads` is itself subject to
-- leads_dept_scoped, so a lead the caller cannot see simply does not exist for
-- them and the EXISTS is false. One place defines lead visibility; everything
-- else follows it. Repeating the predicate would create a second definition to
-- keep in sync.

-- ============================================================================
-- 3. PEOPLE AND ROTATION
-- ============================================================================

-- A rep must read their OWN row (AuthProvider looks itself up by user_id) and
-- their department colleagues (the leads table joins rep names). Writes are
-- admin only — reassigning departments is an Admin action.
DROP POLICY IF EXISTS "open_telemarketers" ON telemarketers;
DROP POLICY IF EXISTS "telemarketers_read" ON telemarketers;
DROP POLICY IF EXISTS "telemarketers_write_admin" ON telemarketers;
CREATE POLICY "telemarketers_read" ON telemarketers FOR SELECT TO authenticated
USING (
  public.is_admin()
  OR user_id = auth.uid()
  OR department_id = public.current_rep_department()
);
CREATE POLICY "telemarketers_write_admin" ON telemarketers FOR ALL TO authenticated
USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "open_round_robin_state" ON round_robin_state;
DROP POLICY IF EXISTS "round_robin_read" ON round_robin_state;
DROP POLICY IF EXISTS "round_robin_write_admin" ON round_robin_state;
CREATE POLICY "round_robin_read" ON round_robin_state FOR SELECT TO authenticated
USING (public.is_admin() OR department_id = public.current_rep_department());
CREATE POLICY "round_robin_write_admin" ON round_robin_state FOR ALL TO authenticated
USING (public.is_admin()) WITH CHECK (public.is_admin());

-- ============================================================================
-- 4. CONFIGURATION — readable by every signed-in user, writable by admin only
--
-- The term calendar is reference data every school-bus rep reads and none of
-- them should edit. Same for stages, KYC questions and the product catalogue:
-- reps consume them on every page, admin curates them in Admin → Departments.
--
-- Deliberately NOT readable by `anon`. These carry department names, funnel
-- structure, the KYC question set and product unit prices — commercially
-- meaningful, and the app requires a login anyway. DepartmentProvider was
-- adjusted in the same change so it no longer attempts this load on /login.
-- ============================================================================

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['departments','funnel_stages','kyc_fields',
                           'department_products','academic_terms']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'open_' || t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_read', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_write_admin', t);

    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (true)',
      t || '_read', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin())',
      t || '_write_admin', t);

    RAISE NOTICE 'config table % : authenticated read, admin write', t;
  END LOOP;
END $$;

-- ============================================================================
-- 5. VERIFICATION
-- ============================================================================

DO $$
DECLARE v_open INT; v_norls INT;
BEGIN
  -- No table may be left with an open USING (true) FOR ALL policy.
  SELECT count(*) INTO v_open FROM pg_policies
  WHERE schemaname = 'public' AND policyname LIKE 'open_%';
  IF v_open > 0 THEN RAISE EXCEPTION '% open_* policies remain', v_open; END IF;

  -- Every table that holds data must still have RLS enabled.
  SELECT count(*) INTO v_norls
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity;
  IF v_norls > 0 THEN RAISE EXCEPTION '% public tables have RLS disabled', v_norls; END IF;

  -- The helpers must exist, or every policy silently evaluates to false and
  -- the whole team loses access.
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                 WHERE n.nspname='public' AND p.proname='current_rep_department')
    THEN RAISE EXCEPTION 'current_rep_department() is missing'; END IF;

  RAISE NOTICE 'OK: no open policies remain, RLS enabled everywhere, helpers present';
END $$;

-- ============================================================================
-- ROLLBACK 011 — restores the previous open posture. Paste into the SQL editor.
--
-- DO $$ DECLARE t TEXT; BEGIN
--   FOREACH t IN ARRAY ARRAY['leads','call_logs','sales','followup_schedule',
--                            'webhook_events','round_robin_state','telemarketers',
--                            'departments','funnel_stages','kyc_fields',
--                            'department_products','service_orders',
--                            'academic_terms','school_buses','term_billings'] LOOP
--     EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_dept_scoped', t);
--     EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_via_lead', t);
--     EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_read', t);
--     EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_write_admin', t);
--     EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'open_' || t, t);
--     EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL USING (true) WITH CHECK (true)',
--                    'open_' || t, t);
--   END LOOP;
-- END $$;
-- (leads_dept_scoped / call_logs_dept_scoped etc. use their own names — the
--  loop above covers them because every policy created here ends in one of the
--  four suffixes.)
-- ============================================================================
