-- ============================================================
-- Nebsam CRM — Supabase Auth Integration
-- Sprint E
-- ============================================================

-- 1. Link telemarketers to Supabase Auth users
ALTER TABLE telemarketers
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_telemarketers_user_id
  ON telemarketers(user_id)
  WHERE user_id IS NOT NULL;

-- 2. Auth-scoped RLS policies
--    ⚠️  Run this BLOCK only after setup-auth-users.mjs has populated user_id.
--    Until then, the open policies remain active and the app continues to work.
--
-- To activate, run in Supabase SQL editor:
--
-- -- Leads: telemarketer sees own leads; admin sees all
-- DROP POLICY IF EXISTS "open_leads" ON leads;
-- CREATE POLICY "leads_own_or_admin" ON leads FOR ALL USING (
--   assigned_to = (SELECT id FROM telemarketers WHERE user_id = auth.uid())
--   OR (SELECT raw_user_meta_data->>'role' FROM auth.users WHERE id = auth.uid()) = 'admin'
-- ) WITH CHECK (
--   assigned_to = (SELECT id FROM telemarketers WHERE user_id = auth.uid())
--   OR (SELECT raw_user_meta_data->>'role' FROM auth.users WHERE id = auth.uid()) = 'admin'
-- );
--
-- -- Call logs: visible if lead is owned by this TM, or admin
-- DROP POLICY IF EXISTS "open_call_logs" ON call_logs;
-- CREATE POLICY "call_logs_own_or_admin" ON call_logs FOR ALL USING (
--   telemarketer_id = (SELECT id FROM telemarketers WHERE user_id = auth.uid())
--   OR (SELECT raw_user_meta_data->>'role' FROM auth.users WHERE id = auth.uid()) = 'admin'
-- ) WITH CHECK (
--   telemarketer_id = (SELECT id FROM telemarketers WHERE user_id = auth.uid())
--   OR (SELECT raw_user_meta_data->>'role' FROM auth.users WHERE id = auth.uid()) = 'admin'
-- );
--
-- -- Sales: visible if telemarketer owns the sale, or admin
-- DROP POLICY IF EXISTS "open_sales" ON sales;
-- CREATE POLICY "sales_own_or_admin" ON sales FOR ALL USING (
--   telemarketer_id = (SELECT id FROM telemarketers WHERE user_id = auth.uid())
--   OR (SELECT raw_user_meta_data->>'role' FROM auth.users WHERE id = auth.uid()) = 'admin'
-- ) WITH CHECK (
--   telemarketer_id = (SELECT id FROM telemarketers WHERE user_id = auth.uid())
--   OR (SELECT raw_user_meta_data->>'role' FROM auth.users WHERE id = auth.uid()) = 'admin'
-- );
--
-- -- Follow-up schedule: same pattern
-- DROP POLICY IF EXISTS "open_followup_schedule" ON followup_schedule;
-- CREATE POLICY "followup_own_or_admin" ON followup_schedule FOR ALL USING (
--   telemarketer_id = (SELECT id FROM telemarketers WHERE user_id = auth.uid())
--   OR (SELECT raw_user_meta_data->>'role' FROM auth.users WHERE id = auth.uid()) = 'admin'
-- ) WITH CHECK (
--   telemarketer_id = (SELECT id FROM telemarketers WHERE user_id = auth.uid())
--   OR (SELECT raw_user_meta_data->>'role' FROM auth.users WHERE id = auth.uid()) = 'admin'
-- );
