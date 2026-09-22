import "server-only"

import { NextResponse } from "next/server"
import type { User } from "@supabase/supabase-js"
import { createClient } from "@/lib/supabase/server"
import { roleOrDefault, type Role } from "./getRole"

/**
 * The gate for routes any signed-in user may call: `/api/account/*`, and the
 * WhatsApp send routes that the chat panel and call-log modal use.
 *
 * Same reasoning as `requireAdmin` — `middleware.ts:38` skips `/api` entirely,
 * so without this a route is open to the whole internet. `/api/whatsapp/send`
 * was exactly that until U1: anyone could POST `{to, message}` and send a
 * WhatsApp from the company's number.
 *
 * Also refuses a banned user, so a deactivated rep with an unexpired token
 * cannot keep using the app until it runs out.
 */

export type UserGuardResult =
  | { ok: true; user: User; role: Role }
  | { ok: false; response: NextResponse }

const deny = (status: number, error: string): UserGuardResult => ({
  ok: false,
  response: NextResponse.json({ ok: false, error }, { status }),
})

export async function requireUser(): Promise<UserGuardResult> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return deny(401, "You are not signed in.")

  const bannedUntil = (user as User & { banned_until?: string }).banned_until
  if (bannedUntil && new Date(bannedUntil) > new Date()) {
    return deny(403, "This account has been deactivated.")
  }

  // Fails closed: an unknown role resolves to telemarketer, never admin.
  return { ok: true, user, role: roleOrDefault(user) }
}
