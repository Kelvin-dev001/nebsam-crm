import "server-only"

import { timingSafeEqual } from "crypto"
import type { NextRequest } from "next/server"

/**
 * Shared-secret check for the WhatsApp BSP webhook.
 *
 * THE PROBLEM
 * -----------
 * `/api/webhook/whatsapp` creates leads using the service-role key and has
 * never authenticated its caller. `middleware.ts` returns early for `/api`, so
 * anyone who knows the URL can inject leads into the CRM — fake customers in
 * the reps' queues, round-robin assignments burned on them, and the webhook
 * events table filled with whatever they send.
 *
 * WHY THIS IS DELIBERATELY NOT A HARD SWITCH
 * ------------------------------------------
 * This webhook is the team's ONLY automated lead source. Turning on a check
 * that does not match what the BSP actually sends would stop lead intake
 * silently, and we would not find out until someone noticed a quiet morning.
 *
 * So the check is **opt-in and fails open until configured**:
 *
 *   • `WHATSAPP_WEBHOOK_SECRET` unset  → allow, and log once per request that
 *     the webhook is unauthenticated. Behaviour is exactly as before.
 *   • set                              → require a match, reject with 401.
 *
 * That makes the rollout two safe steps rather than one risky one:
 *   1. Deploy this. Nothing changes. Watch the logs to see which header the
 *      BSP actually sends (they are recorded below, names only).
 *   2. Set the same value in the BSP console and in Vercel. It starts
 *      enforcing, and a mismatch shows up immediately while you are watching.
 *
 * Accepts the secret in any of the usual places, because BSPs differ and we
 * cannot change what this one sends.
 */

const HEADER_CANDIDATES = [
  "x-webhook-secret",
  "x-api-key",
  "x-hub-signature", // Meta-style
  "authorization",
]

/** Constant-time compare, so a wrong secret cannot be discovered a byte at a time. */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}

export interface WebhookAuthResult {
  ok: boolean
  /** True when no secret is configured, so the request was allowed unchecked. */
  unenforced: boolean
  reason?: string
}

/** Header names only. Values would put the BSP's own credentials in the log. */
function headerNames(request: NextRequest): string[] {
  const names: string[] = []
  request.headers.forEach((_value, key) => {
    if (!key.startsWith("x-vercel-")) names.push(key)
  })
  return names
}

export function checkWebhookSecret(request: NextRequest): WebhookAuthResult {
  const expected = process.env.WHATSAPP_WEBHOOK_SECRET

  if (!expected) {
    // Record which headers arrived, NAMES ONLY — never values, which would put
    // the BSP's own credentials into the log. This is what tells us what to
    // match on before enforcing.
    console.warn(
      "[webhook] UNAUTHENTICATED - WHATSAPP_WEBHOOK_SECRET is not set. " +
        "Headers present: " +
        headerNames(request).join(", "),
    )
    return { ok: true, unenforced: true }
  }

  for (const name of HEADER_CANDIDATES) {
    const raw = request.headers.get(name)
    if (!raw) continue
    const value = name === "authorization" ? raw.replace(/^Bearer\s+/i, "") : raw
    if (safeEqual(value, expected)) return { ok: true, unenforced: false }
  }

  // Some BSPs can only append a query parameter.
  const fromQuery = request.nextUrl.searchParams.get("secret")
  if (fromQuery && safeEqual(fromQuery, expected)) {
    return { ok: true, unenforced: false }
  }

  return { ok: false, unenforced: false, reason: "no matching webhook secret" }
}
