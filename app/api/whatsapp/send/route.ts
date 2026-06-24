import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

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

  const bspUrl    = process.env.WHATSAPP_BSP_URL
  const sender    = process.env.WHATSAPP_SENDER
  const supabase  = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  // Call BSP API if credentials are configured
  if (bspUrl && sender) {
    try {
      const bspRes = await fetch(bspUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sender,
          to: to.replace(/^\+/, ""),   // BSP expects number without leading +
          type: "text",
          data: { preview_url: false, body: message.trim() },
        }),
      })
      if (!bspRes.ok) {
        const errText = await bspRes.text().catch(() => "")
        console.error("BSP API error:", bspRes.status, errText)
        return NextResponse.json(
          { error: `BSP returned ${bspRes.status}`, detail: errText },
          { status: 502 },
        )
      }
    } catch (err) {
      console.error("BSP fetch failed:", err)
      return NextResponse.json({ error: "BSP unreachable" }, { status: 502 })
    }
  }

  // Log the outgoing message in webhook_events
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
