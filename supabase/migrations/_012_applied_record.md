# Migration 012 + Step A — applied to production

**2026-09-22.** Sprint U0, steps A and B. Step C (the app deploy) is tracked separately at the
foot of this file.

## Why

`is_admin()` read `auth.users.raw_user_meta_data->>'role'`. That field is writable by the user it
belongs to, from the browser, with the anon key that ships in the bundle:

```js
await supabase.auth.updateUser({ data: { role: 'admin' } })
```

All fifteen RLS policies in 011 call `is_admin()`, and it read the value live. Any of the three
reps could have granted themselves read/write on every lead, call log, sale and rep record across
all four departments.

Public sign-up was off, so this was reachable by the four real logins rather than by the internet.

## Rogue-account check (the §12 gate, run before anything was written)

```
email                      created      user_meta      app_meta   last sign-in
admin@nebsamdigital.com    2026-06-24   admin          -          2026-09-22
suzzie@nebsamdigital.com   2026-06-24   telemarketer   -          2026-09-21
janet@nebsamdigital.com    2026-06-24   telemarketer   -          2026-09-21
edith@nebsamdigital.com    2026-06-24   telemarketer   -          2026-09-22

Rogue-account check: PASS - all 4 accounts recognised.
```

Four accounts, all expected, none already carrying `app_metadata.role`. **On the available
evidence the hole was never used.** Note the limit of that evidence: it rules out a *surviving*
rogue account, not an escalation that was performed and then reverted. There is no audit trail of
`user_metadata` writes to check, which is part of why `user_admin_audit` arrives in 013.

## Order of operations

| Time (UTC) | Step | Result |
|---|---|---|
| 09:16 | Step A on **staging** | 4 users, `provider=email` survived the merge |
| ~09:18 | 012 on **staging** | committed; security proof + impersonation passed |
| 09:20 | Backup | `prod-pre012-20260922-122045/` — `auth-users.sql` (4 roles), `00-schema.sql` |
| **09:22** | **Step A on production** | 4 users written and verified |
| ~09:24 | **012 on production** | committed, 4 notices, all assertions passed |
| pending | Step C (deploy) | not before **10:22 UTC / 13:22 EAT** (jwt_expiry 3600s) |

## Verification on production, immediately after 012

```
rep Edith  : leads=1151  is_admin=f
rep Janet  : leads=1153  is_admin=f
rep Suzzie : leads=1151  is_admin=f
ADMIN      : leads=3455  is_admin=t
anon       : leads=0
is_admin reads user_metadata? no - closed

admin_profiles : 1 row — "Shared admin", is_active=t, is_shared_account=t
leads_total    : 3455          (unchanged)
leads_updated_at tgenabled=O   (unchanged)
anon_executable_functions: 0   (009e still holds)
open_policies  : 0             (011 still holds)
```

Rep counts are **identical to the pre-sprint baseline** taken the same morning
(1151 / 1153 / 1151). Zero interference.

## The security proof (staging, `scripts/u0-security-proof.mjs`)

Run with real JWTs rather than the service role, using throwaway accounts:

- The escalation write **still succeeds** — `user_metadata` remains user-writable and always
  will. What changed is that nothing reads it for an authorization decision.
- The self-promoted rep gets `is_admin() = false`, sees 0 leads, cannot read the roster.
- A genuine admin gets `is_admin() = true` and all 3,393 staging leads.
- Clearing `admin_profiles.is_active` revokes access **inside an existing session**, with no JWT
  refresh, and restoring it returns access. This matters for U4b: deactivating an admin bites on
  their next query, not up to an hour later.

## Rollback

**Step A** — `C:\Projects\nebsam-crm-backups\auth-metadata-production-2026-09-22T09-22-25-955Z.json`
plus `prod-pre012-20260922-122045/auth-users.sql`. `app_metadata.role` is a new key; restore each
user's recorded `app_metadata` verbatim. Step A does **not** need rolling back alongside 012 — the
old function ignores `app_metadata`, so leaving the key in place is inert.

**012** — paste `_pre012_is_admin_snapshot.sql` (verified md5
`885dd436628c29f63c32662632ebd485` on both projects), *then* `DROP TABLE public.admin_profiles`.
In that order: the replaced `is_admin()` joins the table.

**This rollback reopens the hole.** It is for an admin locked out of production, nothing else.

## What a `public` pg_dump would not have protected

Step A writes to `auth.users`, which a `--schema=public` dump does not contain. The backup that
actually covers this change is the auth dump and the JSON snapshot, not the 23 MB data backup.
The pre-010 full data backup from 2026-09-21 remains the data floor, and 012 modifies **zero
rows in any existing table** — it creates one table and replaces one function.

## Step C — still to do

Deploy the app change (`lib/auth/getRole.ts` and the four call sites). Until then the deployed app
still routes pages by `user_metadata`, which is unchanged and agrees with `app_metadata` for all
four users, so nobody sees a difference.

The residual gap until Step C: a rep who sets `user_metadata.role = 'admin'` can reach the
`/admin` **page**, but RLS shows them nothing there. Page routing, not data.

Do not skip the one-hour gap after Step A. It is belt-and-braces rather than load-bearing — every
role read in the new code goes through `getUser()`, which fetches from the Auth server — but it
costs nothing and covers a path that might have been missed.
