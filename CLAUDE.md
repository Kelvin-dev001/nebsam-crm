# Nebsam CRM — Project Memory

## Project Overview
A full-stack CRM system for **Nebsam Digital Solutions**, a Kenyan digital marketing company
running Meta and TikTok ad campaigns that direct leads into a WhatsApp BSP chatbot.
Three telemarketers (Edith, Janet, Suzzie) manage leads from first inquiry through to
annual renewal follow-ups.

## Tech Stack
- **Frontend:** Next.js 14 (App Router) with TypeScript
- **Backend/DB:** Supabase (PostgreSQL + Realtime + Edge Functions)
- **Styling:** Tailwind CSS + shadcn/ui
- **State Management:** Zustand
- **Tables:** TanStack Table v8
- **Forms:** React Hook Form + Zod
- **Date Handling:** date-fns
- **Icons:** Lucide React
- **Toasts:** Sonner

## Business Rules (Never Violate These)
- All currency in **KES (Kenyan Shillings)** — format as `KES 12,500`
- All phone numbers in **international format** (+254XXXXXXXXX)
- Telemarketers: **Edith, Janet, Suzzie**
- Lead source: WhatsApp BSP webhook (auto-push into CRM)
- Lead access: Each telemarketer sees **only their assigned leads**
- `renewal_due_date` = `installation_date + 365 days` (auto-calculated)
- RAG auto-flag cron runs daily at **8:00 AM EAT**

## RAG Status Logic
- 🟢 GREEN — High intent: actively engaging, quote accepted, renewal confirmed
- 🟡 AMBER — Moderate: interested but undecided, follow-up scheduled
- 🔴 RED — Cold: no answer 3+ times, said no, or overdue follow-up 14+ days

## Funnel Stages (in order)
new → contacted → interested → quote_sent → negotiating →
won → installed → post_sale → renewal_due → renewed → lost → unqualified

## Products (dropdown values)
Fuel Monitoring Solution, Hybrid Car Alarm, Hybrid Car Tracker,
Vehicle Video Telematics, Hybrid Dash Cam, Recovery Tracker,
Bluetooth Tracker, Anti-Jammer Tracker, Other (specify)

---

## Sprint Plan

### ✅ SPRINT 0 — Project Setup (Current)
- [ ] Initialize Next.js 14 project with TypeScript
- [ ] Install and configure all dependencies
- [ ] Set up Supabase project and connect environment variables
- [ ] Create folder structure as defined in the master prompt
- [ ] Set up Git and push initial commit to GitHub
- [ ] Confirm dev server runs with `npm run dev`

**Done when:** `localhost:3000` loads without errors.

---

### 🔲 SPRINT 1 — Database & Seed Data
- [ ] Write and run `supabase/migrations/001_initial_schema.sql`
- [ ] Create all 6 tables: telemarketers, leads, call_logs, sales, followup_schedule, webhook_events
- [ ] Add RLS policies (stubbed for future auth)
- [ ] Write and run `supabase/seed.sql` with Edith, Janet, Suzzie + 20 leads
- [ ] Generate `lib/supabase/types.ts` from schema
- [ ] Create `types/crm.ts` with all enums

**Done when:** All tables visible in Supabase dashboard with seed data.

---

### 🔲 SPRINT 2 — Layout & Navigation Shell
- [ ] Build Sidebar with Dashboard, My Leads, Renewals, Admin links
- [ ] Build Header with TelemarketerSwitcher dropdown
- [ ] Zustand store for active telemarketer session
- [ ] Mobile responsive (sidebar → bottom tab bar)
- [ ] Dark navy sidebar (#0F1729), white content area

**Done when:** Navigation works, telemarketer can be switched from header.

---

### 🔲 SPRINT 3 — Dashboard Page
- [ ] Stats Cards (Total Leads, Calls Today, Follow-ups Due, Sales This Month)
- [ ] Follow-Ups Due Today list with Call Now button
- [ ] RAG Summary (Green/Amber/Red counts)
- [ ] Recent Activity (last 5 call logs)
- [ ] Upcoming Renewals (within 60 days)
- [ ] Skeleton loaders for all widgets

**Done when:** Dashboard loads real data from Supabase for the active telemarketer.

---

### 🔲 SPRINT 4 — Leads Queue Page
- [ ] Paginated, sortable leads table (TanStack Table)
- [ ] All columns: Phone, Name, Product, Funnel Stage, RAG, Last Called, Next Follow-up
- [ ] Filters: RAG status, funnel stage, product, date range, search
- [ ] FunnelStageBadge and RAGBadge components
- [ ] Call Now button that opens Call Log Modal
- [ ] Empty state for no leads

**Done when:** Leads table shows assigned leads with working filters.

---

### 🔲 SPRINT 5 — Call Log Modal
- [ ] Modal/drawer triggered by Call Now button
- [ ] Fields: Outcome, Duration, Notes, KYC toggle, Funnel Stage, RAG, Follow-up date
- [ ] On save: creates call_log, updates lead, creates followup_schedule
- [ ] Optimistic UI update (feels instant)

**Done when:** Telemarketer can log a call and see it reflected immediately.

---

### 🔲 SPRINT 6 — Lead Detail Page (/leads/[id])
- [ ] Tab 1: KYC & Profile (editable)
- [ ] Tab 2: Call History timeline
- [ ] Tab 3: Sale Details form (visible after won)
- [ ] Tab 4: Follow-up Schedule
- [ ] Funnel Stage selector at top
- [ ] RAG Badge (clickable to override)

**Done when:** Full lead profile is viewable and editable with history.

---

### 🔲 SPRINT 7 — Renewals Page
- [ ] Renewals table with all columns
- [ ] Days Until Renewal color coding (green/amber/red)
- [ ] Mark Renewed / Mark Churned actions
- [ ] Filters by telemarketer, product, month, status

**Done when:** Renewal tracking page shows all post-sale clients.

---

### 🔲 SPRINT 8 — Admin Panel
- [ ] Lead Assignment (bulk assign to telemarketer)
- [ ] Telemarketer Management (add/edit/deactivate)
- [ ] CSV Import with column mapping UI
- [ ] Performance Summary table
- [ ] All Leads Overview (all telemarketers visible)

**Done when:** Admin can assign leads and import via CSV.

---

### 🔲 SPRINT 9 — WhatsApp Webhook
- [ ] Supabase Edge Function at `/functions/v1/whatsapp-webhook`
- [ ] Receives BSP payload, stores in webhook_events
- [ ] Creates new lead if phone number is new
- [ ] Updates existing lead if phone number already exists
- [ ] Supabase Realtime on leads table (instant UI update)

**Done when:** Posting a test webhook payload creates a lead in real time.

---

### 🔲 SPRINT 10 — RAG Auto-Flag Cron + Polish
- [ ] Supabase scheduled Edge Function (daily 8AM EAT)
- [ ] Auto-flags RED: no activity 14+ days, overdue renewals
- [ ] Auto-flags AMBER: follow-up due today or tomorrow
- [ ] Final UI polish, loading states, error handling
- [ ] README.md with full setup instructions

**Done when:** App is fully functional end-to-end and ready for deployment.

---

## How Claude Code Should Work on This Project

1. **Always read this file first** before doing anything
2. **Work one sprint at a time** — never jump ahead
3. **Ask before assuming** — if something is unclear, ask Kelvin before building
4. **Confirm before destructive actions** — never drop tables or delete files without asking
5. **Test before moving on** — each sprint has a clear "Done when" condition
6. **Commit after each sprint** — clean git commits with descriptive messages
7. **Use plan mode** at the start of each sprint session

## Current Sprint
**SPRINT 0** — Not started yet.
