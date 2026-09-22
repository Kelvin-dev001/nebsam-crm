# Claude Code Prompt — Nebsam CRM: User Management

**Repo:** `C:\Projects\nebsam-crm` · **Branch:** create `feature/user-management` off `main`
**Scope:** Let admins add users, give them a department, reset their passwords, move them between departments and deactivate them, all from inside the CRM. Support **two or more named admin accounts**, each person logging in as themselves, and retire the shared admin login once they are proven to work. Fix the role-storage security hole first.
**Next migration numbers:** `012`, `013` (011 is the latest applied).

> Read `CLAUDE.md` and `DEPARTMENTS-MASTER-PROMPT.md` §5.0 (the Production Safety Contract) **before** this file. The contract still applies in full. The system is live: 3,395 leads, three reps working in it every day. Work one sprint at a time, use plan mode at the start of each, and follow the §12 protocol before anything touches production.

---

## 1 · HOW USERS ARE MANAGED TODAY (verified in the code)

### 1.1 Where each piece lives

| Concern | Where it lives today | What it actually does |
|---|---|---|
| **Login accounts** | `scripts/setup-auth-users.mjs` | The four accounts are hardcoded in a `USERS` array (3 reps + `admin@nebsamdigital.com`). It is run from a laptop with the service-role key and creates each Supabase Auth user with `user_metadata: { role }` and a random password. It links reps to `telemarketers` through a hardcoded email map and writes the passwords to `CREDENTIALS.md`, which is gitignored. |
| **Rep records** | Admin → Telemarketers tab → `TelemarketerManager.tsx` | "Add Telemarketer" inserts a `telemarketers` row from the browser. **It creates no login**, so the person can't sign in. There's no department field, so the row silently gets the column default: Telematics. |
| **Department assignment** | Admin → Departments → `DepartmentManager.tsx` | A per-rep dropdown that updates `telemarketers.department_id` from the browser. |
| **Deactivation** | `TelemarketerManager.toggleActive` | Flips `telemarketers.is_active` only. **The login keeps working.** |
| **Roles** | `auth.users.raw_user_meta_data->>'role'` | Read by `middleware.ts`, `app/login/page.tsx`, `AuthProvider.tsx`, `UserMenu.tsx`, and by **`public.is_admin()`, which every RLS policy in 011 calls.** |
| **Password reset** | Nowhere | No "forgot password", no "change password", no admin reset. The only way is the Supabase dashboard. |

### 1.2 Defects to fix as part of this work

1. **Critical: admin status is user-writable.** In Supabase, `user_metadata` (`raw_user_meta_data`) can be edited by the user it belongs to via `supabase.auth.updateUser({ data: … })`. That's the client-side SDK, run with the public anon key that ships in the browser bundle. Any signed-in rep can set `role: 'admin'` on themselves. `is_admin()` reads that value live from `auth.users`, so the next query gets full read/write on every lead, call log, sale and rep record. If public sign-ups are enabled on the project (the Supabase default), `supabase.auth.signUp({ …, options: { data: { role: 'admin' } } })` gives the same result to **someone with no account at all.** Supabase's documentation says not to use `user_metadata` for authorization. **Fixed in Sprint U0, before any feature work.**
2. **`setup-auth-users.mjs` destroys its own output.** On a re-run, users that already exist are skipped *without* adding a line to the credentials table, and then `writeFileSync` overwrites `CREDENTIALS.md`. Adding a fifth person that way erases the recorded passwords of the first four.
3. **"Add Telemarketer" creates people who can never log in** (`user_id` stays `NULL`), and it puts them in Telematics whatever was intended.
4. **Deactivated reps can still sign in.** Middleware only checks that a user exists. RLS happens to hide their data (`current_rep()` filters `is_active`), but they are still authenticated, can still read every config table, and could still use defect 1.
5. **Department dropdown offers "Unassigned".** Migration 010 made `telemarketers.department_id` `NOT NULL`, so choosing it raises a constraint error ("Could not reassign the rep").
6. **Moving a rep between departments orphans their leads.** `leads_dept_scoped` requires `department_id = current_rep_department() AND assigned_to = current_rep()`. Once a rep moves department, the leads still assigned to them in the old department match nobody except admin. They disappear from every rep's queue.
7. **Lead counts on the Telemarketers tab are wrong.** `supabase.from("leads").select("assigned_to")` fetches rows and counts them in the browser. PostgREST caps responses at the project's max-rows setting (1,000 by default), and there are 3,395 leads, so the counts are truncated without any warning. Count on the server instead.
8. **Two email addresses per rep.** Auth logins are `@nebsamdigital.com`; the `telemarketers.email` values are `@nebsamdigital.co.ke`. They are linked only by the hardcoded map in the setup script. **Do not "fix" the existing rows** — see §4. The Users screen shows the auth email as the *login email*. For new users the two are the same.
9. **One shared admin login, used by several people.**
   - Every admin action is anonymous: there's no way to tell who reset a password or moved a rep.
   - The password is known to more than one person, so it can't be revoked from one person without locking out all of them.
   - If it's forgotten, nobody inside the app can recover it.
   - Admins also have no profile anywhere: they exist only as an auth user with a role string, with no name, no active flag and no record of who created them.

---

## 2 · DECISIONS ALREADY MADE (do not re-litigate)

| # | Decision | Implication |
|---|---|---|
| U-D1 | **Temporary password + forced change on first login** | Admin clicks Add User. The server generates a strong temporary password and shows it **once**. The admin shares it privately. The user can't use the app until they set their own. |
| U-D2 | **Admin-only password resets, no email** | No "forgot password" email flow, and no SMTP configuration in this project. A reset works exactly like U-D1: new temporary password, forced change. The login page tells users to ask the administrator. Self-service can be added later once Nebsam has a mail sender; design so it slots in. |
| U-D3 | **Multiple named admin accounts; the shared login is retired once they work** | Any admin can create further admins, each with their own login and a temporary password. `admin@nebsamdigital.com` **keeps working unchanged** until an admin explicitly retires it from the UI (§8.8). The Retire button only enables once at least one named admin has logged in and set their own password. Retiring **deactivates** the shared login; it is never deleted, and Reactivate reverses it. From then on, every audit entry names a real person. |
| U-D4 | **Deactivate = block login + reassign open work in the same step** | The deactivate dialog requires choosing an active rep **in the same department** to inherit the departing rep's open leads and pending follow-ups. Past call logs, sales and service orders stay attributed to the person who did the work. If the department has no other active rep, the dialog says so and sends the open leads to the department backlog (`assigned_to = NULL`) instead, stating this explicitly. |
| U-D5 | **Never hard-delete a user** | `call_logs.telemarketer_id`, `sales.telemarketer_id`, `followup_schedule.telemarketer_id` and `service_orders.telemarketer_id` all reference `telemarketers`. Deleting a rep either fails on the foreign key or erases who did the work. The UI has no delete. |
| U-D6 | **Role lives in `app_metadata`; admins also need an active roster entry** | `auth.users.raw_app_meta_data->>'role'` is the role. Only the service role can write it. `user_metadata` is never read for authorization again, anywhere. Being an admin requires **three things to agree**: `app_metadata.role = 'admin'`, an active row in the new `admin_profiles` table, and the login not being banned. All three can only be written by the server. If any one fails, the person is not an admin, at the database and at every API route. |
| U-D7 | **All admins are equal, with guards** | Any admin can add, edit, reset, deactivate or reactivate any other admin. **Enforced on the server, not just hidden in the UI:** (a) nobody can deactivate or reset *themselves* through admin actions; they use "Change password" for their own account. (b) **The last active admin can never be deactivated.** This check is race-safe (§7.6), so two admins deactivating each other at the same moment can't leave zero. (c) Admin-targeted actions (create, reset, deactivate, reactivate, retire the shared login) require the acting admin to **re-enter their own password**, so a logged-in browser left unattended can't be used to take over admin access. |
| U-D8 | **No promotion or demotion** | A login's role is fixed when it is created. Rep accounts stay reps; admin accounts stay admins. There is no role-change UI or API. If a rep becomes a supervisor: deactivate them as a rep (U-D4 reassigns their leads), then create a **new** admin login for them. Every email belongs to exactly one login (Supabase enforces this), so the new admin login needs a different address. Alternatively, free the old one first by editing the deactivated rep's login email to an archive address, e.g. `jane+rep-archived@…`. The Add Admin form explains this when it hits a taken email. |

---

## 3 · OPEN ITEMS — ASK KELVIN BEFORE SPRINT U2

1. **Production login URL** for the "copy login details" message, e.g. `https://crm.nebsamdigital.com/login`.
2. **Password policy.** Proposed: minimum 10 characters, must contain letters and digits. Kelvin sets this in Supabase Dashboard → Authentication → Policies. The app enforces the same rule in Zod so users get a clear message instead of a raw Supabase error.
3. **Existing reps' passwords.** The three current reps use the passwords in `CREDENTIALS.md`. *Proposed default: do not force a change at rollout.* That would interrupt their day, and §5 says not to interfere. Instead, the Users tab gets a per-user **"Require password change at next login"** button that Kelvin presses when he chooses. Once all three have changed, Kelvin deletes `CREDENTIALS.md` himself.
4. **Tab name.** Proposed: rename Admin → "Telemarketers" to **"Users"**. The tab now covers reps in all four departments and the administrators, not only telemarketers.
5. **The first named admins.** Full name, login email and phone for each person who should have admin access. Kelvin first. Recommend a personal address per admin (e.g. `kelvin@nebsamdigital.com`), never a shared one. None of these emails may already belong to a rep login (U-D8).

---

## 4 · WHAT MUST NOT CHANGE (the Production Safety Contract, applied here)

- **The four existing logins must keep working identically at every step.** Same email, same password, same landing page, same leads. Verify this on staging after every sprint and on production after every deploy. This includes the shared `admin@nebsamdigital.com` login, which keeps full admin access right up to the moment an admin deliberately retires it through §8.8. No migration, script or deploy may retire it as a side effect.
- **No existing `telemarketers` row is modified by a migration or rollout script.** Not the `.co.ke` emails, not `created_at` (which fixes the round-robin order), not `is_active`. Rows change only when the admin performs an action on that person in the UI.
- **No lead, call log, sale, follow-up or service order is modified**, except by the explicit reassign-on-deactivate or reassign-on-move actions the admin confirms in a dialog. Those preserve `updated_at` (§7.3).
- **Only two deliberate touches to existing things**, both required by the security fix. State both to Kelvin and wait for go before running either:
  1. Writing `role` into `app_metadata` for the four existing auth users. This adds a key. `user_metadata` is untouched.
  2. `CREATE OR REPLACE` of `public.is_admin()`. This is a **deliberate exception** to contract rule 5, which says to ship `_v2` alongside. Here the vulnerable function is referenced by name by every policy in 011, so fixing it in place is the only way to close the hole without rewriting fifteen policies. The replacement is guarded by preconditions, the old body is snapshotted, and the rollback is one paste (§6.3).
- **Every new function** follows the 009e rule: `REVOKE ALL … FROM PUBLIC, anon;` then an explicit `GRANT EXECUTE` only to the roles that need it. Re-run 009e's verification afterwards: `anon` must have EXECUTE on nothing in `public`.
- **Every new table** gets RLS enabled, explicit policies and explicit grants, and must pass 011's verification block: no `open_*` policies, RLS on everywhere.
- **Staging first, always.** Restore a fresh production `pg_dump` into the staging project before U0. Everything runs there before production.

---

## 5 · SECURITY ARCHITECTURE

### 5.1 The rules

- **Authorization reads `app_metadata.role` and nothing else.** Values: `'admin' | 'telemarketer'`. Add one helper, `lib/auth/getRole.ts`, exporting `getRole(user): 'admin' | 'telemarketer' | null` that reads `user.app_metadata?.role`. Every place that needs the role calls it. After U0, `grep -rn "user_metadata" --include=*.ts --include=*.tsx` must show **no** role reads. Add that grep to `scripts/qa-test.mjs` so it fails the build if one ever comes back.
- **Other flags in `app_metadata`:** `must_change_password: boolean`. Absent means `false`.
- **Service-role access is server-only.** New file `lib/supabase/admin.ts`: `import "server-only"`, then a factory returning `createClient(URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })`. It must never be imported by a client component or anything under `components/`. The key is already set on Vercel, since the WhatsApp webhook uses it. Confirm it has no `NEXT_PUBLIC_` prefix anywhere.
- **Every admin endpoint authenticates itself.** `middleware.ts` returns early for every `/api` path (`if (path.startsWith("/api")) return response`), **so middleware protects none of the new routes.** These routes then act through the **service role, which bypasses RLS entirely**. That makes `requireAdmin` the *only* gate in front of them, so it must check all three U-D6 conditions.

  New file `lib/auth/requireAdmin.ts`:
  1. Build the SSR client from cookies and call `getUser()` (never `getSession()`).
  2. Require `getRole(user) === 'admin'`.
  3. Require `!user.banned_until || banned_until <= now`.
  4. Via the service client, require an `admin_profiles` row for `user.id` with `is_active = true`.
  5. Return `{ user, adminProfile }`. On failure return `401` (no user) or `403` (anything else) as JSON.

  **It is the first line of every handler under `app/api/admin/`.** Add the matching `lib/auth/requireUser.ts` for `/api/account/*`.
- **Step-up for admin-targeted actions (U-D7c).** New helper `lib/auth/verifyActorPassword.ts`. It takes the acting admin's email (from `getUser()`, never from the request body) and the `actorPassword` from the body. It calls `signInWithPassword` on a throwaway server client (`persistSession: false`) and returns true or false. Every route that creates, resets, deactivates or reactivates an admin, or retires the shared login, calls it after `requireAdmin` and returns `403 { error: "Your password was not correct." }` on failure. Rep-targeted actions do not require it.
- **Temporary passwords are shown once and never stored.** They are generated on the server, returned in exactly one HTTP response body, and shown in one dialog. They are never logged, never written to the database or the audit table, and never put in a toast or a URL. The dialog's state is cleared when it closes. No `console.log` of any request or response body in these routes.
- **Public sign-up must be off.** Kelvin switches off Supabase Dashboard → Authentication → "Allow new users to sign up". Admin-created users (`auth.admin.createUser`) are unaffected. On **staging only**, verify with a throwaway `signUp` using the anon key: it must fail with a "signups not allowed" error. **Never run a test sign-up against production.** On production, confirm the dashboard toggle and nothing more.

### 5.2 Generating temporary passwords

`lib/auth/tempPassword.ts` (server-only). Use `crypto.randomInt` over an unambiguous alphabet: no `0 O o 1 l I`. Length 12. Guarantee at least one uppercase, one lowercase and one digit. The result must satisfy the §3 policy. Never use `Math.random`.

---

## 6 · SPRINT U0 — CLOSE THE ROLE HOLE (security, before any feature)

The order matters. Doing these steps out of order will cause exactly the interference §4 forbids.

### 6.1 Step A — audit, then backfill `app_metadata.role` (script, not SQL)

`scripts/backfill-app-metadata-roles.mjs`. Dry-run by default; `--apply` to write; prints the target Supabase host first.

1. List **all** auth users, paginating `auth.admin.listUsers` until exhausted.
2. **Rogue-account check.** Print every user: email, `created_at`, `user_metadata.role`, `app_metadata.role`, `last_sign_in_at`. If any account is not one of the four known logins (`edith@`, `janet@`, `suzzie@`, `admin@nebsamdigital.com`), **stop.** Report it to Kelvin and do not continue. Do not delete it, and do not give it a role. An unknown admin-claiming account means the hole may already have been used, and that becomes Kelvin's decision.
3. For each known user whose `app_metadata.role` is missing, call `auth.admin.updateUserById(id, { app_metadata: { role: <their current user_metadata.role> } })`. Accept only `'admin'` or `'telemarketer'`; anything else stops the run. Pass **only** the `role` key. GoTrue merges `app_metadata`, so `provider`/`providers` survive. **Verify that** afterwards; don't assume it.
4. **Do not touch `user_metadata`.** The old value stays in place for now, because the currently deployed app still reads it for page routing (§6.4).

Verify in SQL:
```sql
SELECT email,
       raw_user_meta_data->>'role'  AS old_role,
       raw_app_meta_data->>'role'   AS new_role,
       raw_app_meta_data ? 'provider' AS provider_kept
FROM auth.users ORDER BY created_at;
-- Every row: new_role = old_role, provider_kept = true.
```

**Then wait at least one hour** (the project's `jwt_expiry` is 3600 s) before Step C, so every live session has refreshed and its JWT carries `app_metadata.role`.

### 6.2 Step B — `012_admin_roster_and_role_source.sql`

This one migration does two things:
- it creates the admin roster (`admin_profiles`) and seeds it with the shared admin, and
- it replaces `is_admin()` so that all three U-D6 conditions must agree.

Both belong in U0 because `is_admin()` should be replaced **once**, with its final logic, rather than patched again when named admins arrive in U4b.

```sql
-- 0. Snapshot the current body first. Save it to
--    supabase/migrations/_pre012_is_admin_snapshot.sql and commit it.
SELECT pg_get_functiondef('public.is_admin()'::regprocedure);

-- 1. The admin roster. A new table; nothing existing is touched.
CREATE TABLE IF NOT EXISTS admin_profiles (
  user_id            UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE RESTRICT,
  full_name          TEXT        NOT NULL,
  phone              TEXT,
  is_active          BOOLEAN     NOT NULL DEFAULT TRUE,
  is_shared_account  BOOLEAN     NOT NULL DEFAULT FALSE,   -- TRUE only for admin@nebsamdigital.com
  created_by         UUID,                                 -- auth uid of the admin who created it; NULL for the seed
  deactivated_at     TIMESTAMPTZ,
  deactivated_reason TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE admin_profiles ENABLE ROW LEVEL SECURITY;
-- Readable by admins only. No write policy for `authenticated`: rows are written
-- by the service role through the §8.8 routes and nothing else.
-- NB: this policy calls is_admin(), and is_admin() reads admin_profiles as
-- SECURITY DEFINER. There is no recursion, because a definer function bypasses
-- the caller's RLS. Verify on staging anyway.
CREATE POLICY "admin_profiles_read_admin" ON admin_profiles
  FOR SELECT TO authenticated USING (public.is_admin());
GRANT SELECT ON TABLE public.admin_profiles TO authenticated;
GRANT ALL    ON TABLE public.admin_profiles TO service_role;

-- 2. Seed: every user who already has app_metadata.role = 'admin' (after Step A,
--    that is exactly the shared admin) gets an active roster row. Idempotent.
INSERT INTO admin_profiles (user_id, full_name, is_shared_account)
SELECT id, 'Shared admin', TRUE
FROM auth.users
WHERE raw_app_meta_data->>'role' = 'admin'
ON CONFLICT (user_id) DO NOTHING;

-- 3. Preconditions — abort (and roll back 1–2 with it) if any fail.
DO $$
DECLARE v_missing INT; v_noprofile INT; v_admins INT; v_bad INT;
BEGIN
  -- Every user who is admin today must be admin under the new source.
  SELECT count(*) INTO v_missing FROM auth.users
  WHERE raw_user_meta_data->>'role' = 'admin'
    AND coalesce(raw_app_meta_data->>'role','') <> 'admin';
  IF v_missing > 0 THEN
    RAISE EXCEPTION '% admin(s) lack app_metadata.role — run Step A first', v_missing;
  END IF;

  -- Every app_metadata admin must have an active roster row.
  SELECT count(*) INTO v_noprofile FROM auth.users u
  WHERE u.raw_app_meta_data->>'role' = 'admin'
    AND NOT EXISTS (SELECT 1 FROM admin_profiles p WHERE p.user_id = u.id AND p.is_active);
  IF v_noprofile > 0 THEN RAISE EXCEPTION '% admin(s) have no active admin_profiles row', v_noprofile; END IF;

  -- At least one admin must pass ALL THREE conditions, or nobody can administer anything.
  SELECT count(*) INTO v_admins
  FROM admin_profiles p JOIN auth.users u ON u.id = p.user_id
  WHERE p.is_active AND u.raw_app_meta_data->>'role' = 'admin'
    AND (u.banned_until IS NULL OR u.banned_until <= now());
  IF v_admins = 0 THEN RAISE EXCEPTION 'No admin would survive the switch — refusing'; END IF;

  -- No unexpected role values.
  SELECT count(*) INTO v_bad FROM auth.users
  WHERE raw_app_meta_data ? 'role'
    AND raw_app_meta_data->>'role' NOT IN ('admin','telemarketer');
  IF v_bad > 0 THEN RAISE EXCEPTION '% users carry an unknown app_metadata.role', v_bad; END IF;
END $$;

-- 4. The fix. Same name, same signature, same attributes. Only the logic changes.
--    No fallback to raw_user_meta_data: a fallback would keep the hole open.
--    All three conditions are server-writable only, and all three are read live,
--    so deactivating an admin takes effect on their very next query rather than
--    when their JWT expires.
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

-- 5. Re-assert grants (009e rule).
REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated, service_role;
```

**Rollback (foot of the file, commented):** paste the body from `_pre012_is_admin_snapshot.sql`, then `DROP TABLE admin_profiles;`. That rollback reopens the hole, so it is for emergencies only.

**Proof on staging, with real JWTs, not the service role:**
1. Sign in as a rep and call `supabase.auth.updateUser({ data: { role: 'admin' } })`. It will succeed, because it only writes `user_metadata`.
2. `select public.is_admin()` must return **false**. A `leads` select must return only that rep's own leads.
3. Sign in as the shared admin: `is_admin()` returns true and all 3,395 leads are visible.
4. On staging only, set the shared admin's `admin_profiles.is_active = false`. Without signing out, re-run the `leads` select in the same session: it must now return **only rows allowed to a non-admin, i.e. none**. Restore `is_active = true` and confirm access returns. This proves deactivation is immediate at the data layer.
5. Reset the test rep's `user_metadata.role` back to `telemarketer` afterwards.

### 6.3 Why B can run before C without anyone noticing

Between Step B and Step C, the old app still routes pages by `user_metadata.role`, which is unchanged. RLS now decides by `app_metadata.role`, which holds the same values after Step A. For all four real users the two agree, so nobody sees a difference. Only a user who edits their own `user_metadata` would see a difference: at worst they'd reach the `/admin` *page*, and RLS would show them nothing. Step C closes that the same day.

### 6.4 Step C — app code reads `app_metadata` (deploy)

| File | Change |
|---|---|
| `lib/auth/getRole.ts` | **New.** The single role reader. |
| `middleware.ts` | `const role = getRole(user) ?? "telemarketer"`. `getUser()` fetches the user fresh from the Auth server, so the value is never stale. |
| `app/login/page.tsx` | Role-based redirect uses `getRole(data.user)`. |
| `components/layout/AuthProvider.tsx` | `syncSession()` already uses `getUser()`, so just swap the reader. **In the `onAuthStateChange` path, do not derive the role from `session.user`.** That object comes from the JWT and can be up to an hour stale. A stale token without `app_metadata.role` would make a rep look role-less, clear their store and blank their screen. Inside the existing `setTimeout(…, 0)`, call `supabase.auth.getUser()` and use that. **The GoTrue lock rule still holds:** the callback stays non-async, and every `supabase.*` call stays inside the deferred timeout. |
| `components/layout/UserMenu.tsx` | Use `getUser()` + `getRole()` instead of `getSession()` + `user_metadata`. For admins, show `admin_profiles.full_name` (the shared account shows "Shared admin"). Never display `user_metadata.full_name` as an admin's identity: it is user-editable, and the name shown should be the one the audit log will record. |

### 6.5 U0 done when

- Step A, B and C are applied to staging and verified, then to production under §12.
- On production, a rep's `updateUser({ data: { role: 'admin' } })` leaves `is_admin()` false. Test this with a rep account, with Kelvin's go-ahead, and reset the value afterwards.
- Public sign-up is confirmed off in the dashboard.
- `admin_profiles` holds exactly one row, the shared admin, with `is_shared_account = true`.
- The four real users log in exactly as before and see exactly what they saw before.
- `grep` finds no authorization read of `user_metadata`.

---

## 7 · MIGRATION `013_user_management.sql` (additive)

### 7.1 Columns on `telemarketers` (nullable, no defaults to backfill, no existing row touched)

```sql
ALTER TABLE telemarketers ADD COLUMN IF NOT EXISTS deactivated_at     TIMESTAMPTZ;
ALTER TABLE telemarketers ADD COLUMN IF NOT EXISTS deactivated_reason TEXT;
```

### 7.2 Audit table

```sql
CREATE TABLE IF NOT EXISTS user_admin_audit (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  action           TEXT        NOT NULL,
    -- Reps:   user_created | login_created | password_reset | password_change_required
    --         | password_changed | profile_updated | department_changed
    --         | deactivated | reactivated | work_reassigned
    -- Admins: admin_created | admin_profile_updated | admin_password_reset
    --         | admin_password_change_required | admin_deactivated | admin_reactivated
    --         | shared_admin_retired | step_up_failed
  target_kind      TEXT        NOT NULL DEFAULT 'rep',     -- 'rep' | 'admin'
  target_user_id   UUID,                                   -- auth.users.id (nullable: rep with no login)
  target_rep_id    UUID        REFERENCES telemarketers(id),
  performed_by     UUID,                                   -- auth.uid() of the actor
  performed_by_name  TEXT,   -- admin_profiles.full_name AT THE TIME of the action (snapshot)
  performed_by_email TEXT,   -- from getUser(), never from the request body (snapshot)
    -- Snapshots, not joins: the log must still read correctly after an admin is
    -- renamed or deactivated. That is the whole point of having named admins.
  details          JSONB       NOT NULL DEFAULT '{}'::jsonb,
    -- e.g. {"from_department":"…","to_department":"…","leads_moved":412,"inheritor":"…"}
    -- NEVER a password, temporary or otherwise.
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_user_admin_audit_target ON user_admin_audit(target_rep_id, created_at DESC);

ALTER TABLE user_admin_audit ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user_admin_audit_read_admin" ON user_admin_audit
  FOR SELECT TO authenticated USING (public.is_admin());
-- No INSERT/UPDATE/DELETE policy for authenticated. Rows are written only by
-- the API routes through the service role. The log is append-only from the app's point of view.
GRANT SELECT ON TABLE public.user_admin_audit TO authenticated;
GRANT ALL    ON TABLE public.user_admin_audit TO service_role;
```

### 7.3 `reassign_rep_open_work` — the heart of deactivate and move

```sql
-- reassign_rep_open_work(p_from_rep UUID, p_to_rep UUID) RETURNS JSONB
--   SECURITY DEFINER, SET search_path = public. service_role ONLY (009e rule).
--   p_to_rep may be NULL, meaning "return to the department backlog".
--
--   Validates:
--     • p_from_rep exists.
--     • If p_to_rep is not NULL: it exists, is_active, and has the SAME
--       department_id as p_from_rep. Otherwise raise. A rep may not inherit
--       leads from another department, because RLS would hide them.
--
--   Moves, in one transaction:
--     • leads WHERE assigned_to = p_from_rep AND the lead's funnel_stage is
--       an is_active_stage for the lead's department (join funnel_stages on
--       department_id + key). Terminal leads (lost, unqualified, dormant)
--       stay with the person who worked them. They are history.
--     • followup_schedule WHERE telemarketer_id = p_from_rep AND status = 'pending'.
--
--   Never moves: call_logs, sales, service_orders, completed/missed follow-ups.
--   Those record who did the work.
--
--   PRESERVE updated_at. Wrap the leads UPDATE in
--     ALTER TABLE leads DISABLE TRIGGER leads_updated_at; … ENABLE TRIGGER …;
--   exactly as rename_funnel_stage (009d) does. A reassignment is not someone
--   "dealing with" the client. Without this, hundreds of leads jump to the top
--   of the inheritor's queue and the team loses their last-touched ordering.
--   Check tgenabled = 'O' in the verification step.
--
--   Returns {"leads_moved": n, "followups_moved": m}.
```

### 7.4 `rep_workload` — correct counts (fixes defect 7)

```sql
-- rep_workload() RETURNS TABLE(rep_id UUID, open_leads INT, pending_followups INT)
--   SECURITY DEFINER, service_role only. Grouped in SQL, so the 1,000-row
--   response cap never applies. "Open" uses the same is_active_stage definition as §7.3.
```

### 7.5 `revoke_user_sessions` — optional, verify before relying on it

```sql
-- revoke_user_sessions(p_user_id UUID) RETURNS INT
--   SECURITY DEFINER, service_role only. DELETE FROM auth.sessions WHERE user_id = p_user_id.
--   Used after a password reset and on deactivation, so a session left open
--   on a shared office computer stops working.
--   VERIFY ON STAGING: after calling it, the user's next token refresh must fail
--   and middleware's getUser() must send them to /login. If Supabase's auth
--   schema rejects this, drop the function and rely on ban + the RLS is_active
--   check (§8.5). Do not work around it.
```

### 7.6 `deactivate_admin_guarded` — the last-admin rule, race-safe

A check in the API route ("count active admins, then deactivate") has a race: two admins deactivating each other at the same instant both see a count of 2, both proceed, and the system ends with zero admins. Only the break-glass script could recover from that. The check and the write must happen atomically, in the database.

```sql
-- deactivate_admin_guarded(p_target UUID, p_actor UUID, p_reason TEXT) RETURNS JSONB
--   SECURITY DEFINER, SET search_path = public. service_role ONLY (009e rule).
--
--   1. PERFORM pg_advisory_xact_lock(hashtext('nebsam_admin_roster'));
--      Serialises every admin deactivation. Held until the transaction ends.
--   2. IF p_target = p_actor → RAISE 'You cannot deactivate your own account.'
--   3. IF target has no active admin_profiles row → return {"ok":true,"already":true}
--      (idempotent retry).
--   4. Count OTHER active admins: admin_profiles.is_active AND user_id <> p_target,
--      joined to auth.users with role = 'admin' and not banned.
--      IF 0 → RAISE 'At least one active administrator must remain.'
--   5. UPDATE admin_profiles SET is_active = false, deactivated_at = now(),
--      deactivated_reason = p_reason WHERE user_id = p_target.
--      is_admin() reads this live, so the target loses all admin data access
--      at this moment, before the Auth-API ban in the route has even run.
--   6. RETURN {"ok": true, "remaining_admins": n}.
--
-- The route then applies the Auth-API ban (§8.8). If the ban call fails, the
-- person is already powerless at the data layer (is_admin() is false) and at
-- the API layer (requireAdmin checks is_active). Retry applies the ban.
```

Also add `reactivate_admin(p_target UUID)` (service_role only): sets `is_active = true`, clears `deactivated_at` and `deactivated_reason`. It needs no guard. Reactivating can never reduce the admin count.

---

## 8 · FEATURES

### 8.1 API routes (all new; every one starts with `requireAdmin()` or `requireUser()`)

| Method + path | Purpose |
|---|---|
| `GET  /api/admin/users` | List for the Users tab (§8.2). |
| `POST /api/admin/users` | Add a rep with a login (§8.3). |
| `POST /api/admin/users/[repId]/login` | Create a login for an existing rep row with `user_id = NULL` (defect 3). |
| `PATCH /api/admin/users/[repId]` | Edit name, phone, job title, login email. |
| `POST /api/admin/users/[repId]/department` | Move department, with a required inheritor (§8.4). |
| `POST /api/admin/users/[repId]/reset-password` | New temporary password + forced change (§8.6). |
| `POST /api/admin/users/[repId]/require-password-change` | Set the flag only (§3 item 3). |
| `POST /api/admin/users/[repId]/deactivate` | Reassign, then block (§8.5). |
| `POST /api/admin/users/[repId]/reactivate` | Unban, reactivate, force a password change. |
| `GET  /api/admin/users/[repId]/audit` | That person's audit history. |
| `POST /api/admin/admins` | Create a named admin. **Step-up required** (§8.8). |
| `PATCH /api/admin/admins/[userId]` | Edit an admin's name, phone or login email. |
| `POST /api/admin/admins/[userId]/reset-password` | New temporary password + forced change. **Step-up.** Refused if `userId` is the caller. |
| `POST /api/admin/admins/[userId]/require-password-change` | Flag only. |
| `POST /api/admin/admins/[userId]/deactivate` | Via `deactivate_admin_guarded`, then ban. **Step-up.** |
| `POST /api/admin/admins/[userId]/reactivate` | Unban + new temporary password + forced change. **Step-up.** |
| `POST /api/admin/admins/retire-shared` | Deactivate the shared login once the §8.8 preconditions hold. **Step-up.** |
| `GET  /api/admin/audit` | The activity feed across all users, newest first, paginated (§8.9). |
| `POST /api/account/password` | Any signed-in user changes their own password (§8.7). |

Validate every body with Zod. Return `{ ok: true, … }` or `{ ok: false, error: "<human sentence>" }`. Never send raw Supabase error text to the browser. Log it on the server without the request body.

**Every write is idempotent and safe to retry.** A second deactivate on an already-deactivated rep returns success with zero moved. A retried create finds the half-made user and completes or cleans it up.

### 8.2 The Users tab — `components/admin/UserManager.tsx`

Replaces `TelemarketerManager` in `AdminShell`, and the tab is renamed "Users" (§3 item 4). **Leave `TelemarketerManager.tsx` in place, unused, and ask Kelvin before deleting it.**

`GET /api/admin/users` builds the list on the server:
- all auth users (paginated `listUsers`), plus
- all `telemarketers` rows with `departments(name, slug)`, plus
- `rep_workload()`,
merged by `telemarketers.user_id = auth.users.id`.

| Column | Source |
|---|---|
| Name | `telemarketers.full_name` |
| Login email | `auth.users.email`, or "—" |
| Department | `departments.name` |
| Job title | `telemarketers.job_title` |
| Phone | `telemarketers.phone`, monospace |
| Open leads · Pending follow-ups | `rep_workload()` |
| Last sign-in | `auth.users.last_sign_in_at`, relative ("2 hours ago") |
| Status | **Active** · **Must change password** (`app_metadata.must_change_password`) · **Deactivated** (`is_active = false` or banned) · **No login** (`user_id IS NULL`) |
| Actions | Row menu, contents depend on status |

- **Filters:** department, status. **Search:** name, email, phone.
- **The tab has two sections, administrators first:**
  - **Administrators:** Name · Login email · Phone · Last sign-in · Created by · Status (Active / Must change password / Deactivated) · Actions. The shared login shows a grey **"Shared"** badge. The signed-in admin's own row shows **"You"** and offers only Edit (their own password changes from the user menu). The Deactivate action is disabled, with the tooltip *"At least one active administrator must remain"*, whenever the target is the only active admin. The server enforces the same rule regardless (§7.6). **"Add administrator"** sits in this section's header.
  - **Sales reps:** the table above.
- **Unrecognised logins:** any auth user who has neither an `admin_profiles` row nor a linked `telemarketers` row shows in a red **"Unrecognised logins"** panel with its email, creation date and `app_metadata.role`, and the text *"This login is not linked to any rep or administrator. If you don't recognise it, contact your developer before doing anything else."* This is how a sign-up made through the old hole would surface. So would an auth user claiming `role = 'admin'` without a roster row: is_admin() already ignores it, but it should be seen. Offer no action on it.

### 8.3 Add user

**Form** (sheet, React Hook Form + Zod; the forwardRef and RHF-toggle rules from `CLAUDE.md` apply):
- Full name*, Login email* (trimmed, lower-cased), Phone (normalised with `lib/utils/phoneHelpers.ts` to `+254…`), **Department*** (active departments only), Job title.

**Server, in order:**
1. `requireAdmin()`.
2. Validate. Reject if the email already exists in `auth.users` or `telemarketers.email`, with a human message: *"janet@… already has a login."*
3. Generate the temporary password (§5.2).
4. `auth.admin.createUser({ email, password, email_confirm: true, app_metadata: { role: 'telemarketer', must_change_password: true }, user_metadata: { full_name } })`. `email_confirm: true` because there is no email flow (U-D2).
5. Insert `telemarketers { full_name, email, phone, department_id, job_title, is_active: true, user_id }` through the service client.
6. **If step 5 fails, `auth.admin.deleteUser(newUserId)` and return the error.** Never leave a login with no rep row, which would appear as an "unrecognised login".
7. Write the `user_created` audit row.
8. Respond `{ ok: true, rep, tempPassword }`.

**Login details dialog** (shown once, cannot be reopened):
- Login URL (§3 item 1), email, temporary password, each with a copy button.
- **"Copy as message"**: a plain-text block ready to paste into WhatsApp or SMS:
  *"Hi Jane, your Nebsam CRM login: <URL> · Email: … · Temporary password: … You'll be asked to set your own password when you first sign in."*
- A red line: *"This password will not be shown again. If it's lost, use Reset password."*
- If the department is Telematics, add an info line: *"New Telematics reps join the WhatsApp round-robin immediately."* `assign_lead_round_robin_v2` rotates over active reps in the department, ordered by `created_at`, so the new rep enters the rotation at once, at the end of the cycle.

### 8.4 Edit and move department

**Edit** (name, phone, job title, login email):
- A login email change calls `auth.admin.updateUserById(id, { email, email_confirm: true })` **and** sets `telemarketers.email` to the same value, since that is an explicit admin edit to that person.
- Never touch other rows' emails.

**Move department** — a separate action, because it moves work:
- The dialog shows the rep's open leads and pending follow-ups in their **current** department.
- If there are any, the admin **must** pick an inheritor: an active rep in the **current** department. If the current department has no other active rep, use the backlog fallback with explicit wording, as in U-D4.
- Server order: `reassign_rep_open_work(from, inheritor)` **first**, then `UPDATE telemarketers SET department_id`, then the audit row with both department names and the counts.
- If the reassignment fails, do not move the rep.

**Fix `DepartmentManager.tsx`** (defect 5):
- Remove the "Unassigned" option.
- Replace the per-rep dropdown's direct browser `update` with a link or button that opens this same Move dialog. There must be exactly one code path that moves a rep.

### 8.5 Deactivate and reactivate

**Deactivate dialog:**
- Shows the rep's name, department, and open leads / pending follow-ups counts.
- **Inheritor select** (required when counts > 0): active reps in the same department, each showing their current open-lead count so the load can be spread sensibly. If no other active rep exists, show the backlog fallback with explicit wording.
- Optional reason, stored in `deactivated_reason`.

**Server order.** It matters: work must never be left orphaned.
1. `requireAdmin()`.
2. `reassign_rep_open_work(repId, inheritorId | NULL)`.
3. `UPDATE telemarketers SET is_active = false, deactivated_at = now(), deactivated_reason = …`. This takes effect immediately in RLS, because `current_rep()` filters on `is_active`.
4. `auth.admin.updateUserById(userId, { ban_duration: '876000h' })`. That is 100 years; Supabase has no "forever".
5. `revoke_user_sessions(userId)`, if §7.5 was verified.
6. Audit `deactivated` and `work_reassigned`, with counts and the inheritor.
7. If step 4 or 5 fails after 2–3 succeeded, report the partial state plainly ("Leads reassigned and access removed from data, but the login block failed: Retry") and make Retry resume from where it stopped.

**Middleware addition** (belt and braces):
- After `getUser()`, if `user.banned_until` is in the future, call `signOut({ scope: 'local' })` and redirect to `/login?reason=deactivated`.
- The login page shows *"Your account has been deactivated. Contact your administrator."* for that reason.

**Reactivate:**
- Unban (`ban_duration: 'none'`), `is_active = true`, clear `deactivated_at` and `deactivated_reason`, and set `must_change_password: true` (they've been away; their old password may be known to others).
- Issue a **new temporary password** using the §8.3 dialog.
- Audit it.
- Leads are **not** automatically returned. Say so in the dialog, and point to Admin → Assignment.

**Round-robin check:** verify `assign_lead_round_robin_v2` behaves when `round_robin_state.last_assigned_telemarketer_id` points at a now-deactivated rep. `ARRAY_POSITION` returns `NULL`, coalesces to 0 and restarts at the first active rep. Confirm it on staging with a real deactivation. Don't assume.

### 8.6 Passwords — admin side

- **Reset password** (row action, with a confirmation dialog):
  - New temporary password (§5.2): `auth.admin.updateUserById(id, { password, app_metadata: { must_change_password: true } })`.
  - Then `revoke_user_sessions` if it was verified, and the audit row `password_reset`.
  - The one-time dialog from §8.3.
- **Require password change at next login:** sets the flag only, plus audit. This is what Kelvin uses for the three existing reps when he's ready (§3 item 3).
- **Break-glass for any admin:** `scripts/admin-reset-password.mjs --email <admin email> [--reactivate]`.
  - Uses the service role and runs locally only. Prints the target host and asks for typed confirmation.
  - Sets a temporary password plus `must_change_password`, prints the password **once to the terminal**, and writes it nowhere.
  - `--reactivate` also unbans the login and sets `admin_profiles.is_active = true`.
  - It writes an audit row with `performed_by_name = 'break-glass script'`.
  - With several named admins, admins normally reset each other in the UI. This script is only for when *no* admin can sign in. It bypasses the §7.6 guard by design, so say so in its header comment.
- **Neutralise `scripts/setup-auth-users.mjs`** (defect 2):
  - Add a guard at the top that exits with *"Deprecated — add users in Admin → Users. This script overwrites CREDENTIALS.md."* unless it is run with `--force-legacy`.
  - Do not delete the script, and do not touch `CREDENTIALS.md`. Deleting that file is Kelvin's call, after the existing reps have changed their passwords.

### 8.7 Passwords — user side

**New route `/account/password`** (a page inside the authenticated shell):
- Fields: current password, new password, confirm. Zod enforces the §3 policy and "new ≠ current".
- `POST /api/account/password`:
  1. `requireUser()`.
  2. Verify the current password by calling `signInWithPassword` on a **throwaway server-side client** (`persistSession: false`). The browser session is not touched.
  3. `auth.admin.updateUserById(user.id, { password: new, app_metadata: { must_change_password: false } })`.
  4. Audit `password_changed` (no password in `details`).
- On success, in the page's own submit handler (never inside `onAuthStateChange`):
  1. `await supabase.auth.refreshSession()`, so the JWT drops the flag.
  2. Toast *"Password updated"*.
  3. Hard-navigate home (`/dashboard` for reps, `/admin` for the admin).
- `?first=1` variant: the heading reads *"Set your own password to continue"*, with no cancel and no navigation chrome besides Sign out.

**Forced-change gate** in `middleware.ts`, after the role and ban checks:
```ts
if (user.app_metadata?.must_change_password === true
    && path !== "/account/password") {
  return NextResponse.redirect(new URL("/account/password?first=1", request.url))
}
```
`/api/*` is already exempt (middleware returns early), so `/api/account/password` stays reachable. This gate is UX, not a security boundary: the user proved they hold the temporary password. The data layer is intentionally not gated on this flag.

**User menu:** add **"Change password"** above Sign out, linking to `/account/password`.

**Login page:**
- Replace *"Contact your administrator if you need access."* with *"Forgot your password? Ask your administrator to reset it."*
- Handle `?reason=deactivated`.
- Leave the sign-in logic unchanged apart from §6.4.

**Designed to extend (U-D2):** keep the password-setting UI in a component (`components/account/SetPasswordForm.tsx`). A future email-based "forgot password" flow can then reuse it on a `/auth/reset` route without rework. Do not build that flow now.

### 8.8 Administrators

**Add administrator** (sheet):
- **Fields:** Full name*, Login email*, Phone.
- **Warning panel:** *"Administrators can see every lead in every department, and can add, reset and deactivate every user — including other administrators."*
- **Step-up:** a **"Your password"** field at the bottom (U-D7c).
- **Server, in order:**
  1. `requireAdmin()`, then `verifyActorPassword()`.
  2. Validate. If the email is taken, say by whom *in kind*, never with details: *"This email already belongs to a sales rep login. Use a different address, or free it by changing that rep's login email first (U-D8)."*
  3. Generate the temporary password (§5.2).
  4. `auth.admin.createUser({ email, password, email_confirm: true, app_metadata: { role: 'admin', must_change_password: true }, user_metadata: { full_name } })`.
  5. Insert `admin_profiles { user_id, full_name, phone, is_active: true, is_shared_account: false, created_by: actor }`.
  6. **If step 5 fails, `auth.admin.deleteUser(newId)`.** An auth user with `role = 'admin'` and no roster row is powerless (is_admin() is false) but would show under "Unrecognised logins"; never leave one behind.
  7. Write the `admin_created` audit row, with actor name and email snapshots.
  8. Show the §8.3 one-time **Login details** dialog, without the round-robin line.

**Edit administrator:** name, phone, login email. A login email change updates `auth.users` via `updateUserById`. Admins may edit their own name and phone. No step-up is required for edits.

**Reset password / Require password change** on another admin work exactly as §8.6 does for reps, plus a step-up for reset. Both are **refused for the caller's own row**: *"Use Change password in your user menu."*

**Deactivate administrator** (step-up):
1. `requireAdmin()`, then `verifyActorPassword()`.
2. `deactivate_admin_guarded(target, actor, reason)`. This enforces not-self and not-last atomically (§7.6). Show its error message verbatim; both are written for humans.
3. `auth.admin.updateUserById(target, { ban_duration: '876000h' })`.
4. `revoke_user_sessions(target)`, if §7.5 was verified.
5. Audit `admin_deactivated`.
6. If step 3 or 4 fails, report the partial state and offer Retry. As §7.6 explains, the target is already powerless after step 2.

Admins own no leads, so there is no reassignment step.

**Reactivate administrator** (step-up): `reactivate_admin`, unban, new temporary password with `must_change_password: true`, the one-time dialog, and audit `admin_reactivated`.

**Retire the shared admin login** — a button on the shared row, labelled *"Retire shared login"*:
- **Enabled only when all of these hold (checked on the server, and shown in the UI as a checklist):**
  1. The caller is a **named** admin (`is_shared_account = false`). The shared login cannot retire itself, and not-self already forbids it.
  2. At least one active named admin exists who has **signed in at least once** (`last_sign_in_at` is after their `admin_profiles.created_at`) **and has already set their own password** (`must_change_password` is false). This proves a named login really works before the shared one goes away.
- **Action** (step-up): run the same path as *Deactivate administrator* on the shared account, with the reason `'Retired: replaced by named administrator accounts'`. Audit it as `shared_admin_retired`.
- **Afterwards:** the row stays visible with a "Retired" status and a **Reactivate** action, so the step is reversible. Nothing is deleted. The shared password stops working at once.
- **Tell Kelvin in the UI** after success: *"The shared admin login is retired. Anyone who used it now needs their own administrator account."*

**Middleware and navigation:** no change. Every admin, named or shared, has `app_metadata.role = 'admin'`, so the existing admin routing applies. The must-change gate (§8.7) applies to admins as it does to reps.

### 8.9 Activity feed

With several named admins, "who did this?" becomes answerable. Add an **Activity** sub-view on the Users tab (or a drawer):
- Newest first, 50 per page, filterable by action type, actor and target.
- Each line reads as a sentence, e.g. *"Kelvin Oyugi reset the password for Janet · 22 Sep, 14:05"* or *"Mary W. deactivated Paul K. and moved 38 open leads to Suzzie."*
- Built from `user_admin_audit` using the snapshot columns, so it reads correctly even after people are renamed or deactivated.
- A failed step-up is logged as `step_up_failed` (actor, action attempted, no password), so repeated failures are visible.

---

## 9 · FILES

**New**
`lib/supabase/admin.ts` · `lib/auth/getRole.ts` · `lib/auth/requireAdmin.ts` · `lib/auth/requireUser.ts` · `lib/auth/verifyActorPassword.ts` · `lib/auth/tempPassword.ts`
`app/api/admin/users/route.ts` · `app/api/admin/users/[repId]/{route,login,department,reset-password,require-password-change,deactivate,reactivate,audit}/route.ts`
`app/api/admin/admins/route.ts` · `app/api/admin/admins/[userId]/{route,reset-password,require-password-change,deactivate,reactivate}/route.ts` · `app/api/admin/admins/retire-shared/route.ts` · `app/api/admin/audit/route.ts`
`app/api/account/password/route.ts` · `app/account/password/page.tsx`
`components/admin/UserManager.tsx` · `components/admin/users/{AddUserSheet,EditUserSheet,MoveDepartmentDialog,DeactivateDialog,LoginDetailsDialog,UserAuditDrawer}.tsx`
`components/admin/admins/{AdminsTable,AddAdminSheet,EditAdminSheet,DeactivateAdminDialog,RetireSharedAdminDialog,StepUpPasswordField}.tsx` · `components/admin/ActivityFeed.tsx`
`components/account/SetPasswordForm.tsx`
`scripts/backfill-app-metadata-roles.mjs` · `scripts/admin-reset-password.mjs`
`supabase/migrations/012_admin_roster_and_role_source.sql` · `supabase/migrations/_pre012_is_admin_snapshot.sql` · `supabase/migrations/013_user_management.sql`

**Changed**
`middleware.ts` (role source, ban check, forced-change gate) · `app/login/page.tsx` · `components/layout/AuthProvider.tsx` · `components/layout/UserMenu.tsx` (admin name from `admin_profiles`) · `components/admin/AdminShell.tsx` (tab) · `components/admin/DepartmentManager.tsx` (remove Unassigned, route moves through §8.4) · `scripts/setup-auth-users.mjs` (deprecation guard only) · `scripts/qa-test.mjs` (the `user_metadata` grep) · `lib/supabase/types.ts` (regenerate) · `types/crm.ts` (`deactivated_at`, `deactivated_reason`, `AdminProfile`, `UserAdminAudit`)

**Untouched, and must stay that way:** `CREDENTIALS.md`, `supabase/seed.sql`, every existing `telemarketers` row, `TelemarketerManager.tsx` (kept, unused, pending Kelvin).

---

## 10 · SPRINT PLAN

| Sprint | Contents | Done when |
|---|---|---|
| **U0 — Close the role hole** | §6 A → B → C, staging then production. Kelvin turns public sign-up off. | §6.5 passes on production. |
| **U1 — Server foundation** | `admin.ts`, `getRole`, `requireAdmin`, `requireUser`, `tempPassword`; migration 013 (§7) on staging; 009e grant check; staging proof that `revoke_user_sessions` works, or its removal. | Every new `/api/admin/users/*` stub returns 401 anonymous and 403 as a rep (tested with curl using a real rep JWT); 013 verifies clean on staging. |
| **U2 — Users tab + Add user** | §8.2, §8.3, "Create login" for unlinked rows. | On staging, Kelvin adds a Fuel Monitoring rep, copies the details, and that person logs in, is forced to set a password, and lands on a Fuel Monitoring dashboard with an empty queue. The existing three reps and admin are unaffected. |
| **U3 — Passwords** | §8.6, §8.7, login page copy, break-glass script, setup-script guard. | Reset → share → forced change → new password works end to end. The old password stops working. Change-password from the user menu works for rep and admin. Break-glass works on staging. |
| **U4 — Move, deactivate, reactivate** | §8.4, §8.5, the `DepartmentManager` fix. | Deactivating a rep with 40 open leads moves exactly those 40 plus their pending follow-ups to the inheritor with `updated_at` unchanged; the rep can't log in; history still shows their name. Moving a rep leaves no lead orphaned. |
| **U4b — Administrators + activity** | §7.6 functions, `verifyActorPassword`, §8.8, §8.9. On production, Kelvin creates the first named admin(s) from §3 item 5. | On staging: two named admins create, reset and deactivate each other; neither can deactivate themselves; the last active admin cannot be deactivated even when two attempts are fired at once; a wrong step-up password is refused and logged. On production: Kelvin's named admin signs in and sets a password, **then** he retires the shared login, and the shared password stops working. |
| **U5 — Verify, document, ship** | §11 checklist on staging, then production under §12; `CLAUDE.md` gains a "User management" section; `README.md` gains "Adding and managing users". | All of §11 passes on production. |

---

## 11 · VERIFICATION CHECKLIST

**No interference (after every sprint, on staging and production):**
- [ ] The four existing logins sign in with their **current** passwords and land where they always have.
- [ ] Each existing rep sees exactly the same lead count as before the sprint.
- [ ] `telemarketers`: same row count; the three existing rows are byte-identical in `email`, `created_at`, `is_active`, `department_id`, `user_id`.
- [ ] `leads`: row count and top-20-by-`updated_at` identical to the pre-sprint snapshot (except leads a test deliberately reassigned, on staging only).
- [ ] `leads_updated_at` → `tgenabled = 'O'`.
- [ ] A test WhatsApp lead still round-robins to an active Telematics rep.
- [ ] `anon` has EXECUTE on nothing in `public`; 011's verification block still passes (no `open_*` policies, RLS on everywhere).

**Security:**
- [ ] A rep setting `user_metadata.role = 'admin'` gets `is_admin() = false`, sees only their own leads, and middleware keeps them out of `/admin`.
- [ ] Public sign-up is off (dashboard; staging throwaway test fails as expected).
- [ ] Every `/api/admin/users/*` route returns 401 anonymous and 403 as a rep. Test each one with curl, not just through the UI.
- [ ] No temporary password appears in the database, the audit table, the Vercel logs or the browser console.
- [ ] The service-role key appears in no client bundle. After `next build`, grep `.next/static` for a **unique** piece of the key's actual value, without ever printing the key:
  - a legacy JWT-style key: use its last 16 characters (the signature). The leading header segment is identical to the anon key and would give a false positive.
  - a newer `sb_secret_…` key: grep for `sb_secret_`.

  Zero matches required.
- [ ] No authorization read of `user_metadata` anywhere (the qa grep passes).

**Flows:**
- [ ] Add a rep to each of the four departments. Each can log in, is forced to change their password, and sees only their own department.
- [ ] Adding a rep with an existing email fails with a human message; no half-created login is left behind.
- [ ] A rep row with no login (made by the old button) gets "Create login" and works afterwards.
- [ ] Reset password: the old password fails, the temporary one works once, a change is forced, and other sessions are ended (if §7.5 was verified).
- [ ] "Require password change" forces the change on the next navigation without resetting anything.
- [ ] Move department: open work goes to the chosen inheritor in the old department; the moved rep sees only their new department; no lead ends up visible to nobody.
- [ ] Deactivate: the login is refused, an open session is bounced to `/login?reason=deactivated`, work moves with `updated_at` preserved, and past call logs still show the rep's name.
- [ ] Deactivate the only rep in a department: open leads go to the backlog with the explicit wording; admin sees them in Backlog.
- [ ] Reactivate: the rep logs in with a new temporary password, is forced to change it, and their old leads are not silently returned.
- [ ] The round-robin keeps working after deactivating the rep it last assigned to.
- [ ] The admin card has no destructive actions; the break-glass script resets the admin on staging.
- [ ] The Users tab lead counts match `SELECT assigned_to, count(*) FROM leads GROUP BY 1` exactly.
- [ ] An auth user linked to no rep appears in "Unrecognised logins".

---

## 12 · REPORTING BACK AND PRODUCTION PROTOCOL

At the end of each sprint, state: what changed (files and migrations), what was verified and how, what's still open, and the exact rollback command.

**Before anything touches production** — the Step A script, 012, 013, or a deploy that changes auth behaviour — post:
- the file or script and the target host as printed,
- the dry-run output,
- confirmation that a fresh `pg_dump` exists and was checked,
- the rollback,
- **for U0 specifically, the output of the §6.1 rogue-account check.**

Then **wait for Kelvin to say go.**

Schedule U0 Step C at least one hour after Step A (§6.1). Deploy auth changes in a quiet window, not while the team is mid-call. If anything in §2 turns out to be wrong once you're in the code, stop and raise it with Kelvin rather than working around it.
