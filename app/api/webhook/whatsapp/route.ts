import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

// ── Payload extraction ─────────────────────────────────────────────────────────

interface MetaMessage {
  from?: string
  text?: { body?: string }
}
interface MetaContact {
  profile?: { name?: string }
}
interface MetaValue {
  messages?: MetaMessage[]
  contacts?: MetaContact[]
}
interface MetaEntry {
  changes?: Array<{ value?: MetaValue }>
}

function getMetaValue(payload: Record<string, unknown>): MetaValue | undefined {
  return (payload?.entry as MetaEntry[] | undefined)?.[0]?.changes?.[0]?.value
}

function extractPhone(payload: Record<string, unknown>): string | null {
  const meta = getMetaValue(payload)
  if (meta?.messages?.[0]?.from) return meta.messages[0].from!
  if (payload?.waId) return payload.waId as string
  return (
    (payload?.phone as string) ??
    (payload?.phone_number as string) ??
    (payload?.from as string) ??
    (payload?.mobile as string) ??
    null
  )
}

function extractName(payload: Record<string, unknown>): string | null {
  const meta = getMetaValue(payload)
  if (meta?.contacts?.[0]?.profile?.name) return meta.contacts[0].profile!.name!
  if (payload?.senderName) return payload.senderName as string
  return (payload?.name as string) ?? (payload?.full_name as string) ?? null
}

function extractMessage(payload: Record<string, unknown>): string | null {
  const meta = getMetaValue(payload)
  if (meta?.messages?.[0]?.text?.body) return meta.messages[0].text!.body!
  return (
    (payload?.text as string) ??
    (payload?.message as string) ??
    (payload?.body as string) ??
    null
  )
}

function normalizePhone(raw: string): string {
  const digits = raw.replace(/[\s\-().]/g, "")
  if (digits.startsWith("+")) return digits
  if (digits.startsWith("254")) return "+" + digits
  if (digits.startsWith("0") && digits.length === 10) return "+254" + digits.slice(1)
  if (digits.length === 9 && digits.startsWith("7")) return "+254" + digits
  return "+" + digits
}

// ── Handlers ───────────────────────────────────────────────────────────────────

// Meta webhook verification
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const challenge = searchParams.get("hub.challenge")
  if (challenge) return new NextResponse(challenge, { status: 200 })
  return NextResponse.json({ ok: true })
}

export async function POST(request: NextRequest) {
  let payload: Record<string, unknown>
  try {
    payload = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  const rawPhone = extractPhone(payload)
  const name = extractName(payload)
  const message = extractMessage(payload)
  const campaign = (payload?.campaign_name as string) ?? (payload?.campaign as string) ?? null

  // No phone → store unprocessed and return (BSP expects 200 always)
  if (!rawPhone) {
    await supabase.from("webhook_events").insert({
      raw_payload: payload,
      phone_number: null,
      processed: false,
    })
    return NextResponse.json({ received: true, processed: false, reason: "no_phone" })
  }

  const phoneNumber = normalizePhone(rawPhone)

  // Single atomic RPC call: check existing / assign round robin / record event
  const { data, error } = await supabase.rpc("assign_lead_round_robin", {
    p_phone: phoneNumber,
    p_name: name ?? null,
    p_message: message ?? null,
    p_campaign: campaign ?? null,
    p_raw_payload: payload,
  })

  if (error) {
    // Fallback: store unprocessed event so we don't lose the payload
    await supabase.from("webhook_events").insert({
      raw_payload: payload,
      phone_number: phoneNumber,
      processed: false,
    })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const result = data as { lead_id: string; is_new: boolean; assigned_to: string | null }
  return NextResponse.json({
    received: true,
    processed: true,
    lead_id: result.lead_id,
    is_new: result.is_new,
    assigned_to: result.assigned_to,
  })
}
