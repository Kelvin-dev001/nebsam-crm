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
