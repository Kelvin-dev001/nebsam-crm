-- ============================================================================
-- 009_departments_additive.sql
--
-- Multi-department expansion, part 1 of 3. ADDITIVE ONLY.
-- Spec: DEPARTMENTS-MASTER-PROMPT.md section 6A.
--
-- Safe to run against live production. After this migration the deployed app
-- behaves exactly as it did before, because nothing it reads has changed:
--   * no existing column changes type, default or nullability
--   * no existing constraint, index or trigger is dropped or altered
--   * assign_lead_round_robin and rag_auto_flag are untouched and still v1
--   * the pg_cron schedule is untouched
--   * no RLS policy or grant on an existing table changes
--   * the only write to existing rows sets department_id on rows where it is
--     NULL because the column was created seconds earlier
--
-- Idempotent: safe to run twice. Every object is guarded, every insert is
-- ON CONFLICT DO NOTHING.
--
-- Run it with:
--   node scripts/migrate-file.mjs supabase/migrations/009_departments_additive.sql --dry-run
-- then, after review and a fresh verified backup:
--   node scripts/migrate-file.mjs supabase/migrations/009_departments_additive.sql --confirm=<project-ref>
--
-- THEN run 009b_departments_indexes_concurrent.sql with --no-transaction.
-- A rollback block is at the foot of this file.
-- ============================================================================

SET TimeZone = 'UTC';

-- ============================================================================
-- 1. NEW TABLES  (section 6.1)
--
-- NOTE: production has an active event trigger, ensure_rls, which fires on
-- ddl_command_end for CREATE TABLE and enables ROW LEVEL SECURITY on every new
-- table in public automatically. Each table below therefore arrives with RLS
-- already ON. A table with RLS enabled and no policy denies all access, so the
-- open policies in section 6 of this file are mandatory, not optional.
-- See supabase/migrations/_pre009_function_snapshot.sql.
-- ============================================================================

CREATE TABLE IF NOT EXISTS departments (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  slug              TEXT        UNIQUE NOT NULL,
  name              TEXT        NOT NULL,
  description       TEXT,
  lead_intake       TEXT        NOT NULL DEFAULT 'manual',    -- whatsapp_webhook | manual
  assignment_mode   TEXT        NOT NULL DEFAULT 'creator',   -- round_robin | creator | unassigned
  post_sale_model   TEXT        NOT NULL DEFAULT 'none',      -- annual_renewal | subscription | consumption | term_contract | none
  accent_color      TEXT        NOT NULL DEFAULT '#2563EB',
  icon              TEXT,                                     -- lucide icon name
  is_active         BOOLEAN     NOT NULL DEFAULT TRUE,
  sort_order        INT         NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS funnel_stages (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id    UUID        NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  key              TEXT        NOT NULL,                  -- snake_case, written to leads.funnel_stage
  label            TEXT        NOT NULL,
  sort_order       INT         NOT NULL,
  color            TEXT        NOT NULL DEFAULT 'slate',
  is_active_stage  BOOLEAN     NOT NULL DEFAULT TRUE,     -- counts as "in the pipeline" for RAG + stats
  is_won           BOOLEAN     NOT NULL DEFAULT FALSE,    -- triggers the Sale tab
  is_terminal      BOOLEAN     NOT NULL DEFAULT FALSE,    -- lost / unqualified / dormant
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (department_id, key)
);

CREATE TABLE IF NOT EXISTS kyc_fields (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id  UUID        NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  key            TEXT        NOT NULL,                    -- key inside leads.kyc JSONB
  label          TEXT        NOT NULL,
  field_type     TEXT        NOT NULL,                    -- text|textarea|number|select|multiselect|boolean|date|phone|email
  options        JSONB,
  is_required    BOOLEAN     NOT NULL DEFAULT FALSE,
  help_text      TEXT,
  sort_order     INT         NOT NULL DEFAULT 0,
  show_in_table  BOOLEAN     NOT NULL DEFAULT FALSE,
  is_active      BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (department_id, key)
);

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

-- Container E-Seal per-use revenue.
CREATE TABLE IF NOT EXISTS service_orders (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id          UUID        NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  department_id    UUID        NOT NULL REFERENCES departments(id),
  telemarketer_id  UUID        NOT NULL REFERENCES telemarketers(id),
  order_date       DATE        NOT NULL DEFAULT CURRENT_DATE,
  product          TEXT        NOT NULL,
  quantity         INT         NOT NULL,
  unit_price       DECIMAL(12,2),
  total_amount     DECIMAL(12,2),
  currency         TEXT        NOT NULL DEFAULT 'KES',
  delivery_date    DATE,
  delivery_status  TEXT        NOT NULL DEFAULT 'pending',  -- pending|delivered|cancelled
  reorder_due_date DATE,                                    -- drives the Reorders page + RAG
  notes            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- School Bus calendar. Global, not per-department: one national school calendar.
CREATE TABLE IF NOT EXISTS academic_terms (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  year           INT         NOT NULL,
  term_number    INT         NOT NULL CHECK (term_number BETWEEN 1 AND 3),
  name           TEXT        NOT NULL,
  start_date     DATE        NOT NULL,
  end_date       DATE        NOT NULL,
  holiday_start  DATE,                                    -- the break FOLLOWING this term
  holiday_end    DATE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (year, term_number),
  CHECK (end_date > start_date)
);

-- Per-bus asset register. A school is ONE lead with N buses.
CREATE TABLE IF NOT EXISTS school_buses (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id             UUID        NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  department_id       UUID        NOT NULL REFERENCES departments(id),
  registration_number TEXT        NOT NULL,
  route_name          TEXT,
  capacity            INT,
  device_serial       TEXT,
  device_product      TEXT,
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

-- School Bus term_contract revenue. One row per (sale, academic term):
-- the renewal event for School Bus, three per year instead of one.
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
  due_date         DATE,                                  -- term start - 14 days
  invoice_status   TEXT        NOT NULL DEFAULT 'pending',
                               -- pending|invoiced|paid|partial|overdue|waived
  paid_date        DATE,
  notes            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (sale_id, academic_term_id)
);

-- Reuse the existing update_updated_at() function (001_initial_schema.sql:110).
DROP TRIGGER IF EXISTS school_buses_updated_at ON school_buses;
CREATE TRIGGER school_buses_updated_at
  BEFORE UPDATE ON school_buses
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================================
-- 2. DEPARTMENT SEED  (section 6.4)
--
-- Must run BEFORE the ALTER TABLE statements below, because every new
-- department_id column takes the telematics row's id as its DEFAULT.
-- ============================================================================

INSERT INTO departments (slug, name, description, lead_intake, assignment_mode, post_sale_model, accent_color, icon, sort_order) VALUES
  ('telematics',      'Vehicle Telematics',  'Vehicle tracking, alarms, dash cams and video telematics. Leads arrive from the WhatsApp BSP chatbot.', 'whatsapp_webhook', 'round_robin', 'annual_renewal', '#2563EB', 'Car',       1),
  ('container_eseal', 'Container E-Seal',    'Container security seals for transporters, clearing & forwarding agents, CFSs and importers. Revenue is per-use: customers reorder by volume.', 'manual', 'creator', 'consumption',    '#0D9488', 'Container', 2),
  ('fuel_monitoring', 'Fuel Monitoring',     'Fuel sensors and fuel management software for fleet and generator operators. Revenue is recurring: install plus a subscription with an end date.', 'manual', 'creator', 'subscription', '#F59E0B', 'Fuel',      3),
  ('school_bus',      'School Bus Solution', 'Bus tracking, parent notification and in-bus safety kit for schools. Billed once per school term, three terms a year.', 'manual', 'creator', 'term_contract', '#7C3AED', 'Bus',       4)
ON CONFLICT (slug) DO NOTHING;

-- ============================================================================
-- 3. ALTER EXISTING TABLES  (section 6.2) -- additive, all with defaults
--
-- ADD COLUMN with a CONSTANT default is metadata-only on PostgreSQL 11+: no
-- table rewrite, no long lock, safe on a live table. Do not introduce a DEFAULT
-- that calls a volatile function -- that WOULD rewrite the table.
--
-- The DEFAULT is the single most important thing in this migration. It means
-- the currently deployed app keeps working untouched between this migration and
-- the app deploy: an insert from the live WhatsApp webhook, or a lead added by
-- a rep five minutes after this runs, lands in telematics automatically without
-- anyone changing a line of code.
-- ============================================================================

DO $$
DECLARE v_tel UUID;
BEGIN
  SELECT id INTO STRICT v_tel FROM departments WHERE slug = 'telematics';

  EXECUTE format('ALTER TABLE leads             ADD COLUMN IF NOT EXISTS department_id UUID REFERENCES departments(id) DEFAULT %L', v_tel);
  EXECUTE format('ALTER TABLE call_logs         ADD COLUMN IF NOT EXISTS department_id UUID REFERENCES departments(id) DEFAULT %L', v_tel);
  EXECUTE format('ALTER TABLE sales             ADD COLUMN IF NOT EXISTS department_id UUID REFERENCES departments(id) DEFAULT %L', v_tel);
  EXECUTE format('ALTER TABLE followup_schedule ADD COLUMN IF NOT EXISTS department_id UUID REFERENCES departments(id) DEFAULT %L', v_tel);
  EXECUTE format('ALTER TABLE telemarketers     ADD COLUMN IF NOT EXISTS department_id UUID REFERENCES departments(id) DEFAULT %L', v_tel);
  EXECUTE format('ALTER TABLE round_robin_state ADD COLUMN IF NOT EXISTS department_id UUID REFERENCES departments(id) DEFAULT %L', v_tel);
END $$;

-- Plain additive columns, all nullable or defaulted, none read by the live app.
ALTER TABLE telemarketers ADD COLUMN IF NOT EXISTS job_title      TEXT;
ALTER TABLE leads         ADD COLUMN IF NOT EXISTS kyc            JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE leads         ADD COLUMN IF NOT EXISTS created_by     UUID REFERENCES telemarketers(id);
ALTER TABLE leads         ADD COLUMN IF NOT EXISTS company_name   TEXT;  -- promoted out of kyc for tables, search, reports
ALTER TABLE sales         ADD COLUMN IF NOT EXISTS contract_start DATE;
ALTER TABLE sales         ADD COLUMN IF NOT EXISTS contract_end   DATE;
ALTER TABLE sales         ADD COLUMN IF NOT EXISTS billing_cycle  TEXT;  -- monthly|quarterly|termly|annual|once_off

-- ============================================================================
-- 4. BACKFILL  (section 6.3) -- the only write to existing rows in this project
--
-- Because of the DEFAULT above, new rows already carry telematics. This fills
-- only the historical rows, which are all NULL.
--
-- leads carries a BEFORE UPDATE trigger, leads_updated_at, which sets
-- updated_at = now(). A bare backfill UPDATE would rewrite updated_at on EVERY
-- lead in the database, destroying the last-touched ordering that the leads
-- queue sorts on, that idx_leads_updated_at serves, and that the team reads as
-- "when did we last deal with this client". Hence the suppression below.
--
-- If this block raises between DISABLE and ENABLE, the whole transaction rolls
-- back and the trigger is restored with it. Verify anyway afterwards -- see
-- section 7.
-- ============================================================================

DO $$
DECLARE v_tel UUID; v_n INT; v_total INT := 0;
BEGIN
  SELECT id INTO STRICT v_tel FROM departments WHERE slug = 'telematics';

  ALTER TABLE leads DISABLE TRIGGER leads_updated_at;
  LOOP
    UPDATE leads SET department_id = v_tel
    WHERE id IN (SELECT id FROM leads WHERE department_id IS NULL LIMIT 500);
    GET DIAGNOSTICS v_n = ROW_COUNT;
    EXIT WHEN v_n = 0;
    v_total := v_total + v_n;
    RAISE NOTICE 'leads backfilled: % rows (running total %)', v_n, v_total;
  END LOOP;
  ALTER TABLE leads ENABLE TRIGGER leads_updated_at;   -- MUST run
  RAISE NOTICE 'leads backfill complete: % rows, leads_updated_at re-enabled', v_total;

  -- The rest have no updated_at trigger, so a plain UPDATE is safe.
  UPDATE call_logs         SET department_id = v_tel WHERE department_id IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT; RAISE NOTICE 'call_logs backfilled: % rows', v_n;

  UPDATE sales             SET department_id = v_tel WHERE department_id IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT; RAISE NOTICE 'sales backfilled: % rows', v_n;

  UPDATE followup_schedule SET department_id = v_tel WHERE department_id IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT; RAISE NOTICE 'followup_schedule backfilled: % rows', v_n;

  UPDATE telemarketers     SET department_id = v_tel WHERE department_id IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT; RAISE NOTICE 'telemarketers backfilled: % rows', v_n;

  UPDATE round_robin_state SET department_id = v_tel WHERE department_id IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT; RAISE NOTICE 'round_robin_state backfilled: % rows', v_n;
END $$;

-- ============================================================================
-- 5. INDEXES  (section 6.3b) -- the ones that can run inside a transaction
--
-- The four indexes on the live leads table use CREATE INDEX CONCURRENTLY and
-- therefore CANNOT run here -- CONCURRENTLY is forbidden inside a transaction
-- block. They live in 009b_departments_indexes_concurrent.sql, which is run
-- separately with --no-transaction.
--
-- idx_leads_department is deliberately NOT created: leads_dept_phone_uniq and
-- the composites in 009b all lead with department_id already.
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_call_logs_department   ON call_logs(department_id);
CREATE INDEX IF NOT EXISTS idx_sales_department       ON sales(department_id);
CREATE INDEX IF NOT EXISTS idx_sales_contract_end     ON sales(contract_end);
CREATE INDEX IF NOT EXISTS idx_service_orders_lead    ON service_orders(lead_id);
CREATE INDEX IF NOT EXISTS idx_service_orders_reorder ON service_orders(reorder_due_date);
CREATE INDEX IF NOT EXISTS idx_school_buses_lead      ON school_buses(lead_id);
CREATE INDEX IF NOT EXISTS idx_school_buses_status    ON school_buses(department_id, status);
CREATE INDEX IF NOT EXISTS idx_term_billings_lead     ON term_billings(lead_id);
CREATE INDEX IF NOT EXISTS idx_term_billings_due      ON term_billings(due_date, invoice_status);
CREATE INDEX IF NOT EXISTS idx_academic_terms_dates   ON academic_terms(start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_funnel_stages_dept     ON funnel_stages(department_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_kyc_fields_dept        ON kyc_fields(department_id, sort_order);

-- round_robin_state holds a single row today, so a plain unique index is
-- instant and does not need CONCURRENTLY.
CREATE UNIQUE INDEX IF NOT EXISTS round_robin_state_dept_uniq ON round_robin_state(department_id);

-- ============================================================================
-- 6. RLS, POLICIES AND GRANTS ON THE NEW TABLES
--
-- Deliberately the SAME posture as 001_initial_schema.sql, so this migration
-- changes no access behaviour for anyone. Tightened in 011, never here.
--
-- These are REAL statements, not commented suggestions, for two reasons:
--
--  1. The ensure_rls event trigger has already enabled RLS on all eight tables
--     as they were created. RLS enabled with no policy denies everything, so
--     without the policies below the app would read zero rows from every
--     config table -- no funnel stages, no KYC fields, no products -- which
--     looks exactly like data loss.
--  2. Tables created outside the Supabase dashboard get no PostgREST grants.
--     This has bitten this project before; it is why scripts/fix-grants.mjs
--     exists. PostgREST connects as anon/authenticated and would see nothing.
--
-- ENABLE ROW LEVEL SECURITY is repeated here for explicitness and so the file
-- is correct on a database without the event trigger (a local staging cluster).
-- It is idempotent.
-- ============================================================================

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'departments', 'funnel_stages', 'kyc_fields', 'department_products',
    'service_orders', 'academic_terms', 'school_buses', 'term_billings'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);

    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = t AND policyname = 'open_' || t
    ) THEN
      EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL USING (true) WITH CHECK (true)',
                     'open_' || t, t);
      RAISE NOTICE 'created policy open_% on %', t, t;
    END IF;

    EXECUTE format('GRANT ALL ON TABLE public.%I TO anon, authenticated, service_role', t);
  END LOOP;
END $$;

-- ============================================================================
-- 7. VERIFICATION  (section 6.3)
--
-- These raise an exception rather than returning rows, so a dry-run that gets
-- to the end of the file without raising has proved the migration is sound.
-- ============================================================================

DO $$
DECLARE v_bad INT; v_trig "char";
BEGIN
  -- 7a. No NULL department_id anywhere.
  SELECT count(*) INTO v_bad FROM leads             WHERE department_id IS NULL;
  IF v_bad > 0 THEN RAISE EXCEPTION 'leads still has % NULL department_id', v_bad; END IF;
  SELECT count(*) INTO v_bad FROM call_logs         WHERE department_id IS NULL;
  IF v_bad > 0 THEN RAISE EXCEPTION 'call_logs still has % NULL department_id', v_bad; END IF;
  SELECT count(*) INTO v_bad FROM sales             WHERE department_id IS NULL;
  IF v_bad > 0 THEN RAISE EXCEPTION 'sales still has % NULL department_id', v_bad; END IF;
  SELECT count(*) INTO v_bad FROM followup_schedule WHERE department_id IS NULL;
  IF v_bad > 0 THEN RAISE EXCEPTION 'followup_schedule still has % NULL department_id', v_bad; END IF;
  SELECT count(*) INTO v_bad FROM telemarketers     WHERE department_id IS NULL;
  IF v_bad > 0 THEN RAISE EXCEPTION 'telemarketers still has % NULL department_id', v_bad; END IF;
  SELECT count(*) INTO v_bad FROM round_robin_state WHERE department_id IS NULL;
  IF v_bad > 0 THEN RAISE EXCEPTION 'round_robin_state still has % NULL department_id', v_bad; END IF;
  RAISE NOTICE 'OK: no NULL department_id in any of the six tables';

  -- 7b. The updated_at trigger is enabled again. 'O' = enabled, origin.
  SELECT tgenabled INTO v_trig FROM pg_trigger WHERE tgname = 'leads_updated_at';
  IF v_trig IS NULL THEN
    RAISE EXCEPTION 'leads_updated_at trigger is MISSING';
  ELSIF v_trig <> 'O' THEN
    RAISE EXCEPTION 'leads_updated_at is not enabled (tgenabled=%) -- updated_at would silently stop advancing', v_trig;
  END IF;
  RAISE NOTICE 'OK: leads_updated_at is enabled';

  -- 7c. The four departments exist.
  SELECT count(*) INTO v_bad FROM departments
   WHERE slug IN ('telematics','container_eseal','fuel_monitoring','school_bus');
  IF v_bad <> 4 THEN RAISE EXCEPTION 'expected 4 departments, found %', v_bad; END IF;
  RAISE NOTICE 'OK: 4 departments seeded';

  -- 7d. Every new table is readable by the API roles. A table with RLS on and
  --     no policy returns nothing to anon/authenticated, which is the failure
  --     this check exists to catch.
  SELECT count(*) INTO v_bad FROM (
    SELECT c.relname FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity
      AND c.relname IN ('departments','funnel_stages','kyc_fields','department_products',
                        'service_orders','academic_terms','school_buses','term_billings')
      AND NOT EXISTS (SELECT 1 FROM pg_policies p
                      WHERE p.schemaname = 'public' AND p.tablename = c.relname)
  ) d;
  IF v_bad > 0 THEN
    RAISE EXCEPTION '% new table(s) have RLS enabled but no policy -- they would return zero rows to the app', v_bad;
  END IF;
  RAISE NOTICE 'OK: every new table with RLS has at least one policy';

  -- 7e. v1 functions untouched and still present.
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname = 'public' AND p.proname = 'assign_lead_round_robin')
  THEN RAISE EXCEPTION 'assign_lead_round_robin has gone missing'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname = 'public' AND p.proname = 'rag_auto_flag')
  THEN RAISE EXCEPTION 'rag_auto_flag has gone missing'; END IF;
  RAISE NOTICE 'OK: assign_lead_round_robin and rag_auto_flag both still present (v1)';
END $$;

-- ============================================================================
-- ROLLBACK 009  (only needed if the whole project is abandoned before the app
-- deploy; nothing below touches a pre-existing row, because every dropped
-- object was created by this file)
--
-- DROP TRIGGER IF EXISTS school_buses_updated_at ON school_buses;
-- DROP TABLE IF EXISTS term_billings, school_buses, academic_terms, service_orders,
--                      department_products, kyc_fields, funnel_stages CASCADE;
-- DROP INDEX IF EXISTS idx_call_logs_department, idx_sales_department,
--                      idx_sales_contract_end, round_robin_state_dept_uniq;
-- ALTER TABLE leads             DROP COLUMN IF EXISTS department_id,
--                               DROP COLUMN IF EXISTS kyc,
--                               DROP COLUMN IF EXISTS created_by,
--                               DROP COLUMN IF EXISTS company_name;
-- ALTER TABLE call_logs         DROP COLUMN IF EXISTS department_id;
-- ALTER TABLE sales             DROP COLUMN IF EXISTS department_id,
--                               DROP COLUMN IF EXISTS contract_start,
--                               DROP COLUMN IF EXISTS contract_end,
--                               DROP COLUMN IF EXISTS billing_cycle;
-- ALTER TABLE followup_schedule DROP COLUMN IF EXISTS department_id;
-- ALTER TABLE telemarketers     DROP COLUMN IF EXISTS department_id,
--                               DROP COLUMN IF EXISTS job_title;
-- ALTER TABLE round_robin_state DROP COLUMN IF EXISTS department_id;
-- DROP TABLE IF EXISTS departments CASCADE;
--
-- Also drop the CONCURRENTLY indexes from 009b:
-- DROP INDEX CONCURRENTLY IF EXISTS leads_dept_phone_uniq;
-- DROP INDEX CONCURRENTLY IF EXISTS idx_leads_dept_stage;
-- DROP INDEX CONCURRENTLY IF EXISTS idx_leads_dept_rag;
-- DROP INDEX CONCURRENTLY IF EXISTS idx_leads_dept_assigned;
-- DROP INDEX CONCURRENTLY IF EXISTS idx_leads_company_name;
-- ============================================================================
