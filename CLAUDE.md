# Nebsam CRM — Project Memory

> **Handing this over or picking it up? Read `HANDOVER.md`.** It covers what is live, the one
> remaining sprint, and the traps that are invisible until they bite.

## Project Overview

A full-stack CRM for **Nebsam Digital Solutions**, a Kenyan digital marketing company running
Meta and TikTok ad campaigns that direct leads into a WhatsApp BSP chatbot. Three telemarketers
(Edith, Janet, Suzzie) manage leads from first inquiry through to annual renewal follow-ups.

**The system is LIVE and in daily use.** As of 2026-09-20 production holds 3,392 leads,
1,870 call logs and 17,019 webhook events. Treat every change as a change to a working system.

The current project is the **multi-department expansion** — adding Container E-Seal, Fuel
Monitoring and School Bus Solution alongside the existing telematics team. The full
specification is `DEPARTMENTS-MASTER-PROMPT.md` in this repo. **Read it before any work on
the `feature/departments` branch.**

## Tech Stack

Next.js 14 (App Router) · TypeScript · Supabase (PostgreSQL 17.6 + Realtime + pg_cron) ·
Tailwind + shadcn/ui · Zustand · TanStack Table v8 · React Hook Form + Zod · date-fns ·
Lucide · Sonner · jsPDF · deployed on Vercel.

## Current Production State (verified 2026-09-20)

**Database — migrations 001–012 applied** (009, 009b, 009c, 009d, 009e, `seed_departments.sql`,
010 cutover). `department_id` is NOT NULL throughout; the phone key is per-department; the cron
runs `rag_auto_flag_v2`. (009 + 009b + `seed_departments.sql` on 2026-09-20;
the app is not yet deployed against them, so nothing reads the new columns yet).

| Table | Rows | Notes |
|---|---:|---|
| `leads` | ~3,395 | `phone_number` globally UNIQUE via `leads_phone_number_key`; every row now carries `department_id` = telematics |
| `call_logs` | 1,870 | |
| `sales` | **0** | No sale has ever been recorded — the renewals path is untested against real data |
| `followup_schedule` | 122 | |
| `telemarketers` | 3 | Edith, Janet, Suzzie |
| `webhook_events` | ~17,029 | |
| `round_robin_state` | 1 | Single row |

**Functions and jobs**
- `assign_lead_round_robin(p_phone, p_name, p_message, p_campaign, p_raw_payload)` —
  SECURITY DEFINER. Rotates over **all active telemarketers** ordered by `created_at`.
- `rag_auto_flag()` — SECURITY DEFINER, pure SQL, hardcoded 10-entry `active_stages` array.
  pg_cron job `rag-auto-flag` at `0 5 * * *` UTC = 08:00 EAT.
- Triggers `leads_updated_at`, `sales_renewal_due_date` (installation_date + 365d) — both enabled.
- Live bodies are committed at `supabase/migrations/_pre009_function_snapshot.sql`.

**RLS** is enabled on all tables with real department-aware policies (migration 011). admin sees
everything; a rep sees their own rows within their own department; `anon` sees nothing. Child
tables (school_buses, term_billings, webhook_events) inherit visibility from their parent lead,
so lead visibility is defined in exactly one place. `service_role` and `postgres` bypass RLS,
which is what keeps the webhook and the cron working.

**There is an active event trigger, `ensure_rls`**, running `public.rls_auto_enable()` on
`ddl_command_end` for `CREATE TABLE`. **Every new table in `public` gets RLS enabled
automatically, the moment it is created.** A table with RLS on and no policy denies everything,
so *any* migration that creates a table must also create a policy and grant to
`anon, authenticated, service_role` — otherwise the table silently returns zero rows to the app,
which looks exactly like data loss. Event triggers are database-level objects, so
`pg_dump --schema=public` does **not** include them and they are invisible in a schema dump;
they are recorded in `supabase/migrations/_pre009_function_snapshot.sql`.

**Auth** — Supabase Auth. Role in `auth.users.raw_user_meta_data->>'role'` =
`admin` | `telemarketer`. `middleware.ts` gates `/admin`, sends admins to `/admin` and reps to
`/dashboard`.

**Routes** — `/` `/login` `/dashboard` `/leads` `/leads/[id]` `/backlog` `/renewals` `/admin`,
plus `/api/webhook/whatsapp`, `/api/whatsapp/{send,installed-message,test}`.

## Database Tooling — read this before running anything

- **`scripts/migrate-file.mjs` is the migration runner.** It takes an explicit file path,
  prints the target host and project ref before connecting, wraps the file in a transaction,
  and refuses a real apply unless `--confirm=<project-ref>` matches the target.
  ```
  node scripts/migrate-file.mjs <file.sql> --dry-run          # BEGIN … ROLLBACK, safe anywhere
  node scripts/migrate-file.mjs <file.sql> --confirm=<ref>    # real apply
  node scripts/migrate-file.mjs <file.sql> --no-transaction --confirm=<ref>   # CREATE INDEX CONCURRENTLY
  ```
- **Never run `scripts/migrate.mjs`.** It is hardcoded to `001_initial_schema.sql`, whose
  `CREATE TABLE` statements have no `IF NOT EXISTS`. It is kept only for historical reference.
- **Never run `scripts/migrate.mjs --seed`, for any reason.** It executes `supabase/seed.sql`,
  which inserts demo telemarketers and 20 sample leads. That file is a fixture for fresh dev
  databases only — do not edit it, do not extend it, do not run it against production.
- **`DATABASE_URL` is the transaction pooler (port 6543) and cannot run migrations or
  `pg_dump`.** Use `MIGRATION_DATABASE_URL` (session pooler, port 5432). The runner refuses
  port 6543 with an explanation.
- Migrations 002–008 were applied by hand in the Supabase SQL editor. 009 onward go through
  the runner.

**Backups — see `supabase/BACKUP-RESTORE.md` before every migration.** A plain `pg_dump` of the
whole database *does not work here*: the session pooler drops long `COPY` streams, so the backup
is taken per-table with keepalives plus a chunked export of `webhook_events`. `pg_restore --list`
does **not** verify a backup — the first failed dump still listed a TOC entry for a table whose
data had aborted. Only a real restore verifies one.

**Client binaries and local staging.** `pg_dump` / `psql` / `pg_restore` 17.6 live in
`C:\Users\user\Tools\pgsql\bin` (EDB zip, no admin install). A local PostgreSQL 17.6 cluster
holding a verified restore of production runs at `localhost:55432`, database `nebsam_staging`
(data dir `C:\Users\user\Tools\pgdata-nebsam-staging`, superuser `postgres`). Start it with:

```
pg_ctl -D C:\Users\user\Tools\pgdata-nebsam-staging -l C:\Users\user\Tools\pgdata-nebsam-staging.log -o "-p 55432 -c listen_addresses=localhost" start
```

Use it to dry-run and apply migrations against **real production data** before production. It
cannot run the Next.js app (no Supabase auth/PostgREST).

**Supabase staging project** — ref `koifyemtduyyfqpkogpl`, session pooler
`aws-0-us-east-1.pooler.supabase.com:5432`, in `.env.local` as `STAGING_DATABASE_URL`. Note
staging is **aws-0** while production is **aws-1**; the hostnames are otherwise identical, which
is why `migrate-file.mjs --confirm` matches the project ref rather than the host. It holds a
restore of production (3,393 leads) plus 009, 009b and the department seed. Its `ensure_rls`
event trigger was recreated by hand after the restore, because a schema-scoped dump omits it.

## Business Rules (never violate)

- Currency is **KES**, formatted `KES 12,500`.
- Phone numbers stored and displayed in international format, `+254XXXXXXXXX`.
- Follow-up timestamps built as `YYYY-MM-DDTHH:mm:00+03:00` (EAT). Cron at `0 5 * * *` UTC.
- Telemarketers: **Edith, Janet, Suzzie** — all telematics.
- Telematics lead source: WhatsApp BSP webhook (auto-push). The three new departments are
  **manual entry only**.
- Each rep sees only their assigned leads; reps are scoped to one department, admin is global.
- `renewal_due_date` = `installation_date + 365 days` (auto-calculated by trigger).
- RAG auto-flag cron runs daily at **08:00 EAT**.

## RAG Status Logic

- 🟢 **GREEN** — High intent: actively engaging, quote accepted, renewal confirmed.
  Never set automatically.
- 🟡 **AMBER** — Moderate: interested but undecided, follow-up scheduled.
- 🔴 **RED** — Cold: no answer 3+ times, said no, or overdue follow-up 14+ days.

14-day new-lead grace period applies (migration 008).

## Funnel Stages — telematics

`new → contacted → interested → quote_sent → negotiating → won → installed → post_sale →
sorted → renewal_due → renewed → lost → unqualified`

11 of the 13 are in live use; `renewal_due` and `renewed` have never been used.
From migration 009 onward, stages are **per-department and database-driven** — see
`DEPARTMENTS-MASTER-PROMPT.md` §6.4.

## Products — telematics (13, the authoritative list is `types/crm.ts`)

Fuel Monitoring Solution · Hybrid Car Alarm · Hybrid Pro Max Alarm · Hybrid Pro Max Plus Alarm ·
Hybrid Car Tracker · Hybrid Pro Tracker · Hybrid Pro Max Tracker · Vehicle Video Telematics ·
Hybrid Dash Cam · Recovery Tracker · Bluetooth Tracker · Anti-Jammer Tracker · Other (specify)

Note: 4 live leads carry `product_interested = ''` (empty string, not NULL). The data is
correct; the config is incomplete. Do not edit those rows to match a dropdown.

---

# Multi-Department Expansion

Full spec: `DEPARTMENTS-MASTER-PROMPT.md`. Branch: `feature/departments`.

## Decisions locked (2026-09-20, confirmed by Kelvin)

| Topic | Decision |
|---|---|
| Data model | **One shared `leads` table + `department_id`.** No per-department tables. |
| Phone uniqueness | Unique **per department**, with a soft cross-department duplicate warning. |
| Config location | Database-driven: `departments`, `funnel_stages`, `kyc_fields`, `department_products`. Adding a stage, KYC question or department is an **admin action, not a deploy**. |
| Slugs / names | `telematics`/Vehicle Telematics · `container_eseal`/Container E-Seal · `fuel_monitoring`/Fuel Monitoring · `school_bus`/School Bus Solution |
| Post-sale models | telematics `annual_renewal` · fuel `subscription` · e-seal `consumption` · school bus `term_contract` |
| Manual leads | Auto-assign to the rep who entered them. WhatsApp leads keep round-robin, now department-scoped. |
| Product catalogues | **Separate per department.** Telematics rows and the 13-item `PRODUCTS` list are untouched; `Fuel Monitoring Solution` stays in telematics for its 20 historical leads. School Bus gets its own SKUs rather than selling telematics ones. |
| KYC field sets | Seeded per `DEPARTMENTS-MASTER-PROMPT.md` §6.4 verbatim. |
| New reps | **None until after cutover.** Departments seed with no new reps; the existing three stay in telematics. New reps are added via Admin after Sprint D7, once `assign_lead_round_robin_v2` is live — so the round-robin bug can never fire. |
| WhatsApp panel | **Hidden in v1** for the three new departments. `components/chat/` and `/api/whatsapp/send` stay telematics-only. |
| Academic terms | **Seeded empty.** Real Kenyan term dates are keyed in through the Admin term-calendar editor (D6). Every School Bus surface must degrade gracefully with an empty calendar — never throw, show "term calendar not configured". |
| Term billing | `term_billings.due_date` = **term start − 14 days**. |

## Production Safety Contract — the seven rules

The existing database stays as it is, data and records untouched, and nothing already working
may be interfered with. That is a hard constraint on this whole project.

1. **Additive only in 009** — `CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`,
   `CREATE INDEX IF NOT EXISTS`, new function names, `INSERT … ON CONFLICT DO NOTHING`.
   No `DROP`, no `ALTER COLUMN`, no `CREATE OR REPLACE` over a live function.
2. **No existing value is ever overwritten.** The only permitted `UPDATE` writes `department_id`
   into a column that is new and entirely NULL.
3. **New columns carry a DEFAULT** (the telematics id), so the currently deployed app keeps
   inserting successfully between the migration and the app deploy.
4. **Disable `leads_updated_at` around the backfill**, or every lead's `updated_at` becomes
   today and the team permanently loses their last-touched ordering. Verify `tgenabled = 'O'`
   afterwards.
5. **Nothing the live app calls is replaced in place.** New behaviour ships as `*_v2` alongside
   the originals. Cutover is a separate, reversible step.
6. **Destructive changes live in 010**, and only after the app is deployed and verified.
7. **Backup first, every time** — `pg_dump` before 009 and again before 010, confirmed
   non-empty and restorable, plus the Supabase PITR timestamp.

**Before any statement runs against production**, post: the migration file, the target host as
the runner printed it, the `--dry-run` output, confirmation that a fresh `pg_dump` exists and
was checked, and the rollback command. Then wait for Kelvin to say go. No exceptions — a live
CRM that three telemarketers are working in right now does not get an unannounced migration.

## Function grants: `REVOKE FROM PUBLIC` is NOT enough

Supabase sets `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon,
authenticated, service_role`. **Every function created in `public` is therefore executable by
`anon` — the key that ships inside the browser bundle.** A `REVOKE ALL ... FROM PUBLIC` removes
only the PUBLIC pseudo-role grant and leaves the explicit `anon=X` grant in place.

This was found on 2026-09-21 by calling the staging REST API with nothing but the public anon
key: it successfully ran `create_manual_lead` and **created a lead**, read
`check_phone_across_departments` (other departments' lead summaries, including rep names), and
ran `rag_auto_flag_v2`. `009e_function_grants.sql` locks every function down and verifies that
`anon` ends up with EXECUTE on nothing.

**Every future `CREATE FUNCTION` in this project must be followed by:**

```sql
REVOKE ALL ON FUNCTION public.<name>(<args>) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.<name>(<args>) TO service_role;  -- plus authenticated if the browser calls it
```

009e was applied to production on 2026-09-21; `anon` now has EXECUTE on nothing in `public`.
Re-run 009e after any migration that creates a function.

**009e revokes from EVERY function before re-granting, and that once broke staging.** Its
`authenticated` allowlist was a hardcoded list of names written before migration 011. 011 added
`is_admin()`, `current_rep()` and `current_rep_department()` — which every one of its fifteen
policies calls — so re-running 009e stripped their `authenticated` grant. A policy expression is
evaluated with the privileges of the **querying** role, so every signed-in query then failed with
*permission denied for function* rather than returning no rows: a total outage, not a quiet one.
Production escaped only because 011 happened to be applied after the last 009e run.

Fixed in U1: 009e now derives the grant from `pg_policies` — anything a policy calls keeps
`authenticated` automatically — and its first verification block fails the migration if a
policy-referenced function would be left unexecutable. **Do not replace that with a list of
names.**

## Authorization: the role lives in `app_metadata`, never `user_metadata`

**Migration 012, applied to production 2026-09-22.** Before it, `is_admin()` read
`auth.users.raw_user_meta_data->>'role'` — a field the user it belongs to can write from the
browser with the anon key:

```js
await supabase.auth.updateUser({ data: { role: 'admin' } })
```

All fifteen RLS policies in 011 call `is_admin()`, so **any rep could have granted themselves
read/write on every lead, call log, sale and rep record in all four departments.**

Being an admin now requires three facts that only the server can write, all read live:

1. `auth.users.raw_app_meta_data->>'role' = 'admin'`
2. an active row in `admin_profiles`
3. the login is not banned

**Rules that follow from this, and must not be relaxed:**

- **Never read `user_metadata` for an authorization decision.** It still holds the old role value
  (012 deliberately left it alone so nothing broke during the cutover) and it is not trustworthy.
  Every role read goes through `lib/auth/getRole.ts`. `scripts/qa-test.mjs` §10 fails the run if
  one ever comes back.
- **Fail closed.** `roleOrDefault()` resolves an unknown role to `telemarketer`, never `admin`.
  Several call sites branch as `role === "telemarketer" ? … : …` where the *else* branch is the
  admin path, so a null role would otherwise take it.
- **Read the role from `getUser()`, not from `session.user`.** The latter is decoded from a JWT up
  to an hour old. In `AuthProvider.onAuthStateChange` this must stay inside the existing
  `setTimeout(…, 0)` — the GoTrue lock rule still applies.
- **`user_metadata` remains user-writable and always will be.** That is not the bug and cannot be
  prevented. The fix is that nothing reads it for authorization.

Deactivating an admin (clearing `admin_profiles.is_active`) takes effect on their **next query**,
proven in an existing session with no JWT refresh — not whenever their token expires.

Verify any time with `node scripts/u0-security-proof.mjs` (staging-guarded; it creates and deletes
its own throwaway accounts).

## Known issue: RED leads never de-escalate to AMBER

`rag_auto_flag()` rule 3 — the only path from RED back to AMBER — **has never fired**. It tests
`f.scheduled_date IN (CURRENT_DATE, CURRENT_DATE + 1)`, but `followup_schedule.scheduled_date` is
`TIMESTAMPTZ` (migration 003) and the app writes a real time of day (`…T15:30:00+03:00`), so the
date literal coerces to midnight and never matches. Measured on production 2026-09-20: 122
pending follow-ups, **0** at midnight, **0** matching.

This is a large part of why **2,715 of 3,395 leads are RED**: a rep logs a call and books
tomorrow's follow-up, and the lead stays red regardless.

`rag_auto_flag_v2` reproduces the bug **deliberately**, because §6.5 requires v2 to match v1
exactly and calls any difference a bug in v2 rather than an improvement. The corrected predicate
(`f.scheduled_date::date IN (…)`) sits commented beside it in
`009c_departments_functions.sql`.

**Decision (Kelvin, 2026-09-20): leave it, revisit after the department work lands.** Enabling
the fix would re-amber a large share of the queue on its first run — a visible change to the
team's day that deserves its own measurement and its own go-ahead. Do not "tidy" it up in
passing.

## Engineering constraints that have bitten this project before

- **The GoTrue lock rule.** `AuthProvider.onAuthStateChange` must stay non-async and must not
  await any `supabase.*` call. Defer with `setTimeout(…, 0)`. Violating this deadlocks every
  request in the app.
- **The RHF toggle rule.** In `CallLogModal`, toggles are plain React state, not `setValue`-only
  RHF fields — those collapse to their default at submit and silently drop follow-ups and KYC
  updates. Keep that pattern in every new form.
- **The forwardRef rule.** `ui/Input` and `ui/Textarea` must forward refs or React Hook Form
  silently drops their values.
- **Grants.** Every new table needs
  `GRANT ALL ON TABLE public.<t> TO anon, authenticated, service_role;` — tables created outside
  the Supabase dashboard get no PostgREST grants. This is why `scripts/fix-grants.mjs` exists.
- **Server Components for data-fetching pages; Client Components only for interactivity.**
  Optimistic UI on call log save.

## Sprint Plan — multi-department expansion

- [x] **D0** — Confirm decisions, branch, build the safe runner, back up production, stand up a
      staging copy, capture the pre-migration snapshot.
- [x] **D1** — `009_departments_additive.sql`, `009b_departments_indexes_concurrent.sql` and
      `seed_departments.sql`, applied and verified on staging. Production untouched.
- [x] **D1b** — 009, 009b and the seed applied to **production** 2026-09-20 ~19:20 EAT and
      verified. App not deployed; cron and webhook still on v1. See
      `supabase/migrations/_009_applied_record.md`.
- [x] **D2** — `009c_departments_functions.sql`: seven functions built and verified on staging.
      **Not yet applied to production** — Kelvin's decision (2026-09-20) is to hold it until D3
      is done and ship it alongside the app work. Nothing calls them either way.
- [x] **D3** — Types, `departmentStore`, `useDepartment`, `DepartmentProvider`, phone/kyc/term
      helpers, config-driven `funnelHelpers`. No existing component changed; build, lint and
      tsc all clean.
- [x] **D4** — `NewProspectSheet`, `KycFields`, department-scoped `LeadsShell`, config-driven
      filters/badges/`CallLogModal`. Verified at the data layer on staging; the browser
      walkthrough still needs the staging anon key.
- [x] **D5** — `UpcomingCommitments`, `/reorders` + `ReordersShell`, department-aware nav and
      middleware route guard, department-scoped backlog and renewals.
- [x] **D5b** — `/buses` + `BusRegisterShell`, `/term-billing` + `TermBillingShell`,
      `generate_term_billings` wired to the UI. Term calendar still empty until D6.
- [x] **D6** — Departments tab (stage/KYC/product/term-calendar editors, rep assignment),
      CSV import with department + KYC mapping, reports grouped by department, admin filters.
- [x] **D7** — App deployed to production 2026-09-21; migration 010 cutover applied and verified.
- [x] **D8** — `011_department_rls.sql` applied to production 2026-09-21. 0 open policies remain;
      department isolation is now enforced in the database, verified by role impersonation.

Sprint detail, acceptance criteria and the verification checklist live in
`DEPARTMENTS-MASTER-PROMPT.md` §9 and §10.

## User management decisions (2026-09-22, confirmed by Kelvin)

| Topic | Decision |
|---|---|
| Login URL | `https://nebsam-crm.vercel.app/login` — used in the "copy as message" text an admin pastes into WhatsApp. Swap it in one place (`lib/auth/loginUrl.ts`) if a custom domain arrives. |
| Password policy | **8+ characters, letters and digits.** Enforced in Zod via `checkPasswordPolicy()` so users get a readable message; Kelvin sets the matching rule in Supabase → Authentication → Policies. `generateTempPassword()` still issues 12 characters. |
| Existing reps' passwords | **Not forced.** A per-user "Require password change at next login" button, pressed when convenient. `CREDENTIALS.md` is deleted by Kelvin once all three have changed. |
| Admin tab name | "Telemarketers" → **"Users"**, since it now covers all four departments plus administrators. |
| First named admins | Still outstanding — needed for U4b, not before. |

Earlier decisions U-D1 to U-D8 are in `USER-MANAGEMENT-PROMPT.md` §2 and are not re-litigated.

## User management — how it is wired

Sprints U0-U4b, live in production. Spec: `USER-MANAGEMENT-PROMPT.md`.
Operator instructions are in `README.md` §12; this is the engineering shape.

**Every `/api` route guards itself.** `middleware.ts:38` returns early for `/api`, so
middleware protects NONE of them, and they act through the service role, which bypasses
RLS. `requireAdmin()` / `requireUser()` is therefore the only gate. Never add a route
under `app/api/` without one — that is exactly how `/api/whatsapp/send` ended up an open
relay.

**`lib/supabase/admin.ts` is `server-only`.** The build fails if a client component
imports it, directly or transitively. That guard has already earned its keep: it caught
`SetPasswordForm` importing the password policy from the module that holds the temporary
password generator. The split is by **secrecy**, not by subject — `passwordPolicy.ts` is
public, `tempPassword.ts` is not.

**Temporary passwords cross the wire once.** One HTTP response, one dialog that cannot be
reopened. Never logged, never stored, never in the audit table. `scripts/u3-verify.mjs`
asserts no password of any kind appears in `user_admin_audit`.

**`signOut()` defaults to `scope: 'global'`.** It revokes EVERY session that user has,
including the caller's own. `verifyPassword` uses `scope: 'local'` for exactly this
reason. Getting this wrong signs a user out of their own browser the moment they confirm
their password — which is what happened, and what `scripts/u4b-verify.mjs` caught.

**The not-self and last-admin rules live in the DATABASE**, in
`deactivate_admin_guarded` (013), not in the route. A route-level check is a race: two
admins deactivating each other simultaneously both see a count of two, both proceed, and
the system ends with zero administrators. The function takes an advisory lock.

**Reassignment before removal, always.** `leads_dept_scoped` requires
`department_id = current_rep_department() AND assigned_to = current_rep()`, so open leads
left on a deactivated or moved rep match nobody and vanish from every queue.
`reassign_rep_open_work` suppresses `leads_updated_at` while it moves them — without
that, hundreds of leads jump to the top of the inheritor's queue and the team's
last-touched ordering is destroyed permanently.

**`followup_schedule.telemarketer_id` is NOT NULL**, so a pending follow-up cannot go to
the backlog the way a lead can. With no inheritor they are **cancelled**, and
`FollowUpStatus` gained `"cancelled"` for it. §7.3 of the spec did not account for this.

**Audit actors are snapshotted, never joined.** `performed_by_name` / `performed_by_email`
are copied in at write time so the log still reads correctly after someone is renamed or
deactivated. A join would silently rewrite history.

### Verification scripts

| Script | Proves |
|---|---|
| `u0-security-proof.mjs` | a rep setting `user_metadata.role='admin'` gains nothing |
| `u1-verify-routes.mjs` | every route: 401 anonymous, 403 as a rep |
| `u1-verify-sessions.mjs` | `revoke_user_sessions` actually revokes |
| `u2-verify.mjs` | the Users tab, adding users, `rep_workload` counts |
| `u3-verify.mjs` | passwords end to end; no password in the audit trail |
| `u4-verify.mjs` | move / deactivate / reactivate; `updated_at` preserved |
| `u4b-verify.mjs` | step-up, the last-admin race, retiring the shared login |
| `user-management-check.mjs` | the §11 checklist; `--target=production` is read-only |

All sprint scripts are **staging-only** and create and delete their own fixtures. They
sign in with a real session **cookie**, not a bearer token — `@supabase/ssr` reads
cookies, so a bearer token would pass vacuously without ever exercising the guard.

## Sprint Plan — user management

Full spec: `USER-MANAGEMENT-PROMPT.md`.

- [x] **U0** — Close the role hole. Step A (`scripts/backfill-app-metadata-roles.mjs`), migration
      `012_admin_roster_and_role_source.sql`, and the app change (`lib/auth/getRole.ts` + four
      call sites) all applied to production 2026-09-22. See
      `supabase/migrations/_012_applied_record.md`.
- [x] **U1** — Server foundation (`lib/supabase/admin.ts`, `requireAdmin`/`requireUser`,
      `tempPassword`, `notImplemented`), migration `013_user_management.sql`, the
      `/api/admin/users/*` stubs, and **locking the four previously-unauthenticated API routes**.
      Applied to production 2026-09-22; see `supabase/migrations/_013_applied_record.md`.
      **Outstanding: `WHATSAPP_WEBHOOK_SECRET` is not set, so the webhook still accepts anyone.**
- [x] **U2** — Users tab (`UserManager`, replacing `TelemarketerManager`), Add user with a login,
      "Create login" for unlinked rows, and the audit trail. Verified on staging, 27/27.
      **Not yet deployed to production.**
- [x] **U3** — Passwords: admin reset + "require change", the user's own
      `/account/password`, the forced-change middleware gate, the break-glass script, and the
      deprecation guard on `setup-auth-users.mjs`. Verified on staging, 28 + 8 + 6 checks.
      **Not yet deployed to production.**
- [x] **U4** — Move department, deactivate, reactivate, edit profile, and the `DepartmentManager`
      fix (defects 5 and 6). Verified on staging, 30/30. **Not yet deployed to production.**
- [x] **U4b** — Named administrators, step-up auth, activity feed, retire the shared login.
      Verified on staging, 32/32. **First named admin still to be created by Kelvin** — the
      create requires his own password for step-up, so it cannot be done for him.
- [x] **U5** — `scripts/user-management-check.mjs` (the §11 checklist, read-only on both
      targets), `README.md` §12 "Adding and Managing Users", and the section above.
      Production: **23 passed, 0 failed**, 2026-09-23.

---

## How Claude Code Should Work on This Project

1. **Always read this file and `DEPARTMENTS-MASTER-PROMPT.md` first.**
2. **Work one sprint at a time** — never jump ahead.
3. **Ask before assuming** — if something is unclear, ask Kelvin before building.
4. **Confirm before destructive actions** — never drop tables or delete files without asking.
5. **Test before moving on** — each sprint has a clear "Done when" condition.
6. **Commit after each sprint** with a descriptive message.
7. **Use plan mode** at the start of each sprint session.
8. **Report back at the end of each sprint**: what changed (files + migration), what was verified
   and how, what is still open, and the exact command to roll back if needed.
9. If anything in the locked decisions turns out to be wrong once you are in the code,
   **stop and raise it with Kelvin** rather than working around it.
