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

  // Single atomic RPC: check existing / assign round robin / record event
  const { data, error } = await supabase.rpc("assign_lead_round_robin", {
    p_phone: phoneNumber,
    p_name: name ?? null,
    p_message: message ?? null,
    p_campaign: campaign ?? null,
    p_raw_payload: payload,
  })

  if (error) {
    await supabase.from("webhook_events").insert({
      raw_payload: payload,
      phone_number: phoneNumber,
      processed: false,
    })
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...CORS, "Content-Type": "application/json" } },
    )
  }

  const result = data as { lead_id: string; is_new: boolean; assigned_to: string | null }
  return new Response(
    JSON.stringify({
      received: true,
      processed: true,
      lead_id: result.lead_id,
      is_new: result.is_new,
      assigned_to: result.assigned_to,
    }),
    { status: 200, headers: { ...CORS, "Content-Type": "application/json" } },
  )
})
