import { NextResponse } from "next/server"

// ── Diagnostic endpoint — GET https://nebsam-crm.vercel.app/api/whatsapp/test
// Shows env-var status and makes a test call to the BSP.
// Remove or restrict this endpoint once WhatsApp is confirmed working.

function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "")
  if (digits.startsWith("0"))   return "254" + digits.slice(1)
  if (digits.startsWith("254")) return digits
  if (digits.startsWith("7") && digits.length === 9) return "254" + digits
  return digits
}

export async function GET() {
  const bspUrl = process.env.WHATSAPP_BSP_URL
  const sender = process.env.WHATSAPP_SENDER

  const apiKey = process.env.WHATSAPP_API_KEY

  const config = {
    WHATSAPP_BSP_URL:  bspUrl  ? `${bspUrl.slice(0, 30)}…` : "NOT SET ❌",
    WHATSAPP_SENDER:   sender  ? `${sender} ✅` : "NOT SET ❌",
    WHATSAPP_API_KEY:  apiKey  ? `${apiKey.slice(0, 8)}… (${apiKey.length} chars) ✅` : "NOT SET ❌",
    NEXT_PUBLIC_SUPABASE_URL:  process.env.NEXT_PUBLIC_SUPABASE_URL  ? "SET ✅" : "NOT SET ❌",
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY ? "SET ✅" : "NOT SET ❌",
  }

  if (!bspUrl || !sender || !apiKey) {
    return NextResponse.json({ status: "misconfigured", config }, { status: 200 })
  }

  // Test call — uses a dummy number (the call will fail with a phone error,
  // but a 4xx from BSP proves the credentials are accepted)
  const to = normalizePhone("254700000000")
  const payload = {
    sender,
    to,
    type: "text",
    data: { preview_url: false, body: "Nebsam CRM connectivity test — please ignore" },
  }

  let bspResult: { status: number; body: string; ok: boolean } | null = null
  try {
    const res = await fetch(bspUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Authorization": "Bearer " + apiKey,
      },
      body: JSON.stringify(payload),
    })
    const text = await res.text()
    bspResult = { status: res.status, body: text, ok: res.ok }
  } catch (err) {
    bspResult = { status: 0, body: String(err), ok: false }
  }

  return NextResponse.json({
    status: bspResult.ok ? "connected" : "bsp_error",
    config,
    test_payload: { ...payload, sender: `${sender.slice(0, 4)}…` },
    bsp_response: bspResult,
  })
}
