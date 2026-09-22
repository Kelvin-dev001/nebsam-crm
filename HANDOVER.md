# Nebsam CRM — Multi-Department Expansion: Handover

**Status: live in production. All sprints D0–D8 complete**, 2026-09-21. **Sprint U0 (security) applied 2026-09-22** — see "Authorization" below.

Read `CLAUDE.md` first for the standing project rules. This document covers what changed, what
is left, and the things that will bite you if nobody tells you about them.

---

## What is live

Three new departments alongside the original telematics team, on **one shared `leads` table with
`department_id`** — no per-department tables.

| Department | Post-sale model | Lead intake | Leads today |
|---|---|---|---:|
| Vehicle Telematics | `annual_renewal` | WhatsApp webhook | 3,431 |
| Container E-Seal | `consumption` (reorders) | manual | 0 |
| Fuel Monitoring | `subscription` (contract end) | manual | 0 |
| School Bus Solution | `term_contract` (3 terms/yr) | manual | 0 |

**Migrations applied to production**, in order: `009` (additive) · `009b` (concurrent indexes) ·
`seed_departments.sql` · `009e` (function grant lockdown) · `009c` (department functions) ·
`009d` (admin functions) · `009e` again · `010` (cutover) · `011` (department RLS).

**App**: deployed to Vercel, serving `nebsam-crm.vercel.app`. New surfaces: manual prospect entry,
`/reorders`, `/buses`, `/term-billing`, Admin → Departments.

---

## What is NOT done

### Nothing structural. The expansion is finished.

All eleven migrations are applied and the app is deployed. Department isolation is enforced in
the **database** (migration 011), not only in the application: admin sees everything, a rep sees
their own rows within their own department, `anon` sees nothing. Verified by impersonating each
real user the way PostgREST does — Edith, Janet and Suzzie each saw exactly the same lead count
after 011 as before it.

### Deferred by explicit decision

- **Rule 3 of the RAG cron never fires.** Documented at length in `CLAUDE.md`. Kelvin's call was
  to leave it. See "Things worth knowing" below — the measurement changes what the fix should be.
- **Overdue commitments are hidden from the dashboard widget.** Pre-existing telematics
  behaviour; the widget queries `today..+60d`, so an overdue renewal or reorder drops off
  entirely. Changing it is a visible change to the team's morning.
- **`components/dashboard/UpcomingRenewals.tsx` is unused** — superseded by
  `UpcomingCommitments.tsx`. Safe to delete.
- **Lead Detail Tab 5 "Buses"** and the `term_contract` variant of the Sale tab (§7.4) were not
  built. `LeadDetailTabs.tsx` is 640 lines and holds the working telematics sale form; the
  standalone `/buses` and `/term-billing` pages cover the functionality.

### Needs Kelvin, not code

- **Real Kenyan term dates.** `academic_terms` is empty on purpose — the spec forbids guessing
  them. Until they are entered in Admin → Departments, School Bus term billing cannot generate
  and the RAG holiday hold is inactive. Every School Bus surface degrades gracefully and says so.
- **New department reps.** None exist yet, by decision — which is why the round-robin bug could
  never fire during the migration window. Add them via Admin → Departments; RLS is now in place,
  so a new rep is isolated to their department from their first login.

---

## Things that will bite you

### 1. `REVOKE ... FROM PUBLIC` does not remove `anon`

Supabase sets `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon,
authenticated, service_role`. **Every function you create in `public` is executable by `anon` —
the key that ships inside the browser bundle.** Revoking PUBLIC leaves the explicit `anon` grant
untouched.

This was found live: with nothing but the public anon key it was possible to call
`create_manual_lead` and **create a lead**, read other departments' lead summaries, and run
`rag_auto_flag_v2`. Two pre-existing functions (`assign_lead_round_robin`, `rag_auto_flag`) had
been exposed this way since long before this project.

**After any migration that creates a function, re-run `009e_function_grants.sql`.** It iterates
the catalogue and is idempotent for exactly this reason. `scripts/departments-check.mjs` asserts
`anon` is refused, so it will fail if someone forgets.

**But know what that file does before you run it.** It REVOKES from every function in `public`
and then re-grants. Its `authenticated` allowlist predated migration 011, so re-running it stripped
`is_admin()`, `current_rep()` and `current_rep_department()` — the three functions all fifteen
policies in 011 call. Because a policy is evaluated as the querying role, every signed-in query
then failed with *permission denied for function*. That is an outage for the whole team, not a
quiet loss of rows. It happened on staging during U1; production escaped on ordering alone.

U1 fixed the cause: 009e now grants `authenticated` to anything referenced in `pg_policies`
automatically, and refuses to complete if a policy-referenced function would be left
unexecutable. Keep it derived. A hardcoded list will drift again.

### 2. `leads_dept_phone_uniq` is an INDEX, not a CONSTRAINT

009b built it with `CREATE UNIQUE INDEX CONCURRENTLY`, so it does not appear in `pg_constraint`.
Do not read that absence as "phone uniqueness is gone". Check `pg_index` and confirm
`indisvalid = true` — a failed `CONCURRENTLY` build leaves an INVALID index that silently
enforces nothing.

### 3. Any `UPDATE` on `leads` rewrites `updated_at`

`leads` carries a `BEFORE UPDATE` trigger setting `updated_at = now()`. The queue sorts on it and
the team reads it as "when did we last deal with this client". A bulk update stamps every
affected row as just-touched and destroys that ordering permanently.

Both places that touch lead rows in bulk — 009's backfill and `rename_funnel_stage` — suppress
the trigger and restore it in the same transaction. Do the same, and verify
`tgenabled = 'O'` afterwards.

### 4. Telematics KYC fields are columns, not JSONB

`full_name`, `location`, `vehicle_type`, `product_interested` are real columns on `leads`, and
`company_name` is promoted out of the JSONB for indexing and reporting. `PROMOTED_KYC_KEYS` in
`types/crm.ts` drives every read and write. A renderer that blindly writes these into `leads.kyc`
makes the team's names and locations vanish from the leads table and from reports **while still
looking correct in the modal**.

### 5. Backups: a single `pg_dump` does not work here

The session pooler drops long `COPY` streams. Backups are taken per-table with keepalives plus a
chunked CSV export of `webhook_events`. `pg_restore --list` does **not** verify a backup — a
truncated dump still lists its TOC. Only a real restore verifies one.

When restoring, **drop `webhook_events_lead_id_fkey` first**: `psql \copy` enforces it even
though `pg_restore --disable-triggers` does not. Full procedure in `supabase/BACKUP-RESTORE.md`.

### 6. RLS policies must be scoped `TO authenticated`

Every policy in 011 carries a `TO authenticated` clause. Without it, a signed-out request against
`leads` evaluates the policy, tries to call `current_rep_department()` — which `anon` cannot
execute — and fails with *permission denied for function* instead of simply returning no rows.
Scoping the policy means `anon` never matches one at all.

Relatedly: **the config tables are `authenticated`-only.** `DepartmentProvider` therefore skips
loading on `/login` and retries on error. If you ever see the app running with no department
name and no manual prospect entry, that load failed and was never retried.

### 7. Authorization reads `app_metadata`, and `user_metadata` is a trap

Until 2026-09-22, `is_admin()` read `auth.users.raw_user_meta_data->>'role'` — which the user it
belongs to can write from the browser with the anon key. Every RLS policy in 011 calls
`is_admin()`, so **any rep could have made themselves an admin over all four departments.**
Migration 012 moved authorization to `app_metadata` (service-role-writable only) plus an active
`admin_profiles` row plus not-banned, all read live.

`user_metadata` still holds the old role value, on purpose — 012 left it alone so nothing broke
during the cutover. **It is not trustworthy and nothing may read it for an authorization
decision.** Every role read goes through `lib/auth/getRole.ts`; `scripts/qa-test.mjs` §10 fails
the run if one comes back.

Two things people get wrong here:

- **Reading the role from `session.user`.** That object is decoded from a JWT up to an hour old.
  Use `getUser()`, and in `AuthProvider.onAuthStateChange` keep it inside the existing
  `setTimeout(…, 0)` or you deadlock the GoTrue lock.
- **Expecting the escalation write to be blocked.** It is not, and cannot be — `user_metadata` is
  user-writable by design. `scripts/u0-security-proof.mjs` asserts the write still *succeeds* and
  that it grants nothing.

Useful property for U4b: clearing `admin_profiles.is_active` revokes access on the admin's **next
query**, proven in a live session with no token refresh.

### 8. `leads` has TWO foreign keys to `telemarketers`

009 added `created_by UUID REFERENCES telemarketers(id)`. `assigned_to` was already there. So
**every PostgREST embed of `telemarketers` sourced from `leads` is ambiguous** and fails with
PGRST201 until you name the constraint:

```ts
telemarketer:telemarketers!leads_assigned_to_fkey(full_name)
```

This broke the admin All-Leads view and, worse, the lead detail page every rep uses — fixed in
`c559f1e`. It survived the whole of D3-D8 because every check until then was SQL or
PostgREST-without-embeds; nothing rendered a page. Embeds sourced from `call_logs` or `sales` are
still unambiguous (one FK each) and need no hint.

The reason it was invisible: `AllLeadsOverview` rendered its empty state instead of surfacing the
query error. Worth logging failures in any new list view.

### 9. The GoTrue lock and the RHF toggle rules

Both predate this work, both are recorded in `CLAUDE.md`, and both have already caused outages.
`AuthProvider.onAuthStateChange` must stay non-async. Toggles must be plain React state, never
`setValue`-only RHF fields.

---

## The point of no return

```sql
ALTER TABLE leads ADD CONSTRAINT leads_phone_number_key UNIQUE (phone_number);
```

That is the 010 rollback line, and it only succeeds **while no two departments share a phone
number**. The moment a rep enters a number telematics already holds, the global constraint can
never be restored: the cron and the `NOT NULL`s still revert, the phone key does not.

**Not yet crossed** — the three new departments hold zero leads. It closes the first time someone
uses the feature, which is the entire point of decision D2. Just know where the door is.

---

## Operational notes

- **Migrations** run through `scripts/migrate-file.mjs`, never `scripts/migrate.mjs` (hardcoded
  to `001`, and `--seed` would pollute production with demo data). Always `--dry-run` first; a
  real apply needs `--confirm=<project-ref>`, matched against the ref rather than the hostname
  because Supabase pooler hostnames are shared per region.
- **`DATABASE_URL` is the transaction pooler (6543)** and cannot run migrations or `pg_dump`. Use
  `MIGRATION_DATABASE_URL` (session pooler, 5432). The runner refuses 6543 outright.
- **Deploys** need `vercel --prod --scope kelvins-projects-1de5cca3`. Without the explicit scope
  it fails "Not authorized". The project is **not** connected to GitHub, so pushing to `main`
  deploys nothing.
- **Checklist**: `node scripts/departments-check.mjs [--target=production]`. Production is
  read-only mode. Last run: **19/19**.
- **Staging** is Supabase project `koifyemtduyyfqpkogpl` (aws-**0**-us-east-1; production is
  aws-**1**). It holds a restore of production plus every migration.

---

## What to watch next

1. ~~**The 05:00 UTC cron on 2026-09-22**~~ — **done, and it passed.** The first production run
   of `rag_auto_flag_v2` reported `succeeded` at `2026-09-22 05:00:00 UTC`. RED moved
   **2,715 → 2,716** against 21 new leads overnight (amber 647, green 89). That matches the
   staging finding that v2 is per-lead identical to v1, and it closes the last irreversible
   unknown: the cron was repointed in 010 and this was the first time it ran unattended.
2. **The first manually entered prospect** in a new department — the first real exercise of
   `create_manual_lead` in production.
3. **The first cross-department duplicate number**, which crosses the point of no return above.

---

## Two findings worth acting on, unrelated to the migration

**The follow-up book is stale.** 120 of 125 pending follow-ups are overdue:

| Rep | Overdue | Oldest |
|---|---:|---|
| Edith | 72 | 2026-07-24 |
| Janet | 35 | 2026-07-23 |
| Suzzie | 13 | 2026-09-10 |

No RAG rule fixes this, and it is visible and actionable today.

**RED is a one-way door.** 2,715 of 3,431 leads are RED — 79%. Rule 2 puts leads in after 14 days
of silence; rule 3 is the only way out and it has never fired. **87 RED leads have been called in
the last 14 days** and are still flagged cold.

Fixing rule 3's date bug alone moves **zero** leads, because only 2 follow-ups are due today and
none tomorrow. The real question is a business one: *should a lead a rep spoke to this week still
be RED?* Measured answers are in the session record; the decision is not a bug fix and should not
be made inside a migration.
