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

## 12 · Adding and Managing Users

Everything below happens in **Admin → Users**. Nothing here needs a developer, a
script or a deploy.

### Adding someone

**Add user** creates their sales-rep record and their login together, and gives you a
temporary password to pass on.

That password is shown **once**. It is not stored anywhere — not in the database, not in
the audit log, not in a file. If it is lost, issue a new one with **Reset password**;
there is no way to look it up, deliberately.

Use **Copy as message** for a block ready to paste into WhatsApp.

The new person is asked to choose their own password the first time they sign in, and
cannot reach the app until they do.

> **Department matters.** A rep only ever sees leads in their own department. Choose it
> when you create them — changing it later moves their work, which is why it is a
> separate action.
>
> A new **Vehicle Telematics** rep joins the WhatsApp round-robin immediately and starts
> receiving enquiries straight away.

### If someone cannot sign in

| What you see | What to do |
|---|---|
| **No login** | An old record made before this screen existed. Press **Create login**. |
| **Must change password** | Normal for a new or reset account. They set their own on next sign-in. |
| **Deactivated** | Their access was removed. **Reactivate** issues a new temporary password. |
| They forgot it | **Reset password.** There is no "forgot password" email — this is the only recovery path. |

**Reset password** cuts them off immediately and signs them out everywhere.
**Require change** does not: their current password keeps working until they choose a new
one. Use Require change when you simply want someone to move off a password you know.

### When someone leaves, or changes team

Both **Deactivate** and **Move** hand over the person's open work first, and both make you
say who takes it.

That is not bureaucracy. A rep only sees leads that are *assigned to them* **and** *in
their own department*. Leads left on someone who has been deactivated — or who has moved
team — match nobody, and disappear from every queue. They are still in the database, and
an admin can still find them, but from the floor it looks exactly like losing them.

So:

- **Deactivate** — pick who inherits their open leads and pending follow-ups, then their
  login is blocked. Past call logs and sales keep their name; nothing is deleted, and it
  can be undone with **Reactivate**.
- **Move** — their open work stays with the old team, handed to someone still in it. They
  start clean in the new department.
- **No other active rep in that team?** The leads go to the department backlog
  (Admin → Assignment), and their pending follow-ups are **cancelled** — a follow-up
  cannot sit in a backlog, and one left on someone who has gone is a call nobody makes.

Closed leads (lost, unqualified, dormant) never move. They are history.

Reactivating does **not** give someone their old leads back. Those belong to whoever
inherited them and have been worked since. Reassign from Admin → Assignment if you want
them returned.

### Administrators

An administrator sees **every lead in every department** and can add, reset and deactivate
every user, including other administrators.

Admin-targeted actions ask you to re-enter **your own password**. That is not extra
security theatre: without it, a browser left unlocked on a desk is enough for someone to
take over administrative access, with your name on every line of the audit log.

Two rules the system enforces for you, whatever the screen offers:

- You cannot deactivate or reset **yourself** here. Use **Change password** in the user
  menu, which asks for your current password.
- **The last active administrator can never be removed.** This is enforced in the
  database, so two admins removing each other at the same instant cannot leave zero.

### Retiring the shared login

`admin@nebsamdigital.com` is shared, so every action taken with it is anonymous and its
password cannot be revoked from one person without locking out everyone.

Once a named administrator has signed in **and** set their own password, **Retire shared
login** appears on its row. Until then it stays disabled — an account that merely exists
proves nothing, and retiring on that basis could leave nobody able to administer the CRM.

Retiring **deactivates**; it never deletes. The account keeps its audit history and can be
restored.

### Who did what

**Admin → Users** records every user-management action with the name and email of whoever
performed it, captured at the time. Renaming or deactivating an administrator later does
not rewrite the history.

Failed password confirmations are recorded too — repeated ones are what someone probing an
unattended session looks like.

### If nobody can sign in at all

Last resort, from a machine with the repo and `.env.local`:

```bash
node scripts/admin-reset-password.mjs --email <admin email> [--reactivate]
```

It prints a temporary password once to the terminal and writes it nowhere. It deliberately
bypasses the last-administrator guard, so use it only when the UI genuinely cannot be
reached.

---

## Business Rules

- All currency in **KES** — formatted as `KES 12,500`
- All phone numbers in **international format** — `+254XXXXXXXXX`
- `renewal_due_date` = `installation_date + 365 days` (auto-calculated by DB trigger)
- Each telemarketer sees **only their assigned leads**
- RAG auto-flag cron runs daily at **8:00 AM EAT**
