# Claude Code Prompt — Nebsam CRM: Multi-Department Expansion

**Repo:** `C:\Projects\nebsam-crm` · **Branch:** create `feature/departments` off `main`
**Scope:** Add **Container E-Seal**, **Fuel Monitoring** and **School Bus Solution** departments to the existing telematics CRM.
**Next migration number:** `009` (008 is the latest applied).

> Read `CLAUDE.md` and this file **in full** before writing any code. Work one sprint at a time, in order. Use plan mode at the start of each sprint. Do not jump ahead. Do not drop tables or delete files without asking Kelvin first.

---

## 1 · WHAT ALREADY EXISTS (do not re-derive — this is verified)

### Stack
Next.js 14 App Router · TypeScript · Supabase (Postgres + Realtime + pg_cron) · Tailwind + shadcn/ui · Zustand · TanStack Table v8 · React Hook Form + Zod · date-fns · Lucide · Sonner · jsPDF · Vercel.

### Database (migrations 001–008 applied)

| Table | Notes |
|---|---|
| `telemarketers` | `id, full_name, email, phone, is_active, created_at, user_id → auth.users` |
| `leads` | `id, phone_number (UNIQUE), assigned_to, full_name, location, vehicle_type, product_interested, lead_source, funnel_stage, rag_status, campaign_name, whatsapp_message, created_at, updated_at` |
| `call_logs` | `lead_id, telemarketer_id, called_at, duration_seconds, call_outcome, call_notes, next_followup_date, next_followup_notes, rag_status_after_call, funnel_stage_after_call` |
| `sales` | `lead_id, telemarketer_id, product, sale_amount, currency (KES), installation_date, installation_location, sale_date, vehicle_registration, serial_number, subscription_type, renewal_due_date, renewal_reminder_sent, notes` |
| `followup_schedule` | `lead_id, sale_id, telemarketer_id, followup_type, scheduled_date (TIMESTAMPTZ), notes, status, completed_at` |
| `webhook_events` | `raw_payload, phone_number, processed, lead_id, direction, message_text, sent_at` |
| `round_robin_state` | **single row**, `last_assigned_telemarketer_id` |

**Functions / jobs:**
- `assign_lead_round_robin(p_phone, p_name, p_message, p_campaign, p_raw_payload)` — SECURITY DEFINER. Rotates over **all active telemarketers** ordered by `created_at`.
- `public.rag_auto_flag()` — SECURITY DEFINER, pure SQL. pg_cron job `rag-auto-flag` at `0 5 * * *` UTC = 08:00 EAT. **`active_stages` array is hardcoded inside the function.**
- Triggers: `leads_updated_at`, `sales_renewal_due_date` (installation_date + 365d).

**RLS:** enabled on all tables, but policies are still `USING (true)` (`open_leads`, `open_call_logs`, …). The auth-scoped versions sit commented out in `006_auth.sql`.

**Auth:** Supabase Auth. Role lives in `auth.users.raw_user_meta_data->>'role'` = `admin` | `telemarketer`. `middleware.ts` gates `/admin`, redirects admins to `/admin` and reps to `/dashboard`.

### Routes
`/` `/login` `/dashboard` `/leads` `/leads/[id]` `/backlog` `/renewals` `/admin`
`/api/webhook/whatsapp` `/api/whatsapp/send` `/api/whatsapp/installed-message` `/api/whatsapp/test`

### Key components
`components/layout/` — `AppShell, Sidebar, MobileNav, Header, AuthProvider, UserMenu, TelemarketerSwitcher, NotificationBell, AlarmProvider, SignOutButton`
`components/leads/` — `LeadsShell, LeadTable, LeadFilters, LeadDetailShell, LeadDetailTabs, CallLogModal, LeadSummaryBar, LeadNotesDialog, FunnelStageBadge, RAGBadge, WhatsAppPanel`
`components/admin/` — `AdminShell` (tabs: All Leads · Capacity · Assignment · Performance · Telemarketers · CSV Import · Reports) + `RoundRobinWidget`
`components/dashboard/` — `DashboardShell, StatsCards, FollowUpToday, RAGSummary, RecentActivity, UpcomingRenewals`
`components/backlog/BacklogShell` · `components/renewals/RenewalsShell, RenewalsTable, RenewalsFilters` · `components/chat/`
`lib/` — `supabase/{client,server,types}`, `stores/telemarketerStore`, `utils/{ragHelpers,funnelHelpers,dateHelpers}`, `notifications/followupAlarm`, `reports/{fetchReportData,generatePDF}`, `auth/signOut`
`types/crm.ts` — `FunnelStage, RAGStatus, Product, CallOutcome, LeadSource, FollowUpType, SubscriptionType, RenewalStatus` + `FUNNEL_STAGES`, `PRODUCTS`, `FUNNEL_STAGE_LABELS`

### Tooling — READ THIS CAREFULLY, THE RUNNER IS NOT WHAT THE README CLAIMS

`scripts/migrate.mjs` is **hardcoded to run `001_initial_schema.sql` only** (line 55). It does not iterate the migrations directory. Migrations 002–008 were applied by hand in the Supabase SQL editor.

Three consequences that matter on a live database:

1. **Never run `node scripts/migrate.mjs` against production.** It re-runs `001_initial_schema.sql`, whose `CREATE TABLE` statements have no `IF NOT EXISTS`. It will abort on the first statement — harmless but useless — and it will never apply 009.
2. **Never run `node scripts/migrate.mjs --seed` against production, for any reason.** It executes `supabase/seed.sql`, which inserts demo telemarketers and 20 sample leads. That would pollute live data. Treat `seed.sql` as a fixture for fresh dev databases only — do not edit it, do not extend it, do not run it.
3. `client.query(sql)` sends the whole file as one simple-protocol query, which Postgres wraps in an **implicit transaction**. `CREATE INDEX CONCURRENTLY` and `ALTER SYSTEM` cannot run that way.

**Build a new runner before Sprint D1:** `scripts/migrate-file.mjs <path> [--no-transaction] [--dry-run]`.
- Takes an explicit file path — no hardcoded filename.
- Default: wraps the file in `BEGIN … COMMIT` explicitly and rolls back on any error.
- `--no-transaction`: splits on `-- @statement` markers and runs each separately, for `CREATE INDEX CONCURRENTLY`.
- `--dry-run`: runs inside a transaction and `ROLLBACK`s at the end, printing every notice. **Every migration in this project must be dry-run against a copy of production before it is applied to production.**
- Prints the connected database host so you cannot apply to prod thinking you are on staging.

Other scripts: `qa-test.mjs`, `e2e-test.mjs`, `fix-grants.mjs`, `setup-auth-users.mjs`.

---

## 2 · THE BUSINESS PROBLEM

Nebsam is adding three sales departments that do **not** receive leads from the WhatsApp BSP chatbot:

1. **Container E-Seal** — sells container security seals to transporters, clearing & forwarding agents, CFSs and importers. Revenue is **per-use**: customers reorder seals by volume, there is no annual renewal.
2. **Fuel Monitoring** — sells fuel sensors and fuel management software to fleet and generator operators. Revenue is **recurring**: install + subscription/contract with an end date.
3. **School Bus Solution** — sells bus tracking, parent notification and in-bus safety kit to schools. Revenue is **term-based**: a contract billed once per school term, three terms a year. A school is one lead with *many buses*, and the sale is decided by a board or transport committee on a school calendar — so the department needs a **per-bus asset register** and **term-calendar awareness**, not just a funnel.

Their numbers arrive **manually** — a prospect calls the department, or a rep sources the number offline. A rep must be able to log in, key in the number, complete a KYC, record the call outcome, set a follow-up, and then walk that prospect down a funnel from inquiry to service delivery — exactly like the telematics team does, minus the chatbot.

**Everything else — funnel discipline, RAG, follow-ups, backlog, dashboard, reports — must work identically for all four departments.**

---

## 3 · DECISIONS ALREADY MADE (do not re-litigate)

| # | Decision | Implication |
|---|---|---|
| D1 | **One shared `leads` table + `department_id`** | No per-department tables. Every query, page, RLS policy, cron and report gains a department predicate. |
| D2 | **Phone unique per department + soft duplicate warning** | Drop the global `UNIQUE` on `leads.phone_number`; add `UNIQUE(department_id, phone_number)`. On manual entry, warn "this number also exists in Telematics" but still allow the record. |
| D3 | **Department config lives in the database** | `departments`, `funnel_stages`, `kyc_fields`, `department_products` tables. KYC answers stored in `leads.kyc JSONB`. Adding a stage, a KYC question or a fourth department is an **admin action, not a deploy**. |
| D4 | **Manual leads auto-assign to the rep who entered them** | `assigned_to = creating rep`. Admin can reassign in Admin → Assignment. WhatsApp leads keep round-robin (now department-scoped). |
| D5 | **Each department gets its own B2B funnel**, seeded and editable | Telematics funnel unchanged. |
| D6 | **Four post-sale models, one per department** | Telematics = `annual_renewal` (install + 365d). Fuel = `subscription` (contract with end date). E-Seal = `consumption` (reorders by volume, no renewal). School Bus = `term_contract` (billed per term, 3 terms/year). |
| D7 | **Reps are scoped to one department; admin is global** | `telemarketers.department_id`. Reps see only their department's leads. Admin sees and reports across all four. |
| D9 | **School Bus models buses and the school calendar** | A school lead owns N `school_buses` rows. `academic_terms` holds term and holiday dates; follow-ups warn inside holidays and RAG holds rather than going RED when nobody is reachable. Procurement (board approval, budget cycle, tender route) is modelled as **funnel stages + KYC fields**, not as its own tables. |
| D8 | **B2B company KYC, per department**, on top of a shared core | Field definitions seeded in `kyc_fields`, editable in Admin. |

---

## 4 · OPEN ITEMS — ASK KELVIN BEFORE SPRINT D1

Do not guess these. Ask, then proceed.

1. **`Fuel Monitoring Solution` is already a product in the telematics product list** (`types/crm.ts`). Does it stay there for historical leads, move wholly to the new Fuel Monitoring department, or exist in both? *Proposed default: leave existing telematics rows untouched; new fuel-monitoring deals use the fuel department's own product list.*
2. **Department display names and slugs** — proposed `telematics` / "Vehicle Telematics", `container_eseal` / "Container E-Seal", `fuel_monitoring` / "Fuel Monitoring", `school_bus` / "School Bus Solution". Confirm.
3. **Rep names, emails and department for the new users** (all three new departments) — needed for `setup-auth-users.mjs` and seed.
4. **Do the new departments need the WhatsApp chat panel** (`components/chat/`, `/api/whatsapp/send`) for outbound messaging to manually-entered numbers? *Proposed default: hidden for these departments in v1.*
5. **The seeded product lists and KYC fields in §6.4 are my proposal** — have Kelvin confirm or edit them before the seed is written.
6. **School Bus overlaps telematics on hardware.** Speed Governor, Driver Behaviour Monitoring, In-Bus CCTV and GPS tracking all exist, in some form, in the telematics product list. Same question as item 1: does School Bus get its own catalogue entries, or does it sell the telematics SKUs under a department tag? *Proposed default: its own catalogue — a school buys "GPS Bus Tracking", not "Hybrid Car Tracker", and reporting should not merge the two.*
7. **Real school term and holiday dates** for the current and next academic year, to seed `academic_terms`. Three terms per year with the holiday window after each. Without these the holiday-hold RAG rule and the term-billing schedule cannot be seeded — ask Kelvin, do not guess Kenyan term dates.
8. **Who is billed and when within a term** — is the term invoice raised at term start, or a set number of days before? Sets `term_billings.due_date`. *Proposed default: 14 days before term start.*

---

## 5 · NON-NEGOTIABLE CONSTRAINTS

### 5.0 · Production safety contract — the system is LIVE and in daily use

Kelvin's instruction, verbatim in intent: **the existing database stays as it is, data and records untouched, and nothing already working may be interfered with.** That is a hard constraint on this whole project, not a preference. Everything below follows from it.

**The seven rules:**

1. **Additive only, in the first migration.** `009` may only `CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, `CREATE FUNCTION` under **new names**, and `INSERT … ON CONFLICT DO NOTHING`. No `DROP`, no `ALTER COLUMN`, no `CREATE OR REPLACE` over a function the live app or cron already calls, no `UPDATE` to a column that already holds data. After `009` runs on production, the live app must behave **exactly** as it did before — because nothing it reads has changed.
2. **No existing value is ever overwritten.** The only `UPDATE` permitted in this project writes `department_id` into a column that is new and entirely `NULL`. It sets nothing else. See rule 4 for the trap in that.
3. **New columns carry a DEFAULT.** `department_id` defaults to the telematics row's id. This is what lets the *currently deployed* app — which knows nothing about departments — keep inserting leads and call logs successfully between the migration and the app deploy. Without the default, `009` plus the old app equals broken inserts the moment anyone adds a lead.
4. **Disable `leads_updated_at` around the backfill.** `leads` has a `BEFORE UPDATE` trigger that sets `updated_at = now()`. A bare backfill `UPDATE` would rewrite `updated_at` on **every lead in the database**, destroying the last-touched ordering that the leads queue sorts on, that `idx_leads_updated_at` serves, and that the team reads as "when did we last deal with this client". That is exactly the kind of silent data damage Kelvin is asking you to avoid. Wrap the backfill in `ALTER TABLE leads DISABLE TRIGGER leads_updated_at;` … `ENABLE TRIGGER`, and verify afterwards that `max(updated_at)` and the top-20 ordering are unchanged from the pre-migration snapshot.
5. **Nothing the live app calls is replaced in place.** `assign_lead_round_robin` and `rag_auto_flag` are running in production right now — the first on every inbound WhatsApp message, the second at 05:00 UTC daily against every lead. New behaviour ships as `*_v2` functions alongside the originals. The originals keep running until the app is deployed and the v2 behaviour has been dry-run and compared. Cutover is a separate, reversible step.
6. **Destructive changes live in `010`, and only after the app is deployed.** Dropping the global phone `UNIQUE`, setting `NOT NULL`, and repointing the cron are all cutover operations. They run when the new app code is live and verified, not before.
7. **Backup first, every time.** Before `009` and again before `010`: take a `pg_dump` of the production database, confirm the file is non-empty and restorable, and note the Supabase point-in-time-recovery timestamp. Do not start a migration without both.

**Before touching production at all:** restore a `pg_dump` of production into a scratch Supabase project or local Postgres, apply `009` and `010` there, run the §10 checklist against it, and only then schedule the production window. A dry-run on an empty dev database proves nothing — the risks here are all about existing rows.

### 5.1 · Engineering constraints

- **Zero regression for the telematics team.** Every existing page, query, filter, cron run and report must behave identically after the migration. Ship behind a working `feature/departments` branch and verify before merge.
- **Backfill before constraining.** Every existing `leads`, `call_logs`, `sales`, `followup_schedule` and `telemarketers` row belongs to `telematics`. Backfill first (migration 009), add `NOT NULL` second (migration 010, post-deploy).
- **The round-robin bug.** `assign_lead_round_robin` currently rotates over *all* active telemarketers. The moment an e-seal or fuel rep is added, WhatsApp telematics leads will start being assigned to them. **Fix this in the same migration that adds reps** — no exceptions.
- **Grants.** Every new table needs `GRANT ALL ON TABLE public.<t> TO anon, authenticated, service_role;`. Tables created outside the Supabase dashboard do not get PostgREST grants automatically — this has bitten this project before (see `002` and `scripts/fix-grants.mjs`).
- **Realtime.** `leads` is already published. Add `ALTER TABLE leads REPLICA IDENTITY FULL;` so filtered subscriptions (`department_id=eq.X`) match reliably, and publish any new table the UI subscribes to.
- **The GoTrue lock rule.** `AuthProvider.onAuthStateChange` must stay non-async and must not await any `supabase.*` call. Defer with `setTimeout(…, 0)`. Read the comment in `components/layout/AuthProvider.tsx` before touching auth. Violating this deadlocks every request in the app.
- **The RHF toggle rule.** In `CallLogModal`, toggles are plain React state, not `setValue`-only RHF fields — those collapse to their default at submit and silently drop follow-ups and KYC updates. Keep that pattern in every new form.
- **Formatting rules.** Currency `KES 12,500`. Phones stored and displayed `+254XXXXXXXXX`. Follow-up timestamps built as `YYYY-MM-DDTHH:mm:00+03:00` (EAT). Cron at `0 5 * * *` UTC.
- **Server Components for data-fetching pages; Client Components only for interactivity.** Optimistic UI on call log save.
- Commit after each sprint with a descriptive message.

---

## 6 · MIGRATIONS — THREE FILES, IN ORDER, WITH A DEPLOY BETWEEN

| File | Contains | When it runs | Reversible? |
|---|---|---|---|
| `009_departments_additive.sql` | New tables, new columns **with defaults**, new indexes, new `*_v2` functions, config seed, backfill | Safe on live production. The running app is unaffected — nothing it reads changes. | Yes — drop the new objects; no existing row was altered except a new column going from NULL to telematics |
| `010_departments_cutover.sql` | `NOT NULL`, phone constraint swap, cron repoint, `REPLICA IDENTITY FULL`, drop `*_v1` | **Only after** the new app code is deployed and verified in production | Yes — rollback block is required in the file |
| `011_department_rls.sql` | RLS policy swap (§8) | After 010 has soaked for at least a few days | Yes — previous policies kept as commented SQL |

Every file: `IF NOT EXISTS` / `IF EXISTS` guards throughout, idempotent, safe to run twice, with a commented `-- ROLLBACK` block at the foot.

---

## 6A · MIGRATION `009_departments_additive.sql`

### 6.1 New tables

```sql
-- ── departments ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS departments (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  slug              TEXT        UNIQUE NOT NULL,          -- telematics | container_eseal | fuel_monitoring
  name              TEXT        NOT NULL,                 -- display name
  description       TEXT,
  lead_intake       TEXT        NOT NULL DEFAULT 'manual',-- 'whatsapp_webhook' | 'manual'
  assignment_mode   TEXT        NOT NULL DEFAULT 'creator',-- 'round_robin' | 'creator' | 'unassigned'
  post_sale_model   TEXT        NOT NULL DEFAULT 'none',  -- 'annual_renewal' | 'subscription' | 'consumption' | 'term_contract' | 'none'
  accent_color      TEXT        NOT NULL DEFAULT '#2563EB',
  icon              TEXT,                                 -- lucide icon name
  is_active         BOOLEAN     NOT NULL DEFAULT TRUE,
  sort_order        INT         NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── funnel_stages (per department, ordered, editable) ───────
CREATE TABLE IF NOT EXISTS funnel_stages (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id    UUID        NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  key              TEXT        NOT NULL,                  -- snake_case, written to leads.funnel_stage
  label            TEXT        NOT NULL,
  sort_order       INT         NOT NULL,
  color            TEXT        NOT NULL DEFAULT 'slate',  -- badge variant
  is_active_stage  BOOLEAN     NOT NULL DEFAULT TRUE,     -- counts as "in the pipeline" for RAG + stats
  is_won           BOOLEAN     NOT NULL DEFAULT FALSE,    -- triggers the Sale tab
  is_terminal      BOOLEAN     NOT NULL DEFAULT FALSE,    -- lost / unqualified / dormant
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (department_id, key)
);

-- ── kyc_fields (per department, editable) ───────────────────
CREATE TABLE IF NOT EXISTS kyc_fields (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id  UUID        NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  key            TEXT        NOT NULL,                    -- key inside leads.kyc JSONB
  label          TEXT        NOT NULL,
  field_type     TEXT        NOT NULL,                    -- text|textarea|number|select|multiselect|boolean|date|phone|email
  options        JSONB,                                   -- ["Transporter","CFS",...] for select/multiselect
  is_required    BOOLEAN     NOT NULL DEFAULT FALSE,
  help_text      TEXT,
  sort_order     INT         NOT NULL DEFAULT 0,
  show_in_table  BOOLEAN     NOT NULL DEFAULT FALSE,      -- surface as a leads-table column
  is_active      BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (department_id, key)
);

-- ── department_products ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS department_products (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id  UUID        NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  name           TEXT        NOT NULL,
  unit_price     DECIMAL(12,2),
  currency       TEXT        NOT NULL DEFAULT 'KES',
  is_active      BOOLEAN     NOT NULL DEFAULT TRUE,
  sort_order     INT         NOT NULL DEFAULT 0,
  UNIQUE (department_id, name)
);

-- ── service_orders (Container E-Seal per-use revenue) ───────
CREATE TABLE IF NOT EXISTS service_orders (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id        UUID        NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  department_id  UUID        NOT NULL REFERENCES departments(id),
  telemarketer_id UUID       NOT NULL REFERENCES telemarketers(id),
  order_date     DATE        NOT NULL DEFAULT CURRENT_DATE,
  product        TEXT        NOT NULL,
  quantity       INT         NOT NULL,
  unit_price     DECIMAL(12,2),
  total_amount   DECIMAL(12,2),
  currency       TEXT        NOT NULL DEFAULT 'KES',
  delivery_date  DATE,
  delivery_status TEXT       NOT NULL DEFAULT 'pending',  -- pending|delivered|cancelled
  reorder_due_date DATE,                                  -- drives the Reorders page + RAG
  notes          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── academic_terms (School Bus calendar) ────────────────────
-- Global, not per-department: one national school calendar.
-- Drives term billing, holiday-aware follow-ups and the RAG holiday hold.
CREATE TABLE IF NOT EXISTS academic_terms (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  year           INT         NOT NULL,
  term_number    INT         NOT NULL CHECK (term_number BETWEEN 1 AND 3),
  name           TEXT        NOT NULL,                    -- e.g. 'Term 1 2027'
  start_date     DATE        NOT NULL,
  end_date       DATE        NOT NULL,
  holiday_start  DATE,                                    -- the break FOLLOWING this term
  holiday_end    DATE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (year, term_number),
  CHECK (end_date > start_date)
);

-- ── school_buses (per-bus asset register) ───────────────────
-- A school is ONE lead with N buses. Billing and renewal are per bus.
CREATE TABLE IF NOT EXISTS school_buses (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id             UUID        NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  department_id       UUID        NOT NULL REFERENCES departments(id),
  registration_number TEXT        NOT NULL,               -- e.g. KDA 123X
  route_name          TEXT,
  capacity            INT,
  device_serial       TEXT,
  device_product      TEXT,                               -- from department_products
  install_date        DATE,
  status              TEXT        NOT NULL DEFAULT 'prospective',
                                  -- prospective|scheduled|installed|active|suspended|removed
  rate_per_term       DECIMAL(12,2),
  currency            TEXT        NOT NULL DEFAULT 'KES',
  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (department_id, registration_number)
);

-- ── term_billings (School Bus term_contract revenue) ────────
-- One row per (sale, academic term). This is the renewal event for
-- School Bus — three per year instead of one.
CREATE TABLE IF NOT EXISTS term_billings (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id          UUID        NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  sale_id          UUID        REFERENCES sales(id) ON DELETE SET NULL,
  department_id    UUID        NOT NULL REFERENCES departments(id),
  academic_term_id UUID        NOT NULL REFERENCES academic_terms(id),
  bus_count        INT         NOT NULL DEFAULT 0,
  amount_per_bus   DECIMAL(12,2),
  total_amount     DECIMAL(12,2),
  currency         TEXT        NOT NULL DEFAULT 'KES',
  due_date         DATE,                                  -- default: term start − 14 days (§4 item 8)
  invoice_status   TEXT        NOT NULL DEFAULT 'pending',
                               -- pending|invoiced|paid|partial|overdue|waived
  paid_date        DATE,
  notes            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (sale_id, academic_term_id)
);
```

**Trigger:** add `school_buses_updated_at` reusing the existing `update_updated_at()` function.

**Helper function** (used by the follow-up form, RAG and the term-billing generator):

```sql
-- Is a given date inside a school holiday window?
CREATE OR REPLACE FUNCTION public.is_school_holiday(p_date DATE)
RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM academic_terms
    WHERE holiday_start IS NOT NULL AND holiday_end IS NOT NULL
      AND p_date BETWEEN holiday_start AND holiday_end
  );
$$;

-- Generate the term_billings rows for a school's contract across its term span.
-- generate_term_billings(p_sale_id UUID) — idempotent, ON CONFLICT DO NOTHING
-- against UNIQUE(sale_id, academic_term_id). bus_count is taken from
-- school_buses WHERE status IN ('installed','active') at generation time.
```

### 6.2 Altering existing tables — additive, with defaults

Seed the `departments` rows (§6.4) **before** these statements so the default can reference the telematics id.

Every `department_id` gets `DEFAULT` = the telematics id. This is the single most important line in the migration: it means the **currently deployed app keeps working untouched** between 009 and the app deploy. An insert from the live WhatsApp webhook, or a lead added by Janet five minutes after you run this, lands in telematics automatically without anyone changing a line of code.

```sql
DO $$
DECLARE v_tel UUID;
BEGIN
  SELECT id INTO STRICT v_tel FROM departments WHERE slug = 'telematics';

  EXECUTE format('ALTER TABLE leads ADD COLUMN IF NOT EXISTS department_id UUID
                  REFERENCES departments(id) DEFAULT %L', v_tel);
  EXECUTE format('ALTER TABLE call_logs ADD COLUMN IF NOT EXISTS department_id UUID
                  REFERENCES departments(id) DEFAULT %L', v_tel);
  EXECUTE format('ALTER TABLE sales ADD COLUMN IF NOT EXISTS department_id UUID
                  REFERENCES departments(id) DEFAULT %L', v_tel);
  EXECUTE format('ALTER TABLE followup_schedule ADD COLUMN IF NOT EXISTS department_id UUID
                  REFERENCES departments(id) DEFAULT %L', v_tel);
  EXECUTE format('ALTER TABLE telemarketers ADD COLUMN IF NOT EXISTS department_id UUID
                  REFERENCES departments(id) DEFAULT %L', v_tel);
  EXECUTE format('ALTER TABLE round_robin_state ADD COLUMN IF NOT EXISTS department_id UUID
                  REFERENCES departments(id) DEFAULT %L', v_tel);
END $$;

-- Plain additive columns, all nullable or defaulted, none read by the live app.
ALTER TABLE telemarketers ADD COLUMN IF NOT EXISTS job_title TEXT;
ALTER TABLE leads         ADD COLUMN IF NOT EXISTS kyc JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE leads         ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES telemarketers(id);
ALTER TABLE leads         ADD COLUMN IF NOT EXISTS company_name TEXT;  -- promoted out of kyc for tables, search, reports
ALTER TABLE sales         ADD COLUMN IF NOT EXISTS contract_start DATE;
ALTER TABLE sales         ADD COLUMN IF NOT EXISTS contract_end   DATE;
ALTER TABLE sales         ADD COLUMN IF NOT EXISTS billing_cycle  TEXT; -- monthly|quarterly|termly|annual|once_off
```

> `ADD COLUMN … DEFAULT` with a constant is metadata-only on PostgreSQL 11+ — no table rewrite, no long lock, safe on a live table. `kyc JSONB NOT NULL DEFAULT '{}'` is likewise metadata-only. Do not add a `DEFAULT` that calls a volatile function; that *would* rewrite the table.

### 6.3 Backfill — the only write to existing rows in this whole project

Because of the `DEFAULT` in §6.2, new rows already carry telematics. This backfill only fills the historical rows, which are all `NULL`.

**Take the before-snapshot first.** Run this and keep the output; §10 compares against it.

```sql
-- SNAPSHOT — save the output before doing anything else.
SELECT 'leads' t, count(*) rows, max(updated_at)::text hi, min(created_at)::text lo FROM leads
UNION ALL SELECT 'call_logs', count(*), max(called_at)::text, min(created_at)::text FROM call_logs
UNION ALL SELECT 'sales', count(*), max(created_at)::text, min(created_at)::text FROM sales
UNION ALL SELECT 'followup_schedule', count(*), max(created_at)::text, min(created_at)::text FROM followup_schedule
UNION ALL SELECT 'telemarketers', count(*), max(created_at)::text, min(created_at)::text FROM telemarketers;

-- Also save the top-20 leads by updated_at. If this ordering changes, the trigger fired.
SELECT id, phone_number, updated_at FROM leads ORDER BY updated_at DESC LIMIT 20;
```

**The backfill.** Note the trigger suppression — rule 4 in §5.0. Without it, every lead's `updated_at` becomes today and the team loses their last-touched ordering permanently.

```sql
DO $$
DECLARE v_tel UUID; v_n INT;
BEGIN
  SELECT id INTO STRICT v_tel FROM departments WHERE slug = 'telematics';

  -- leads: suppress leads_updated_at so updated_at is preserved exactly.
  ALTER TABLE leads DISABLE TRIGGER leads_updated_at;
  LOOP
    UPDATE leads SET department_id = v_tel
    WHERE id IN (SELECT id FROM leads WHERE department_id IS NULL LIMIT 500);
    GET DIAGNOSTICS v_n = ROW_COUNT;
    EXIT WHEN v_n = 0;
    RAISE NOTICE 'leads backfilled: % rows', v_n;
  END LOOP;
  ALTER TABLE leads ENABLE TRIGGER leads_updated_at;   -- MUST run; see rollback note below

  -- The rest have no updated_at trigger, so a plain UPDATE is safe.
  UPDATE call_logs         SET department_id = v_tel WHERE department_id IS NULL;
  UPDATE sales             SET department_id = v_tel WHERE department_id IS NULL;
  UPDATE followup_schedule SET department_id = v_tel WHERE department_id IS NULL;
  UPDATE telemarketers     SET department_id = v_tel WHERE department_id IS NULL;
  UPDATE round_robin_state SET department_id = v_tel WHERE department_id IS NULL;
END $$;
```

> If the block raises between `DISABLE` and `ENABLE`, the transaction rolls back and the trigger is restored with it — but **verify anyway** after the migration:
> `SELECT tgenabled FROM pg_trigger WHERE tgname = 'leads_updated_at';` must return `O`. A disabled `leads_updated_at` in production means `updated_at` silently stops advancing, which would quietly break RAG and the queue ordering. Check it explicitly; do not assume.

**Then verify, before going any further:**

```sql
SELECT count(*) FROM leads             WHERE department_id IS NULL;  -- must be 0
SELECT count(*) FROM call_logs         WHERE department_id IS NULL;  -- must be 0
SELECT count(*) FROM sales             WHERE department_id IS NULL;  -- must be 0
SELECT count(*) FROM followup_schedule WHERE department_id IS NULL;  -- must be 0
SELECT count(*) FROM telemarketers     WHERE department_id IS NULL;  -- must be 0
-- Re-run the snapshot query. Row counts and max(updated_at) must be IDENTICAL to before.
```

**Config coverage checks — these protect the live UI.** Every value already sitting in `leads.funnel_stage` and `leads.product_interested` must exist in the new config tables, or the telematics team's badges and dropdowns lose their values the moment the new app deploys:

```sql
-- Every existing stage value must have a funnel_stages row. Expect zero rows back.
SELECT DISTINCT l.funnel_stage FROM leads l
LEFT JOIN funnel_stages f ON f.department_id = l.department_id AND f.key = l.funnel_stage
WHERE f.id IS NULL;

-- Every existing product value must have a department_products row. Expect zero rows back.
SELECT DISTINCT l.product_interested FROM leads l
LEFT JOIN department_products p ON p.department_id = l.department_id AND p.name = l.product_interested
WHERE l.product_interested IS NOT NULL AND p.id IS NULL;
```

If either returns rows, add the missing values to the telematics config as `is_active = false` legacy entries — historical leads keep rendering, but reps cannot pick them for new work. **Do not edit the lead rows to match the config.** The data is correct; the config is incomplete.

### 6.3b Indexes (additive, non-blocking)

Create the composite phone index **now**, in 009, but **do not drop the old constraint yet** — that is a 010 operation. Both can coexist: the global unique is simply stricter.

```sql
-- @statement  (run via migrate-file.mjs --no-transaction)
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS leads_dept_phone_uniq ON leads(department_id, phone_number);
-- @statement
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS round_robin_state_dept_uniq ON round_robin_state(department_id);
```

Then check it built cleanly — a `CONCURRENTLY` build that fails leaves an **invalid** index behind that silently does nothing:

```sql
SELECT indexrelid::regclass, indisvalid FROM pg_index
WHERE indexrelid::regclass::text IN ('leads_dept_phone_uniq','round_robin_state_dept_uniq');
-- indisvalid must be true for both. If false: DROP INDEX and rebuild.
```

Remaining indexes — all on new or low-traffic tables, so plain `CREATE INDEX IF NOT EXISTS` is fine, except the three on `leads`, which should also use `CONCURRENTLY`:
-- @statement — on the live leads table, always CONCURRENTLY
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_leads_dept_stage    ON leads(department_id, funnel_stage);
-- @statement
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_leads_dept_rag      ON leads(department_id, rag_status);
-- @statement
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_leads_dept_assigned ON leads(department_id, assigned_to);
-- @statement
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_leads_company_name  ON leads(company_name);
-- idx_leads_department is redundant — leads_dept_phone_uniq and the composites above
-- already lead with department_id. Do not create it.
CREATE INDEX IF NOT EXISTS idx_call_logs_department    ON call_logs(department_id);
CREATE INDEX IF NOT EXISTS idx_sales_department        ON sales(department_id);
CREATE INDEX IF NOT EXISTS idx_sales_contract_end      ON sales(contract_end);
CREATE INDEX IF NOT EXISTS idx_service_orders_lead     ON service_orders(lead_id);
CREATE INDEX IF NOT EXISTS idx_service_orders_reorder  ON service_orders(reorder_due_date);
CREATE INDEX IF NOT EXISTS idx_school_buses_lead       ON school_buses(lead_id);
CREATE INDEX IF NOT EXISTS idx_school_buses_status     ON school_buses(department_id, status);
CREATE INDEX IF NOT EXISTS idx_term_billings_lead      ON term_billings(lead_id);
CREATE INDEX IF NOT EXISTS idx_term_billings_due       ON term_billings(due_date, invoice_status);
CREATE INDEX IF NOT EXISTS idx_academic_terms_dates    ON academic_terms(start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_funnel_stages_dept      ON funnel_stages(department_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_kyc_fields_dept         ON kyc_fields(department_id, sort_order);

-- 7. RLS + grants on every new table.
ALTER TABLE departments         ENABLE ROW LEVEL SECURITY;
ALTER TABLE funnel_stages       ENABLE ROW LEVEL SECURITY;
ALTER TABLE kyc_fields          ENABLE ROW LEVEL SECURITY;
ALTER TABLE department_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_orders      ENABLE ROW LEVEL SECURITY;
ALTER TABLE academic_terms      ENABLE ROW LEVEL SECURITY;
ALTER TABLE school_buses        ENABLE ROW LEVEL SECURITY;
ALTER TABLE term_billings       ENABLE ROW LEVEL SECURITY;
-- Open policies for now — deliberately the SAME posture as 001, so 009 changes
-- no access behaviour for anyone. Tightened in 011, never here.
--   CREATE POLICY "open_<t>" ON <t> FOR ALL USING (true) WITH CHECK (true);
-- GRANT ALL ON TABLE public.<each new table> TO anon, authenticated, service_role;
--   (Required — tables created outside the dashboard get no PostgREST grants.
--    Missing grants are why scripts/fix-grants.mjs exists. Do not skip this.)

-- 8. Realtime — NOT here. ALTER TABLE leads REPLICA IDENTITY FULL increases WAL
--    volume on the busiest table in the system and only matters once the app
--    subscribes with a department filter. It belongs in 010, after the deploy.
```

### 6.3c What 009 deliberately does NOT do

State this back to Kelvin before running it, so he knows what he is approving:

- Does **not** drop or alter any existing constraint, index or trigger (the backfill's trigger disable is restored in the same transaction).
- Does **not** modify any existing column's type, default or nullability.
- Does **not** change `assign_lead_round_robin` or `rag_auto_flag` — both keep running exactly as they do today.
- Does **not** change the pg_cron schedule.
- Does **not** change any RLS policy or grant on an existing table.
- Does **not** write to any pre-existing column. The only values written are `department_id` on rows where it was `NULL` because the column was created seconds earlier.
- Does **not** insert a single lead, call log, sale, follow-up or telemarketer. The only inserts are configuration rows: departments, stages, KYC field definitions, products, academic terms.

**After 009 the live app is byte-for-byte unaffected.** If that is not true when you dry-run it, something in your file is wrong — fix the file, do not proceed.

### 6.4 Seed data — `supabase/seed_departments.sql`

Config rows only. Every insert `ON CONFLICT DO NOTHING` so the file is safe to re-run. **Not** `supabase/seed.sql` — that file holds demo leads and telemarketers and must never run against production; leave it exactly as it is.

**Departments**

| slug | name | lead_intake | assignment_mode | post_sale_model | icon |
|---|---|---|---|---|---|
| `telematics` | Vehicle Telematics | `whatsapp_webhook` | `round_robin` | `annual_renewal` | `Car` |
| `container_eseal` | Container E-Seal | `manual` | `creator` | `consumption` | `Container` |
| `fuel_monitoring` | Fuel Monitoring | `manual` | `creator` | `subscription` | `Fuel` |
| `school_bus` | School Bus Solution | `manual` | `creator` | `term_contract` | `Bus` |

**Funnel stages — `telematics` (unchanged, migrate the existing 13 as-is):**
`new, contacted, interested, quote_sent, negotiating, won*, installed, post_sale, sorted, renewal_due, renewed, lost†, unqualified†`

**Funnel stages — `container_eseal`:**
`new → contacted → qualified → site_visit → proposal_sent → negotiating → won* → contract_signed → seals_delivered → active_account → reorder_due → dormant† → lost† → unqualified†`

**Funnel stages — `fuel_monitoring`:**
`new → contacted → qualified → demo_scheduled → proposal_sent → negotiating → won* → contract_signed → installation_scheduled → installed → active_subscription → renewal_due → renewed → lost† → unqualified†`

**Funnel stages — `school_bus`** (committee-shaped — the extra stages exist because a school decision stalls at board review, not at price):
`new → contacted → qualified → school_visit → demo_presented → proposal_sent → board_review → negotiating → won* → contract_signed → installation_scheduled → buses_installed → active_service → term_renewal_due → renewed → dormant† → lost† → unqualified†`

\* `is_won = true` · † `is_terminal = true, is_active_stage = false`

> `dormant` for School Bus means a school that let a term lapse but is not lost — they come back next term. Keep it terminal for RAG purposes but visible as its own filter.

**KYC fields — shared B2B core (seed into all three new departments):**

| key | label | type | required |
|---|---|---|---|
| `company_name` | Company Name | text | ✔ |
| `contact_person` | Contact Person | text | ✔ |
| `contact_role` | Role / Title | text | |
| `alt_phone` | Alternative Phone | phone | |
| `email` | Email | email | |
| `physical_location` | Physical Location / Town | text | ✔ |
| `kra_pin` | KRA PIN | text | |
| `decision_maker` | Is this the decision maker? | boolean | |
| `how_heard` | How did they hear about us? | select — Referral, Walk-in, Cold call, Social media, Existing client, Other | |

> `company_name` is also written to the promoted `leads.company_name` column on save — keep the two in sync in one write.
> For `school_bus`, seed the **same `company_name` key with the label "School Name"** — one code path, department-appropriate wording. Same for `contact_person` → "Contact Person (Director / Transport Manager)".

**KYC fields — `container_eseal` (additional):**

| key | label | type |
|---|---|---|
| `business_type` | Business Type | select — Transporter, Clearing & Forwarding Agent, CFS / Container Depot, Importer / Exporter, Shipping Line, Other |
| `fleet_size` | Number of Trucks | number |
| `routes_served` | Routes Served | multiselect — Mombasa–Nairobi, Mombasa–Kampala, Mombasa–Kigali, Mombasa–Juba, Nairobi–Kisumu, Local, Other |
| `cargo_type` | Typical Cargo | text |
| `monthly_container_volume` | Containers Handled / Month | number |
| `current_seal_supplier` | Current Seal Supplier | text |
| `seal_type_used` | Seal Type Currently Used | select — Bolt seal, Cable seal, Electronic seal, None, Other |

**KYC fields — `fuel_monitoring` (additional):**

| key | label | type |
|---|---|---|
| `fleet_size` | Fleet Size | number |
| `vehicle_types` | Vehicle / Asset Types | multiselect — Trucks, Buses, Tankers, Generators, Static tanks, Earth movers, Other |
| `tank_capacity_litres` | Tank Capacity (litres) | number |
| `static_tank_count` | Number of Static Tanks | number |
| `monthly_fuel_spend` | Monthly Fuel Spend (KES) | number |
| `current_fuel_system` | Existing Fuel System | select — None, Manual logbook, Fuel cards, Competitor telematics, Other |
| `primary_pain_point` | Primary Pain Point | select — Fuel theft, Reconciliation, Consumption reporting, Driver behaviour, Compliance, Other |
| `has_existing_gps` | Already has GPS tracking? | boolean |

**KYC fields — `school_bus` (additional):**

| key | label | type |
|---|---|---|
| `school_type` | School Type | select — Private, Public / Government, International, Faith-based, Academy / Chain |
| `school_level` | Levels Served | multiselect — ECD / Kindergarten, Primary, Junior Secondary, Secondary, Mixed |
| `student_population` | Student Population | number |
| `bus_count` | Number of School Buses | number |
| `bus_ownership` | Buses Owned or Hired | select — School-owned, Hired / contracted, Mixed |
| `existing_tracking` | Existing Tracking | select — None, Basic GPS, Competitor platform, Other |
| `parent_app_interest` | Wants the Parent App? | boolean |
| `decision_body` | Who Approves the Purchase | select — Director / Proprietor, Board of Management, PTA, Transport Committee, County Education Office |
| `budget_cycle` | Budget Cycle | select — Term 1, Term 2, Term 3, Annual (January), Ad hoc |
| `procurement_route` | Procurement Route | select — Direct, Quotation, Tender |
| `key_concern` | Primary Concern | select — Student safety, Parent communication, Route efficiency, Driver behaviour, Fuel / cost control, NTSA compliance, Other |

> `bus_count` is the KYC *claim* at inquiry. The `school_buses` table is the *verified register* built during installation. Do not conflate them: quote from the claim, bill from the register.

**Products — `container_eseal`:** Single-Use Bolt Seal · Cable Seal · Electronic Container Seal (E-Seal) · RFID Container Seal · GPS Container Tracker / Smart Lock · Seal Monitoring Platform Subscription · Other (specify)

**Products — `fuel_monitoring`:** Capacitive Fuel Level Sensor · Ultrasonic Fuel Sensor · Fuel Flow Meter · Generator Fuel Monitoring Kit · Static Tank Monitoring · Fuel Management Software Subscription · Fuel + GPS Bundle · Other (specify)

**Products — `school_bus`:** GPS Bus Tracking · Parent Notification App · RFID / Student Boarding Cards · In-Bus CCTV · Speed Governor · Driver Behaviour Monitoring · Panic / SOS Button · School Bus Management Platform Subscription · Other (specify)

**Products — `telematics`:** migrate the existing `PRODUCTS` array from `types/crm.ts` verbatim.

**Academic terms:** seed from the real dates Kelvin supplies (§4 item 7). Do not invent term dates — an empty `academic_terms` table must degrade gracefully (no holiday hold, no auto-generated billings, a visible "term calendar not configured" notice in Admin) rather than throw.

### 6.5 Functions — new names, never `CREATE OR REPLACE` over a live one

`assign_lead_round_robin` handles every inbound WhatsApp message. `rag_auto_flag` runs at 05:00 UTC against every lead in the database. Replacing either in place means a bug ships straight to production with no way back except restoring a function body you no longer have.

**So: snapshot, then build alongside.**

```sql
-- 0. Snapshot the current definitions before writing anything. Save the output
--    to supabase/migrations/_pre009_function_snapshot.sql and commit it.
SELECT pg_get_functiondef(oid) FROM pg_proc
WHERE proname IN ('assign_lead_round_robin','rag_auto_flag');
```

New work ships as `assign_lead_round_robin_v2` and `rag_auto_flag_v2`, created in 009 and **not called by anything**. The v1 functions keep serving production untouched. The webhook route switches to v2 in the app deploy; the cron switches to v2 in 010. Both switches are one-line reversals.

> Do not try to add a defaulted parameter to `assign_lead_round_robin` via `CREATE OR REPLACE` — changing the argument list creates an *overload*, not a replacement, and a 5-argument call then fails with "function is not unique". A new name is the only clean path.

```sql
-- assign_lead_round_robin_v2(p_department_slug TEXT, p_phone, p_name, p_message,
--                            p_campaign, p_raw_payload)  -- department first, no defaults
--   • Resolve department_id from slug; raise if unknown.
--   • Telemarketer pool: WHERE is_active AND department_id = v_dept_id
--   • Lead lookup: WHERE phone_number = p_phone AND department_id = v_dept_id
--   • round_robin_state: read/upsert the row WHERE department_id = v_dept_id
--   • INSERT INTO leads (..., department_id) VALUES (..., v_dept_id)
-- v1 stays in place and untouched. The webhook route switches to v2 as part of
-- the app deploy, so there is never a moment where neither works.

-- create_manual_lead(p_department_slug, p_phone, p_company, p_contact_name,
--                    p_kyc JSONB, p_product, p_source, p_created_by)
--   SECURITY DEFINER. Normalises phone, resolves department, applies the
--   department's assignment_mode (creator | round_robin | unassigned),
--   sets funnel_stage to the department's lowest sort_order stage,
--   rag_status 'amber', writes kyc + company_name, returns the new lead row.
--   Raises a typed error on (department_id, phone_number) collision so the
--   UI can show "already in your department" rather than a raw SQL error.

-- check_phone_across_departments(p_phone TEXT) RETURNS TABLE(
--   department_name TEXT, funnel_stage TEXT, assigned_rep TEXT, created_at TIMESTAMPTZ)
--   SECURITY DEFINER. Returns ONLY these summary columns — never lead detail —
--   so a rep can be warned about a cross-department duplicate without being
--   granted read access to another department's data. This is what powers D2's
--   soft warning.

-- rag_auto_flag_v2(p_dry_run BOOLEAN DEFAULT FALSE): a NEW function. The cron
-- keeps calling v1 until 010. p_dry_run = true computes every change and returns
-- it as JSONB WITHOUT writing a single row — run it against production and diff
-- against v1's output before you ever let it write. A RAG function is the one
-- thing here that can silently mislabel every lead in the system overnight.
--   Replace the hardcoded active_stages array with a lookup:
--   stages in funnel_stages WHERE is_active_stage = true, matched per
--   lead.department_id. Add department-specific rules:
--     • post_sale_model='annual_renewal' → overdue sales.renewal_due_date → RED (existing)
--     • post_sale_model='subscription'   → sales.contract_end < today      → RED
--     •                                    contract_end within 30 days     → AMBER
--     • post_sale_model='consumption'    → service_orders.reorder_due_date < today → RED
--     • post_sale_model='term_contract'  → term_billings.due_date < today AND
--                                          invoice_status IN ('pending','invoiced','partial','overdue') → RED
--     •                                    next term starts within 21 days and that term has
--                                          no term_billings row yet → AMBER (term renewal due)
--   HOLIDAY HOLD (school_bus only): skip the 14-day inactivity → RED rule entirely
--     when public.is_school_holiday(CURRENT_DATE) is true. A school that cannot be
--     reached because it is closed is not a cold lead, and auto-reddening the whole
--     department every April/August would make the RAG column useless. Overdue
--     billings still go RED during a holiday — money is money.
--   Keep the 14-day inactivity rule and the 14-day new-lead grace period (008).
--   Keep "never auto-set GREEN".
--   Return per-department counts in the JSONB result.

-- generate_term_billings(p_sale_id UUID) — see §6.1. Call it on contract save and
-- from a daily job so a new term's billing row appears automatically once the
-- term calendar rolls forward. Idempotent; never overwrites a paid row.
```

---

## 6B · MIGRATION `010_departments_cutover.sql`

**Do not write or run this until the new app code is deployed to production and verified.** Everything here changes behaviour the live system depends on. Take a second `pg_dump` immediately before.

### 6B.1 Preconditions — abort the migration if any fails

```sql
DO $$
DECLARE v_bad INT;
BEGIN
  -- No NULL department_id anywhere.
  SELECT count(*) INTO v_bad FROM leads WHERE department_id IS NULL;
  IF v_bad > 0 THEN RAISE EXCEPTION 'leads has % NULL department_id — 009 incomplete', v_bad; END IF;

  -- The composite index exists and is VALID.
  IF NOT EXISTS (SELECT 1 FROM pg_index WHERE indexrelid = 'leads_dept_phone_uniq'::regclass AND indisvalid)
  THEN RAISE EXCEPTION 'leads_dept_phone_uniq missing or invalid — rebuild before cutover'; END IF;

  -- The updated_at trigger is enabled (rule 4 sanity check).
  IF (SELECT tgenabled FROM pg_trigger WHERE tgname = 'leads_updated_at') <> 'O'
  THEN RAISE EXCEPTION 'leads_updated_at is not enabled — fix before proceeding'; END IF;

  -- No duplicate (department_id, phone_number) — should be impossible given the index.
  SELECT count(*) INTO v_bad FROM (
    SELECT department_id, phone_number FROM leads GROUP BY 1,2 HAVING count(*) > 1
  ) d;
  IF v_bad > 0 THEN RAISE EXCEPTION 'Refusing cutover: % duplicate pairs', v_bad; END IF;
END $$;
```

### 6B.2 The cutover steps

```sql
-- 1. NOT NULL. Adding a validated CHECK first lets SET NOT NULL skip the full
--    scan (PG 12+), so the ACCESS EXCLUSIVE lock is held for milliseconds
--    instead of seconds. Do leads last — it is the busiest table.
ALTER TABLE telemarketers ADD CONSTRAINT telemarketers_dept_nn CHECK (department_id IS NOT NULL) NOT VALID;
ALTER TABLE telemarketers VALIDATE CONSTRAINT telemarketers_dept_nn;   -- weak lock, safe online
ALTER TABLE telemarketers ALTER COLUMN department_id SET NOT NULL;
ALTER TABLE telemarketers DROP CONSTRAINT telemarketers_dept_nn;
-- …repeat for call_logs, sales, followup_schedule, then leads.

-- 2. Phone key: drop the global UNIQUE. leads_dept_phone_uniq (built in 009)
--    already enforces the new rule, so there is no unguarded moment.
--    Look the name up — do not assume 'leads_phone_number_key'.
DO $$
DECLARE v_con TEXT;
BEGIN
  SELECT conname INTO v_con FROM pg_constraint
  WHERE conrelid = 'leads'::regclass AND contype = 'u'
    AND pg_get_constraintdef(oid) ILIKE '%(phone_number)%'
    AND conname <> 'leads_dept_phone_uniq';
  IF v_con IS NOT NULL THEN
    RAISE NOTICE 'Dropping global phone constraint: %', v_con;
    EXECUTE format('ALTER TABLE leads DROP CONSTRAINT %I', v_con);
  END IF;
END $$;

-- 3. Repoint the cron to v2. Same job name = replace, not duplicate.
SELECT cron.schedule('rag-auto-flag', '0 5 * * *', $$SELECT public.rag_auto_flag_v2();$$);

-- 4. Realtime: filtered subscriptions by department need full replica identity.
ALTER TABLE leads REPLICA IDENTITY FULL;
-- Publish any new table the UI subscribes to (school_buses, term_billings if live-updating).

-- 5. Leave v1 functions in place for now. Drop them in a later cleanup migration,
--    once a full renewal cycle has passed and nobody has needed to roll back.
```

### 6B.3 Rollback block — required at the foot of the file

```sql
-- ROLLBACK 010 (paste into the SQL editor; safe to run any time after 010)
-- SELECT cron.schedule('rag-auto-flag', '0 5 * * *', $$SELECT public.rag_auto_flag();$$);
-- ALTER TABLE leads REPLICA IDENTITY DEFAULT;
-- ALTER TABLE leads ALTER COLUMN department_id DROP NOT NULL;   -- and the other four
-- ALTER TABLE leads ADD CONSTRAINT leads_phone_number_key UNIQUE (phone_number);
--   ⚠ This last one only succeeds if no cross-department duplicate phone exists yet.
--   Once a second department has logged a number telematics already holds, the global
--   constraint can no longer be restored — that is the true point of no return for
--   this project. Reaching it is fine and expected; just know where it is.
```

### 6B.4 Rollback for 009

Only needed if you abandon the whole thing before the app deploy:

```sql
-- DROP TABLE term_billings, school_buses, academic_terms, service_orders,
--            department_products, kyc_fields, funnel_stages CASCADE;
-- DROP FUNCTION assign_lead_round_robin_v2, rag_auto_flag_v2, create_manual_lead,
--               check_phone_across_departments, is_school_holiday, generate_term_billings;
-- DROP INDEX CONCURRENTLY leads_dept_phone_uniq, idx_leads_dept_stage, …;
-- ALTER TABLE leads DROP COLUMN department_id, DROP COLUMN kyc,
--                   DROP COLUMN created_by, DROP COLUMN company_name;
-- …same for the other tables, then DROP TABLE departments.
-- No pre-existing row is touched by any of this: every dropped column was added by 009.
```

---

## 7 · APPLICATION CHANGES

### 7.1 Types — `types/crm.ts`

- Keep `FunnelStage` as a union **only for telematics legacy code**; introduce `type StageKey = string` for department-driven stages, and drive labels/colors from the `funnel_stages` table instead of `FUNNEL_STAGE_LABELS`.
- Add `Department`, `FunnelStageDef`, `KycFieldDef`, `DepartmentProduct`, `ServiceOrder`, `AcademicTerm`, `SchoolBus`, `TermBilling` interfaces.
- Add `type PostSaleModel = 'annual_renewal' | 'subscription' | 'consumption' | 'term_contract' | 'none'` and switch on it exhaustively (a `never` default case) so adding a fifth model fails the build instead of silently rendering nothing.
- Add `department_id`, `kyc`, `company_name`, `created_by` to `Lead`; `department_id`, `contract_start`, `contract_end`, `billing_cycle` to `Sale`; `department_id`, `job_title` to `Telemarketer`.
- Add `export type Rep = Telemarketer` and use `Rep` in new code. **Do not rename the `telemarketers` table** — it is referenced across ~40 files and every RPC. Relabel it "Sales Reps" in the UI only.
- Regenerate `lib/supabase/types.ts` from the schema after the migration.

### 7.2 New: department context

- `lib/stores/departmentStore.ts` (Zustand) — `activeDepartment`, `departments[]`, `stages[]`, `kycFields[]`, `products[]`, plus `setActiveDepartment`.
- `lib/departments/useDepartment.ts` — hook returning the resolved config for the signed-in user. Reps: their own department, locked. Admin: a switcher, defaulting to "All departments".
- Load department config **once** in `AppShell` and cache it; never fetch stage definitions per row.
- `lib/utils/phoneHelpers.ts` — `normalizePhone()` accepting `07…`, `01…`, `7…`, `254…`, `+254…` → `+254XXXXXXXXX`; `formatPhone()` for display. Use it everywhere a phone is entered or matched.
- `lib/utils/kycHelpers.ts` — render/validate a `KycFieldDef[]` into a Zod schema and a form section; read/write `leads.kyc`.
- `lib/utils/termHelpers.ts` — current term, next term, `isSchoolHoliday(date)`, days-to-next-term, term-billing due date. Client-side mirror of `is_school_holiday`, fed from the cached `academic_terms` list. Must return sane values when the calendar is empty.
- `lib/utils/funnelHelpers.ts` — rewrite to take stages from config rather than the hardcoded array.

### 7.3 New: manual prospect entry

**`components/leads/NewProspectSheet.tsx`** — the core of this whole request.

- Triggered by a **"+ New Prospect"** button on `/leads` (and on `/backlog` for admin). Visible to every rep; for telematics reps it sets `lead_source = 'manual'`.
- Fields, in order: **Phone Number** (normalized on blur) → duplicate check → **Department** (locked to the rep's department; a select for admin) → **Product Interested** (from `department_products`) → **Lead Source** (`manual`, `referral`, `walk_in`, `cold_call`, `existing_client`) → **dynamically rendered KYC section** from `kyc_fields` for that department → **first call outcome** (optional, opens the same field set as `CallLogModal`) → **follow-up date + time** (optional).
- **Duplicate handling:** on phone blur, call `check_phone_across_departments`. If a match exists in *this* department → block with "Already in your queue — open it" and a link. If a match exists in *another* department → non-blocking amber banner: "This number is also a prospect in Vehicle Telematics (stage: negotiating, rep: Janet). Continue anyway?" Continue is allowed.
- On save: one `create_manual_lead` RPC call, then optionally one `call_logs` insert and one `followup_schedule` insert, mirroring `CallLogModal.onSubmit`. Optimistic insert into the leads table, toast on success, rollback + toast on failure.
- Toggles are **plain React state**, not RHF `setValue` fields.
- **Holiday-aware follow-up picker** (school_bus only): if the chosen date falls inside a holiday window, show an inline amber note — "Term 2 holiday until 28 Aug — the school will likely be closed. Schedule anyway?" — with a one-click "move to first day of Term 3". Never block the date; reps know their schools.

### 7.4 Changed components

| File | Change |
|---|---|
| `components/layout/Sidebar.tsx` | Department name + accent under the "Nebsam CRM" wordmark. Nav is department-aware: `consumption` shows **Reorders** instead of **Renewals**; `term_contract` shows **Term Billing** plus a **Buses** item; `'none'` hides the post-sale item entirely. |
| `components/layout/MobileNav.tsx` | Same department-aware items. |
| `components/layout/Header.tsx` | Department badge. For admin, a Department switcher (All · Telematics · Container E-Seal · Fuel Monitoring) writing to `departmentStore`. |
| `components/layout/AuthProvider.tsx` | Also load the rep's `department_id` and hydrate `departmentStore`. **Keep the non-async `onAuthStateChange` contract.** |
| `components/leads/LeadsShell.tsx` | `.eq('department_id', …)` on every query and realtime subscription. Add the "+ New Prospect" button. Columns become department-driven: telematics keeps Vehicle Type; the new departments show Company Name + any `kyc_fields.show_in_table`. |
| `components/leads/LeadFilters.tsx` | Stage and product options from config, not constants. Add a Department filter for admin. |
| `components/leads/FunnelStageBadge.tsx` | Look up label + color from `funnel_stages` by `(department_id, key)`; fall back to the key, title-cased. |
| `components/leads/CallLogModal.tsx` | KYC block becomes the dynamic `kyc_fields` renderer (telematics keeps its current four fields, seeded as its own `kyc_fields` rows so there is exactly one code path). Stage dropdown from config. Write `department_id` on the `call_logs` insert. |
| `components/leads/LeadDetailTabs.tsx` | **Tab 1 KYC** renders dynamically per department. **Tab 3 Sale** switches exhaustively on `post_sale_model`: `annual_renewal` = today's form; `subscription` = contract start/end + billing cycle + amount; `consumption` = a `service_orders` list with "Record Order"; `term_contract` = contract start/end + rate per bus per term + the generated `term_billings` schedule with per-term invoice status. **New Tab 5 "Buses"** for `school_bus` only — the per-bus register (add/edit bus, reg number, route, capacity, device serial, install date, status), with a live count that feeds `term_billings.bus_count`. **Tab 4** unchanged. Hide the WhatsApp panel for `lead_intake='manual'` departments. |
| `components/dashboard/DashboardShell.tsx` + widgets | Scope every query by department. `UpcomingRenewals` becomes `UpcomingCommitments`: renewals for telematics, contract expiries for fuel, reorders due for e-seal, term billings due for school bus. School Bus stats cards swap "Sales This Month" for **Buses Under Contract** and add a **Current Term / days to next term** tile. |
| `components/backlog/BacklogShell.tsx` | Department filter; admin sees all departments with a department column. |
| `components/renewals/*` | Department-aware. Add `components/reorders/ReordersShell.tsx` + route `/reorders` for `consumption` departments. Add `components/billing/TermBillingShell.tsx` + route `/term-billing` for `term_contract`: rows grouped by academic term, columns School · Buses · Amount · Due · Status, actions Mark Invoiced / Mark Paid / Waive, filters by term and status. |
| **New** `components/buses/BusRegisterShell.tsx` + route `/buses` | School Bus only. All buses across the rep's schools: reg number, school, route, capacity, device serial, install date, status. Filter by status and school. This is the operations view; the per-school view lives in Lead Detail Tab 5. |
| `components/admin/AdminShell.tsx` | New **Departments** tab (see 7.5). Every other tab gains a department filter. `RoundRobinWidget` shows one row per `round_robin_state` department and only rotates telematics. |
| `components/admin/CSVImport.tsx` | Department selector before mapping; map KYC columns onto `kyc_fields` keys; route through `create_manual_lead`; report per-row duplicate outcomes. |
| `components/admin/PerformanceSummary.tsx`, `ReportsTab.tsx`, `lib/reports/*` | Group by department; department column in the table and in the PDF header. |
| `lib/notifications/followupAlarm.ts` | Scope to the rep's department. For school_bus, suppress holiday-window alarms unless the rep explicitly scheduled inside one. |
| `middleware.ts` | Unchanged role logic. Add: a rep hitting a route their department doesn't have (`/renewals` for e-seal, `/buses` for anyone but school bus) is redirected to `/dashboard`. Drive this from `post_sale_model`, not a hardcoded slug list. |

### 7.5 New: Admin → Departments tab

`components/admin/DepartmentManager.tsx` — this is what makes D3 pay off:

- List departments; create/edit (name, slug, intake, assignment mode, post-sale model, accent, icon, active).
- **Stage editor** per department: add/rename/reorder (drag), set color, toggle `is_active_stage` / `is_won` / `is_terminal`. Renaming a stage `key` must migrate existing `leads.funnel_stage` values in the same transaction — warn loudly before allowing it.
- **KYC field editor** per department: add/edit/reorder fields, set type, options, required, `show_in_table`. Deleting a field soft-deletes (`is_active = false`) so historical `leads.kyc` answers survive.
- **Product editor** per department: name, unit price, active.
- **Term calendar editor** (global, shown once — not per department): add/edit academic terms with year, term number, start, end, holiday start, holiday end. Validate that terms do not overlap and that each holiday sits between its term's end and the next term's start. Show a clear "term calendar not configured" state with a link here from anywhere School Bus needs it.
- Assign reps to departments (also surfaced in `TelemarketerManager`).

---

## 8 · RLS — migration `011`, Sprint D8, last of everything

Replace the open policies. Helper functions, both SECURITY DEFINER and `STABLE`:

```sql
CREATE OR REPLACE FUNCTION public.current_rep_department() RETURNS UUID ...
CREATE OR REPLACE FUNCTION public.is_admin() RETURNS BOOLEAN ...  -- auth.users.raw_user_meta_data->>'role' = 'admin'
```

Policy shape for `leads`, `call_logs`, `sales`, `followup_schedule`, `service_orders`, `school_buses`, `term_billings`:

```
USING (is_admin() OR department_id = current_rep_department())
```

…and, for a rep, additionally scoped to their own rows where the existing 006 draft did so (`assigned_to` / `telemarketer_id`). Config tables (`departments`, `funnel_stages`, `kyc_fields`, `department_products`, `academic_terms`) are **readable by all authenticated users, writable by admin only** — the term calendar is reference data every school-bus rep reads and none of them should edit.

**Before enabling:** confirm the webhook route uses the service-role key (service_role bypasses RLS) and that `create_manual_lead` / `assign_lead_round_robin` remain SECURITY DEFINER. Keep the previous policies in the migration as commented rollback SQL, exactly as `006_auth.sql` does.

---

## 9 · SPRINT PLAN

Follow the `CLAUDE.md` working rules: plan mode at the start of each sprint, one sprint at a time, commit at each gate, ask before assuming.

### SPRINT D0 — Confirm, branch, and build a safe staging copy
- Ask Kelvin the eight items in §4.
- `git checkout -b feature/departments`.
- Write `scripts/migrate-file.mjs` per §1 (explicit path, `--dry-run`, `--no-transaction`, prints the target host).
- `pg_dump` production. **Restore it into a scratch Supabase project** — this is the staging database, and it must contain real production data, because every risk in this project is about existing rows. Record the Supabase PITR timestamp.
- Run the §6.3 snapshot query against production and commit the output to the repo.
- **Done when:** decisions are in `CLAUDE.md`, the branch exists, the runner works, and a production-data staging copy is up.

### SPRINT D1 — Migration 009 (additive) on staging
- Write `supabase/migrations/009_departments_additive.sql` per §6A, plus `supabase/seed_departments.sql`. Do not touch `supabase/seed.sql`.
- Snapshot the v1 function definitions (§6.5 step 0) and commit them.
- `--dry-run` against staging, read every notice, then apply for real to **staging only**.
- Run the §6.3 verification and config-coverage queries. Run the §10 telematics regression checklist against staging with the **old app code still pointing at it** — that is the actual proof that 009 is non-interfering.
- **Done when:** on staging, four departments and the full config exist; every pre-existing row carries `department_id = telematics`; `leads_dept_phone_uniq` is valid; row counts and `max(updated_at)` are identical to the snapshot; `leads_updated_at` is enabled; and the **unmodified** app still works against it.

### SPRINT D1b — Apply 009 to production
- Second `pg_dump`. Apply 009 to production in a quiet window. Re-run every verification query.
- Nothing else changes: the app is untouched, the cron still calls v1, the webhook still calls v1.
- **Done when:** production verification queries all pass, and the team reports a normal working day with no visible change whatsoever.

### SPRINT D2 — Functions (v2, called by nothing yet)
- `assign_lead_round_robin_v2`, `create_manual_lead`, `check_phone_across_departments`, `is_school_holiday`, `generate_term_billings`, `rag_auto_flag_v2` with `p_dry_run`.
- On staging: `SELECT public.rag_auto_flag_v2(true);` and `SELECT public.rag_auto_flag();` — diff the two. For telematics leads the results must match exactly; any difference is a bug in v2, not an improvement.
- **Done when:** v2 dry-run matches v1 on telematics, returns correct per-department counts, provably skips the inactivity rule for school_bus during a holiday — and the production cron is still calling v1.

### SPRINT D3 — Types, stores, config plumbing
- Regenerate `lib/supabase/types.ts`; update `types/crm.ts`; add `departmentStore`, `useDepartment`, `phoneHelpers`, `kycHelpers`; rewrite `funnelHelpers`.
- **Done when:** `npm run build` passes clean and the telematics app is byte-for-byte unchanged in behaviour.

### SPRINT D4 — Manual entry + department-aware leads
- `NewProspectSheet`, dynamic KYC renderer, duplicate warning, department-scoped `LeadsShell` / filters / badges / `CallLogModal`.
- **Done when:** an e-seal rep can log in, enter a number, complete KYC, log a call outcome, set a follow-up, and see the lead in their queue — while a telematics rep sees none of it. Repeat the same walkthrough as a school-bus rep against a school.

### SPRINT D5 — Funnel journey: dashboard, backlog, renewals, reorders
- Department-aware dashboard widgets; `/reorders` page + `ReordersShell`; contract tracking on the Sale tab; `UpcomingCommitments`.
- **Done when:** each department's dashboard shows only its own numbers, and a won e-seal lead produces a service order with a reorder date that lands on the Reorders page.

### SPRINT D5b — School Bus: bus register + term billing
Split out because it is the only department with a child-asset model, and it should not block D5 shipping.
- Lead Detail **Tab 5 Buses**; `/buses` `BusRegisterShell`; `/term-billing` `TermBillingShell`; `term_contract` variant of the Sale tab; `generate_term_billings` wired to contract save and to a daily job; holiday-aware follow-up picker; Admin term calendar editor.
- **Done when:** a school lead with 6 buses produces a term-billing row per term for the contract span with `bus_count = 6`; marking Term 1 paid leaves Term 2 pending; an overdue term billing turns the lead RED; and scheduling a follow-up inside the August holiday shows the warning and offers the Term 3 start date.

### SPRINT D6 — Admin: Departments tab, assignment, CSV, reports + RLS
- `DepartmentManager` (stages, KYC fields, products, term calendar, rep assignment); department filters across admin; CSV import with department + KYC mapping; reports grouped by department.
- **Done when:** Kelvin can add a stage and a KYC question from the UI with no deploy, and the full app works against the staging copy of production data.

### SPRINT D7 — Deploy the app, then cut over
Order matters. The app ships first, against a database that 009 already prepared.
1. Extend `scripts/qa-test.mjs` and `scripts/e2e-test.mjs` with the §10 checklist; run green on staging.
2. Merge to `main`, deploy to Vercel. The app now calls `assign_lead_round_robin_v2` and `create_manual_lead`. The cron is still on v1, the global phone constraint is still in place — both harmless, because the app writes `department_id` explicitly.
3. **Smoke-test the telematics path on production first**: a real WhatsApp lead arrives, assigns to a telematics rep, appears live, a call logs against it. Only then let the new reps in.
4. Run `010_departments_cutover.sql`: `--dry-run`, review, `pg_dump`, apply. Watch the next 05:00 cron run and compare its output against the previous morning's.
- **Done when:** all four departments are live, the telematics regression checklist passes on production, and one full overnight cron cycle has run on v2 with results that match expectations.

### SPRINT D8 — RLS, after a soak
- Only once 010 has been stable for several days: `011_department_rls.sql` per §8.
- This is the highest-risk change in the project — a wrong policy makes data invisible to the people who own it, which looks exactly like data loss to the team even though nothing was deleted.
- Apply to staging, verify with anon-key queries per role, then production in a quiet window with the rollback SQL open in another tab.
- **Done when:** a rep signed in to one department provably cannot read another department's leads (verified with a raw anon-key query, not just the UI), and every telematics rep still sees exactly the leads they saw the day before.

---

## 10 · VERIFICATION CHECKLIST

**Data integrity — run after 009 and again after 010, on staging and on production:**
- [ ] Row counts for `leads`, `call_logs`, `sales`, `followup_schedule`, `telemarketers` are **identical** to the pre-migration snapshot.
- [ ] `max(updated_at)` on `leads` is unchanged, and the top-20-by-`updated_at` list matches the snapshot row for row. (If this fails, the backfill trigger suppression did not work — restore from `pg_dump` rather than trying to reconstruct the ordering.)
- [ ] `SELECT tgenabled FROM pg_trigger WHERE tgname = 'leads_updated_at'` returns `O`.
- [ ] `SELECT tgenabled FROM pg_trigger WHERE tgname = 'sales_renewal_due_date'` returns `O`.
- [ ] No `department_id IS NULL` in any of the five tables.
- [ ] Every distinct existing `funnel_stage` and `product_interested` value has a matching config row (§6.3 coverage queries return zero rows).
- [ ] `leads_dept_phone_uniq` exists with `indisvalid = true`.
- [ ] No lead, call log, sale, follow-up or telemarketer row was **inserted** by the migration: `SELECT count(*) FROM leads WHERE created_at > '<migration timestamp>'` shows only genuine new business, none of `seed.sql`'s demo names.
- [ ] After 009 only: `assign_lead_round_robin` and `rag_auto_flag` still exist with their original bodies (diff against the committed snapshot), and the cron job still points at v1.

**Telematics regression (must all still pass):**
- [ ] WhatsApp webhook creates a lead, round-robins across **telematics reps only**, appears live via Realtime.
- [ ] `/leads`, `/backlog`, `/renewals`, `/dashboard` render identical data and counts to pre-migration.
- [ ] Call log save still writes call_log + lead update + followup, optimistically.
- [ ] RAG cron produces the same flags for telematics leads as before.
- [ ] Reports PDF still generates.
- [ ] Login → admin lands on `/admin`, rep lands on `/dashboard`; idle logout still fires.

**New department acceptance:**
- [ ] E-seal rep creates a prospect from a phone number; `+254` normalization works from `07…` input.
- [ ] Same number entered in fuel monitoring succeeds with a cross-department warning; entered twice in the same department is blocked with a clear message.
- [ ] KYC renders exactly the seeded field set per department, required fields validate, answers persist to `leads.kyc` and re-open populated.
- [ ] Funnel dropdown shows only that department's stages, in order; stage change persists and the badge colors correctly.
- [ ] Follow-up scheduled at 3:30 PM stores as `+03:00` and fires the alarm/notification for the right rep.
- [ ] Lead progresses new → … → won → contract_signed → delivered/active; Sale tab shows the right form for the department's `post_sale_model`.
- [ ] E-seal service order with a reorder date appears on `/reorders` and drives RAG to RED when overdue.
- [ ] Fuel contract expiring in 20 days shows AMBER and appears in upcoming commitments.
- [ ] Admin adds a new KYC field and a new stage from the UI; both appear for reps without a deploy.
- [ ] Rep A (e-seal) cannot read fuel-monitoring, school-bus or telematics leads via the anon key with their JWT.

**School Bus acceptance:**
- [ ] A school lead accepts 6 buses in the register; `UNIQUE(department_id, registration_number)` rejects a duplicate plate with a readable message, not a raw SQL error.
- [ ] Saving a contract spanning three terms generates exactly three `term_billings` rows, each with `bus_count = 6` and `due_date` = term start − 14 days.
- [ ] Re-running `generate_term_billings` on the same sale creates no duplicates and does not reset a row already marked paid.
- [ ] An overdue term billing turns the school RED; marking it paid and re-running the cron does not leave it RED for the wrong reason.
- [ ] During a seeded holiday window, a school with no call activity for 20 days is **not** auto-flagged RED; a school with an overdue billing **is**.
- [ ] Scheduling a follow-up inside a holiday shows the warning and the "move to first day of Term 3" action works.
- [ ] Adding a 7th bus mid-contract is reflected in the *next* unbilled term, not retroactively in a paid one.
- [ ] With `academic_terms` empty, every School Bus page renders with a "term calendar not configured" notice and nothing throws.
- [ ] `/buses` and `/term-billing` are unreachable for reps in the other three departments.
- [ ] `npm run build` clean, no TypeScript errors, no console errors on any route.

---

## 11 · REPORTING BACK

At the end of each sprint, state: what changed (files + migration), what was verified and how, what is still open, and the exact command to roll back if needed. If anything in §3 turns out to be wrong once you are in the code, **stop and raise it with Kelvin** rather than working around it.

**Before any statement runs against the production database**, post: the migration file, the target host as `migrate-file.mjs` printed it, the `--dry-run` output, confirmation that a fresh `pg_dump` exists and was checked, and the rollback command. Then wait for Kelvin to say go. This applies to 009, 010 and 011 without exception — a live CRM that three telemarketers are working in right now does not get an unannounced migration.
