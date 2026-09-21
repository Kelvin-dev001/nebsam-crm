-- ============================================================================
-- _pre009_function_snapshot.sql  -- REFERENCE ONLY. DO NOT RUN THIS FILE.
--
-- Every function in schema public, captured from PRODUCTION (project
-- slnphqsrrjpqcthezgun, PostgreSQL 17.6) on 2026-09-20T14:51:51Z,
-- before migration 009.
--
-- Why this exists (DEPARTMENTS-MASTER-PROMPT.md section 6.5):
-- assign_lead_round_robin runs on every inbound WhatsApp message and
-- rag_auto_flag runs at 05:00 UTC against every lead. 009 must not replace
-- either; new behaviour ships as *_v2 alongside. Section 10 requires diffing
-- the post-009 definitions against this file to prove they were left alone.
--
-- Running this file would CREATE OR REPLACE the live functions, which is the
-- exact operation the safety contract forbids. It is committed as evidence and
-- as the restore path if one of them is ever damaged.
--
-- NOTE: this captures ALL public functions, not just the ones the prompt names.
-- The first capture filtered to four known names and missed rls_auto_enable,
-- which turns out to matter a great deal for 009 -- see the event triggers at
-- the foot of this file.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.assign_lead_round_robin(p_phone text, p_name text, p_message text, p_campaign text, p_raw_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_existing_lead_id      UUID;
  v_lead_id               UUID;
  v_telemarketers         UUID[];
  v_last_assigned         UUID;
  v_last_idx              INT;
  v_next_telemarketer_id  UUID;
  v_is_new                BOOLEAN := FALSE;
  v_state_id              UUID;
BEGIN
  SELECT id INTO v_existing_lead_id
  FROM leads WHERE phone_number = p_phone;

  IF v_existing_lead_id IS NOT NULL THEN
    UPDATE leads SET
      full_name        = CASE WHEN full_name IS NULL AND p_name IS NOT NULL THEN p_name ELSE full_name END,
      whatsapp_message = CASE WHEN p_message IS NOT NULL THEN p_message ELSE whatsapp_message END
    WHERE id = v_existing_lead_id;
    v_lead_id := v_existing_lead_id;
  ELSE
    SELECT ARRAY_AGG(id ORDER BY created_at) INTO v_telemarketers
    FROM telemarketers WHERE is_active = TRUE;

    SELECT last_assigned_telemarketer_id INTO v_last_assigned
    FROM round_robin_state LIMIT 1;

    SELECT COALESCE(ARRAY_POSITION(v_telemarketers, v_last_assigned), 0) INTO v_last_idx;

    v_next_telemarketer_id :=
      v_telemarketers[(v_last_idx % ARRAY_LENGTH(v_telemarketers, 1)) + 1];

    INSERT INTO leads (
      phone_number, full_name, whatsapp_message, campaign_name,
      lead_source, funnel_stage, rag_status, assigned_to
    ) VALUES (
      p_phone, p_name, p_message, p_campaign,
      'whatsapp_bot', 'new', 'amber', v_next_telemarketer_id
    ) RETURNING id INTO v_lead_id;

    SELECT id INTO v_state_id FROM round_robin_state LIMIT 1;
    IF v_state_id IS NOT NULL THEN
      UPDATE round_robin_state
      SET last_assigned_telemarketer_id = v_next_telemarketer_id, updated_at = now()
      WHERE id = v_state_id;
    ELSE
      INSERT INTO round_robin_state (last_assigned_telemarketer_id) VALUES (v_next_telemarketer_id);
    END IF;

    v_is_new := TRUE;
  END IF;

  INSERT INTO webhook_events (raw_payload, phone_number, processed, lead_id)
  VALUES (p_raw_payload, p_phone, TRUE, v_lead_id);

  RETURN jsonb_build_object('lead_id', v_lead_id, 'is_new', v_is_new, 'assigned_to', v_next_telemarketer_id);
END;
$function$
;
CREATE OR REPLACE FUNCTION public.rag_auto_flag()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_red     int := 0;
  v_red2    int := 0;
  v_amber   int := 0;
  v_checked int := 0;
  active_stages text[] := ARRAY[
    'new','contacted','interested','quote_sent','negotiating',
    'won','installed','post_sale','sorted','renewal_due'
  ];
BEGIN
  SELECT count(*) INTO v_checked FROM leads WHERE funnel_stage = ANY(active_stages);

  -- 1. Overdue renewals → RED (always)
  UPDATE leads l SET rag_status = 'red'
  WHERE l.funnel_stage = ANY(active_stages)
    AND l.rag_status <> 'red'
    AND EXISTS (
      SELECT 1 FROM sales s
      WHERE s.lead_id = l.id
        AND s.renewal_due_date IS NOT NULL
        AND s.renewal_due_date < CURRENT_DATE
    );
  GET DIAGNOSTICS v_red = ROW_COUNT;

  -- 2. Neglected 14+ days: no call in 14 days, not GREEN, not overdue,
  --    AND the lead itself is at least 14 days old (grace period for
  --    fresh leads that simply haven't been worked yet) → RED
  UPDATE leads l SET rag_status = 'red'
  WHERE l.funnel_stage = ANY(active_stages)
    AND l.rag_status NOT IN ('green','red')
    AND l.created_at < now() - interval '14 days'
    AND NOT EXISTS (
      SELECT 1 FROM call_logs c
      WHERE c.lead_id = l.id AND c.called_at >= now() - interval '14 days'
    )
    AND NOT EXISTS (
      SELECT 1 FROM sales s
      WHERE s.lead_id = l.id
        AND s.renewal_due_date IS NOT NULL
        AND s.renewal_due_date < CURRENT_DATE
    );
  GET DIAGNOSTICS v_red2 = ROW_COUNT;

  -- 3. Currently RED but has recent activity + a pending follow-up
  --    today/tomorrow (and not overdue) → de-escalate to AMBER
  UPDATE leads l SET rag_status = 'amber'
  WHERE l.funnel_stage = ANY(active_stages)
    AND l.rag_status = 'red'
    AND NOT EXISTS (
      SELECT 1 FROM sales s
      WHERE s.lead_id = l.id
        AND s.renewal_due_date IS NOT NULL
        AND s.renewal_due_date < CURRENT_DATE
    )
    AND EXISTS (
      SELECT 1 FROM call_logs c
      WHERE c.lead_id = l.id AND c.called_at >= now() - interval '14 days'
    )
    AND EXISTS (
      SELECT 1 FROM followup_schedule f
      WHERE f.lead_id = l.id
        AND f.status = 'pending'
        AND f.scheduled_date IN (CURRENT_DATE, CURRENT_DATE + 1)
    );
  GET DIAGNOSTICS v_amber = ROW_COUNT;

  RETURN jsonb_build_object(
    'run_at',        now(),
    'leads_checked', v_checked,
    'flagged_red',   v_red + v_red2,
    'flagged_amber', v_amber
  );
END;
$function$
;
CREATE OR REPLACE FUNCTION public.rls_auto_enable()
 RETURNS event_trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.set_renewal_due_date()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.installation_date IS NOT NULL THEN
    NEW.renewal_due_date = NEW.installation_date + INTERVAL '365 days';
  END IF;
  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.update_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$
;


-- ============================================================================
-- DATABASE-LEVEL EVENT TRIGGERS (not schema-scoped, so pg_dump --schema=public
-- does NOT include them -- they are invisible in 00-schema.sql).
--
-- ensure_rls is the one that matters: it fires on ddl_command_end for every
-- CREATE TABLE in public and enables ROW LEVEL SECURITY on the new table
-- automatically. Migration 009 creates eight tables, so all eight arrive with
-- RLS already on. A table with RLS enabled and no policy denies everything, so
-- 009 MUST create its open policies and grants as real statements. The master
-- prompt section 6A leaves both commented out; following it literally would
-- leave every new config table returning zero rows to the app.
--
-- pgrst_ddl_watch is the reason new tables appear in the PostgREST API without
-- a manual schema-cache reload.
-- ============================================================================
-- EVENT TRIGGER ensure_rls ON ddl_command_end (enabled=O) EXECUTES rls_auto_enable WHEN TAG IN (CREATE TABLE, CREATE TABLE AS, SELECT INTO)
-- EVENT TRIGGER issue_graphql_placeholder ON sql_drop (enabled=O) EXECUTES set_graphql_placeholder WHEN TAG IN (DROP EXTENSION)
-- EVENT TRIGGER issue_pg_cron_access ON ddl_command_end (enabled=O) EXECUTES grant_pg_cron_access WHEN TAG IN (CREATE EXTENSION)
-- EVENT TRIGGER issue_pg_graphql_access ON ddl_command_end (enabled=O) EXECUTES grant_pg_graphql_access WHEN TAG IN (CREATE EXTENSION)
-- EVENT TRIGGER issue_pg_net_access ON ddl_command_end (enabled=O) EXECUTES grant_pg_net_access WHEN TAG IN (CREATE EXTENSION)
-- EVENT TRIGGER pgrst_ddl_watch ON ddl_command_end (enabled=O) EXECUTES pgrst_ddl_watch
-- EVENT TRIGGER pgrst_drop_watch ON sql_drop (enabled=O) EXECUTES pgrst_drop_watch
