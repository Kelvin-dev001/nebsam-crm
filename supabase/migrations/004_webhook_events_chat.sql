-- ============================================================
-- Nebsam CRM — WhatsApp Chat Panel Support
-- Sprint A
-- ============================================================
-- Adds direction / message_text / sent_at to webhook_events
-- so the chat panel can display and query conversation history.

ALTER TABLE webhook_events
  ADD COLUMN IF NOT EXISTS direction    TEXT        DEFAULT 'incoming',
  ADD COLUMN IF NOT EXISTS message_text TEXT,
  ADD COLUMN IF NOT EXISTS sent_at      TIMESTAMPTZ DEFAULT now();

-- Backfill message_text from raw_payload for existing events
UPDATE webhook_events
SET message_text = COALESCE(
  -- Meta Cloud API format
  (raw_payload->'entry'->0->'changes'->0->'value'->'messages'->0->>'body'),
  -- Simple / custom formats
  raw_payload->>'text',
  raw_payload->>'message',
  raw_payload->>'body'
)
WHERE message_text IS NULL
  AND phone_number  IS NOT NULL;

-- Backfill sent_at from received_at for existing rows
UPDATE webhook_events
SET sent_at = received_at
WHERE sent_at IS NULL;

-- Indexes for chat-panel queries
CREATE INDEX IF NOT EXISTS idx_webhook_events_phone   ON webhook_events(phone_number);
CREATE INDEX IF NOT EXISTS idx_webhook_events_lead_id ON webhook_events(lead_id);
CREATE INDEX IF NOT EXISTS idx_webhook_events_sent_at ON webhook_events(sent_at DESC);

-- Explicit grants (consistent with other tables)
GRANT ALL ON TABLE public.webhook_events TO anon, authenticated, service_role;
