# Pre-009 production snapshot

Captured 2026-09-20T14:02:32Z from **production** (Supabase project `slnphqsrrjpqcthezgun`, PostgreSQL 17.6,
session pooler `aws-1-us-east-1.pooler.supabase.com:5432`), read-only inside `BEGIN ... ROLLBACK`.

```
node scripts/migrate-file.mjs supabase/migrations/_pre009_snapshot.sql --dry-run
```

## How to use this file

`DEPARTMENTS-MASTER-PROMPT.md` section 10 compares production before and after 009. **Production
is live and gains leads and webhook events continuously**, so the row counts below are a
reference capture from Sprint D0, not a frozen baseline. Re-run the query immediately before
applying 009 and compare *that* capture against the post-migration one.

What must be **identical** across a migration is what 009 promises not to touch:
`max(updated_at)` on `leads`, the top-20 ordering, trigger state, constraint and index names,
and the cron command. Row counts may only go **up**, by genuine new business — never down, and
never by a `seed.sql` insert.

## Row counts

| table | rows | latest activity | earliest record |
|---|---:|---|---|
| `leads` | 3,393 | 2026-09-20 13:26:29.927356+00 | 2026-06-22 10:10:28.680606+00 |
| `call_logs` | 1,870 | 2026-09-19 11:59:50.06786+00 | 2026-06-24 08:18:25.611643+00 |
| `sales` | **0** | - | - |
| `followup_schedule` | 122 | 2026-09-17 12:37:53.003182+00 | 2026-07-22 19:26:11.694017+00 |
| `telemarketers` | 3 | 2026-06-21 23:48:25.113645+00 | 2026-06-21 23:48:25.113645+00 |
| `round_robin_state` | 1 | 2026-09-20 13:04:38.490291+00 | - |
| `webhook_events` | 17,023 | 2026-09-20 13:26:29.927356+00 | 2026-06-22 09:16:19.694676+00 |

**`sales` is empty.** No sale has ever been recorded in production. The `sales_renewal_due_date`
trigger has never fired against real data, the Renewals page has never shown a row, and every
section 10 check that reads `sales` is trivially satisfied today. 009's `sales` backfill will
touch zero rows.

All timestamps are rendered in UTC by a `SET TimeZone = 'UTC'` at the top of the query, so a
capture from a staging cluster in another timezone is directly comparable.

## Verified facts that migrations 009 and 010 depend on

| Fact | Value |
|---|---|
| Server version | PostgreSQL 17.6 |
| `leads_updated_at` trigger | enabled (`tgenabled = O`) |
| `sales_renewal_due_date` trigger | enabled (`tgenabled = O`) |
| Global phone constraint | `leads_phone_number_key` - `UNIQUE (phone_number)` |
| Indexes on `leads` | 6: `leads_pkey`, `leads_phone_number_key`, `idx_leads_assigned_to`, `idx_leads_funnel_stage`, `idx_leads_rag_status`, `idx_leads_updated_at` |
| pg_cron job | `rag-auto-flag` (jobid 1), `0 5 * * *` UTC, active, running `SELECT public.rag_auto_flag();` - **v1** |
| Columns 009 adds | none exist yet |
| Tables 009 creates | none exist yet |

The phone constraint name happens to match the conventional `leads_phone_number_key`, but 010
must still look it up rather than hardcode it - it is declared inline in
`001_initial_schema.sql:19`, so the name is generated, not chosen.

The cron command is what section 10 checks after 009: it must still read
`SELECT public.rag_auto_flag();`. Migration 010 is the only thing permitted to repoint it.

## Config coverage - what the seed must contain

Every value below is live in `leads` today and must have a matching `funnel_stages` /
`department_products` row under the telematics department, or the team's badges and dropdowns
lose their values the moment the new app deploys (section 6.3).

**`funnel_stage` - 11 distinct values in use** (of the 13 in `types/crm.ts`; `renewal_due` and
`renewed` have never been used): `new` 1,728 · `contacted` 1,444 · `interested` 90 ·
`quote_sent` 46 · `lost` 36 · `won` 23 · `negotiating` 12 · `installed` 7 · `unqualified` 3 ·
`post_sale` 2 · `sorted` 2. Exact figures in the full output below.

**`product_interested`** - all values match the 13-item `PRODUCTS` array in `types/crm.ts`,
except one: **4 leads carry an empty string `''`**, which is neither NULL nor a product.

### Two things D1 must decide

1. **The four `product_interested = ''` rows.** The section 6.3 coverage query will flag them,
   because `''` can never have a `department_products` row. Section 6.3 is explicit that the
   config is wrong, not the data: **do not edit those four lead rows.** Either seed a legacy
   inactive `''` product, or treat `''` as NULL in the coverage check only. Needs a decision
   before the seed is written.
2. **`Fuel Monitoring Solution` has 20 live telematics leads.** Confirms the decision to leave it
   in the telematics catalogue for history rather than move it to the new Fuel department.

## Last-touched ordering (top 20 leads by `updated_at`)

Section 10 requires this list to match row for row after 009 - that is the check that proves the
backfill's trigger suppression worked. Phone numbers are deliberately omitted; the ids preserve
the ordering, which is the thing being compared.

```
[0] id=9cf177a7-903a-485f-8382-09908724d0c3  updated_at=2026-09-20 13:26:29.927356+00
[1] id=d26e5953-1ecf-4156-90a6-715b6b9cf1fe  updated_at=2026-09-20 13:04:38.490291+00
[2] id=00074855-d63c-4e3d-811b-1d8215cd3ce6  updated_at=2026-09-20 12:29:18.000933+00
[3] id=097fcd3f-573b-4b88-a88d-1ae8934557f5  updated_at=2026-09-20 11:57:11.787248+00
[4] id=5317639f-827d-4115-8e51-eb7d0305ae8b  updated_at=2026-09-20 11:54:43.059744+00
[5] id=347da6c5-3456-45e1-bebf-814886bd06d9  updated_at=2026-09-20 11:51:21.678294+00
[6] id=5cde12e3-101a-4b7f-86f7-cf39b64c2c8d  updated_at=2026-09-20 11:39:46.183677+00
[7] id=108fbb1f-aa9e-481d-ae8c-8f93bda8e37c  updated_at=2026-09-20 10:16:31.19106+00
[8] id=d70a852e-bb1d-477e-be50-8675438ec371  updated_at=2026-09-20 08:49:13.875544+00
[9] id=2d921307-9182-4af5-a15c-dc432529a2f2  updated_at=2026-09-20 08:16:25.177303+00
[10] id=8891fd9d-b8f1-40f9-ad18-5b7453f48203  updated_at=2026-09-20 07:48:05.409842+00
[11] id=1074a348-c66a-42bf-98d1-0886519a56e5  updated_at=2026-09-20 07:31:58.3779+00
[12] id=3963ec2d-1d9c-4e22-9df1-dc7b929b3448  updated_at=2026-09-20 07:25:49.164066+00
[13] id=a0a8bc26-235b-472b-9cfe-e8ee0b65be25  updated_at=2026-09-20 07:07:54.531766+00
[14] id=2925b3cf-bfed-47e2-931e-adaa04b04516  updated_at=2026-09-20 07:01:41.531665+00
[15] id=5d144d5e-f579-484c-9865-61de0232c62d  updated_at=2026-09-20 06:52:30.952122+00
[16] id=b8971888-e5a6-41a4-b264-923e7f1d7f9b  updated_at=2026-09-20 06:20:10.842706+00
[17] id=2daa79e5-bbbe-4fb9-ae31-7123227f9664  updated_at=2026-09-20 05:50:37.421707+00
[18] id=66ad666c-f830-4cde-ae78-e8b2870f80f3  updated_at=2026-09-20 05:48:12.212906+00
[19] id=de91fd15-db2a-4e5a-978e-884113879597  updated_at=2026-09-20 05:11:29.576404+00
```

## Backup and staging verification

The backup taken alongside this snapshot was verified by a **full restore** into a local
PostgreSQL 17.6 cluster (`localhost:55432`, database `nebsam_staging`), not by
`pg_restore --list` - which would have passed a truncated dump. See `supabase/BACKUP-RESTORE.md`.

Running this same snapshot query against that restored copy returns **row-for-row identical
output** to production: same counts, same timestamps, same ordering. Referential integrity across
all four foreign keys returned zero orphans.

## Full captured output

```
+-- nebsam-crm migrate-file ---------------------------------
  | file     : supabase/migrations/_pre009_snapshot.sql
  | sha256   : 057ee58ee21971a93d8b15b9cf6235c4320fdc03f33b1160d1703c14becbb189
  | env var  : MIGRATION_DATABASE_URL
  | host     : aws-1-us-east-1.pooler.supabase.com
  | port     : 5432
  | database : postgres
  | user     : postgres.slnphqsrrjpqcthezgun
  | project  : slnphqsrrjpqcthezgun
  | mode     : DRY RUN - BEGIN ... ROLLBACK, nothing is committed
  +------------------------------------------------------------

  connected  PostgreSQL 17.6  db=postgres

  NOTICE  cron job 1 (rag-auto-flag): schedule=0 5 * * * active=t command=SELECT public.rag_auto_flag();
  result[0]: SET
  -- result[1]: 7 row(s) --
  [0] t=call_logs  rows=1870  hi=2026-09-19 11:59:50.06786+00  lo=2026-06-24 08:18:25.611643+00
  [1] t=followup_schedule  rows=122  hi=2026-09-17 12:37:53.003182+00  lo=2026-07-22 19:26:11.694017+00
  [2] t=leads  rows=3393  hi=2026-09-20 13:26:29.927356+00  lo=2026-06-22 10:10:28.680606+00
  [3] t=round_robin_state  rows=1  hi=2026-09-20 13:04:38.490291+00  lo=NULL
  [4] t=sales  rows=0  hi=NULL  lo=NULL
  [5] t=telemarketers  rows=3  hi=2026-06-21 23:48:25.113645+00  lo=2026-06-21 23:48:25.113645+00
  [6] t=webhook_events  rows=17023  hi=2026-09-20 13:26:29.927356+00  lo=2026-06-22 09:16:19.694676+00

  -- result[2]: 20 row(s) --
  [0] id=9cf177a7-903a-485f-8382-09908724d0c3  updated_at=2026-09-20 13:26:29.927356+00
  [1] id=d26e5953-1ecf-4156-90a6-715b6b9cf1fe  updated_at=2026-09-20 13:04:38.490291+00
  [2] id=00074855-d63c-4e3d-811b-1d8215cd3ce6  updated_at=2026-09-20 12:29:18.000933+00
  [3] id=097fcd3f-573b-4b88-a88d-1ae8934557f5  updated_at=2026-09-20 11:57:11.787248+00
  [4] id=5317639f-827d-4115-8e51-eb7d0305ae8b  updated_at=2026-09-20 11:54:43.059744+00
  [5] id=347da6c5-3456-45e1-bebf-814886bd06d9  updated_at=2026-09-20 11:51:21.678294+00
  [6] id=5cde12e3-101a-4b7f-86f7-cf39b64c2c8d  updated_at=2026-09-20 11:39:46.183677+00
  [7] id=108fbb1f-aa9e-481d-ae8c-8f93bda8e37c  updated_at=2026-09-20 10:16:31.19106+00
  [8] id=d70a852e-bb1d-477e-be50-8675438ec371  updated_at=2026-09-20 08:49:13.875544+00
  [9] id=2d921307-9182-4af5-a15c-dc432529a2f2  updated_at=2026-09-20 08:16:25.177303+00
  [10] id=8891fd9d-b8f1-40f9-ad18-5b7453f48203  updated_at=2026-09-20 07:48:05.409842+00
  [11] id=1074a348-c66a-42bf-98d1-0886519a56e5  updated_at=2026-09-20 07:31:58.3779+00
  [12] id=3963ec2d-1d9c-4e22-9df1-dc7b929b3448  updated_at=2026-09-20 07:25:49.164066+00
  [13] id=a0a8bc26-235b-472b-9cfe-e8ee0b65be25  updated_at=2026-09-20 07:07:54.531766+00
  [14] id=2925b3cf-bfed-47e2-931e-adaa04b04516  updated_at=2026-09-20 07:01:41.531665+00
  [15] id=5d144d5e-f579-484c-9865-61de0232c62d  updated_at=2026-09-20 06:52:30.952122+00
  [16] id=b8971888-e5a6-41a4-b264-923e7f1d7f9b  updated_at=2026-09-20 06:20:10.842706+00
  [17] id=2daa79e5-bbbe-4fb9-ae31-7123227f9664  updated_at=2026-09-20 05:50:37.421707+00
  [18] id=66ad666c-f830-4cde-ae78-e8b2870f80f3  updated_at=2026-09-20 05:48:12.212906+00
  [19] id=de91fd15-db2a-4e5a-978e-884113879597  updated_at=2026-09-20 05:11:29.576404+00

  -- result[3]: 2 row(s) --
  [0] tgname=leads_updated_at  tgenabled=O  on_table=leads
  [1] tgname=sales_renewal_due_date  tgenabled=O  on_table=sales

  -- result[4]: 2 row(s) --
  [0] conname=leads_phone_number_key  contype=u  definition=UNIQUE (phone_number)
  [1] conname=leads_pkey  contype=p  definition=PRIMARY KEY (id)

  -- result[5]: 6 row(s) --
  [0] indexname=idx_leads_assigned_to  indexdef=CREATE INDEX idx_leads_assigned_to ON public.leads USING btree (assigned_to)
  [1] indexname=idx_leads_funnel_stage  indexdef=CREATE INDEX idx_leads_funnel_stage ON public.leads USING btree (funnel_stage)
  [2] indexname=idx_leads_rag_status  indexdef=CREATE INDEX idx_leads_rag_status ON public.leads USING btree (rag_status)
  [3] indexname=idx_leads_updated_at  indexdef=CREATE INDEX idx_leads_updated_at ON public.leads USING btree (updated_at)
  [4] indexname=leads_phone_number_key  indexdef=CREATE UNIQUE INDEX leads_phone_number_key ON public.leads USING btree (phone_number)
  [5] indexname=leads_pkey  indexdef=CREATE UNIQUE INDEX leads_pkey ON public.leads USING btree (id)

  -- result[6]: 25 row(s) --
  [0] field=funnel_stage  value=new  leads=1728
  [1] field=funnel_stage  value=contacted  leads=1444
  [2] field=funnel_stage  value=interested  leads=90
  [3] field=funnel_stage  value=quote_sent  leads=46
  [4] field=funnel_stage  value=lost  leads=36
  [5] field=funnel_stage  value=won  leads=23
  [6] field=funnel_stage  value=negotiating  leads=12
  [7] field=funnel_stage  value=installed  leads=7
  [8] field=funnel_stage  value=unqualified  leads=3
  [9] field=funnel_stage  value=post_sale  leads=2
  [10] field=funnel_stage  value=sorted  leads=2
  [11] field=product_interested  value=(null)  leads=3010
  [12] field=product_interested  value=Vehicle Video Telematics  leads=121
  [13] field=product_interested  value=Hybrid Car Alarm  leads=57
  [14] field=product_interested  value=Hybrid Dash Cam  leads=47
  [15] field=product_interested  value=Hybrid Car Tracker  leads=40
  [16] field=product_interested  value=Hybrid Pro Max Alarm  leads=31
  [17] field=product_interested  value=Hybrid Pro Tracker  leads=29
  [18] field=product_interested  value=Fuel Monitoring Solution  leads=20
  [19] field=product_interested  value=Hybrid Pro Max Plus Alarm  leads=11
  [20] field=product_interested  value=Anti-Jammer Tracker  leads=9
  [21] field=product_interested  value=Hybrid Pro Max Tracker  leads=7
  [22] field=product_interested  value=Bluetooth Tracker  leads=5
  [23] field=product_interested  value=  leads=4
  [24] field=product_interested  value=Other (specify)  leads=2

  result[7]: SELECT (0)
  result[8]: SELECT (0)
  result[9]: DO
  ROLLED BACK - dry run complete, nothing was committed. 1 notice(s).
```
