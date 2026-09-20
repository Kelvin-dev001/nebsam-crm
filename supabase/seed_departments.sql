-- ============================================================================
-- seed_departments.sql  -- CONFIGURATION ROWS ONLY.
--
-- Spec: DEPARTMENTS-MASTER-PROMPT.md section 6.4.
-- Run AFTER 009_departments_additive.sql (which seeds the four departments
-- themselves, because the department_id DEFAULTs depend on them).
--
--   node scripts/migrate-file.mjs supabase/seed_departments.sql --dry-run
--   node scripts/migrate-file.mjs supabase/seed_departments.sql --confirm=<project-ref>
--
-- Idempotent: every insert is ON CONFLICT DO NOTHING, so it is safe to re-run
-- and safe to extend later.
--
-- This inserts NOT ONE lead, call log, sale, follow-up or telemarketer. It is
-- config only. It is NOT supabase/seed.sql -- that file holds demo leads and
-- demo telemarketers and must never run against production. Leave it alone.
-- ============================================================================

SET TimeZone = 'UTC';

-- ============================================================================
-- 1. FUNNEL STAGES -- telematics (unchanged: the existing 13, migrated as-is)
--
-- CRITICAL: is_active_stage here reproduces, exactly, the hardcoded
-- active_stages array inside rag_auto_flag() v1:
--
--   'new','contacted','interested','quote_sent','negotiating',
--   'won','installed','post_sale','sorted','renewal_due'
--
-- rag_auto_flag_v2 (Sprint D2) replaces that hardcoded array with a lookup on
-- this column. Sprint D2's acceptance test is that v2's dry-run output matches
-- v1 exactly for telematics leads -- which is only true if these ten rows, and
-- only these ten, carry is_active_stage = true. `renewed`, `lost` and
-- `unqualified` are absent from v1's array and must be false here.
--
-- `color` stores the Tailwind colour family currently used by
-- components/leads/FunnelStageBadge.tsx. Two telematics badges use a non-default
-- shade (`installed` is green-200/800, `unqualified` is slate with lighter
-- text). A colour family alone cannot express that, so the badge component must
-- keep its existing STAGE_CLASSES map for telematics keys and fall back to this
-- column only for the new departments. Otherwise the telematics UI changes
-- appearance, which section 10 forbids.
-- ============================================================================

INSERT INTO funnel_stages (department_id, key, label, sort_order, color, is_active_stage, is_won, is_terminal)
SELECT d.id, v.key, v.label, v.sort_order, v.color, v.is_active_stage, v.is_won, v.is_terminal
FROM departments d
CROSS JOIN (VALUES
  ('new',         'New',          1,  'slate',   TRUE,  FALSE, FALSE),
  ('contacted',   'Contacted',    2,  'blue',    TRUE,  FALSE, FALSE),
  ('interested',  'Interested',   3,  'cyan',    TRUE,  FALSE, FALSE),
  ('quote_sent',  'Quote Sent',   4,  'violet',  TRUE,  FALSE, FALSE),
  ('negotiating', 'Negotiating',  5,  'amber',   TRUE,  FALSE, FALSE),
  ('won',         'Won',          6,  'green',   TRUE,  TRUE,  FALSE),
  ('installed',   'Installed',    7,  'green',   TRUE,  FALSE, FALSE),
  ('post_sale',   'Post-Sale',    8,  'teal',    TRUE,  FALSE, FALSE),
  ('sorted',      'Sorted',       9,  'purple',  TRUE,  FALSE, FALSE),
  ('renewal_due', 'Renewal Due',  10, 'orange',  TRUE,  FALSE, FALSE),
  ('renewed',     'Renewed',      11, 'emerald', FALSE, FALSE, FALSE),
  ('lost',        'Lost',         12, 'red',     FALSE, FALSE, TRUE),
  ('unqualified', 'Unqualified',  13, 'slate',   FALSE, FALSE, TRUE)
) AS v(key, label, sort_order, color, is_active_stage, is_won, is_terminal)
WHERE d.slug = 'telematics'
ON CONFLICT (department_id, key) DO NOTHING;

-- ---- container_eseal --------------------------------------------------------
INSERT INTO funnel_stages (department_id, key, label, sort_order, color, is_active_stage, is_won, is_terminal)
SELECT d.id, v.key, v.label, v.sort_order, v.color, v.is_active_stage, v.is_won, v.is_terminal
FROM departments d
CROSS JOIN (VALUES
  ('new',             'New',              1,  'slate',   TRUE,  FALSE, FALSE),
  ('contacted',       'Contacted',        2,  'blue',    TRUE,  FALSE, FALSE),
  ('qualified',       'Qualified',        3,  'cyan',    TRUE,  FALSE, FALSE),
  ('site_visit',      'Site Visit',       4,  'sky',     TRUE,  FALSE, FALSE),
  ('proposal_sent',   'Proposal Sent',    5,  'violet',  TRUE,  FALSE, FALSE),
  ('negotiating',     'Negotiating',      6,  'amber',   TRUE,  FALSE, FALSE),
  ('won',             'Won',              7,  'green',   TRUE,  TRUE,  FALSE),
  ('contract_signed', 'Contract Signed',  8,  'green',   TRUE,  FALSE, FALSE),
  ('seals_delivered', 'Seals Delivered',  9,  'teal',    TRUE,  FALSE, FALSE),
  ('active_account',  'Active Account',   10, 'emerald', TRUE,  FALSE, FALSE),
  ('reorder_due',     'Reorder Due',      11, 'orange',  TRUE,  FALSE, FALSE),
  ('dormant',         'Dormant',          12, 'zinc',    FALSE, FALSE, TRUE),
  ('lost',            'Lost',             13, 'red',     FALSE, FALSE, TRUE),
  ('unqualified',     'Unqualified',      14, 'slate',   FALSE, FALSE, TRUE)
) AS v(key, label, sort_order, color, is_active_stage, is_won, is_terminal)
WHERE d.slug = 'container_eseal'
ON CONFLICT (department_id, key) DO NOTHING;

-- ---- fuel_monitoring --------------------------------------------------------
INSERT INTO funnel_stages (department_id, key, label, sort_order, color, is_active_stage, is_won, is_terminal)
SELECT d.id, v.key, v.label, v.sort_order, v.color, v.is_active_stage, v.is_won, v.is_terminal
FROM departments d
CROSS JOIN (VALUES
  ('new',                    'New',                    1,  'slate',   TRUE,  FALSE, FALSE),
  ('contacted',              'Contacted',              2,  'blue',    TRUE,  FALSE, FALSE),
  ('qualified',              'Qualified',              3,  'cyan',    TRUE,  FALSE, FALSE),
  ('demo_scheduled',         'Demo Scheduled',         4,  'sky',     TRUE,  FALSE, FALSE),
  ('proposal_sent',          'Proposal Sent',          5,  'violet',  TRUE,  FALSE, FALSE),
  ('negotiating',            'Negotiating',            6,  'amber',   TRUE,  FALSE, FALSE),
  ('won',                    'Won',                    7,  'green',   TRUE,  TRUE,  FALSE),
  ('contract_signed',        'Contract Signed',        8,  'green',   TRUE,  FALSE, FALSE),
  ('installation_scheduled', 'Installation Scheduled', 9,  'teal',    TRUE,  FALSE, FALSE),
  ('installed',              'Installed',              10, 'teal',    TRUE,  FALSE, FALSE),
  ('active_subscription',    'Active Subscription',    11, 'emerald', TRUE,  FALSE, FALSE),
  ('renewal_due',            'Renewal Due',            12, 'orange',  TRUE,  FALSE, FALSE),
  ('renewed',                'Renewed',                13, 'emerald', FALSE, FALSE, FALSE),
  ('lost',                   'Lost',                   14, 'red',     FALSE, FALSE, TRUE),
  ('unqualified',            'Unqualified',            15, 'slate',   FALSE, FALSE, TRUE)
) AS v(key, label, sort_order, color, is_active_stage, is_won, is_terminal)
WHERE d.slug = 'fuel_monitoring'
ON CONFLICT (department_id, key) DO NOTHING;

-- ---- school_bus -------------------------------------------------------------
-- Committee-shaped: the extra stages exist because a school decision stalls at
-- board review, not at price. `dormant` means a school that let a term lapse but
-- is not lost -- they come back next term. Terminal for RAG purposes, but
-- visible as its own filter.
INSERT INTO funnel_stages (department_id, key, label, sort_order, color, is_active_stage, is_won, is_terminal)
SELECT d.id, v.key, v.label, v.sort_order, v.color, v.is_active_stage, v.is_won, v.is_terminal
FROM departments d
CROSS JOIN (VALUES
  ('new',                    'New',                    1,  'slate',   TRUE,  FALSE, FALSE),
  ('contacted',              'Contacted',              2,  'blue',    TRUE,  FALSE, FALSE),
  ('qualified',              'Qualified',              3,  'cyan',    TRUE,  FALSE, FALSE),
  ('school_visit',           'School Visit',           4,  'sky',     TRUE,  FALSE, FALSE),
  ('demo_presented',         'Demo Presented',         5,  'sky',     TRUE,  FALSE, FALSE),
  ('proposal_sent',          'Proposal Sent',          6,  'violet',  TRUE,  FALSE, FALSE),
  ('board_review',           'Board Review',           7,  'indigo',  TRUE,  FALSE, FALSE),
  ('negotiating',            'Negotiating',            8,  'amber',   TRUE,  FALSE, FALSE),
  ('won',                    'Won',                    9,  'green',   TRUE,  TRUE,  FALSE),
  ('contract_signed',        'Contract Signed',        10, 'green',   TRUE,  FALSE, FALSE),
  ('installation_scheduled', 'Installation Scheduled', 11, 'teal',    TRUE,  FALSE, FALSE),
  ('buses_installed',        'Buses Installed',        12, 'teal',    TRUE,  FALSE, FALSE),
  ('active_service',         'Active Service',         13, 'emerald', TRUE,  FALSE, FALSE),
  ('term_renewal_due',       'Term Renewal Due',       14, 'orange',  TRUE,  FALSE, FALSE),
  ('renewed',                'Renewed',                15, 'emerald', FALSE, FALSE, FALSE),
  ('dormant',                'Dormant',                16, 'zinc',    FALSE, FALSE, TRUE),
  ('lost',                   'Lost',                   17, 'red',     FALSE, FALSE, TRUE),
  ('unqualified',            'Unqualified',            18, 'slate',   FALSE, FALSE, TRUE)
) AS v(key, label, sort_order, color, is_active_stage, is_won, is_terminal)
WHERE d.slug = 'school_bus'
ON CONFLICT (department_id, key) DO NOTHING;

-- ============================================================================
-- 2. KYC FIELDS
--
-- Telematics first. Section 7.4 requires the telematics KYC block to become the
-- same dynamic renderer as everyone else, "so there is exactly one code path".
--
-- IMPORTANT for Sprint D4: these four telematics keys are NOT JSONB keys. They
-- are native columns on `leads` (full_name, location, vehicle_type,
-- product_interested), which CallLogModal writes directly today. The dynamic
-- renderer must treat a known set of promoted keys as columns rather than
-- writing them into leads.kyc -- the same pattern the spec already uses for
-- company_name. If the renderer blindly writes these into leads.kyc, the
-- telematics team's names and locations stop appearing in the leads table and
-- in reports, while looking fine in the modal.
-- ============================================================================

INSERT INTO kyc_fields (department_id, key, label, field_type, options, is_required, sort_order, show_in_table, help_text)
SELECT d.id, v.key, v.label, v.field_type, v.options::jsonb, v.is_required, v.sort_order, v.show_in_table, v.help_text
FROM departments d
CROSS JOIN (VALUES
  ('full_name',          'Full Name',    'text', NULL, FALSE, 1, TRUE,  'Stored on leads.full_name, not in leads.kyc'),
  ('location',           'Location',     'text', NULL, FALSE, 2, FALSE, 'Stored on leads.location, not in leads.kyc'),
  ('vehicle_type',       'Vehicle Type', 'text', NULL, FALSE, 3, TRUE,  'Stored on leads.vehicle_type, not in leads.kyc'),
  ('product_interested', 'Product',      'select', NULL, FALSE, 4, TRUE, 'Stored on leads.product_interested; options come from department_products')
) AS v(key, label, field_type, options, is_required, sort_order, show_in_table, help_text)
WHERE d.slug = 'telematics'
ON CONFLICT (department_id, key) DO NOTHING;

-- ---- shared B2B core, for container_eseal and fuel_monitoring ---------------
INSERT INTO kyc_fields (department_id, key, label, field_type, options, is_required, sort_order, show_in_table)
SELECT d.id, v.key, v.label, v.field_type, v.options::jsonb, v.is_required, v.sort_order, v.show_in_table
FROM departments d
CROSS JOIN (VALUES
  ('company_name',      'Company Name',                  'text',    NULL, TRUE,  1, TRUE),
  ('contact_person',    'Contact Person',                'text',    NULL, TRUE,  2, TRUE),
  ('contact_role',      'Role / Title',                  'text',    NULL, FALSE, 3, FALSE),
  ('alt_phone',         'Alternative Phone',             'phone',   NULL, FALSE, 4, FALSE),
  ('email',             'Email',                         'email',   NULL, FALSE, 5, FALSE),
  ('physical_location', 'Physical Location / Town',      'text',    NULL, TRUE,  6, TRUE),
  ('kra_pin',           'KRA PIN',                       'text',    NULL, FALSE, 7, FALSE),
  ('decision_maker',    'Is this the decision maker?',   'boolean', NULL, FALSE, 8, FALSE),
  ('how_heard',         'How did they hear about us?',   'select',
     '["Referral","Walk-in","Cold call","Social media","Existing client","Other"]', FALSE, 9, FALSE)
) AS v(key, label, field_type, options, is_required, sort_order, show_in_table)
WHERE d.slug IN ('container_eseal', 'fuel_monitoring')
ON CONFLICT (department_id, key) DO NOTHING;

-- ---- shared B2B core, school_bus wording ------------------------------------
-- Same keys, department-appropriate labels: one code path, different words.
INSERT INTO kyc_fields (department_id, key, label, field_type, options, is_required, sort_order, show_in_table)
SELECT d.id, v.key, v.label, v.field_type, v.options::jsonb, v.is_required, v.sort_order, v.show_in_table
FROM departments d
CROSS JOIN (VALUES
  ('company_name',      'School Name',                                  'text',    NULL, TRUE,  1, TRUE),
  ('contact_person',    'Contact Person (Director / Transport Manager)','text',    NULL, TRUE,  2, TRUE),
  ('contact_role',      'Role / Title',                                 'text',    NULL, FALSE, 3, FALSE),
  ('alt_phone',         'Alternative Phone',                            'phone',   NULL, FALSE, 4, FALSE),
  ('email',             'Email',                                        'email',   NULL, FALSE, 5, FALSE),
  ('physical_location', 'Physical Location / Town',                     'text',    NULL, TRUE,  6, TRUE),
  ('kra_pin',           'KRA PIN',                                      'text',    NULL, FALSE, 7, FALSE),
  ('decision_maker',    'Is this the decision maker?',                  'boolean', NULL, FALSE, 8, FALSE),
  ('how_heard',         'How did they hear about us?',                  'select',
     '["Referral","Walk-in","Cold call","Social media","Existing client","Other"]', FALSE, 9, FALSE)
) AS v(key, label, field_type, options, is_required, sort_order, show_in_table)
WHERE d.slug = 'school_bus'
ON CONFLICT (department_id, key) DO NOTHING;

-- ---- container_eseal, additional -------------------------------------------
INSERT INTO kyc_fields (department_id, key, label, field_type, options, is_required, sort_order, show_in_table)
SELECT d.id, v.key, v.label, v.field_type, v.options::jsonb, v.is_required, v.sort_order, v.show_in_table
FROM departments d
CROSS JOIN (VALUES
  ('business_type',            'Business Type',              'select',
     '["Transporter","Clearing & Forwarding Agent","CFS / Container Depot","Importer / Exporter","Shipping Line","Other"]', FALSE, 10, TRUE),
  ('fleet_size',               'Number of Trucks',           'number', NULL, FALSE, 11, FALSE),
  ('routes_served',            'Routes Served',              'multiselect',
     '["Mombasa-Nairobi","Mombasa-Kampala","Mombasa-Kigali","Mombasa-Juba","Nairobi-Kisumu","Local","Other"]', FALSE, 12, FALSE),
  ('cargo_type',               'Typical Cargo',              'text',   NULL, FALSE, 13, FALSE),
  ('monthly_container_volume', 'Containers Handled / Month', 'number', NULL, FALSE, 14, TRUE),
  ('current_seal_supplier',    'Current Seal Supplier',      'text',   NULL, FALSE, 15, FALSE),
  ('seal_type_used',           'Seal Type Currently Used',   'select',
     '["Bolt seal","Cable seal","Electronic seal","None","Other"]', FALSE, 16, FALSE)
) AS v(key, label, field_type, options, is_required, sort_order, show_in_table)
WHERE d.slug = 'container_eseal'
ON CONFLICT (department_id, key) DO NOTHING;

-- ---- fuel_monitoring, additional -------------------------------------------
INSERT INTO kyc_fields (department_id, key, label, field_type, options, is_required, sort_order, show_in_table)
SELECT d.id, v.key, v.label, v.field_type, v.options::jsonb, v.is_required, v.sort_order, v.show_in_table
FROM departments d
CROSS JOIN (VALUES
  ('fleet_size',           'Fleet Size',              'number', NULL, FALSE, 10, TRUE),
  ('vehicle_types',        'Vehicle / Asset Types',   'multiselect',
     '["Trucks","Buses","Tankers","Generators","Static tanks","Earth movers","Other"]', FALSE, 11, FALSE),
  ('tank_capacity_litres', 'Tank Capacity (litres)',  'number', NULL, FALSE, 12, FALSE),
  ('static_tank_count',    'Number of Static Tanks',  'number', NULL, FALSE, 13, FALSE),
  ('monthly_fuel_spend',   'Monthly Fuel Spend (KES)','number', NULL, FALSE, 14, TRUE),
  ('current_fuel_system',  'Existing Fuel System',    'select',
     '["None","Manual logbook","Fuel cards","Competitor telematics","Other"]', FALSE, 15, FALSE),
  ('primary_pain_point',   'Primary Pain Point',      'select',
     '["Fuel theft","Reconciliation","Consumption reporting","Driver behaviour","Compliance","Other"]', FALSE, 16, FALSE),
  ('has_existing_gps',     'Already has GPS tracking?','boolean', NULL, FALSE, 17, FALSE)
) AS v(key, label, field_type, options, is_required, sort_order, show_in_table)
WHERE d.slug = 'fuel_monitoring'
ON CONFLICT (department_id, key) DO NOTHING;

-- ---- school_bus, additional -------------------------------------------------
-- NOTE: bus_count here is the KYC *claim* at inquiry. The school_buses table is
-- the *verified register* built during installation. Do not conflate them:
-- quote from the claim, bill from the register.
INSERT INTO kyc_fields (department_id, key, label, field_type, options, is_required, sort_order, show_in_table, help_text)
SELECT d.id, v.key, v.label, v.field_type, v.options::jsonb, v.is_required, v.sort_order, v.show_in_table, v.help_text
FROM departments d
CROSS JOIN (VALUES
  ('school_type',         'School Type',              'select',
     '["Private","Public / Government","International","Faith-based","Academy / Chain"]', FALSE, 10, TRUE, NULL),
  ('school_level',        'Levels Served',            'multiselect',
     '["ECD / Kindergarten","Primary","Junior Secondary","Secondary","Mixed"]', FALSE, 11, FALSE, NULL),
  ('student_population',  'Student Population',       'number', NULL, FALSE, 12, FALSE, NULL),
  ('bus_count',           'Number of School Buses',   'number', NULL, FALSE, 13, TRUE,
     'The number the school claims at inquiry. Quote from this; bill from the verified bus register.'),
  ('bus_ownership',       'Buses Owned or Hired',     'select',
     '["School-owned","Hired / contracted","Mixed"]', FALSE, 14, FALSE, NULL),
  ('existing_tracking',   'Existing Tracking',        'select',
     '["None","Basic GPS","Competitor platform","Other"]', FALSE, 15, FALSE, NULL),
  ('parent_app_interest', 'Wants the Parent App?',    'boolean', NULL, FALSE, 16, FALSE, NULL),
  ('decision_body',       'Who Approves the Purchase','select',
     '["Director / Proprietor","Board of Management","PTA","Transport Committee","County Education Office"]', FALSE, 17, TRUE, NULL),
  ('budget_cycle',        'Budget Cycle',             'select',
     '["Term 1","Term 2","Term 3","Annual (January)","Ad hoc"]', FALSE, 18, FALSE, NULL),
  ('procurement_route',   'Procurement Route',        'select',
     '["Direct","Quotation","Tender"]', FALSE, 19, FALSE, NULL),
  ('key_concern',         'Primary Concern',          'select',
     '["Student safety","Parent communication","Route efficiency","Driver behaviour","Fuel / cost control","NTSA compliance","Other"]', FALSE, 20, FALSE, NULL)
) AS v(key, label, field_type, options, is_required, sort_order, show_in_table, help_text)
WHERE d.slug = 'school_bus'
ON CONFLICT (department_id, key) DO NOTHING;

-- ============================================================================
-- 3. PRODUCTS
--
-- Telematics: the existing PRODUCTS array from types/crm.ts, verbatim, in order.
-- These 13 must all exist or the telematics team's product dropdown and their
-- historical leads lose their values (section 6.3 coverage check).
-- ============================================================================

INSERT INTO department_products (department_id, name, sort_order)
SELECT d.id, v.name, v.sort_order
FROM departments d
CROSS JOIN (VALUES
  ('Fuel Monitoring Solution',   1),
  ('Hybrid Car Alarm',           2),
  ('Hybrid Pro Max Alarm',       3),
  ('Hybrid Pro Max Plus Alarm',  4),
  ('Hybrid Car Tracker',         5),
  ('Hybrid Pro Tracker',         6),
  ('Hybrid Pro Max Tracker',     7),
  ('Vehicle Video Telematics',   8),
  ('Hybrid Dash Cam',            9),
  ('Recovery Tracker',           10),
  ('Bluetooth Tracker',          11),
  ('Anti-Jammer Tracker',        12),
  ('Other (specify)',            13)
) AS v(name, sort_order)
WHERE d.slug = 'telematics'
ON CONFLICT (department_id, name) DO NOTHING;

-- Legacy value. Four production leads carry product_interested = '' -- an empty
-- string, not NULL. Section 6.3 is explicit that in this situation the data is
-- correct and the config is incomplete: "add the missing values to the
-- telematics config as is_active = false legacy entries ... Do NOT edit the
-- lead rows to match the config."
--
-- is_active = FALSE keeps it out of every dropdown while letting those four
-- historical leads keep rendering, and lets the section 6.3 coverage query
-- return zero rows as it must.
INSERT INTO department_products (department_id, name, is_active, sort_order)
SELECT d.id, '', FALSE, 999
FROM departments d
WHERE d.slug = 'telematics'
ON CONFLICT (department_id, name) DO NOTHING;

-- ---- container_eseal --------------------------------------------------------
INSERT INTO department_products (department_id, name, sort_order)
SELECT d.id, v.name, v.sort_order
FROM departments d
CROSS JOIN (VALUES
  ('Single-Use Bolt Seal',                 1),
  ('Cable Seal',                           2),
  ('Electronic Container Seal (E-Seal)',   3),
  ('RFID Container Seal',                  4),
  ('GPS Container Tracker / Smart Lock',   5),
  ('Seal Monitoring Platform Subscription',6),
  ('Other (specify)',                      7)
) AS v(name, sort_order)
WHERE d.slug = 'container_eseal'
ON CONFLICT (department_id, name) DO NOTHING;

-- ---- fuel_monitoring --------------------------------------------------------
INSERT INTO department_products (department_id, name, sort_order)
SELECT d.id, v.name, v.sort_order
FROM departments d
CROSS JOIN (VALUES
  ('Capacitive Fuel Level Sensor',        1),
  ('Ultrasonic Fuel Sensor',              2),
  ('Fuel Flow Meter',                     3),
  ('Generator Fuel Monitoring Kit',       4),
  ('Static Tank Monitoring',              5),
  ('Fuel Management Software Subscription',6),
  ('Fuel + GPS Bundle',                   7),
  ('Other (specify)',                     8)
) AS v(name, sort_order)
WHERE d.slug = 'fuel_monitoring'
ON CONFLICT (department_id, name) DO NOTHING;

-- ---- school_bus -------------------------------------------------------------
-- Its own catalogue, not the telematics SKUs: a school buys "GPS Bus Tracking",
-- not "Hybrid Car Tracker", and reporting must not merge the two.
INSERT INTO department_products (department_id, name, sort_order)
SELECT d.id, v.name, v.sort_order
FROM departments d
CROSS JOIN (VALUES
  ('GPS Bus Tracking',                       1),
  ('Parent Notification App',                2),
  ('RFID / Student Boarding Cards',          3),
  ('In-Bus CCTV',                            4),
  ('Speed Governor',                         5),
  ('Driver Behaviour Monitoring',            6),
  ('Panic / SOS Button',                     7),
  ('School Bus Management Platform Subscription', 8),
  ('Other (specify)',                        9)
) AS v(name, sort_order)
WHERE d.slug = 'school_bus'
ON CONFLICT (department_id, name) DO NOTHING;

-- ============================================================================
-- 4. ACADEMIC TERMS -- deliberately EMPTY
--
-- Kelvin's decision (2026-09-20): seed nothing. Real Kenyan term dates are
-- keyed in through the Admin term-calendar editor in Sprint D6. The prompt
-- forbids inventing them.
--
-- Everything School Bus must therefore degrade gracefully on an empty calendar:
-- no holiday hold, no auto-generated billings, and a visible "term calendar not
-- configured" notice rather than an exception.
-- ============================================================================

-- ============================================================================
-- 5. CONFIG COVERAGE CHECKS  (section 6.3)
--
-- Every funnel_stage and product_interested value that exists in live data must
-- have a matching config row, or the telematics team's badges and dropdowns
-- lose their values the moment the new app deploys. These raise rather than
-- return rows, so a dry-run that completes has proved coverage.
-- ============================================================================

DO $$
DECLARE v_bad INT; v_list TEXT;
BEGIN
  SELECT count(*), string_agg(DISTINCT l.funnel_stage, ', ')
    INTO v_bad, v_list
  FROM leads l
  LEFT JOIN funnel_stages f
         ON f.department_id = l.department_id AND f.key = l.funnel_stage
  WHERE f.id IS NULL;
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'funnel_stage values with no config row: % (% leads affected)', v_list, v_bad;
  END IF;
  RAISE NOTICE 'OK: every funnel_stage in live data has a funnel_stages row';

  SELECT count(*), string_agg(DISTINCT coalesce(l.product_interested, '<null>'), ', ')
    INTO v_bad, v_list
  FROM leads l
  LEFT JOIN department_products p
         ON p.department_id = l.department_id AND p.name = l.product_interested
  WHERE l.product_interested IS NOT NULL AND p.id IS NULL;
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'product_interested values with no config row: % (% leads affected)', v_list, v_bad;
  END IF;
  RAISE NOTICE 'OK: every product_interested in live data has a department_products row';

  -- The ten telematics stages that rag_auto_flag v1 treats as active.
  SELECT count(*) INTO v_bad
  FROM funnel_stages f JOIN departments d ON d.id = f.department_id
  WHERE d.slug = 'telematics' AND f.is_active_stage;
  IF v_bad <> 10 THEN
    RAISE EXCEPTION 'telematics has % active stages, expected 10 to match rag_auto_flag v1', v_bad;
  END IF;
  RAISE NOTICE 'OK: telematics has exactly 10 active stages, matching rag_auto_flag v1';
END $$;

-- ============================================================================
-- ROLLBACK
-- DELETE FROM kyc_fields;
-- DELETE FROM department_products;
-- DELETE FROM funnel_stages;
-- (Safe: no lead, call log or sale references these. The departments rows
--  themselves are removed by 009's rollback block.)
-- ============================================================================
