# WhatsApp Webhook — Supabase Edge Function

## Deploy

```bash
supabase login
supabase link --project-ref slnphqsrrjpqcthezgun
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=<your-service-role-key>
supabase functions deploy whatsapp-webhook
```

The function URL will be:
```
https://slnphqsrrjpqcthezgun.supabase.co/functions/v1/whatsapp-webhook
```

## Alternatively — use the Next.js route

The Next.js API route at `/api/webhook/whatsapp` implements identical logic and
works without deploying an edge function. Point your BSP to:
```
https://<your-domain>/api/webhook/whatsapp
```

## Supported BSP payload formats

**Meta Cloud API:**
```json
{
  "entry": [{ "changes": [{ "value": {
    "messages": [{ "from": "254712345678", "text": { "body": "Hi" } }],
    "contacts": [{ "profile": { "name": "John" }, "wa_id": "254712345678" }]
  }}]}]
}
```

**WATI:**
```json
{ "waId": "254712345678", "senderName": "John", "text": "Hi" }
```

**Simple / custom:**
```json
{ "phone": "+254712345678", "name": "John", "message": "Hi", "campaign_name": "meta_nov" }
```

## Realtime

Enable Realtime on the `leads` table in Supabase Dashboard:
Database → Replication → Tables → toggle `leads` to ON.

The leads queue page subscribes to INSERT and UPDATE events, so new leads
from the webhook appear instantly without a page refresh.
