import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { addDays, format } from "date-fns"

// ── Phone normalisation ───────────────────────────────────────────────────────

function normalisePhone(raw: string): string {
  const digits = raw.replace(/[\s\-().+]/g, "")
  if (digits.startsWith("254")) return digits
  if (digits.startsWith("0") && digits.length === 10) return "254" + digits.slice(1)
  if (digits.length === 9 && digits.startsWith("7")) return "254" + digits
  return digits
}

// ── Handler ───────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  let body: { leadId: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const { leadId } = body
  if (!leadId) {
    return NextResponse.json({ error: "leadId is required" }, { status: 400 })
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  // 1. Fetch lead
  const { data: lead, error: leadErr } = await supabase
    .from("leads")
    .select("id, phone_number, product_interested, assigned_to")
    .eq("id", leadId)
    .single()

  if (leadErr || !lead) {
    return NextResponse.json({ error: "Lead not found" }, { status: 404 })
  }

  // 2. Fetch most recent sale for renewal date
  const { data: sale } = await supabase
    .from("sales")
    .select("installation_date, renewal_due_date")
    .eq("lead_id", leadId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  // 3. Compute renewal date
  let renewalDate: Date
  if (sale?.installation_date) {
    renewalDate = addDays(new Date(sale.installation_date), 365)
  } else if (sale?.renewal_due_date) {
    renewalDate = new Date(sale.renewal_due_date)
  } else {
    renewalDate = addDays(new Date(), 365)
  }

  const renewalStr = format(renewalDate, "d MMMM yyyy") // "12 June 2026"

  // 4. Build message
  const product = lead.product_interested ?? "vehicle tracking"
  const message =
    `Dear Valued Client, thank you for choosing our ${product} services. ` +
    `Your renewal date will be on ${renewalStr}. ` +
    `Contact 0769063333 for support.`

  // 5. Call BSP API (non-blocking — failures are logged, not returned as errors)
  const bspUrl = process.env.WHATSAPP_BSP_URL
  const sender = process.env.WHATSAPP_SENDER
  const apiKey = process.env.WHATSAPP_API_KEY
  const toNumber = normalisePhone(lead.phone_number)
  let bspOk = false

  if (bspUrl && sender) {
    try {
      const bspRes = await fetch(bspUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
          ...(apiKey ? { "Authorization": "Bearer " + apiKey } : {}),
        },
        body: JSON.stringify({
          sender,
          to: toNumber,
          type: "text",
          data: { preview_url: false, body: message },
        }),
      })
      bspOk = bspRes.ok
      if (!bspRes.ok) {
        const detail = await bspRes.text().catch(() => "")
        console.error("BSP installed-message error:", bspRes.status, detail)
      }
    } catch (err) {
      console.error("BSP installed-message fetch failed:", err)
    }
  } else {
    // BSP not configured — treat as ok for logging purposes
    bspOk = true
  }

  // 6. Log to webhook_events (always, regardless of BSP result)
  await supabase.from("webhook_events").insert({
    raw_payload: { body: message },
    phone_number: lead.phone_number,
    processed: bspOk,
    direction: "outgoing",
    message_text: message,
    sent_at: new Date().toISOString(),
  })

  // 7. Log to call_logs as an automated action
  if (lead.assigned_to) {
    await supabase.from("call_logs").insert({
      lead_id: leadId,
      telemarketer_id: lead.assigned_to,
      call_outcome: "whatsapp_sent",
      call_notes: `Auto: Installation confirmation sent. Renewal date: ${renewalStr}`,
      rag_status_after_call: null,
      funnel_stage_after_call: "installed",
    })
  }

  if (!bspOk) {
    return NextResponse.json(
      { error: "BSP delivery failed", renewal_date: renewalStr },
      { status: 502 },
    )
  }

  return NextResponse.json({ ok: true, renewal_date: renewalStr })
}
