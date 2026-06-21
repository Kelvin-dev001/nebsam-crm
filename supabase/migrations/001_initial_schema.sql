-- ============================================================
-- Nebsam CRM — Initial Schema
-- Sprint 1
-- ============================================================

-- ── Telemarketers ───────────────────────────────────────────
CREATE TABLE telemarketers (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name   TEXT        NOT NULL,
  email       TEXT        UNIQUE NOT NULL,
  phone       TEXT,
  is_active   BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Leads ───────────────────────────────────────────────────
CREATE TABLE leads (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_number        TEXT        NOT NULL UNIQUE,
  assigned_to         UUID        REFERENCES telemarketers(id) ON DELETE SET NULL,
  full_name           TEXT,
  location            TEXT,
  vehicle_type        TEXT,
  product_interested  TEXT,
  lead_source         TEXT        NOT NULL DEFAULT 'whatsapp_bot',
  funnel_stage        TEXT        NOT NULL DEFAULT 'new',
  rag_status          TEXT        NOT NULL DEFAULT 'amber',
  campaign_name       TEXT,
  whatsapp_message    TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Call Logs ───────────────────────────────────────────────
CREATE TABLE call_logs (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id               UUID        NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  telemarketer_id       UUID        NOT NULL REFERENCES telemarketers(id),
  called_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  duration_seconds      INT,
  call_outcome          TEXT        NOT NULL,
  call_notes            TEXT,
  next_followup_date    DATE,
  next_followup_notes   TEXT,
  rag_status_after_call TEXT,
  funnel_stage_after_call TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Sales ───────────────────────────────────────────────────
CREATE TABLE sales (
  id                    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id               UUID          NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  telemarketer_id       UUID          NOT NULL REFERENCES telemarketers(id),
  product               TEXT          NOT NULL,
  sale_amount           DECIMAL(10,2),
  currency              TEXT          NOT NULL DEFAULT 'KES',
  installation_date     DATE,
  installation_location TEXT,
  sale_date             DATE          NOT NULL DEFAULT CURRENT_DATE,
  vehicle_registration  TEXT,
  serial_number         TEXT,
  subscription_type     TEXT          NOT NULL DEFAULT 'annual',
  renewal_due_date      DATE,
  renewal_reminder_sent BOOLEAN       NOT NULL DEFAULT FALSE,
  notes                 TEXT,
  created_at            TIMESTAMPTZ   NOT NULL DEFAULT now()
);

-- ── Follow-up Schedule ──────────────────────────────────────
CREATE TABLE followup_schedule (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id          UUID        NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  sale_id          UUID        REFERENCES sales(id) ON DELETE SET NULL,
  telemarketer_id  UUID        NOT NULL REFERENCES telemarketers(id),
  followup_type    TEXT        NOT NULL,
  scheduled_date   DATE        NOT NULL,
  notes            TEXT,
  status           TEXT        NOT NULL DEFAULT 'pending',
  completed_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Webhook Events ──────────────────────────────────────────
CREATE TABLE webhook_events (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  raw_payload  JSONB       NOT NULL,
  phone_number TEXT,
  processed    BOOLEAN     NOT NULL DEFAULT FALSE,
  lead_id      UUID        REFERENCES leads(id) ON DELETE SET NULL,
  received_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Indexes ─────────────────────────────────────────────────
CREATE INDEX idx_leads_assigned_to       ON leads(assigned_to);
CREATE INDEX idx_leads_funnel_stage      ON leads(funnel_stage);
CREATE INDEX idx_leads_rag_status        ON leads(rag_status);
CREATE INDEX idx_leads_updated_at        ON leads(updated_at);
CREATE INDEX idx_call_logs_lead_id       ON call_logs(lead_id);
CREATE INDEX idx_call_logs_telemarketer  ON call_logs(telemarketer_id);
CREATE INDEX idx_call_logs_called_at     ON call_logs(called_at);
CREATE INDEX idx_sales_lead_id           ON sales(lead_id);
CREATE INDEX idx_sales_renewal_due_date  ON sales(renewal_due_date);
CREATE INDEX idx_followup_schedule_date  ON followup_schedule(scheduled_date);
CREATE INDEX idx_followup_schedule_lead  ON followup_schedule(lead_id);

-- ── Triggers ────────────────────────────────────────────────

-- Auto-update leads.updated_at on every row change
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER leads_updated_at
  BEFORE UPDATE ON leads
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Auto-calculate renewal_due_date = installation_date + 365 days
CREATE OR REPLACE FUNCTION set_renewal_due_date()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.installation_date IS NOT NULL THEN
    NEW.renewal_due_date = NEW.installation_date + INTERVAL '365 days';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER sales_renewal_due_date
  BEFORE INSERT OR UPDATE OF installation_date ON sales
  FOR EACH ROW EXECUTE FUNCTION set_renewal_due_date();

-- ── Row Level Security ───────────────────────────────────────
-- RLS is enabled on all tables. Policies are currently open (allow all)
-- so the app works without auth. When Supabase Auth is wired up in a
-- future sprint, replace USING (true) with USING (auth.uid() = ...).

ALTER TABLE telemarketers    ENABLE ROW LEVEL SECURITY;
ALTER TABLE leads            ENABLE ROW LEVEL SECURITY;
ALTER TABLE call_logs        ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales            ENABLE ROW LEVEL SECURITY;
ALTER TABLE followup_schedule ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_events   ENABLE ROW LEVEL SECURITY;

CREATE POLICY "open_telemarketers"     ON telemarketers     FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "open_leads"             ON leads             FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "open_call_logs"         ON call_logs         FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "open_sales"             ON sales             FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "open_followup_schedule" ON followup_schedule FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "open_webhook_events"    ON webhook_events    FOR ALL USING (true) WITH CHECK (true);
