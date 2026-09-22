import "server-only"

import { NextResponse } from "next/server"
import type { User } from "@supabase/supabase-js"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { getRole } from "./getRole"

/**
 * The gate in front of every `/api/admin/**` route.
 *
 * WHY IT HAS TO DO ALL THE WORK
 * -----------------------------
 * `middleware.ts:38` returns early for every `/api` path:
 *
 *     if (path.startsWith("/api")) return response
 *
 * so **middleware protects none of these routes**. The routes then act through
 * the service role, which bypasses RLS entirely. That makes this function the
 * only thing between an anonymous request and every row in the database. It
 * therefore checks all three U-D6 conditions rather than trusting any one.
 *
 * All three are server-writable only, and all three are read live, so removing
 * someone's admin access takes effect on their next request rather than
 * whenever their JWT happens to expire.
 */

export interface AdminProfile {
  user_id: string
  full_name: string
  is_active: boolean
  is_shared_account: boolean
}

export type AdminGuardResult =
  | { ok: true; user: User; adminProfile: AdminProfile }
  | { ok: false; response: NextResponse }

const deny = (status: number, error: string): AdminGuardResult => ({
  ok: false,
  response: NextResponse.json({ ok: false, error }, { status }),
})

export async function requireAdmin(): Promise<AdminGuardResult> {
  // 1. Who is this? getUser() validates with the Auth server; getSession()
  //    would only decode the cookie and would accept a stale or forged one.
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return deny(401, "You are not signed in.")

  // 2. app_metadata only. user_metadata is writable by the user themselves.
  if (getRole(user) !== "admin") {
    return deny(403, "This action requires an administrator account.")
  }

  // 3. Not banned. A banned user's token is normally rejected outright, but a
  //    ban applied mid-session can leave an unexpired JWT in play, so check.
  const bannedUntil = (user as User & { banned_until?: string }).banned_until
  if (bannedUntil && new Date(bannedUntil) > new Date()) {
    return deny(403, "This account has been deactivated.")
  }

  // 4. An ACTIVE roster row. Read through the service client because
  //    admin_profiles is admin-readable only, and we have not yet established
  //    that this caller is an admin — using their own client here would be
  //    circular.
  const admin = createAdminClient()
  const { data: profile, error } = await admin
    .from("admin_profiles")
    .select("user_id, full_name, is_active, is_shared_account")
    .eq("user_id", user.id)
    .maybeSingle()

  if (error) {
    // Log server-side; never hand raw Supabase text to the browser.
    console.error("[requireAdmin] admin_profiles lookup failed:", error.message)
    return deny(403, "Could not verify your administrator access.")
  }

  if (!profile || !profile.is_active) {
    return deny(403, "This action requires an active administrator account.")
  }

  return { ok: true, user, adminProfile: profile as AdminProfile }
}
