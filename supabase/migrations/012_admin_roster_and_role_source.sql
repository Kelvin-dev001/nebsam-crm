-- ============================================================================
-- 012_admin_roster_and_role_source.sql
--
-- Closes the privilege-escalation hole. Spec: USER-MANAGEMENT-PROMPT.md §6.2.
--
-- THE HOLE
--   is_admin() reads auth.users.raw_user_meta_data->>'role'. That field is
--   writable by the user it belongs to, from the browser, with the anon key
--   that ships in the bundle:
--
--       await supabase.auth.updateUser({ data: { role: 'admin' } })
--
--   Every RLS policy in 011 calls is_admin(), and it reads the value live, so
--   any signed-in rep can grant themselves read/write on every lead, call log,
--   sale and rep record across all four departments. Supabase's own docs say
--   not to use user_metadata for authorization.
--
-- THE FIX
--   Authorization moves to raw_app_meta_data, which ONLY the service role can
--   write. Being an admin now requires three server-controlled facts to agree
--   (U-D6):
--       1. app_metadata.role = 'admin'
--       2. an active row in the new admin_profiles table
--       3. the login is not banned
--   Any one failing means not an admin — at the database, and (from U1) at
--   every API route. All three are read live, so deactivating an admin bites on
--   their very next query rather than whenever their JWT happens to expire.
--
-- ORDER MATTERS — RUN STEP A FIRST
--   scripts/backfill-app-metadata-roles.mjs must have run, or precondition 1
--   below aborts the whole transaction. That is deliberate: replacing is_admin()
--   before app_metadata is populated would lock the admin out of production.
--
-- A DELIBERATE EXCEPTION TO SAFETY-CONTRACT RULE 5
--   CLAUDE.md rule 5 says new behaviour ships as *_v2 beside the original and
--   never replaces a live function in place. This migration breaks that rule on
--   purpose. is_admin() is referenced BY NAME by all fifteen policies in 011, so
--   an is_admin_v2() would close nothing until every one of those policies was
--   rewritten to call it — a far larger and riskier change than this one. The
--   in-place replacement is guarded by four preconditions, the old body is
--   snapshotted in _pre012_is_admin_snapshot.sql, and the rollback is one paste.
--
-- SAFE TO RE-RUN. Every step is IF NOT EXISTS / ON CONFLICT / OR REPLACE.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. The admin roster
-- ----------------------------------------------------------------------------
-- New table; nothing existing is touched. Admins have never had a profile —
-- they existed only as an auth user carrying a role string, with no name, no
-- active flag and no record of who created them. From U4b this table is what
-- makes "who reset that password?" answerable.
--
-- NOTE the ensure_rls event trigger (CLAUDE.md) enables RLS on every new table
-- in public automatically, the moment it is created. The explicit ENABLE below
-- is therefore belt-and-braces — but a table with RLS on and NO policy denies
-- everything, which looks exactly like data loss, so the policy and grants
-- below are mandatory, not optional.
CREATE TABLE IF NOT EXISTS admin_profiles (
  user_id            UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE RESTRICT,
  full_name          TEXT        NOT NULL,
  phone              TEXT,
  is_active          BOOLEAN     NOT NULL DEFAULT TRUE,
  is_shared_account  BOOLEAN     NOT NULL DEFAULT FALSE,  -- TRUE only for admin@nebsamdigital.com
  created_by         UUID,                                -- auth uid of the creating admin; NULL for the seed
  deactivated_at     TIMESTAMPTZ,
  deactivated_reason TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE admin_profiles ENABLE ROW LEVEL SECURITY;

-- Readable by admins only. There is deliberately NO write policy for
-- `authenticated`: rows are written by the service role through the U4b routes
-- and by nothing else. If an admin could write this table from the browser, the
-- hole would simply have moved rather than closed.
--
-- On recursion: this policy calls is_admin(), and is_admin() reads
-- admin_profiles. That is not infinite, because is_admin() is SECURITY DEFINER
-- and a definer function bypasses the caller's RLS. Verified on staging rather
-- than assumed.
DROP POLICY IF EXISTS "admin_profiles_read_admin" ON admin_profiles;
CREATE POLICY "admin_profiles_read_admin" ON admin_profiles
  FOR SELECT TO authenticated USING (public.is_admin());

GRANT SELECT ON TABLE public.admin_profiles TO authenticated;
GRANT ALL    ON TABLE public.admin_profiles TO service_role;

-- ----------------------------------------------------------------------------
-- 2. Seed the roster
-- ----------------------------------------------------------------------------
-- Everyone who is already an admin under the NEW source gets an active row.
-- After Step A that is exactly one account: the shared admin login.
--
-- is_shared_account marks it as the login several people share. U-D3 keeps it
-- working unchanged until an admin deliberately retires it from the UI in U4b.
-- Nothing here retires it, and nothing here may.
INSERT INTO admin_profiles (user_id, full_name, is_shared_account)
SELECT id, 'Shared admin', TRUE
FROM auth.users
WHERE raw_app_meta_data->>'role' = 'admin'
ON CONFLICT (user_id) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 3. Preconditions — any failure rolls back steps 1 and 2 with it
-- ----------------------------------------------------------------------------
DO $$
DECLARE v_missing INT; v_noprofile INT; v_admins INT; v_bad INT;
BEGIN
  -- (a) Everyone who is an admin TODAY must still be one under the new source.
  --     This is the check that catches "012 was run before Step A".
  SELECT count(*) INTO v_missing FROM auth.users
  WHERE raw_user_meta_data->>'role' = 'admin'
    AND coalesce(raw_app_meta_data->>'role','') <> 'admin';
  IF v_missing > 0 THEN
    RAISE EXCEPTION
      '% admin(s) lack app_metadata.role. Run scripts/backfill-app-metadata-roles.mjs (Step A) first.',
      v_missing;
  END IF;

  -- (b) Every app_metadata admin must have an active roster row, or the switch
  --     would silently strip their access.
  SELECT count(*) INTO v_noprofile FROM auth.users u
  WHERE u.raw_app_meta_data->>'role' = 'admin'
    AND NOT EXISTS (SELECT 1 FROM admin_profiles p WHERE p.user_id = u.id AND p.is_active);
  IF v_noprofile > 0 THEN
    RAISE EXCEPTION '% admin(s) have no active admin_profiles row', v_noprofile;
  END IF;

  -- (c) THE IMPORTANT ONE. At least one admin must satisfy all three conditions
  --     after the switch. Without this, a mistake here locks every human out of
  --     administering the system and only a rollback could recover it.
  SELECT count(*) INTO v_admins
  FROM admin_profiles p JOIN auth.users u ON u.id = p.user_id
  WHERE p.is_active
    AND u.raw_app_meta_data->>'role' = 'admin'
    AND (u.banned_until IS NULL OR u.banned_until <= now());
  IF v_admins = 0 THEN
    RAISE EXCEPTION 'No admin would survive the switch - refusing to replace is_admin()';
  END IF;

  -- (d) No unexpected role values anywhere.
  SELECT count(*) INTO v_bad FROM auth.users
  WHERE raw_app_meta_data ? 'role'
    AND raw_app_meta_data->>'role' NOT IN ('admin','telemarketer');
  IF v_bad > 0 THEN
    RAISE EXCEPTION '% user(s) carry an unknown app_metadata.role', v_bad;
  END IF;

  RAISE NOTICE 'preconditions OK: % admin(s) will survive the switch', v_admins;
END $$;

-- ----------------------------------------------------------------------------
-- 4. The fix itself
-- ----------------------------------------------------------------------------
-- Same name, same signature, same attributes (sql / STABLE / SECURITY DEFINER /
-- search_path). Only the logic changes, so all fifteen policies in 011 pick it
-- up with no edit.
--
-- There is deliberately NO fallback to raw_user_meta_data. A fallback such as
-- "app_metadata.role = 'admin' OR user_metadata.role = 'admin'" would leave the
-- hole wide open while looking like a fix.
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM auth.users u
    JOIN public.admin_profiles p ON p.user_id = u.id
    WHERE u.id = auth.uid()
      AND u.raw_app_meta_data->>'role' = 'admin'
      AND p.is_active
      AND (u.banned_until IS NULL OR u.banned_until <= now())
  );
$$;

-- ----------------------------------------------------------------------------
-- 5. Grants (the 009e rule)
-- ----------------------------------------------------------------------------
-- Supabase's ALTER DEFAULT PRIVILEGES grants anon EXECUTE on every function
-- created in public, and REVOKE ... FROM PUBLIC does NOT remove that explicit
-- grant. CREATE OR REPLACE on an existing function keeps its existing ACL, but
-- re-assert anyway: this file must be correct if it is ever run on a database
-- where is_admin() did not already exist.
REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 6. Verification — fails the migration rather than reporting a problem
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v_src TEXT; v_admins INT; v_anon INT; v_rls BOOLEAN; v_pol INT;
BEGIN
  -- The replacement actually took, and carries no user_metadata fallback.
  SELECT pg_get_functiondef('public.is_admin()'::regprocedure) INTO v_src;
  IF v_src LIKE '%raw_user_meta_data%' THEN
    RAISE EXCEPTION 'is_admin() still references raw_user_meta_data - the hole is open';
  END IF;
  IF v_src NOT LIKE '%admin_profiles%' THEN
    RAISE EXCEPTION 'is_admin() does not reference admin_profiles - replacement did not apply';
  END IF;

  -- Someone can still administer the system.
  SELECT count(*) INTO v_admins
  FROM admin_profiles p JOIN auth.users u ON u.id = p.user_id
  WHERE p.is_active AND u.raw_app_meta_data->>'role' = 'admin'
    AND (u.banned_until IS NULL OR u.banned_until <= now());
  IF v_admins = 0 THEN RAISE EXCEPTION 'no surviving admin after replacement'; END IF;

  -- anon must not be able to call it.
  SELECT count(*) INTO v_anon
  FROM information_schema.routine_privileges
  WHERE routine_schema = 'public' AND routine_name = 'is_admin' AND grantee = 'anon';
  IF v_anon > 0 THEN RAISE EXCEPTION 'anon still has EXECUTE on is_admin()'; END IF;

  -- The new table is not left open or unreadable.
  SELECT relrowsecurity INTO v_rls FROM pg_class WHERE oid = 'public.admin_profiles'::regclass;
  IF NOT v_rls THEN RAISE EXCEPTION 'RLS is not enabled on admin_profiles'; END IF;

  SELECT count(*) INTO v_pol FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'admin_profiles';
  IF v_pol = 0 THEN RAISE EXCEPTION 'admin_profiles has RLS on but no policy - it would deny everything'; END IF;

  RAISE NOTICE 'OK: is_admin() now requires app_metadata + active roster row + not banned';
  RAISE NOTICE 'OK: % admin(s) survive; admin_profiles has RLS and % policy(ies)', v_admins, v_pol;
END $$;

-- ============================================================================
-- ROLLBACK 012
--
--   1. Paste the body from _pre012_is_admin_snapshot.sql
--   2. DROP TABLE public.admin_profiles;
--
-- In that order: the replaced is_admin() joins admin_profiles, so dropping the
-- table first breaks every RLS policy in 011 until the old function is back.
--
-- BE CLEAR ABOUT WHAT THIS ROLLBACK DOES: it puts authorization back on a field
-- the user can write to themselves, i.e. it REOPENS the privilege-escalation
-- hole. It exists for one scenario - an admin locked out of production - and it
-- should be followed by fixing forward quickly, not left in place.
--
-- Step A (app_metadata) does NOT need rolling back alongside this. The old
-- function ignores app_metadata entirely, so leaving the key in place is inert.
-- ============================================================================
