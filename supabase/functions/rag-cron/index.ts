// RAG Auto-Flag Cron — runs daily at 8:00 AM EAT (05:00 UTC)
//
// Schedule via Supabase Dashboard → Database → Cron Jobs → New cron job:
//   Name:     rag-auto-flag
//   Schedule: 0 5 * * *
//   Command:  SELECT net.http_post(
//               'https://slnphqsrrjpqcthezgun.supabase.co/functions/v1/rag-cron',
//               '{}',
//               'application/json'
//             );
//
// Deploy: supabase functions deploy rag-cron

import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const ACTIVE_STAGES = ["new", "contacted", "interested", "quote_sent", "negotiating", "won", "installed", "post_sale", "renewal_due"]

Deno.serve(async (_req: Request) => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  )

  const now = new Date()
  const todayStr = now.toISOString().split("T")[0]

  const tomorrow = new Date(now)
  tomorrow.setDate(tomorrow.getDate() + 1)
  const tomorrowStr = tomorrow.toISOString().split("T")[0]

  const cutoff = new Date(now)
  cutoff.setDate(cutoff.getDate() - 14)
  const cutoffISO = cutoff.toISOString()

  // ── 1. Fetch all active leads ──────────────────────────────────────────────
  const { data: leads, error: leadsErr } = await supabase
    .from("leads")
    .select("id, funnel_stage, rag_status")
    .in("funnel_stage", ACTIVE_STAGES)

  if (leadsErr || !leads) {
    return new Response(JSON.stringify({ error: leadsErr?.message ?? "Failed to fetch leads" }), { status: 500 })
  }

  const leadIds = leads.map((l: any) => l.id)

  // ── 2. Which leads have a call in the last 14 days ─────────────────────────
  const { data: recentCalls } = await supabase
    .from("call_logs")
    .select("lead_id")
    .in("lead_id", leadIds)
    .gte("called_at", cutoffISO)

  const recentlyCalledSet = new Set((recentCalls ?? []).map((c: any) => c.lead_id))

  // ── 3. Which leads have a pending follow-up today or tomorrow ──────────────
  const { data: upcomingFollowups } = await supabase
    .from("followup_schedule")
    .select("lead_id")
    .in("lead_id", leadIds)
    .in("scheduled_date", [todayStr, tomorrowStr])
    .eq("status", "pending")

  const followupSoonSet = new Set((upcomingFollowups ?? []).map((f: any) => f.lead_id))

  // ── 4. Which leads have an overdue renewal (from sales table) ──────────────
  // renewal_due_date lives on sales, not leads — must join via sales table
  const { data: overdueRenewalSales } = await supabase
    .from("sales")
    .select("lead_id")
    .in("lead_id", leadIds)
    .lt("renewal_due_date", todayStr)
    .not("renewal_due_date", "is", null)

  const overdueRenewalSet = new Set((overdueRenewalSales ?? []).map((s: any) => s.lead_id))

  // ── 5. Compute new RAG for each lead ───────────────────────────────────────
  const toRed: string[] = []
  const toAmber: string[] = []

  for (const lead of leads as any[]) {
    const isOverdueRenewal = overdueRenewalSet.has(lead.id)
    const hasNoRecentActivity = !recentlyCalledSet.has(lead.id)
    const hasFollowupSoon = followupSoonSet.has(lead.id)

    if (isOverdueRenewal) {
      // Always RED for overdue renewals regardless of current status
      if (lead.rag_status !== "red") toRed.push(lead.id)
    } else if (hasNoRecentActivity && lead.rag_status !== "green") {
      // No activity in 14+ days — don't override green (telemarketer may have talked off-platform)
      if (lead.rag_status !== "red") toRed.push(lead.id)
    } else if (hasFollowupSoon && lead.rag_status === "red") {
      // Follow-up is scheduled — de-escalate from red to amber
      toAmber.push(lead.id)
    }
  }

  // ── 5. Batch update ────────────────────────────────────────────────────────
  let redUpdated = 0
  let amberUpdated = 0

  const BATCH = 100

  for (let i = 0; i < toRed.length; i += BATCH) {
    const { error } = await supabase
      .from("leads")
      .update({ rag_status: "red" })
      .in("id", toRed.slice(i, i + BATCH))
    if (!error) redUpdated += Math.min(BATCH, toRed.length - i)
  }

  for (let i = 0; i < toAmber.length; i += BATCH) {
    const { error } = await supabase
      .from("leads")
      .update({ rag_status: "amber" })
      .in("id", toAmber.slice(i, i + BATCH))
    if (!error) amberUpdated += Math.min(BATCH, toAmber.length - i)
  }

  const result = {
    run_at: now.toISOString(),
    leads_checked: leads.length,
    flagged_red: redUpdated,
    flagged_amber: amberUpdated,
    skipped: leads.length - redUpdated - amberUpdated,
  }

  console.log("RAG cron result:", result)

  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  })
})
