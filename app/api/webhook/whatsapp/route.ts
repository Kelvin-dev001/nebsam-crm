import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

// ── Payload extraction ─────────────────────────────────────────────────────────

function extractPhone(payload: Record<string, unknown>): string | null {
  const meta = (payload?.entry as any)?.[0]?.changes?.[0]?.value
  if (meta?.messages?.[0]?.from) return meta.messages[0].from
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
  const meta = (payload?.entry as any)?.[0]?.changes?.[0]?.value
  if (meta?.contacts?.[0]?.profile?.name) return meta.contacts[0].profile.name
  if (payload?.senderName) return payload.senderName as string
  return (payload?.name as string) ?? (payload?.full_name as string) ?? null
}

function extractMessage(payload: Record<string, unknown>): string | null {
  const meta = (payload?.entry as any)?.[0]?.changes?.[0]?.value
  if (meta?.messages?.[0]?.text?.body) return meta.messages[0].text.body
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

  if (!rawPhone) {
    await (supabase.from("webhook_events") as any).insert({
      raw_payload: payload,
      phone_number: null,
      processed: false,
    })
    return NextResponse.json({ received: true, processed: false, reason: "no_phone" })
  }

  const phoneNumber = normalizePhone(rawPhone)

  const { data: existing } = await supabase
    .from("webhook_events")
    .select("lead_id")
    .eq("phone_number", phoneNumber)
    .eq("processed", true)
    .order("received_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  // Also check leads directly
  const { data: existingLead } = await supabase
    .from("leads")
    .select("id, full_name, whatsapp_message")
    .eq("phone_number", phoneNumber)
    .maybeSingle()

  let leadId: string
  let isNew = false

  if (existingLead) {
    leadId = existingLead.id
    const updates: Record<string, unknown> = {}
    if (message) updates.whatsapp_message = message
    if (name && !(existingLead as any).full_name) updates.full_name = name
    if (Object.keys(updates).length > 0) {
      await (supabase.from("leads") as any).update(updates).eq("id", leadId)
    }
  } else {
    isNew = true
    const { data: newLead, error } = await (supabase.from("leads") as any)
      .insert({
        phone_number: phoneNumber,
        full_name: name,
        whatsapp_message: message,
        lead_source: "whatsapp_bot",
        funnel_stage: "new",
        rag_status: "amber",
        campaign_name: campaign,
      })
      .select("id")
      .single()

    if (error || !newLead) {
      await (supabase.from("webhook_events") as any).insert({
        raw_payload: payload,
        phone_number: phoneNumber,
        processed: false,
      })
      return NextResponse.json({ error: error?.message ?? "Lead insert failed" }, { status: 500 })
    }
    leadId = newLead.id
  }

  await (supabase.from("webhook_events") as any).insert({
    raw_payload: payload,
    phone_number: phoneNumber,
    processed: true,
    lead_id: leadId,
  })

  return NextResponse.json({ received: true, processed: true, lead_id: leadId, is_new: isNew })
}
