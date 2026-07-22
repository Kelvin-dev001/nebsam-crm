-- ============================================================
-- Nebsam CRM — RAG auto-flag: 14-day age-gate refinement
-- ============================================================
-- The "no activity 14+ days → RED" rule was flagging brand-new,
-- never-yet-called leads as cold. Add a grace period: a lead can
-- only be auto-RED for inactivity once it is 14+ days old.
--
-- Also does a one-time correction: leads younger than 14 days that
-- the first (un-gated) run turned red are restored to amber.

-- ── Refined function (adds created_at age-gate to step 2) ────
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
$$;

-- ── One-time correction ─────────────────────────────────────
-- Restore to AMBER the fresh (<14 day) leads that the first,
-- un-gated run incorrectly flagged red. Overdue-renewal reds and
-- genuinely-stale (14+ day) reds are left untouched.
UPDATE leads l SET rag_status = 'amber'
WHERE l.rag_status = 'red'
  AND l.funnel_stage IN (
    'new','contacted','interested','quote_sent','negotiating',
    'won','installed','post_sale','sorted','renewal_due'
  )
  AND l.created_at >= now() - interval '14 days'
  AND NOT EXISTS (
    SELECT 1 FROM sales s
    WHERE s.lead_id = l.id
      AND s.renewal_due_date IS NOT NULL
      AND s.renewal_due_date < CURRENT_DATE
  );
