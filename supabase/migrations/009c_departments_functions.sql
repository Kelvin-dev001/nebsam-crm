-- ============================================================================
-- 009c_departments_functions.sql
--
-- Sprint D2. Department-aware functions, shipped under NEW NAMES alongside the
-- live v1 functions. Spec: DEPARTMENTS-MASTER-PROMPT.md section 6.5.
--
-- NOTHING IN THIS FILE IS CALLED BY ANYTHING YET.
--   * assign_lead_round_robin v1 still serves every inbound WhatsApp message.
--     The webhook route switches to v2 as part of the app deploy (D7).
--   * rag_auto_flag v1 still runs at 05:00 UTC. The cron switches to v2 in 010.
--   Both switches are one-line reversals.
--
-- Numbered 009c rather than 010 deliberately: this is additive under the same
-- safety contract as 009 (CREATE FUNCTION under new names only, no existing
-- object touched), so it is safe on live production. 010 stays reserved for the
-- cutover, which is the file that actually changes behaviour.
--
--   node scripts/migrate-file.mjs supabase/migrations/009c_departments_functions.sql --dry-run
--   node scripts/migrate-file.mjs supabase/migrations/009c_departments_functions.sql --confirm=<ref>
--
-- Rollback block at the foot.
-- ============================================================================

SET TimeZone = 'UTC';

-- ============================================================================
-- 1. normalize_phone_ke(TEXT) -> TEXT
--
-- Kenyan MSISDN normalisation, server side. The UI normalises on blur too
-- (lib/utils/phoneHelpers.ts), but the database is the only place that can
-- guarantee it, and the (department_id, phone_number) unique index is only
-- meaningful if every writer agrees on the format.
--
-- 0712345678 | 712345678 | 254712345678 | +254712345678 -> +254712345678
-- Anything it cannot confidently parse is returned trimmed and unchanged
-- rather than mangled: a number that looks wrong is better than a number
-- that is silently wrong.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.normalize_phone_ke(p_phone TEXT)
RETURNS TEXT
LANGUAGE plpgsql IMMUTABLE
SET search_path TO 'public'
AS $$
DECLARE d TEXT;
BEGIN
  IF p_phone IS NULL THEN RETURN NULL; END IF;

  -- Strip everything that is not a digit (spaces, dashes, brackets, leading +).
  d := regexp_replace(p_phone, '[^0-9]', '', 'g');
  IF d = '' THEN RETURN btrim(p_phone); END IF;

  -- 254XXXXXXXXX (12 digits) -> already correct
  IF length(d) = 12 AND left(d, 3) = '254' THEN RETURN '+' || d; END IF;
  -- 0XXXXXXXXX (10 digits, local trunk prefix) -> drop the 0
  IF length(d) = 10 AND left(d, 1) = '0' THEN RETURN '+254' || substr(d, 2); END IF;
  -- XXXXXXXXX (9 digits, no trunk prefix)
  IF length(d) = 9 THEN RETURN '+254' || d; END IF;
  -- 00254XXXXXXXXX international prefix
  IF length(d) = 14 AND left(d, 5) = '00254' THEN RETURN '+' || substr(d, 3); END IF;

  RETURN btrim(p_phone);
END;
$$;

-- ============================================================================
-- 2. is_school_holiday(DATE) -> BOOLEAN   (section 6.1)
--
-- Degrades to FALSE on an empty academic_terms table, which is the state
-- production is in until the term calendar is entered in Admin (D6). FALSE is
-- the safe default: no holiday hold, so RAG behaves exactly as it does for
-- every other department rather than silently suppressing escalations.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.is_school_holiday(p_date DATE)
RETURNS BOOLEAN
LANGUAGE sql STABLE
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM academic_terms
    WHERE holiday_start IS NOT NULL AND holiday_end IS NOT NULL
      AND p_date BETWEEN holiday_start AND holiday_end
  );
$$;

-- ============================================================================
-- 3. check_phone_across_departments(TEXT)   (decision D2, soft duplicate warning)
--
-- Returns ONLY summary columns -- never lead detail -- so a rep can be warned
-- about a cross-department duplicate without being granted read access to
-- another department's data. This is what powers the amber "this number is
-- also a prospect in Vehicle Telematics" banner.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.check_phone_across_departments(p_phone TEXT)
RETURNS TABLE (
  department_id   UUID,
  department_slug TEXT,
  department_name TEXT,
  funnel_stage    TEXT,
  assigned_rep    TEXT,
  created_at      TIMESTAMPTZ
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT d.id, d.slug, d.name, l.funnel_stage, t.full_name, l.created_at
  FROM leads l
  JOIN departments d ON d.id = l.department_id
  LEFT JOIN telemarketers t ON t.id = l.assigned_to
  WHERE l.phone_number = public.normalize_phone_ke(p_phone)
  ORDER BY d.sort_order;
$$;

-- ============================================================================
-- 4. assign_lead_round_robin_v2   (section 6.5)
--
-- Department-scoped replacement for the live v1. The bug it fixes: v1 rotates
-- over ALL active telemarketers, so the moment an e-seal or fuel rep exists,
-- inbound telematics leads start being assigned to them. v1 is left running
-- because no non-telematics rep exists yet (decision: none until after
-- cutover), so the bug cannot fire in the meantime.
--
-- Department first, no defaults: a defaulted parameter added to v1 would have
-- created an OVERLOAD, not a replacement, and the existing 5-argument call
-- would then fail with "function is not unique". A new name is the only clean
-- path.
--
-- Behaviour is otherwise identical to v1, scoped by department:
--   * telemarketer pool  WHERE is_active AND department_id = <dept>
--   * lead lookup        WHERE phone_number = <phone> AND department_id = <dept>
--   * round_robin_state  the row WHERE department_id = <dept>
-- ============================================================================

CREATE OR REPLACE FUNCTION public.assign_lead_round_robin_v2(
  p_department_slug TEXT,
  p_phone           TEXT,
  p_name            TEXT,
  p_message         TEXT,
  p_campaign        TEXT,
  p_raw_payload     JSONB
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_dept_id               UUID;
  v_phone                 TEXT;
  v_existing_lead_id      UUID;
  v_lead_id               UUID;
  v_telemarketers         UUID[];
  v_last_assigned         UUID;
  v_last_idx              INT;
  v_next_telemarketer_id  UUID;
  v_is_new                BOOLEAN := FALSE;
  v_state_id              UUID;
  v_stage                 TEXT;
BEGIN
  SELECT id INTO v_dept_id FROM departments WHERE slug = p_department_slug;
  IF v_dept_id IS NULL THEN
    RAISE EXCEPTION 'unknown department slug: %', p_department_slug
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  v_phone := public.normalize_phone_ke(p_phone);

  SELECT id INTO v_existing_lead_id
  FROM leads WHERE phone_number = v_phone AND department_id = v_dept_id;

  IF v_existing_lead_id IS NOT NULL THEN
    -- Same as v1: fill a missing name, always refresh the last message.
    UPDATE leads SET
      full_name        = CASE WHEN full_name IS NULL AND p_name IS NOT NULL THEN p_name ELSE full_name END,
      whatsapp_message = CASE WHEN p_message IS NOT NULL THEN p_message ELSE whatsapp_message END
    WHERE id = v_existing_lead_id;
    v_lead_id := v_existing_lead_id;
  ELSE
    SELECT ARRAY_AGG(id ORDER BY created_at) INTO v_telemarketers
    FROM telemarketers
    WHERE is_active = TRUE AND department_id = v_dept_id;

    IF v_telemarketers IS NULL OR ARRAY_LENGTH(v_telemarketers, 1) IS NULL THEN
      RAISE EXCEPTION 'no active telemarketers in department %', p_department_slug
        USING ERRCODE = 'no_data_found';
    END IF;

    SELECT last_assigned_telemarketer_id INTO v_last_assigned
    FROM round_robin_state WHERE department_id = v_dept_id LIMIT 1;

    SELECT COALESCE(ARRAY_POSITION(v_telemarketers, v_last_assigned), 0) INTO v_last_idx;

    v_next_telemarketer_id :=
      v_telemarketers[(v_last_idx % ARRAY_LENGTH(v_telemarketers, 1)) + 1];

    -- The department's first stage, from config rather than a hardcoded 'new'.
    -- For telematics this resolves to 'new', identical to v1.
    SELECT key INTO v_stage FROM funnel_stages
    WHERE department_id = v_dept_id ORDER BY sort_order LIMIT 1;
    v_stage := COALESCE(v_stage, 'new');

    INSERT INTO leads (
      phone_number, full_name, whatsapp_message, campaign_name,
      lead_source, funnel_stage, rag_status, assigned_to, department_id
    ) VALUES (
      v_phone, p_name, p_message, p_campaign,
      'whatsapp_bot', v_stage, 'amber', v_next_telemarketer_id, v_dept_id
    ) RETURNING id INTO v_lead_id;

    SELECT id INTO v_state_id FROM round_robin_state WHERE department_id = v_dept_id LIMIT 1;
    IF v_state_id IS NOT NULL THEN
      UPDATE round_robin_state
      SET last_assigned_telemarketer_id = v_next_telemarketer_id, updated_at = now()
      WHERE id = v_state_id;
    ELSE
      INSERT INTO round_robin_state (last_assigned_telemarketer_id, department_id)
      VALUES (v_next_telemarketer_id, v_dept_id);
    END IF;

    v_is_new := TRUE;
  END IF;

  INSERT INTO webhook_events (raw_payload, phone_number, processed, lead_id)
  VALUES (p_raw_payload, v_phone, TRUE, v_lead_id);

  RETURN jsonb_build_object(
    'lead_id', v_lead_id, 'is_new', v_is_new,
    'assigned_to', v_next_telemarketer_id, 'department_id', v_dept_id
  );
END;
$$;

-- ============================================================================
-- 5. create_manual_lead   (section 6.5, decision D4)
--
-- The entry point for the three manual departments. Applies the department's
-- assignment_mode, writes kyc + the promoted company_name in one write, and
-- raises a TYPED error on a same-department duplicate so the UI can show
-- "already in your queue" instead of a raw SQL error.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.create_manual_lead(
  p_department_slug TEXT,
  p_phone           TEXT,
  p_company         TEXT     DEFAULT NULL,
  p_contact_name    TEXT     DEFAULT NULL,
  p_kyc             JSONB    DEFAULT '{}'::jsonb,
  p_product         TEXT     DEFAULT NULL,
  p_source          TEXT     DEFAULT 'manual',
  p_created_by      UUID     DEFAULT NULL,
  p_location        TEXT     DEFAULT NULL
)
RETURNS leads
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_dept        departments%ROWTYPE;
  v_phone       TEXT;
  v_stage       TEXT;
  v_assigned_to UUID;
  v_reps        UUID[];
  v_last        UUID;
  v_idx         INT;
  v_lead        leads%ROWTYPE;
BEGIN
  SELECT * INTO v_dept FROM departments WHERE slug = p_department_slug;
  IF v_dept.id IS NULL THEN
    RAISE EXCEPTION 'unknown department slug: %', p_department_slug
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  v_phone := public.normalize_phone_ke(p_phone);
  IF v_phone IS NULL OR v_phone = '' THEN
    RAISE EXCEPTION 'phone number is required' USING ERRCODE = 'null_value_not_allowed';
  END IF;

  -- Typed duplicate error, checked up front so the UI gets a clean message
  -- rather than a unique-violation from leads_dept_phone_uniq.
  IF EXISTS (SELECT 1 FROM leads
             WHERE department_id = v_dept.id AND phone_number = v_phone) THEN
    RAISE EXCEPTION 'lead % already exists in department %', v_phone, v_dept.name
      USING ERRCODE = 'unique_violation',
            HINT = 'duplicate_in_department';
  END IF;

  SELECT key INTO v_stage FROM funnel_stages
  WHERE department_id = v_dept.id ORDER BY sort_order LIMIT 1;
  v_stage := COALESCE(v_stage, 'new');

  -- assignment_mode: creator | round_robin | unassigned
  IF v_dept.assignment_mode = 'creator' THEN
    v_assigned_to := p_created_by;
  ELSIF v_dept.assignment_mode = 'round_robin' THEN
    SELECT ARRAY_AGG(id ORDER BY created_at) INTO v_reps
    FROM telemarketers WHERE is_active AND department_id = v_dept.id;
    IF v_reps IS NOT NULL AND ARRAY_LENGTH(v_reps, 1) IS NOT NULL THEN
      SELECT last_assigned_telemarketer_id INTO v_last
      FROM round_robin_state WHERE department_id = v_dept.id LIMIT 1;
      SELECT COALESCE(ARRAY_POSITION(v_reps, v_last), 0) INTO v_idx;
      v_assigned_to := v_reps[(v_idx % ARRAY_LENGTH(v_reps, 1)) + 1];
      UPDATE round_robin_state
      SET last_assigned_telemarketer_id = v_assigned_to, updated_at = now()
      WHERE department_id = v_dept.id;
    END IF;
  ELSE
    v_assigned_to := NULL;   -- 'unassigned'
  END IF;

  INSERT INTO leads (
    phone_number, full_name, company_name, location, product_interested,
    lead_source, funnel_stage, rag_status, department_id, kyc, created_by, assigned_to
  ) VALUES (
    v_phone, p_contact_name, p_company, p_location, p_product,
    p_source, v_stage, 'amber', v_dept.id, COALESCE(p_kyc, '{}'::jsonb),
    p_created_by, v_assigned_to
  ) RETURNING * INTO v_lead;

  RETURN v_lead;
END;
$$;

-- ============================================================================
-- 6. generate_term_billings(UUID)   (School Bus, section 6.1)
--
-- One term_billings row per academic term the contract spans. Idempotent
-- against UNIQUE(sale_id, academic_term_id), and it NEVER touches a row that
-- has already been invoiced or paid -- adding a seventh bus mid-contract must
-- be reflected in the next unbilled term, not retroactively in a paid one.
--
-- bus_count comes from the verified register (school_buses with status
-- installed|active), never from the kyc bus_count claim.
--
-- Returns the number of rows created and the number refreshed.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.generate_term_billings(p_sale_id UUID)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_sale        sales%ROWTYPE;
  v_dept_id     UUID;
  v_lead_id     UUID;
  v_bus_count   INT;
  v_rate        DECIMAL(12,2);
  v_start       DATE;
  v_end         DATE;
  v_created     INT := 0;
  v_refreshed   INT := 0;
  v_terms       INT;
BEGIN
  SELECT * INTO v_sale FROM sales WHERE id = p_sale_id;
  IF v_sale.id IS NULL THEN
    RAISE EXCEPTION 'sale % not found', p_sale_id USING ERRCODE = 'no_data_found';
  END IF;

  v_lead_id := v_sale.lead_id;
  SELECT department_id INTO v_dept_id FROM leads WHERE id = v_lead_id;

  -- Degrade gracefully on an unconfigured calendar rather than throwing.
  SELECT count(*) INTO v_terms FROM academic_terms;
  IF v_terms = 0 THEN
    RETURN jsonb_build_object(
      'ok', false, 'reason', 'term_calendar_not_configured',
      'created', 0, 'refreshed', 0);
  END IF;

  v_start := COALESCE(v_sale.contract_start, v_sale.installation_date, v_sale.sale_date::date);
  v_end   := v_sale.contract_end;
  IF v_start IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_contract_start',
                              'created', 0, 'refreshed', 0);
  END IF;

  SELECT count(*) INTO v_bus_count
  FROM school_buses
  WHERE lead_id = v_lead_id AND status IN ('installed', 'active');

  SELECT avg(rate_per_term) INTO v_rate
  FROM school_buses
  WHERE lead_id = v_lead_id AND status IN ('installed', 'active') AND rate_per_term IS NOT NULL;

  -- Create a row per term the contract overlaps. due_date is term start minus
  -- 14 days (Kelvin's decision, 2026-09-20).
  WITH ins AS (
    INSERT INTO term_billings (
      lead_id, sale_id, department_id, academic_term_id,
      bus_count, amount_per_bus, total_amount, currency, due_date)
    SELECT v_lead_id, p_sale_id, v_dept_id, t.id,
           v_bus_count, v_rate, v_rate * v_bus_count, COALESCE(v_sale.currency, 'KES'),
           t.start_date - 14
    FROM academic_terms t
    WHERE t.start_date >= v_start
      AND (v_end IS NULL OR t.start_date <= v_end)
    ON CONFLICT (sale_id, academic_term_id) DO NOTHING
    RETURNING 1)
  SELECT count(*) INTO v_created FROM ins;

  -- Refresh only rows nobody has acted on yet.
  WITH upd AS (
    UPDATE term_billings b
    SET bus_count      = v_bus_count,
        amount_per_bus = v_rate,
        total_amount   = v_rate * v_bus_count
    WHERE b.sale_id = p_sale_id
      AND b.invoice_status = 'pending'
      AND (b.bus_count IS DISTINCT FROM v_bus_count
        OR b.amount_per_bus IS DISTINCT FROM v_rate)
    RETURNING 1)
  SELECT count(*) INTO v_refreshed FROM upd;

  RETURN jsonb_build_object(
    'ok', true, 'created', v_created, 'refreshed', v_refreshed,
    'bus_count', v_bus_count, 'amount_per_bus', v_rate);
END;
$$;

-- ============================================================================
-- 7. rag_auto_flag_v2(p_dry_run BOOLEAN DEFAULT FALSE)   (section 6.5)
--
-- A NEW function. The cron keeps calling v1 until 010.
--
-- p_dry_run = true computes every change and returns it as JSONB WITHOUT
-- writing a single row, so it can be run against production and diffed against
-- v1 before it is ever allowed to write. A RAG function is the one thing in
-- this system that can silently mislabel every lead overnight.
--
-- HOW IT REPRODUCES v1 EXACTLY FOR TELEMATICS
--
-- v1 applies three UPDATEs in sequence, and each sees the effects of the last.
-- To be able to dry-run, v2 applies the same three rules in the same order to a
-- temp working copy, then either writes the diff back or just reports it. The
-- rules stay mutually exclusive in practice (rule 2 requires no recent call,
-- rule 3 requires one; rule 1 requires an overdue renewal, rules 2 and 3
-- exclude one), so per-rule counts remain unambiguous.
--
-- The hardcoded active_stages array is replaced by a lookup on
-- funnel_stages.is_active_stage, matched per lead.department_id. The telematics
-- seed sets exactly the ten stages v1 hardcoded, and seed_departments.sql
-- fails loudly if that ever drifts.
--
-- RULE 3 IS REPRODUCED FAITHFULLY, INCLUDING ITS BUG.
-- v1 compares `f.scheduled_date IN (CURRENT_DATE, CURRENT_DATE + 1)`, but
-- scheduled_date is TIMESTAMPTZ (migration 003) and the app writes a real time
-- of day, so the date literal coerces to midnight and the comparison never
-- matches. Measured on production 2026-09-20: 122 pending follow-ups, 0 at
-- midnight, 0 matching. The RED -> AMBER de-escalation has therefore never
-- fired, which is part of why 2,715 of 3,395 leads are RED.
--
-- It is reproduced here on purpose. Section 6.5 requires v2 to match v1
-- exactly on telematics, and "any difference is a bug in v2, not an
-- improvement". Fixing it is a ONE-LINE change (cast scheduled_date::date) but
-- it would re-amber a large number of leads on the first run, which is a
-- visible change to the team's queue and must be a separate, deliberate,
-- separately-verified decision. The fixed predicate is kept below, commented,
-- so the change is a two-character edit when it is agreed.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.rag_auto_flag_v2(p_dry_run BOOLEAN DEFAULT FALSE)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_checked  INT := 0;
  v_applied  INT := 0;
  v_result   jsonb;
  v_holiday  BOOLEAN;
BEGIN
  v_holiday := public.is_school_holiday(CURRENT_DATE);

  -- Working copy: every lead in a stage its own department marks active.
  CREATE TEMP TABLE _rag_work ON COMMIT DROP AS
  SELECT l.id,
         l.department_id,
         d.slug            AS dept_slug,
         d.post_sale_model AS model,
         l.created_at,
         l.rag_status      AS orig,
         l.rag_status      AS cur,
         NULL::TEXT        AS rule
  FROM leads l
  JOIN departments d ON d.id = l.department_id
  WHERE EXISTS (
    SELECT 1 FROM funnel_stages f
    WHERE f.department_id = l.department_id
      AND f.key = l.funnel_stage
      AND f.is_active_stage
  );

  SELECT count(*) INTO v_checked FROM _rag_work;

  -- ---- RULE 1: overdue post-sale commitment -> RED -----------------------
  -- annual_renewal is v1's rule 1, unchanged. The other three models are new
  -- and cannot affect telematics.

  -- annual_renewal (telematics): overdue sales.renewal_due_date
  UPDATE _rag_work w SET cur = 'red', rule = 'overdue_renewal'
  WHERE w.model = 'annual_renewal' AND w.cur <> 'red'
    AND EXISTS (SELECT 1 FROM sales s
                WHERE s.lead_id = w.id
                  AND s.renewal_due_date IS NOT NULL
                  AND s.renewal_due_date < CURRENT_DATE);

  -- subscription (fuel): contract_end in the past
  UPDATE _rag_work w SET cur = 'red', rule = 'contract_expired'
  WHERE w.model = 'subscription' AND w.cur <> 'red'
    AND EXISTS (SELECT 1 FROM sales s
                WHERE s.lead_id = w.id
                  AND s.contract_end IS NOT NULL
                  AND s.contract_end < CURRENT_DATE);

  -- consumption (e-seal): reorder overdue
  UPDATE _rag_work w SET cur = 'red', rule = 'reorder_overdue'
  WHERE w.model = 'consumption' AND w.cur <> 'red'
    AND EXISTS (SELECT 1 FROM service_orders o
                WHERE o.lead_id = w.id
                  AND o.reorder_due_date IS NOT NULL
                  AND o.reorder_due_date < CURRENT_DATE);

  -- term_contract (school bus): an unpaid term billing is past due.
  -- Money is money: this one applies during a holiday too.
  UPDATE _rag_work w SET cur = 'red', rule = 'term_billing_overdue'
  WHERE w.model = 'term_contract' AND w.cur <> 'red'
    AND EXISTS (SELECT 1 FROM term_billings b
                WHERE b.lead_id = w.id
                  AND b.due_date IS NOT NULL
                  AND b.due_date < CURRENT_DATE
                  AND b.invoice_status IN ('pending','invoiced','partial','overdue'));

  -- ---- RULE 2: neglected 14+ days -> RED ---------------------------------
  -- Identical to v1, plus the school_bus holiday hold. A school that cannot be
  -- reached because it is closed is not a cold lead, and auto-reddening the
  -- whole department every April and August would make the RAG column useless.
  UPDATE _rag_work w SET cur = 'red', rule = 'inactive_14d'
  WHERE w.cur NOT IN ('green','red')
    AND NOT (w.dept_slug = 'school_bus' AND v_holiday)
    AND w.created_at < now() - interval '14 days'
    AND NOT EXISTS (SELECT 1 FROM call_logs c
                    WHERE c.lead_id = w.id
                      AND c.called_at >= now() - interval '14 days')
    AND NOT EXISTS (SELECT 1 FROM sales s
                    WHERE s.lead_id = w.id
                      AND s.renewal_due_date IS NOT NULL
                      AND s.renewal_due_date < CURRENT_DATE);

  -- ---- RULE 3: de-escalate RED -> AMBER ----------------------------------
  -- Faithful to v1, bug included. See the header. The fixed version is the
  -- commented predicate.
  UPDATE _rag_work w SET cur = 'amber', rule = 'followup_imminent'
  WHERE w.cur = 'red'
    AND NOT EXISTS (SELECT 1 FROM sales s
                    WHERE s.lead_id = w.id
                      AND s.renewal_due_date IS NOT NULL
                      AND s.renewal_due_date < CURRENT_DATE)
    AND EXISTS (SELECT 1 FROM call_logs c
                WHERE c.lead_id = w.id
                  AND c.called_at >= now() - interval '14 days')
    AND EXISTS (SELECT 1 FROM followup_schedule f
                WHERE f.lead_id = w.id
                  AND f.status = 'pending'
                  AND f.scheduled_date IN (CURRENT_DATE, CURRENT_DATE + 1)
                  -- FIXED VERSION, do not enable without a separate decision:
                  -- AND f.scheduled_date::date IN (CURRENT_DATE, CURRENT_DATE + 1)
               );

  -- ---- RULE 4: upcoming commitment -> AMBER (new departments only) -------
  -- Cannot affect telematics: annual_renewal is excluded. Applies to leads
  -- that are not already RED, so a commitment coming due can lift a GREEN lead
  -- to AMBER -- deliberate, because an expiring contract needs action
  -- regardless of how engaged the rep thinks the client is. Revisit in D5 with
  -- real fuel and e-seal data.
  UPDATE _rag_work w SET cur = 'amber', rule = 'contract_expiring_30d'
  WHERE w.model = 'subscription' AND w.cur <> 'red' AND w.rule IS NULL
    AND EXISTS (SELECT 1 FROM sales s
                WHERE s.lead_id = w.id
                  AND s.contract_end IS NOT NULL
                  AND s.contract_end >= CURRENT_DATE
                  AND s.contract_end <= CURRENT_DATE + 30);

  -- term renewal: next term starts within 21 days and has no billing row yet
  UPDATE _rag_work w SET cur = 'amber', rule = 'term_renewal_due'
  WHERE w.model = 'term_contract' AND w.cur <> 'red' AND w.rule IS NULL
    AND EXISTS (
      SELECT 1 FROM academic_terms t
      WHERE t.start_date >= CURRENT_DATE
        AND t.start_date <= CURRENT_DATE + 21
        AND NOT EXISTS (SELECT 1 FROM term_billings b
                        WHERE b.lead_id = w.id AND b.academic_term_id = t.id));

  -- ---- Apply, or not -----------------------------------------------------
  IF NOT p_dry_run THEN
    UPDATE leads l SET rag_status = w.cur
    FROM _rag_work w
    WHERE l.id = w.id AND w.cur IS DISTINCT FROM w.orig;
    GET DIAGNOSTICS v_applied = ROW_COUNT;
  ELSE
    SELECT count(*) INTO v_applied FROM _rag_work WHERE cur IS DISTINCT FROM orig;
  END IF;

  SELECT jsonb_build_object(
    'run_at',        now(),
    'dry_run',       p_dry_run,
    'school_holiday', v_holiday,
    'leads_checked', v_checked,
    -- v1-compatible totals, so the two can be compared directly
    'flagged_red',   (SELECT count(*) FROM _rag_work WHERE cur = 'red'   AND orig <> 'red'),
    'flagged_amber', (SELECT count(*) FROM _rag_work WHERE cur = 'amber' AND orig <> 'amber'),
    'changed',       v_applied,
    'by_rule',       COALESCE((SELECT jsonb_object_agg(rule, n) FROM (
                        SELECT rule, count(*) n FROM _rag_work
                        WHERE rule IS NOT NULL AND cur IS DISTINCT FROM orig
                        GROUP BY rule) r), '{}'::jsonb),
    'by_department', COALESCE((SELECT jsonb_object_agg(dept_slug, j) FROM (
                        SELECT dept_slug, jsonb_build_object(
                                 'checked', count(*),
                                 'to_red',   count(*) FILTER (WHERE cur='red'   AND orig<>'red'),
                                 'to_amber', count(*) FILTER (WHERE cur='amber' AND orig<>'amber')
                               ) j
                        FROM _rag_work GROUP BY dept_slug) d), '{}'::jsonb)
  ) INTO v_result;

  DROP TABLE _rag_work;
  RETURN v_result;
END;
$$;

-- ============================================================================
-- Grants. These are SECURITY DEFINER RPCs the app calls through PostgREST.
-- rag_auto_flag_v2 is deliberately NOT granted to anon/authenticated -- it is a
-- cron job, and nothing in the browser should be able to re-flag every lead.
-- ============================================================================

REVOKE ALL ON FUNCTION public.rag_auto_flag_v2(BOOLEAN) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.rag_auto_flag_v2(BOOLEAN) TO service_role;

GRANT EXECUTE ON FUNCTION public.assign_lead_round_robin_v2(TEXT,TEXT,TEXT,TEXT,TEXT,JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_manual_lead(TEXT,TEXT,TEXT,TEXT,JSONB,TEXT,TEXT,UUID,TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.check_phone_across_departments(TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.generate_term_billings(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_school_holiday(DATE) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.normalize_phone_ke(TEXT) TO anon, authenticated, service_role;

-- ============================================================================
-- Verification: v1 must still be present and untouched, and nothing may be
-- calling v2 yet.
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                 WHERE n.nspname='public' AND p.proname='assign_lead_round_robin')
    THEN RAISE EXCEPTION 'assign_lead_round_robin (v1) is missing'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                 WHERE n.nspname='public' AND p.proname='rag_auto_flag')
    THEN RAISE EXCEPTION 'rag_auto_flag (v1) is missing'; END IF;

  IF EXISTS (SELECT 1 FROM cron.job WHERE command ILIKE '%rag_auto_flag_v2%')
    THEN RAISE EXCEPTION 'the cron already points at v2 -- that is a 010 operation'; END IF;

  RAISE NOTICE 'OK: v1 functions intact, cron still on v1, v2 called by nothing';
EXCEPTION
  WHEN undefined_table THEN
    RAISE NOTICE 'OK: v1 functions intact (pg_cron not installed here)';
END $$;

-- ============================================================================
-- ROLLBACK 009c
-- DROP FUNCTION IF EXISTS public.rag_auto_flag_v2(BOOLEAN);
-- DROP FUNCTION IF EXISTS public.assign_lead_round_robin_v2(TEXT,TEXT,TEXT,TEXT,TEXT,JSONB);
-- DROP FUNCTION IF EXISTS public.create_manual_lead(TEXT,TEXT,TEXT,TEXT,JSONB,TEXT,TEXT,UUID,TEXT);
-- DROP FUNCTION IF EXISTS public.check_phone_across_departments(TEXT);
-- DROP FUNCTION IF EXISTS public.generate_term_billings(UUID);
-- DROP FUNCTION IF EXISTS public.is_school_holiday(DATE);
-- DROP FUNCTION IF EXISTS public.normalize_phone_ke(TEXT);
-- Nothing else is affected: v1 is untouched and nothing calls v2.
-- ============================================================================
