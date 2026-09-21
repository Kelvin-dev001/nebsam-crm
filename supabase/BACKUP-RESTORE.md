# Backing up and restoring the Nebsam production database

`DEPARTMENTS-MASTER-PROMPT.md` §5.0 rule 7 requires a verified backup before migration 009 and
again before 010. This is the procedure that actually works against this project, written down
because the obvious one does not.

## What does not work, and why

**A single `pg_dump` of the whole database fails.** `DATABASE_URL` is Supabase's transaction-mode
pooler (port 6543), which cannot run `pg_dump` at all. The session pooler (port 5432,
`MIGRATION_DATABASE_URL`) can, but it **drops long-running `COPY` streams**:

```
pg_dump: error: Dumping the contents of table "webhook_events" failed: PQgetCopyData() failed.
pg_dump: detail: Error message from server: SSL SYSCALL error: EOF detected
```

This is intermittent and not limited to the big table — one attempt died on `leads` (664 kB).
Adding keepalives to the connection string made every table under ~1 MB reliable on the first
attempt, but `webhook_events` (25 MB) failed all four retries.

**The direct connection is not reachable from this machine.**
`db.slnphqsrrjpqcthezgun.supabase.co` resolves to an IPv6 address only, and this machine has no
global IPv6. (Node reports `ENOTFOUND` for it because it queries A records by default — the AAAA
record does exist. Do not conclude from that error that the host is wrong.)

**`pg_restore --list` does not verify a backup.** The first failed dump still listed a
`TABLE DATA public webhook_events` TOC entry even though the copy had aborted. A TOC listing
proves the archive header is readable, nothing more. **Only a real restore verifies a backup.**

## The procedure that works

`pg_dump` / `psql` / `pg_restore` 17.6 live in `C:\Users\user\Tools\pgsql\bin` (EDB binaries zip,
no admin install, matching the 17.6 server). Add that to `PATH` first.

Build the connection string from `MIGRATION_DATABASE_URL` plus keepalives:

```
sslmode=require&keepalives=1&keepalives_idle=10&keepalives_interval=5&keepalives_count=12&connect_timeout=30
```

### 1. Schema

```
pg_dump --schema-only --no-owner --no-privileges --schema=public --file=00-schema.sql "<url>"
```

### 2. Each table separately, with retries

```
pg_dump --format=custom --compress=6 --no-owner --no-privileges \
        --data-only --table=public.<t> --file=data-<t>.dump "<url>"
```

for `telemarketers`, `round_robin_state`, `sales`, `followup_schedule`, `call_logs`, `leads`.
Per-table dumps mean one dropped connection costs one table, not the whole backup. Retry up to
4 times; with keepalives these all succeed first time.

### 3. `webhook_events` in chunks

Too large for one `COPY` through the pooler. Export in 1,000-row pages, each a short-lived
statement:

```
psql "<url>" -c "\copy (SELECT * FROM public.webhook_events ORDER BY received_at, id
                        OFFSET <n> LIMIT 1000) TO 'chunk-<n>.csv' WITH (FORMAT csv)"
```

18 chunks at 17,019 rows. All succeeded first time.

### 4. Auth users

```
pg_dump --data-only --no-owner --no-privileges --table=auth.users --table=auth.identities \
        --file=auth-users.sql "<url>"
```

## Verifying the backup — restore it locally

The only honest verification. The EDB zip includes a full server, so no Docker and no second
cloud project is needed.

```
initdb -D <datadir> -U postgres --encoding=UTF8 --locale=C --pwfile=<file>
pg_ctl -D <datadir> -l <logfile> -o "-p 55432 -c listen_addresses=localhost" start
createdb -h localhost -p 55432 -U postgres nebsam_staging
```

Two things the restore needs before the schema will load:

```sql
DROP SCHEMA public CASCADE;   -- the dump contains its own CREATE SCHEMA public
CREATE SCHEMA auth;           -- telemarketers.user_id has an FK to auth.users
CREATE TABLE auth.users (id uuid PRIMARY KEY);
```

Then:

```
psql -d nebsam_staging -v ON_ERROR_STOP=1 -f 00-schema.sql
pg_restore -d nebsam_staging --data-only --disable-triggers data-<t>.dump   # each table
psql -d nebsam_staging -c "\copy public.webhook_events FROM 'chunk-NNN.csv' WITH (FORMAT csv)"
```

`--disable-triggers` is required: tables are restored one at a time, so FK checks would fire
against not-yet-loaded parents. Always use `-v ON_ERROR_STOP=1` — without it a failed statement
scrolls past and you get a silently partial restore, which is the failure this whole document
exists to prevent.

**Drop the webhook_events FK before loading the CSV chunks.** `pg_restore --disable-triggers`
suppresses foreign-key checks, but `psql \copy` does NOT — so the chunk load enforces
`webhook_events_lead_id_fkey` and fails on any event referencing a lead the `leads` dump did not
capture. Proven on the pre-010 restore (2026-09-21): the final chunk aborted on exactly this.

```sql
ALTER TABLE webhook_events DROP CONSTRAINT webhook_events_lead_id_fkey;
-- ... load every chunk ...
-- then, if you want the constraint back, clear the orphans first:
DELETE FROM webhook_events w WHERE w.lead_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM leads l WHERE l.id = w.lead_id);
ALTER TABLE webhook_events ADD CONSTRAINT webhook_events_lead_id_fkey
  FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE SET NULL;
```

Finally, compare row counts and `max()` timestamps against
`supabase/migrations/_pre009_snapshot_output.md`, and check for orphans:

```sql
SELECT count(*) FROM leads l WHERE l.assigned_to IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM telemarketers t WHERE t.id = l.assigned_to);
-- and the same shape for call_logs, followup_schedule, webhook_events -> leads
```

## Known limitation of this backup

Because tables are dumped one at a time rather than in a single transaction, the backup is
**not a transactionally consistent snapshot across tables**. Production is live, so a lead
created between the `leads` dump and the `webhook_events` export appears in one and not the
other.

In the 2026-09-20 backup this showed up as `leads` 3,393 and `webhook_events` 17,023 against
snapshot values of 3,392 and 17,019 — four inbound messages and one new lead arrived while the
backup ran. All four foreign-key checks returned **zero orphans**, so the copy is referentially
sound; but if you restore it, expect it to be accurate to within a few minutes rather than to a
single instant. For a point-in-time restore, use Supabase's own PITR instead and treat this as
the belt-and-braces copy.

## The 2026-09-20 pre-009 backup

`C:\Projects\nebsam-crm-backups\` (outside the repo — it holds live customer phone numbers and
must never be committed).

- `prod-20260920/00-schema.sql` — public schema structure
- `prod-20260920/data-*.dump` — six core tables, custom format
- `prod-20260920/webhook_events-chunks/chunk-000..017.csv` — 22.1 MB, 17,023 rows
- `nebsam-prod-20260920-155908-auth-users.sql` — auth.users + auth.identities
- `*.INVALID-truncated-copy-failed` — the failed early attempts, renamed so they can never be
  mistaken for a usable backup. Delete them once the successful backup has been used.

Verified by full restore into a local PostgreSQL 17.6 cluster on port 55432, database
`nebsam_staging`: all seven tables present, counts matching, zero FK orphans.
