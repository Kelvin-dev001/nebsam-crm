# Nebsam CRM

A full-stack CRM for **Nebsam Digital Solutions**, a Kenyan digital marketing company.
Three telemarketers (Edith, Janet, Suzzie) manage WhatsApp leads from first inquiry through annual renewal.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 14 (App Router) · TypeScript · Tailwind CSS · shadcn/ui |
| State | Zustand |
| Tables | TanStack Table v8 |
| Forms | React Hook Form + Zod |
| Backend / DB | Supabase (PostgreSQL + Realtime + Edge Functions) |
| Dates | date-fns |
| Icons | Lucide React |
| Toasts | Sonner |

---

## Prerequisites

- **Node.js v18+** — [nodejs.org](https://nodejs.org)
- **Supabase account** — [supabase.com](https://supabase.com)
- **Supabase CLI** (optional, for deploying Edge Functions) — `npm install -g supabase`

---

## 1 · Clone and Install

```bash
git clone https://github.com/Kelvin-dev001/nebsam-crm.git
cd nebsam-crm
npm install
```

---

## 2 · Environment Variables

Create a `.env.local` file at the project root:

```env
NEXT_PUBLIC_SUPABASE_URL=https://<your-project-id>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<your-anon-key>
SUPABASE_SERVICE_ROLE_KEY=<your-service-role-key>
DATABASE_URL=postgresql://postgres.<project-id>:<password>@aws-1-us-east-1.pooler.supabase.com:6543/postgres
```

Find these in your Supabase Dashboard → **Settings → API**.

---

## 3 · Database Setup

Run migrations and seed data from your terminal:

```bash
node scripts/migrate.mjs --seed
```

This creates all 6 tables and loads 3 telemarketers + 20 sample leads.

**Tables created:**
- `telemarketers` — Edith, Janet, Suzzie
- `leads` — WhatsApp leads with funnel stage and RAG status
- `call_logs` — Call history per lead
- `sales` — Won deals with renewal dates
- `followup_schedule` — Scheduled follow-ups
- `webhook_events` — Raw WhatsApp payloads

---

## 4 · Enable Supabase Realtime

In the Supabase Dashboard → **Database → Replication → Tables**, toggle the **`leads`** table to ON.

This enables the leads queue to update instantly when new WhatsApp messages arrive.

---

## 5 · Run Dev Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The app redirects to `/dashboard`.

Select a telemarketer from the top-right switcher to load data.

---

## 6 · Pages

| Route | Description |
|-------|-------------|
| `/dashboard` | Stats, follow-ups due today, RAG summary, recent activity, upcoming renewals |
| `/leads` | Paginated leads queue with filters, Call Now button |
| `/leads/[id]` | Full lead profile — KYC, call history, sale details, follow-up schedule |
| `/renewals` | All post-sale clients with days-until-renewal and Mark Renewed/Churned actions |
| `/admin` | All Leads · Lead Assignment · Performance Summary · Telemarketer Management · CSV Import |

---

## 7 · WhatsApp Webhook

Two options — both implement identical logic:

### Option A — Next.js API route (no CLI needed)

Point your WhatsApp BSP to:
```
POST https://<your-domain>/api/webhook/whatsapp
```

### Option B — Supabase Edge Function

```bash
supabase login
supabase link --project-ref <your-project-id>
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=<your-service-role-key>
supabase functions deploy whatsapp-webhook
```

Webhook URL:
```
POST https://<your-project-id>.supabase.co/functions/v1/whatsapp-webhook
```

### Supported payload formats

**Meta Cloud API** (official WhatsApp Business):
```json
{
  "entry": [{ "changes": [{ "value": {
    "messages": [{ "from": "254712345678", "text": { "body": "Hi, I'm interested" } }],
    "contacts": [{ "profile": { "name": "John Doe" }, "wa_id": "254712345678" }]
  }}]}]
}
```

**WATI / simple format:**
```json
{ "phone": "+254712345678", "name": "John Doe", "message": "Hi", "campaign_name": "meta_nov" }
```

Phone numbers are auto-normalized to `+254XXXXXXXXX` format.

---

## 8 · RAG Auto-Flag Cron

The cron runs daily at **8:00 AM EAT** and auto-flags leads:

| Condition | Flag |
|-----------|------|
| No call in 14+ days (not GREEN) | 🔴 RED |
| Renewal overdue (`renewal_due` stage, past date) | 🔴 RED |
| Pending follow-up today or tomorrow (was RED) | 🟡 AMBER |

### Deploy the cron function

```bash
supabase functions deploy rag-cron
```

### Schedule it (Supabase Dashboard → Database → Cron Jobs)

```
Name:     rag-auto-flag
Schedule: 0 5 * * *
Command:  SELECT net.http_post(
            'https://<your-project-id>.supabase.co/functions/v1/rag-cron',
            '{}',
            'application/json'
          );
```

---

## 9 · CSV Lead Import

In **Admin → CSV Import**, upload a `.csv` file. Columns are auto-mapped by name.
You can manually map each column to a CRM field. Only `phone_number` is required.

Phone normalization: `0712345678` → `+254712345678`

---

## 10 · RAG Status Reference

| Status | Meaning |
|--------|---------|
| 🟢 GREEN | High intent — actively engaging, quote accepted, renewal confirmed |
| 🟡 AMBER | Moderate — interested but undecided, follow-up scheduled |
| 🔴 RED | Cold — no answer 3+ times, said no, or overdue follow-up 14+ days |

---

## 11 · Funnel Stages

```
new → contacted → interested → quote_sent → negotiating →
won → installed → post_sale → renewal_due → renewed → lost → unqualified
```

---

## Business Rules

- All currency in **KES** — formatted as `KES 12,500`
- All phone numbers in **international format** — `+254XXXXXXXXX`
- `renewal_due_date` = `installation_date + 365 days` (auto-calculated by DB trigger)
- Each telemarketer sees **only their assigned leads**
- RAG auto-flag cron runs daily at **8:00 AM EAT**
