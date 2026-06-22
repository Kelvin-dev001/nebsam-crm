-- ============================================================
-- Nebsam CRM — Round Robin Assignment State
-- Sprint 11
-- ============================================================

-- ── Round Robin State ────────────────────────────────────────
-- Always exactly ONE row. Tracks who was last assigned a lead
-- so the cycle (Sonnie → Janet → Suzzie → ...) survives restarts.

CREATE TABLE round_robin_state (
  id                            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  last_assigned_telemarketer_id UUID        REFERENCES telemarketers(id),
  updated_at                    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE round_robin_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY "open_round_robin_state" ON round_robin_state
  FOR ALL USING (true) WITH CHECK (true);

-- ── RPC: Atomic lead assignment ──────────────────────────────
-- Called by the webhook handler instead of direct table writes.
-- Runs as a single DB transaction:
--   1. Check if lead exists (by phone)
--   2a. Existing → update name/message, preserve assignment
--   2b. New → find next telemarketer in cycle, insert lead, advance state
--   3. Record webhook_event
--   Returns: { lead_id, is_new, assigned_to }

CREATE OR REPLACE FUNCTION assign_lead_round_robin(
  p_phone      TEXT,
  p_name       TEXT,
  p_message    TEXT,
  p_campaign   TEXT,
  p_raw_payload JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_existing_lead_id      UUID;
  v_lead_id               UUID;
  v_telemarketers         UUID[];
  v_last_assigned         UUID;
  v_last_idx              INT;
  v_next_telemarketer_id  UUID;
  v_is_new                BOOLEAN := FALSE;
BEGIN
  -- 1. Check for existing lead
  SELECT id INTO v_existing_lead_id
  FROM leads
  WHERE phone_number = p_phone;

  IF v_existing_lead_id IS NOT NULL THEN
    -- Existing lead: update name/message only, do NOT reassign
    UPDATE leads SET
      full_name        = CASE WHEN full_name IS NULL AND p_name IS NOT NULL
                              THEN p_name ELSE full_name END,
      whatsapp_message = CASE WHEN p_message IS NOT NULL
                              THEN p_message ELSE whatsapp_message END
    WHERE id = v_existing_lead_id;

    v_lead_id := v_existing_lead_id;

  ELSE
    -- New lead: round robin assignment

    -- Get ordered active telemarketer IDs (created_at = seeded order: Sonnie, Janet, Suzzie)
    SELECT ARRAY_AGG(id ORDER BY created_at)
    INTO v_telemarketers
    FROM telemarketers
    WHERE is_active = TRUE;

    -- Get last assigned from state (the single row)
    SELECT last_assigned_telemarketer_id
    INTO v_last_assigned
    FROM round_robin_state
    LIMIT 1;

    -- Find position of last assigned (0 if null/not found → next = index 1 = Sonnie)
    SELECT COALESCE(ARRAY_POSITION(v_telemarketers, v_last_assigned), 0)
    INTO v_last_idx;

    -- Advance one step in the cycle (1-based Postgres array indexing)
    v_next_telemarketer_id :=
      v_telemarketers[(v_last_idx % ARRAY_LENGTH(v_telemarketers, 1)) + 1];

    -- Insert new lead with assignment
    INSERT INTO leads (
      phone_number, full_name, whatsapp_message, campaign_name,
      lead_source, funnel_stage, rag_status, assigned_to
    ) VALUES (
      p_phone, p_name, p_message, p_campaign,
      'whatsapp_bot', 'new', 'amber', v_next_telemarketer_id
    )
    RETURNING id INTO v_lead_id;

    -- Advance round_robin_state (single row — always UPDATE)
    UPDATE round_robin_state
    SET last_assigned_telemarketer_id = v_next_telemarketer_id,
        updated_at = now();

    v_is_new := TRUE;
  END IF;

  -- Record the webhook event
  INSERT INTO webhook_events (raw_payload, phone_number, processed, lead_id)
  VALUES (p_raw_payload, p_phone, TRUE, v_lead_id);

  RETURN jsonb_build_object(
    'lead_id',     v_lead_id,
    'is_new',      v_is_new,
    'assigned_to', v_next_telemarketer_id
  );
END;
$$;
