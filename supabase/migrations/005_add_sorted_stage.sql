-- ============================================================
-- Nebsam CRM — Add 'sorted' funnel stage
-- Sprint C
-- ============================================================
-- The funnel_stage column is plain TEXT with no CHECK constraint,
-- so no ALTER TABLE is required to accept the new value.
-- This migration is a no-op safety confirmation of that fact.
--
-- New funnel order:
--   new → contacted → interested → quote_sent → negotiating →
--   won → installed → post_sale → sorted → renewal_due →
--   renewed → lost → unqualified
--
-- All application-side changes (type, labels, badge, filters)
-- are handled in the TypeScript codebase.

-- Verify no CHECK constraint exists (informational query)
-- SELECT conname FROM pg_constraint
-- WHERE conrelid = 'leads'::regclass AND contype = 'c';

DO $$
BEGIN
  -- Guard: confirm funnel_stage has no check constraint that would block 'sorted'
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'leads'::regclass
      AND contype = 'c'
      AND conname LIKE '%funnel%'
  ) THEN
    RAISE EXCEPTION 'Unexpected CHECK constraint on funnel_stage — update it to include ''sorted'' before applying this migration.';
  END IF;
END $$;
