-- ============================================================
-- Nebsam CRM — followup_schedule.scheduled_date → TIMESTAMPTZ
-- Allows telemarketers to store a specific time for follow-ups
-- not just a calendar date.
-- ============================================================

ALTER TABLE followup_schedule
  ALTER COLUMN scheduled_date TYPE TIMESTAMPTZ
  USING scheduled_date::TIMESTAMPTZ;
