import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

// ── Phone normalisation ───────────────────────────────────────────────────────
// Strips all non-digits, converts 07xx → 2547xx, removes leading +

function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "")
  if (digits.startsWith("0"))   return "254" + digits.slice(1)
  if (digits.startsWith("254")) return digits
  if (digits.startsWith("7") && digits.length === 9) return "254" + digits
  return digits
}

// ── Handler ───────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  let body: { to: string; message: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const { to, message } = body
  if (!to || !message?.trim()) {
    return NextResponse.json({ error: "to and message are required" }, { status: 400 })
  }

  // ── Env-var check ──────────────────────────────────────────────────────────
  const bspUrl = process.env.WHATSAPP_BSP_URL
  const sender = process.env.WHATSAPP_SENDER
  const apiKey = process.env.WHATSAPP_API_KEY

  console.log("=== WHATSAPP SEND DEBUG ===")
  console.log("BSP URL configured:", !!bspUrl, bspUrl ?? "(missing)")
  console.log("SENDER configured:", !!sender, sender ? `${sender.slice(0, 6)}...` : "(missing)")
  console.log("API KEY configured:", !!apiKey, apiKey ? `${apiKey.slice(0, 8)}... (${apiKey.length} chars)` : "(missing)")

  if (!bspUrl) {
    return NextResponse.json(
      { error: "WHATSAPP_BSP_URL environment variable is not configured" },
      { status: 500 },
    )
  }
  if (!sender) {
    return NextResponse.json(
      { error: "WHATSAPP_SENDER environment variable is not configured — set this in Vercel project settings" },
      { status: 500 },
    )
  }
  if (!apiKey) {
    return NextResponse.json(
      { error: "WHATSAPP_API_KEY environment variable is not configured — set this in Vercel project settings" },
      { status: 500 },
    )
  }

  const toNormalised = normalizePhone(to)
  const payload = {
    sender,
    to: toNormalised,
    type: "text",
    data: { preview_url: false, body: message.trim() },
  }

  console.log("To (raw):", to, "→ normalised:", toNormalised)
  console.log("Payload:", JSON.stringify(payload, null, 2))

  // ── BSP call ───────────────────────────────────────────────────────────────
  try {
    const bspRes = await fetch(bspUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Authorization": "Bearer " + apiKey,
      },
      body: JSON.stringify(payload),
    })

    const responseText = await bspRes.text()
    console.log("BSP response status:", bspRes.status)
    console.log("BSP response body:", responseText)
    console.log("==========================")

    if (!bspRes.ok) {
      // Try to parse JSON error from BSP for a clean message
      let bspMessage = responseText
      try {
        const parsed = JSON.parse(responseText)
        bspMessage = parsed.message ?? parsed.error ?? responseText
      } catch { /* use raw text */ }

      return NextResponse.json(
        {
          error: `Jaza Africa error (${bspRes.status}): ${bspMessage}`,
          bsp_status: bspRes.status,
          bsp_body: responseText,
        },
        { status: 502 },
      )
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error("BSP fetch exception:", msg)
    return NextResponse.json(
      { error: `BSP unreachable: ${msg}` },
      { status: 502 },
    )
  }

  // ── Log outgoing message to webhook_events ─────────────────────────────────
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  const { data: event, error: dbErr } = await supabase
    .from("webhook_events")
    .insert({
      raw_payload: { body: message.trim() },
      phone_number: to,
      processed: true,
      direction: "outgoing",
      message_text: message.trim(),
      sent_at: new Date().toISOString(),
    })
    .select("id")
    .single()

  if (dbErr) {
    console.error("Failed to log outgoing message:", dbErr.message)
    return NextResponse.json({ error: dbErr.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, event_id: event.id })
}
