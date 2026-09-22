# End-to-end test plan — multi-department expansion

**Why this list exists, and what it is really for.**

Everything in this project has been verified at the **data layer**: SQL suites, role
impersonation the way PostgREST does it, byte-comparison of snapshots before and after every
migration. What has *never* happened is a human clicking a button. `NewProspectSheet`,
`KycFields`, `ReordersShell`, `BusRegisterShell`, `TermBillingShell`, `DepartmentManager` and the
rewritten CSV import have all compiled, type-checked and linted — and have never been rendered
in a browser.

So the priority below is not "what is most important to the business". It is **"what is least
verified"**. Section A is the part that could be quietly broken right now.

Tick the boxes. Anything that fails, note the exact steps — most of these have a one-line fix.

---

## Where to run this

**Do sections A and B on production.** They are read-only or they exercise the telematics flow
the team already uses, and production is the only place the real data lives.

**Do sections C, D and E against staging, not production**, because they create prospects, orders
and buses. Staging (`koifyemtduyyfqpkogpl`) holds a restore of production plus every migration,
so it behaves identically.

To point the app at staging, from the repo:

```bash
# .env.local already holds STAGING_SUPABASE_URL / STAGING_SUPABASE_ANON_KEY.
NEXT_PUBLIC_SUPABASE_URL=https://koifyemtduyyfqpkogpl.supabase.co \
NEXT_PUBLIC_SUPABASE_ANON_KEY=<STAGING_SUPABASE_ANON_KEY from .env.local> \
npm run dev
```

Then work at `http://localhost:3000`. Nothing you do there touches live data.

If you would rather test everything on production, that is defensible too — just prefix anything
you create with `TEST` so it is easy to find and delete afterwards.

---

## A. Nothing is broken (do this first — 10 minutes)

Migration 011 changed who can see what. If anything here fails, stop and say so; the rollback is
one block at the foot of `011_department_rls.sql`.

- [ ] **A1.** Edith logs in. She lands on `/dashboard` and sees her leads — roughly **1,143**.
- [ ] **A2.** Janet logs in and sees roughly **1,145**. Suzzie, roughly **1,143**.
- [ ] **A3.** Each rep's stage badges read normally — "Quote Sent", "Contacted" — not raw keys
      like `quote_sent`, and not blank.
- [ ] **A4.** Open a lead. The detail page loads, call history is there, notes are there.
- [ ] **A5.** Log a call from **Call Now**: outcome, duration, notes, a KYC edit and a follow-up
      date. Save. Reopen the lead and confirm **all of it persisted** — especially the follow-up
      and the KYC. (This is the exact bug `c88cee5` fixed and nobody has confirmed it since.)
- [ ] **A6.** Admin logs in and lands on `/admin`. Every existing tab still loads.
- [ ] **A7.** `/renewals` and `/backlog` still load for a rep.

**If A1–A2 show the wrong number, that is an RLS problem. Everything else can wait.**

---

## B. The parts that changed underneath the team

These look identical to before, but the machinery beneath them is new.

- [ ] **B1.** A real WhatsApp enquiry arrives and appears in a rep's queue **live**, without a
      refresh. (Realtime + the webhook now on `assign_lead_round_robin_v2`.)
- [ ] **B2.** That lead is assigned to the next rep in rotation, not always the same person.
- [ ] **B3.** The sidebar shows **Vehicle Telematics** under the wordmark, in blue.
- [ ] **B4.** The leads filters still work: RAG, stage, product, search, contacted.
- [ ] **B5.** **Download My Report** on the dashboard produces a PDF, and the header now reads
      "Daily Performance Report · Vehicle Telematics" with a Department column in the table.
- [x] **B6.** ~~Tomorrow morning, RAG counts look normal~~ — **PASSED 2026-09-22.** See F1.

---

## C. Manual prospect entry — the core of the whole request

**Do this as admin**, who can pick any department. There are no non-telematics reps yet.

- [ ] **C1.** Use the **department switcher in the header** to select *Container E-Seal*. The
      sidebar name and accent change, and the nav shows **Reorders** instead of Renewals.
- [ ] **C2.** On `/leads`, click **+ New Prospect**.
- [ ] **C3.** Type `0722334455` and tab out. It reformats to **+254722334455**.
- [ ] **C4.** The KYC section shows **Container E-Seal's** questions — Business Type, Number of
      Trucks, Routes Served, Cargo Type, Containers/Month, Current Seal Supplier, Seal Type —
      not telematics fields.
- [ ] **C5.** Routes Served is multi-select chips; Business Type is a dropdown; Number of Trucks
      only accepts numbers.
- [ ] **C6.** Leave a required field (Company Name) blank and save. It refuses with a clear
      message, and does **not** create anything.
- [ ] **C7.** Fill it in, tick **Log the first call now**, tick **Schedule a follow-up**, save.
- [ ] **C8.** The prospect appears **at the top of the queue immediately**, with a Company column.
- [ ] **C9.** Open it — the KYC answers are all there, including the multi-select.
- [ ] **C10.** Enter the **same number again** in the same department. It is **blocked** with
      "Already in your queue", and offers a link.
- [ ] **C11.** Switch to *Fuel Monitoring* and enter that same number. An **amber banner** warns
      it also exists in Container E-Seal — and **lets you continue**. Save it. (This is decision
      D2, and it only started working after migration 010.)
- [ ] **C12.** Switch to *School Bus Solution*. The KYC set changes again, and "Company Name" now
      reads **"School Name"**.

---

## D. The post-sale pages

- [ ] **D1.** With *Container E-Seal* selected, open **Reorders**. Click **Record Order**, pick
      the customer from C7, a product, quantity and unit price. The total shows as `KES 30,000`.
- [ ] **D2.** Set the reorder date to a past date. It appears on the list in **red**, marked
      overdue.
- [ ] **D3.** **Mark Delivered** updates immediately.
- [ ] **D4.** Switch to *School Bus Solution*. **Buses** and **Term Billing** appear in the nav.
- [ ] **D5.** On **Buses**, add a bus (e.g. `KDA 123X`, status *installed*, rate 20000). Add a
      second with the **same plate** — it is refused with a readable sentence, not a SQL error.
- [ ] **D6.** **Term Billing** shows an amber **"Term calendar not configured"** panel, and
      **Generate Billings** is disabled. *This is correct* until the real term dates are entered.
- [ ] **D7.** Switch to *Fuel Monitoring*. The nav shows **Contracts**, not Reorders.

---

## E. Admin — configuration without a deploy

This is the payoff of decision D3, and the part most worth proving to yourself.

- [ ] **E1.** **Admin → Departments**. Pick Container E-Seal. Add a stage `legal_review` /
      "Legal Review". Move it above **Won** with the arrows.
- [ ] **E2.** Go to `/leads` for that department. The new stage is in the **stage filter** and in
      the **Call Now** stage dropdown — **with no deploy and no restart**.
- [ ] **E3.** Add a KYC question (e.g. "Annual Seal Budget", number). Open **+ New Prospect** —
      it is there.
- [ ] **E4.** Remove a KYC question. It disappears from the form, but open a prospect that
      already answered it and confirm **the answer is still stored** (soft delete).
- [ ] **E5.** Rename a stage **key** on a department with leads at that stage. It warns you
      loudly, then reports how many leads were migrated. Confirm those leads still appear and
      the queue's **last-touched ordering has not changed**.
- [ ] **E6.** **Term calendar**: add three terms with holidays. "Check calendar" reports it as
      consistent. Now add an overlapping term — it reports the overlap in plain words.
- [ ] **E7.** With the calendar configured, go back to **Term Billing** and press **Generate
      Billings**. Rows appear grouped by term, due **14 days before** each term start.
- [ ] **E8.** Mark Term 1 **Paid**. Add another bus. Regenerate. Terms 2 and 3 update to the new
      bus count; **Term 1 keeps its original amount.**
- [ ] **E9.** **CSV import**: pick a department *first*, then upload a small CSV. Confirm the
      column mapper offers that department's **KYC questions** alongside the core fields, and the
      result report separates "already in this department" from "held by another department".
- [ ] **E10.** **Admin → Reports** and the other tabs each have a working department filter.

---

## F. Only time can test these

- [x] **F1.** ~~Tomorrow's 05:00 UTC cron run~~ — **PASSED.** The first production run of
      `rag_auto_flag_v2` completed `succeeded` at `2026-09-22 05:00:00 UTC`. RED went
      **2,715 → 2,716 (+1)** while the total went 3,431 → 3,452 (+21 leads overnight); amber 647,
      green 89. A v2 that had diverged from v1 would have reflagged hundreds on its first pass.
      This was the last irreversible unknown in the migration.
- [ ] **F2.** After a week, follow-up alarms and notifications still fire for the right rep.
- [ ] **F3.** When the first non-telematics rep is created, confirm they log in and see **only**
      their own department — and that a telematics rep still sees exactly what they saw before.

---

## What this plan cannot tell you

Be aware of the limits, so a clean run is not over-read:

- **It does not prove security.** A tester clicking around as admin proves nothing about whether
  a rep can reach another department's data. That was proven separately by impersonating each
  role at the database level, which is stronger than any UI test — but the two are not
  substitutes for each other.
- **It only covers one browser, once.** No responsive/mobile check, no second browser, no
  concurrent-user check.
- **It is a snapshot.** Nothing here runs again automatically. See the note below.

## Better than a checklist, if you want it

A manual pass is the right call **right now**, because the UI has never been exercised and a
human will notice things no assertion would — wrong wording, a cramped layout, a confusing
order of fields.

It is the wrong tool for the *tenth* time you need this. Two things would improve on it:

1. **Automated browser tests.** `playwright` is already in `devDependencies` and unused. The
   flows in sections C and D are exactly the kind of deterministic paths worth automating, and
   they would then run on every change instead of whenever someone has an afternoon.
2. **Extending `scripts/departments-check.mjs`.** It already runs the data-layer checklist in
   about two seconds against either environment (`--target=production`). Anything in this
   document that is really a data assertion — C3's normalisation, C10/C11's duplicate rules,
   E8's billing arithmetic — belongs there rather than in a human's hands.

Neither is a reason to skip this pass. They are what stops you needing to do it by hand again.
