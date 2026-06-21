# Claude Code Prompt — Nebsam Digital Solutions CRM

## PROJECT OVERVIEW

Build a full-stack CRM system called **Nebsam CRM** for a digital marketing company that runs Meta and TikTok ad campaigns directing leads to a WhatsApp BSP chatbot. Three telemarketers use the system to manage leads from first inquiry through to post-sale annual renewal follow-ups.

---

## TECH STACK

- **Frontend:** Next.js 14 (App Router) with TypeScript
- **Backend/DB:** Supabase (PostgreSQL + Realtime + Edge Functions)
- **Styling:** Tailwind CSS + shadcn/ui component library
- **State Management:** Zustand
- **Tables/Grids:** TanStack Table v8
- **Forms:** React Hook Form + Zod validation
- **Date Handling:** date-fns
- **Icons:** Lucide React
- **Notifications/Toasts:** Sonner

---

## DATABASE SCHEMA (Supabase / PostgreSQL)

Create the following tables. Generate the full SQL migration file.

### `telemarketers`
```sql
id UUID PRIMARY KEY DEFAULT gen_random_uuid()
full_name TEXT NOT NULL
email TEXT UNIQUE NOT NULL
phone TEXT
created_at TIMESTAMPTZ DEFAULT now()
```

### `leads`
```sql
id UUID PRIMARY KEY DEFAULT gen_random_uuid()
phone_number TEXT NOT NULL UNIQUE          -- WhatsApp number from BSP webhook
assigned_to UUID REFERENCES telemarketers(id)
full_name TEXT
location TEXT                              -- City/town/estate
vehicle_type TEXT                          -- e.g. Toyota Prado, Nissan X-Trail, Subaru Forester
product_interested TEXT                    -- See PRODUCT LIST below
lead_source TEXT DEFAULT 'whatsapp_bot'    -- whatsapp_bot | meta_ads | tiktok_ads | referral | manual
funnel_stage TEXT DEFAULT 'new'            -- See FUNNEL STAGES below
rag_status TEXT DEFAULT 'cold'            -- red | amber | green
campaign_name TEXT                         -- e.g. "May 2025 Fuel Monitor Push"
whatsapp_message TEXT                      -- First message/inquiry from chatbot
created_at TIMESTAMPTZ DEFAULT now()
updated_at TIMESTAMPTZ DEFAULT now()
```

### `call_logs`
```sql
id UUID PRIMARY KEY DEFAULT gen_random_uuid()
lead_id UUID REFERENCES leads(id) ON DELETE CASCADE
telemarketer_id UUID REFERENCES telemarketers(id)
called_at TIMESTAMPTZ DEFAULT now()
duration_seconds INT
call_outcome TEXT                          -- answered | no_answer | busy | callback_requested | wrong_number
call_notes TEXT                            -- Free-form feedback from the call
next_followup_date DATE
next_followup_notes TEXT
rag_status_after_call TEXT                 -- red | amber | green
funnel_stage_after_call TEXT
created_at TIMESTAMPTZ DEFAULT now()
```

### `sales`
```sql
id UUID PRIMARY KEY DEFAULT gen_random_uuid()
lead_id UUID REFERENCES leads(id) ON DELETE CASCADE
telemarketer_id UUID REFERENCES telemarketers(id)
product TEXT NOT NULL
sale_amount DECIMAL(10,2)
currency TEXT DEFAULT 'KES'
installation_date DATE
installation_location TEXT
sale_date DATE DEFAULT CURRENT_DATE
vehicle_registration TEXT
serial_number TEXT                        -- Device/unit serial number
subscription_type TEXT DEFAULT 'annual'  -- annual | once_off
renewal_due_date DATE                    -- Calculated as installation_date + 1 year
renewal_reminder_sent BOOLEAN DEFAULT FALSE
notes TEXT
created_at TIMESTAMPTZ DEFAULT now()
```

### `followup_schedule`
```sql
id UUID PRIMARY KEY DEFAULT gen_random_uuid()
lead_id UUID REFERENCES leads(id) ON DELETE CASCADE
sale_id UUID REFERENCES sales(id)        -- NULL if pre-sale follow-up
telemarketer_id UUID REFERENCES telemarketers(id)
followup_type TEXT                        -- pre_sale | post_sale_renewal | check_in
scheduled_date DATE NOT NULL
notes TEXT
status TEXT DEFAULT 'pending'            -- pending | completed | missed | rescheduled
completed_at TIMESTAMPTZ
created_at TIMESTAMPTZ DEFAULT now()
```

### `webhook_events`
```sql
id UUID PRIMARY KEY DEFAULT gen_random_uuid()
raw_payload JSONB NOT NULL
phone_number TEXT
processed BOOLEAN DEFAULT FALSE
lead_id UUID REFERENCES leads(id)
received_at TIMESTAMPTZ DEFAULT now()
```

---

## PRODUCT LIST (use as a dropdown/select enum)

```
- Fuel Monitoring Solution
- Hybrid Car Alarm
- Hybrid Car Tracker
- Vehicle Video Telematics
- Hybrid Dash Cam
- Recovery Tracker
- Bluetooth Tracker
- Anti-Jammer Tracker
- Other (specify)
```

---

## FUNNEL STAGES

Map these stages as a sequential pipeline. Each lead must be moved forward manually by the telemarketer.

```
1. new              → Lead just arrived from WhatsApp bot, not yet called
2. contacted        → First call made, conversation started
3. interested       → Client confirmed interest, gathering more info/KYC
4. quote_sent       → Price/quote has been communicated
5. negotiating      → Client is negotiating or thinking it over
6. won              → Sale confirmed and closed
7. installed        → Product physically installed
8. post_sale        → After-sales monitoring phase
9. renewal_due      → Annual renewal coming up (within 60 days)
10. renewed         → Renewal payment received
11. lost            → Lead dropped off / not interested
12. unqualified     → Wrong number, not a fit, duplicate
```

---

## RAG STATUS LOGIC

- **GREEN** 🟢 — High intent: actively engaging, quote accepted, or renewal confirmed
- **AMBER** 🟡 — Moderate: interested but undecided, follow-up scheduled, renewal reminder sent
- **RED** 🔴 — Cold: no answer (3+ attempts), said no, or overdue follow-up with no contact

Telemarketers manually assign RAG status after each call. The system also auto-flags:
- RED if a lead has had no call activity for 14+ days and is not `won`, `lost`, or `unqualified`
- RED if a renewal is overdue (past `renewal_due_date`) and status is still `renewal_due`
- AMBER if `next_followup_date` is today or tomorrow

---

## APPLICATION PAGES & FEATURES

### 1. `/dashboard` — Telemarketer Home Dashboard

This is the first page after selecting a telemarketer (no auth yet — just a telemarketer picker on load).

Display:
- Greeting with telemarketer name
- **My Stats Cards:** Total Leads, Calls Today, Follow-ups Due Today, Sales This Month
- **Follow-Ups Due Today** — compact list of leads with scheduled follow-ups today, each with a "Call Now" button
- **RAG Summary** — Count of Green / Amber / Red leads assigned to this telemarketer
- **Recent Activity** — Last 5 call logs made by this telemarketer
- **Upcoming Renewals** — Clients with `renewal_due_date` within 60 days

### 2. `/leads` — My Leads Queue

A full paginated, sortable, filterable table of leads assigned to the logged-in telemarketer.

Columns:
- Phone Number (clickable — opens Lead Detail)
- Name (may be blank until KYC filled)
- Product Interested
- Funnel Stage (badge with color)
- RAG Status (colored dot)
- Last Called (date)
- Next Follow-up (date, red if overdue)
- Assigned To
- Actions: [Call Now] [View] [Edit]

Filters:
- By RAG status (Red / Amber / Green)
- By funnel stage
- By product
- By follow-up date range
- Search by name or phone

Clicking **[Call Now]** button:
- Marks the lead as "in call" (optimistic UI update)
- Opens the Call Log Modal (see below)
- Displays the lead's full KYC and previous call history in a side panel

### 3. `/leads/[id]` — Lead Detail Page

Full lead profile page with tabs:

**Tab 1: KYC & Profile**
- Editable fields: Full Name, Phone, Location, Vehicle Type, Product Interested, Campaign Name, Lead Source
- First WhatsApp message shown as read-only quote block
- Assigned telemarketer (admin can reassign)

**Tab 2: Call History**
- Timeline of all call logs for this lead, newest first
- Each entry shows: Date/time, Telemarketer, Outcome, Duration, Notes, RAG status set, Next Follow-up scheduled

**Tab 3: Sale Details** (visible only when funnel stage is `won` or beyond)
- Sale record form: Product, Amount (KES), Sale Date, Installation Date, Installation Location, Vehicle Reg, Serial Number, Renewal Due Date (auto-calculated)

**Tab 4: Follow-up Schedule**
- List of all scheduled follow-ups (pre-sale and post-sale renewals)
- Status badge: Pending / Completed / Missed
- Add new follow-up button

**Funnel Stage Selector** — Always visible at top of page. Dropdown or stepper to move the lead through funnel stages. Changing stage triggers a confirmation prompt.

**RAG Badge** — Color-coded pill always visible at top of page. Clickable to manually override.

### 4. Call Log Modal (triggered from [Call Now] button)

A modal/drawer that opens over the current page. Fields:

```
- Call Outcome* (dropdown): Answered | No Answer | Busy | Callback Requested | Wrong Number
- Call Duration (minutes:seconds input)
- Call Notes* (textarea — what did client say? What was discussed?)
- Update KYC during call? (toggle — expands KYC fields inline if yes)
- Update Funnel Stage? (dropdown — optional)
- Set RAG Status* (Red / Amber / Green toggle)
- Schedule Next Follow-up? (date picker + notes field)
- Save & Close button
```

On save:
- Creates a new `call_logs` record
- Updates `leads.funnel_stage` and `leads.rag_status` if changed
- Creates a `followup_schedule` record if follow-up date was set
- Updates `leads.updated_at`

### 5. `/admin` — Admin Panel

Accessible by switching to an Admin view (no auth yet, just a toggle).

Features:
- **Lead Assignment** — Table of all unassigned leads + bulk assign to telemarketer
- **Telemarketer Management** — Add / edit / deactivate telemarketers
- **Lead Import** — CSV upload to bulk-import leads with column mapping UI
- **Campaign Tags** — Manage campaign name labels used in leads
- **All Leads Overview** — Full leads table with all telemarketers visible
- **Performance Summary** — Table: Telemarketer | Calls Made | Leads Won | Conversion Rate | Renewals Due

### 6. `/renewals` — Renewal Management

A dedicated page for post-sale follow-up management.

Table columns:
- Client Name
- Phone
- Product
- Installation Date
- Renewal Due Date
- Days Until Renewal (color: green >60 days, amber 30-60, red <30 or overdue)
- Telemarketer Assigned
- Renewal Status (Pending / Reminded / Renewed / Churned)
- Actions: [Call Now] [Mark Renewed] [Mark Churned]

Filter by: telemarketer, product, renewal month, status

### 7. WhatsApp Webhook Endpoint

Create a Supabase Edge Function at `POST /functions/v1/whatsapp-webhook` that:

1. Receives incoming webhook payload from the WhatsApp BSP
2. Stores raw payload in `webhook_events`
3. Extracts phone number and first message
4. Checks if a lead with that phone number already exists:
   - If **new number**: creates a new lead record with `funnel_stage = 'new'`, `rag_status = 'amber'`, `lead_source = 'whatsapp_bot'`
   - If **existing number**: appends a note to the existing lead and updates `updated_at`
5. Marks `webhook_events.processed = true`
6. Returns HTTP 200

---

## UI/UX DESIGN REQUIREMENTS

- **Color palette:** Dark navy sidebar (`#0F1729`), white content area, accent color electric blue (`#2563EB`), RAG colors: green `#16A34A`, amber `#D97706`, red `#DC2626`
- **Font:** Geist (Next.js default) for UI, monospace for phone numbers
- **Sidebar navigation:** Fixed left sidebar with icons + labels. Items: Dashboard, My Leads, Renewals, Admin (at bottom)
- **Telemarketer switcher:** Top-right of header — a simple avatar dropdown to switch between telemarketers (simulates login until auth is added)
- **Mobile responsive:** Sidebar collapses to bottom tab bar on mobile
- **Empty states:** Every empty table/list must have a meaningful empty state illustration and message
- **Loading states:** Skeleton loaders for all data tables and cards
- **Optimistic UI:** Call log saves should feel instant, sync in background

---

## FILE STRUCTURE

```
nebsam-crm/
├── app/
│   ├── layout.tsx
│   ├── page.tsx                        → redirects to /dashboard
│   ├── dashboard/page.tsx
│   ├── leads/
│   │   ├── page.tsx                    → leads table
│   │   └── [id]/page.tsx              → lead detail
│   ├── renewals/page.tsx
│   ├── admin/page.tsx
│   └── api/
│       └── webhook/whatsapp/route.ts  → Next.js API route (proxies to Supabase fn)
├── components/
│   ├── layout/
│   │   ├── Sidebar.tsx
│   │   ├── Header.tsx
│   │   └── TelemarketerSwitcher.tsx
│   ├── leads/
│   │   ├── LeadTable.tsx
│   │   ├── LeadFilters.tsx
│   │   ├── LeadDetailTabs.tsx
│   │   ├── CallLogModal.tsx
│   │   ├── FunnelStageBadge.tsx
│   │   └── RAGBadge.tsx
│   ├── dashboard/
│   │   ├── StatsCards.tsx
│   │   ├── FollowUpToday.tsx
│   │   ├── RAGSummary.tsx
│   │   └── UpcomingRenewals.tsx
│   ├── renewals/
│   │   └── RenewalTable.tsx
│   └── admin/
│       ├── LeadAssignment.tsx
│       ├── TelemarketerManager.tsx
│       └── CSVImport.tsx
├── lib/
│   ├── supabase/
│   │   ├── client.ts
│   │   ├── server.ts
│   │   └── types.ts                   → auto-generated Supabase types
│   ├── stores/
│   │   └── telemarketerStore.ts       → Zustand store for active telemarketer
│   └── utils/
│       ├── ragHelpers.ts              → RAG auto-flag logic
│       ├── funnelHelpers.ts
│       └── dateHelpers.ts
├── supabase/
│   ├── migrations/
│   │   └── 001_initial_schema.sql     → Full schema from above
│   └── functions/
│       └── whatsapp-webhook/
│           └── index.ts
├── types/
│   └── crm.ts                         → Shared TypeScript types
├── .env.local.example
└── README.md
```

---

## SEED DATA

Generate a seed script `supabase/seed.sql` that inserts:
- 3 telemarketers: **Sonnie**, **Janet**, and **Suzzie**
- 20 sample leads spread across all funnel stages, RAG statuses, and products
- 15 sample call logs across those leads
- 4 sales records with renewal dates
- 6 scheduled follow-ups (some pending, some missed)

---

## IMPLEMENTATION NOTES FOR CLAUDE CODE

1. Use **Server Components** for all data-fetching pages and **Client Components** only for interactive elements (modals, forms, filters).
2. Use **Supabase SSR client** (`@supabase/ssr`) for server-side queries and **browser client** for real-time subscriptions.
3. Set up **Supabase Realtime** on the `leads` table so that when a new webhook lead arrives, the telemarketer's leads queue updates instantly without a page refresh.
4. All monetary values are in **KES (Kenyan Shillings)** — format as `KES 12,500`.
5. All phone numbers should be stored and displayed in **international format** (+254XXXXXXXXX).
6. The `renewal_due_date` in the `sales` table should be **automatically calculated** as `installation_date + 365 days` when a sale is saved.
7. The RAG auto-flag logic should run as a **Supabase scheduled Edge Function** (cron) once per day at 8:00 AM EAT.
8. Use **row-level security (RLS)** policies in Supabase even though auth is not yet active — structure them so they can be activated later by uncommenting the auth checks.
9. Every table that supports it should have **optimistic updates** using Zustand or React Query mutation patterns.
10. Build the **CSV import** to handle WhatsApp export format (with columns: phone, name, date, message) as well as a generic format.

---

## DELIVERABLES CHECKLIST

Claude Code should produce, in order:

- [ ] `supabase/migrations/001_initial_schema.sql` — complete schema with RLS policies
- [ ] `supabase/seed.sql` — seed data
- [ ] `supabase/functions/whatsapp-webhook/index.ts` — webhook edge function
- [ ] `lib/supabase/types.ts` — TypeScript types matching schema
- [ ] `types/crm.ts` — app-level types (FunnelStage, RAGStatus, Product enums)
- [ ] All layout components (Sidebar, Header, TelemarketerSwitcher)
- [ ] Dashboard page with all widgets
- [ ] Leads table page with filters
- [ ] Lead detail page with all 4 tabs
- [ ] Call Log Modal (fully functional form)
- [ ] Renewals page
- [ ] Admin panel
- [ ] `README.md` with setup instructions and `.env.local.example`
