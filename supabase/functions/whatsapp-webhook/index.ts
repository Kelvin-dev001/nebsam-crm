// Supabase Edge Function — WhatsApp BSP Webhook
// Deploy: supabase functions deploy whatsapp-webhook
// Set secret: supabase secrets set SUPABASE_SERVICE_ROLE_KEY=<your-key>

import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

// ── Payload extraction ─────────────────────────────────────────────────────────
// Supports: Meta Cloud API, WATI, simple/custom formats

function extractPhone(payload: Record<string, unknown>): string | null {
  // Meta Cloud API
  const meta = (payload?.entry as any)?.[0]?.changes?.[0]?.value
  if (meta?.messages?.[0]?.from) return meta.messages[0].from

  // WATI
  if (payload?.waId) return payload.waId as string

  // Simple / custom
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

// ── Handler ────────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS })
  }

  // Webhook verification (GET) — Meta sends hub.challenge
  if (req.method === "GET") {
    const url = new URL(req.url)
    const challenge = url.searchParams.get("hub.challenge")
    return new Response(challenge ?? "OK", { status: 200 })
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 })
  }

  let payload: Record<string, unknown>
  try {
    payload = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { ...CORS, "Content-Type": "application/json" },
    })
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  )

  const rawPhone = extractPhone(payload)
  const name = extractName(payload)
  const message = extractMessage(payload)
  const campaign = (payload?.campaign_name as string) ?? (payload?.campaign as string) ?? null

  // No phone → store as unprocessed and return 200 (BSP expects 200 always)
  if (!rawPhone) {
    await supabase.from("webhook_events").insert({
      raw_payload: payload,
      phone_number: null,
      processed: false,
    })
    return new Response(
      JSON.stringify({ received: true, processed: false, reason: "no_phone" }),
      { status: 200, headers: { ...CORS, "Content-Type": "application/json" } },
    )
  }

  const phoneNumber = normalizePhone(rawPhone)

  // Check for existing lead
  const { data: existing } = await supabase
    .from("leads")
    .select("id, full_name, whatsapp_message")
    .eq("phone_number", phoneNumber)
    .maybeSingle()

  let leadId: string
  let isNew = false

  if (existing) {
    leadId = existing.id
    const updates: Record<string, unknown> = {}
    if (message) updates.whatsapp_message = message
    if (name && !existing.full_name) updates.full_name = name
    if (Object.keys(updates).length > 0) {
      await supabase.from("leads").update(updates).eq("id", leadId)
    }
  } else {
    isNew = true
    const { data: newLead, error } = await supabase
      .from("leads")
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
      await supabase.from("webhook_events").insert({
        raw_payload: payload,
        phone_number: phoneNumber,
        processed: false,
      })
      return new Response(
        JSON.stringify({ error: error?.message ?? "Lead insert failed" }),
        { status: 500, headers: { ...CORS, "Content-Type": "application/json" } },
      )
    }
    leadId = (newLead as any).id
  }

  // Store processed event
  await supabase.from("webhook_events").insert({
    raw_payload: payload,
    phone_number: phoneNumber,
    processed: true,
    lead_id: leadId,
  })

  return new Response(
    JSON.stringify({ received: true, processed: true, lead_id: leadId, is_new: isNew }),
    { status: 200, headers: { ...CORS, "Content-Type": "application/json" } },
  )
})
