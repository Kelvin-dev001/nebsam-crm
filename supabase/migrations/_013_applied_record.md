# Migration 013 + the API route lockdown — applied to production

**2026-09-22.** Sprint U1. Database and deploy both live.

## What went out

| Step | Detail |
|---|---|
| Backup | `prod-pre013-20260922-221059/` — schema, `auth.users`, `telemarketers` |
| `013_user_management.sql` | committed, 4 notices, all assertions passed |
| `009e_function_grants.sql` (fixed) | committed, 26 notices |
| Deploy | `nebsam-5jatukvhm` → `nebsam-crm.vercel.app` |

## The 009e fix, and why it was applied to production the same day

Re-running 009e after 013 **broke staging**. It revokes from every function then re-grants
`authenticated` from a hardcoded list written before migration 011. 011 added `is_admin()`,
`current_rep()` and `current_rep_department()` — which all fifteen of its policies call. A policy
is evaluated with the privileges of the **querying** role, so stripping those grants made every
signed-in query fail with *permission denied for function*: a total outage, not a quiet loss of
rows.

`CLAUDE.md` and `HANDOVER.md` both say to re-run 009e after any migration that creates a function.
**Following that instruction against production would have taken the CRM down.** Production
escaped only because 011 was applied after the last 009e run — luck, not design.

009e now derives the grant from `pg_policies`, so anything a policy calls keeps `authenticated`
automatically, and its first verification block fails the migration if a policy-referenced
function would be left unexecutable. Confirmed on production after the run:

```
current_rep             {authenticated,postgres,service_role}
current_rep_department  {authenticated,postgres,service_role}
is_admin                {authenticated,postgres,service_role}
```

## Production verification, after both migrations

```
rep Edith  : leads=1159  is_admin=f
rep Janet  : leads=1161  is_admin=f
rep Suzzie : leads=1158  is_admin=f
ADMIN      : leads=3478  is_admin=t
anon       : leads=0
is_admin reads user_metadata? no - closed

leads_total 3478 · leads_updated_at tgenabled=O
anon_executable_functions 0 · open_policies 0
```

## The API routes, verified against the live site

Every one of these was open to the internet before this deploy:

```
POST /api/whatsapp/send              -> 401
POST /api/whatsapp/installed-message -> 401
GET  /api/whatsapp/test              -> 401   {"ok":false,"error":"You are not signed in."}
GET  /api/admin/users                -> 401
POST /api/account/password           -> 401
POST /api/webhook/whatsapp           -> 200   (fails open by design, see below)
/ /login /dashboard /admin /leads    -> 200
```

`/api/whatsapp/test` used to return the **first 8 characters of `WHATSAPP_API_KEY` and its exact
length** to any caller. It now reports presence only.

## The webhook is NOT yet enforcing — this is deliberate, and it is your move

`WHATSAPP_WEBHOOK_SECRET` is unset, so `checkWebhookSecret` allows every request and logs a
warning. Behaviour is identical to before this deploy; anyone who knows the URL can still inject
leads.

That is the safe half of a two-step rollout, because this webhook is the team's only automated
lead source and a check that did not match what the BSP actually sends would stop intake
silently.

**To finish it:**

1. Read the Vercel logs for `[webhook] UNAUTHENTICATED` lines. They list the header **names** the
   BSP sends (never values). Confirm one of `x-webhook-secret`, `x-api-key`, `x-hub-signature` or
   `authorization` is present — or plan to use the `?secret=` query parameter.
2. Generate a long random secret. Set it in the BSP console **and** as `WHATSAPP_WEBHOOK_SECRET`
   in Vercel.
3. Redeploy. It starts enforcing.
4. Watch for a real inbound lead within the hour. If intake stops, unset the Vercel variable and
   redeploy — it fails open again immediately.

Until step 2, the hole is open. It is recorded here rather than left implicit.

## Rollback

013 is additive and, apart from the route guards, inert:

```sql
DROP FUNCTION IF EXISTS public.reassign_rep_open_work(uuid,uuid);
DROP FUNCTION IF EXISTS public.rep_workload();
DROP FUNCTION IF EXISTS public.revoke_user_sessions(uuid);
DROP FUNCTION IF EXISTS public.deactivate_admin_guarded(uuid,uuid,text);
DROP FUNCTION IF EXISTS public.reactivate_admin(uuid);
DROP TABLE IF EXISTS public.user_admin_audit;
ALTER TABLE telemarketers DROP COLUMN IF EXISTS deactivated_at,
                          DROP COLUMN IF EXISTS deactivated_reason;
```

The deploy rolls back through Vercel. Note that rolling it back **reopens the send relay and the
key disclosure**, so prefer fixing forward.
