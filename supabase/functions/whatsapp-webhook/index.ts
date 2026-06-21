// Supabase Edge Function — full implementation in Sprint 9
// Deploy with: supabase functions deploy whatsapp-webhook

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

serve(async (req: Request) => {
  const payload = await req.json()
  console.log("Webhook payload:", payload)
  return new Response(JSON.stringify({ received: true }), {
    headers: { "Content-Type": "application/json" },
    status: 200,
  })
})
