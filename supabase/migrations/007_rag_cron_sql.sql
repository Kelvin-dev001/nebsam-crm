-- ============================================================
-- Nebsam CRM — RAG Auto-Flag as native SQL cron + realtime fix
-- ============================================================
-- Replaces the previous pg_cron → net.http_post → edge-function
-- approach, which failed every day (malformed http_post args +
-- the rag-cron edge function was never deployed).
--
-- The RAG logic is pure data manipulation, so it runs directly in
-- Postgres — no edge function, no HTTP, no auth to break.
--
-- Business rule: runs daily at 08:00 EAT (05:00 UTC).

-- ── RAG auto-flag function ──────────────────────────────────
-- Mirrors supabase/functions/rag-cron/index.ts exactly:
--   1. Overdue renewal (sales.renewal_due_date < today) → RED (always)
--   2. No call in 14+ days, not GREEN, not overdue          → RED
--   3. Currently RED, has recent activity + pending follow-up
--      today/tomorrow, not overdue                          → AMBER (de-escalate)
-- Never sets anything to GREEN (that stays a human decision).
CREATE OR REPLACE FUNCTION public.rag_auto_flag()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

  -- 1. Overdue renewals → RED (always, regardless of current status)
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

  -- 2. No activity 14+ days, not GREEN, not an overdue renewal → RED
  UPDATE leads l SET rag_status = 'red'
  WHERE l.funnel_stage = ANY(active_stages)
    AND l.rag_status NOT IN ('green','red')
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
$$;

-- ── Reschedule the cron job (upsert by name) ────────────────
-- 05:00 UTC = 08:00 EAT. Calls the SQL function directly.
SELECT cron.schedule('rag-auto-flag', '0 5 * * *', $$SELECT public.rag_auto_flag();$$);

-- ── Realtime: publish webhook_events for the WhatsApp chat ───
-- leads is already in supabase_realtime; add webhook_events so the
-- chat panel streams incoming messages live. REPLICA IDENTITY FULL
-- lets filtered subscriptions (phone_number=eq.X) match reliably.
ALTER TABLE webhook_events REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'webhook_events'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE webhook_events;
  END IF;
END $$;
