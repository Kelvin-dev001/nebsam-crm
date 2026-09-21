# Migration 009 — production apply record

Applied to **production** (Supabase project `slnphqsrrjpqcthezgun`, PostgreSQL 17.6) on
**2026-09-20, ~19:20–19:25 EAT** (Sunday evening — the quiet window §5.0 asks for).

Sprint D1b. The application was **not** deployed as part of this: the running app is unchanged,
the cron still calls `rag_auto_flag()` v1, the webhook still calls `assign_lead_round_robin` v1,
and the global phone `UNIQUE` is still in place. Those are all 010/D7 operations.

## What ran, in order

| # | File | sha256 (prefix) | Mode | Result |
|---|---|---|---|---|
| 1 | `009_departments_additive.sql` | `eff1d726…` | one transaction | COMMITTED, 20 notices |
| 2 | `009b_departments_indexes_concurrent.sql` | `463f81d3…` | `--no-transaction` | 6 statements, all 5 indexes VALID |
| 3 | `seed_departments.sql` | `914c7459…` | one transaction | COMMITTED, 3 coverage checks passed |

Each was dry-run against production immediately beforehand and passed identically.

## Backup taken first (§5.0 rule 7)

`C:\Projects\nebsam-crm-backups\prod-pre009-20260920-185953` — 22.49 MB, 26 files, zero
failures. Verified **offline**: every archive fully decompressed and every row counted, all 18
CSV chunks parsed, giving counts identical to live production at the time —
leads 3,395 · call_logs 1,870 · followup_schedule 122 · telemarketers 3 · sales 0 ·
webhook_events 17,029 · auth.users 4.

Caveat recorded honestly: this backup was **not** proven by a live restore, because the local
verification cluster had been stopped for memory pressure. The D0 backup, taken by the identical
procedure, *was* proven restorable end to end. Before 010, restore this one for real.

## Verification after the apply

Baseline captured immediately before (`leads` 3,395, `max(updated_at)`
`2026-09-20 15:51:13.935612+00`) and re-run after:

- [x] Row counts for all seven tables **identical** to the baseline.
- [x] Top-20 `leads` by `updated_at` **byte-identical**, row for row — the backfill's trigger
      suppression did its job, and in fact no `UPDATE` ran at all (see below).
- [x] `leads_updated_at` → `tgenabled = O`.
- [x] `sales_renewal_due_date` → `tgenabled = O`.
- [x] `leads_phone_number_key` — `UNIQUE (phone_number)` — still present.
- [x] pg_cron job `rag-auto-flag` still `0 5 * * *` running `SELECT public.rag_auto_flag();` (v1).
- [x] All five `leads` indexes from 009b report `indisvalid = true`.
- [x] All **five** public function bodies diff **identical** against
      `_pre009_function_snapshot.sql` — nothing was replaced.
- [x] `anon` and `authenticated` can `SELECT` from `departments`, `funnel_stages`, `kyc_fields`
      and `department_products` (the check that matters given the `ensure_rls` event trigger).
- [x] No lead, call log, sale, follow-up or telemarketer row was inserted. The only inserts were
      config: 4 departments, 60 funnel stages, 57 KYC fields, 38 products.

## Resulting configuration

| department | post-sale model | stages | KYC | products | leads |
|---|---|---:|---:|---:|---:|
| `telematics` | `annual_renewal` | 13 | 4 | 14 | 3,395 |
| `container_eseal` | `consumption` | 14 | 16 | 7 | 0 |
| `fuel_monitoring` | `subscription` | 15 | 17 | 8 | 0 |
| `school_bus` | `term_contract` | 18 | 20 | 9 | 0 |

`academic_terms` is deliberately empty — real term dates are entered through Admin in D6.

Telematics products number 14 rather than 13: the thirteenth is the `is_active = false` legacy
entry for the empty string, which is what lets the four production leads carrying
`product_interested = ''` keep rendering without editing those rows.

## The backfill did nothing, and that is correct

Every backfill reported **0 rows**. §6.3 assumes the historical rows are `NULL` and need filling;
they are not. `ADD COLUMN` with a constant `DEFAULT` serves that default to pre-existing rows
through `attmissingval` — confirmed on staging as `atthasmissing = true`,
`attmissingval = {<telematics id>}` — so `department_id` was already populated on all 3,395 rows
the moment the column appeared, with no table rewrite and no row touched.

The consequence is worth stating plainly: the `updated_at` damage that rule 4 exists to prevent
was **structurally impossible here**, because no `UPDATE` ever ran.

## Rollback

Still fully reversible, and the path is tested — applied, rolled back and re-applied on staging
with the data byte-identical at every step:

```
node scripts/migrate-file.mjs supabase/migrations/009_rollback.sql --dry-run
node scripts/migrate-file.mjs supabase/migrations/009_rollback.sql --confirm=slnphqsrrjpqcthezgun
```

This stays safe **only until the app deploy**. Once the new app is live it reads
`leads.department_id` and the config tables, so the app must be rolled back first.

---

# 009c / 009d / 009e — production apply record

Applied to **production** on **2026-09-21, ~10:25–10:30 EAT** (Monday, during business hours —
safe because none of these take a table lock; only 009 itself did).

| # | File | Result |
|---|---|---|
| 1 | `009e_function_grants.sql` | Closed the **pre-existing** anon exposure on `assign_lead_round_robin` and `rag_auto_flag` |
| 2 | `009c_departments_functions.sql` | 7 department functions created, called by nothing |
| 3 | `009d_admin_functions.sql` | 3 admin functions created |
| 4 | `009e_function_grants.sql` again | Locked down the 10 functions just created |

009e ran **first and last** deliberately. First, because it closes a hole that was live on
production. Last, because Supabase's default privileges grant `anon` EXECUTE on every newly
created function — so 009c and 009d re-opened it for their own functions the moment they ran.
009e is idempotent by design for exactly this reason.

## Final grant state (verified)

`anon = false` on **all 15** functions in `public`. `authenticated = true` on exactly the eight
the browser calls: `create_manual_lead`, `check_phone_across_departments`,
`generate_term_billings`, `is_school_holiday`, `normalize_phone_ke`, `rename_funnel_stage`,
`reorder_funnel_stages`, `validate_academic_terms`. `service_role = true` throughout.

Verified by `has_function_privilege()` rather than by invoking, because calling
`assign_lead_round_robin` would create a real lead and `rag_auto_flag` would rewrite
`rag_status` across every lead in the database.

## Nothing the live system depends on moved

- pg_cron still `0 5 * * *` → `SELECT public.rag_auto_flag();` (**v1**)
- `leads_updated_at` and `sales_renewal_due_date` both `tgenabled = O`
- `leads_phone_number_key` still present
- The webhook still calls v1 — switching it to v2 is part of the D7 app deploy

## The team kept working throughout

Measured across the apply window: `call_logs` 1,870 → 1,871, `leads` 3,414 → 3,417,
`webhook_events` 17,029 → 17,069. A rep logged a call at 07:24 UTC (10:24 EAT) while these were
being applied. No disruption.

---

# 010 — production cutover record

Applied to **production** on **2026-09-21, ~20:45 EAT**. The only destructive migration in the
project.

| Step | Result |
|---|---|
| `SET NOT NULL` on `department_id` | all six tables |
| Drop global `leads_phone_number_key` | dropped; `leads_dept_phone_uniq` now the sole phone key |
| Repoint pg_cron | `rag-auto-flag` → `SELECT public.rag_auto_flag_v2();` |
| `REPLICA IDENTITY FULL` on `leads` | `relreplident = f` |
| v1 functions | retained as the rollback path |

## Verification

- Row counts and the top-20 last-touched ordering **byte-identical** to the baseline captured
  minutes earlier.
- `leads_updated_at` and `sales_renewal_due_date` both `tgenabled = O`.
- `leads_dept_phone_uniq`: `indisvalid = true`, `indisunique = true`, **0** duplicate
  (department, phone) pairs. It is an INDEX rather than a CONSTRAINT — built with
  `CREATE UNIQUE INDEX CONCURRENTLY` in 009b — so it is correctly absent from `pg_constraint`.
  Do not read that absence as "no uniqueness".
- Section 10 checklist against production: **19/19, zero failures**.

## Backup, verified by an actual restore

`prod-pre010-20260921-202605` — 14 tables, 17,115 webhook rows, zero dump failures. Restored in
full into the local cluster: leads 3,430 · call_logs 1,941 · webhook_events 17,115 · config
4/60/57/38.

The restore exposed a real gap in the documented procedure: `psql \copy` enforces
`webhook_events_lead_id_fkey` even though `pg_restore --disable-triggers` does not, so the final
chunk aborted on a row referencing a lead the `leads` dump had not captured. `BACKUP-RESTORE.md`
now says to drop that FK before loading chunks.

It also measured the cross-table drift for the first time: **1 orphaned row in 17,115 (0.006%)**,
a lead created in the ~4-minute gap between the two exports. The backup is a sound recovery point
to within a few minutes, not to a single instant.

## The point of no return

Restoring the global phone constraint only succeeds while no two departments share a number:

```sql
ALTER TABLE leads ADD CONSTRAINT leads_phone_number_key UNIQUE (phone_number);
```

**Not yet crossed** — the three new departments hold zero leads. It closes the first time a rep
enters a number telematics already holds, which is the entire point of decision D2.

## What to watch

The 05:00 UTC (08:00 EAT) cron run on 2026-09-22 is the **first on `rag_auto_flag_v2`**. Compare
its result against the previous morning's: v2 was proven on staging to produce byte-identical
per-lead output to v1 across 3,393 leads, so the RAG distribution should not move beyond normal
daily drift.
