-- ============================================================================
-- _pre012_is_admin_snapshot.sql
--
-- The body of public.is_admin() as it ran in production immediately before
-- migration 012 replaced it. Captured with:
--
--   SELECT pg_get_functiondef('public.is_admin()'::regprocedure);
--
-- Captured from staging (koifyemtduyyfqpkogpl) on 2026-09-22. Byte-identical to
-- the body declared in 011_department_rls.sql:51-59, and re-confirmed against
-- production at the §12 gate before 012 was applied.
--
-- ----------------------------------------------------------------------------
-- THIS IS THE ROLLBACK FOR MIGRATION 012.
--
-- Pasting it restores the previous behaviour, but understand what that means:
-- it puts authorization back on raw_user_meta_data, which the user themselves
-- can write through supabase.auth.updateUser({ data: … }) using the anon key
-- that ships in the browser bundle. In other words this rollback REOPENS the
-- privilege-escalation hole that 012 exists to close. It is for emergencies —
-- an admin locked out of production — and nothing else. Close the window fast.
--
-- The full rollback is this file, then:
--   DROP TABLE public.admin_profiles;
--
-- Drop the table second: the replaced is_admin() joins it, so dropping first
-- would break every RLS policy in 011 until the function is restored.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.is_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
  SELECT coalesce(
    (SELECT raw_user_meta_data->>'role' FROM auth.users WHERE id = auth.uid()) = 'admin',
    FALSE);
$function$;

-- Grants, as they were (009e rule).
REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated, service_role;
