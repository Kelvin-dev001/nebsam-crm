import "server-only"

import { createClient } from "@supabase/supabase-js"
import type { Database } from "./types"

/**
 * The service-role Supabase client. **Server only.**
 *
 * `import "server-only"` at the top of this file makes the build FAIL if any
 * client component — anything with "use client", anything under components/ —
 * imports it, directly or transitively. That is the point: the service-role key
 * bypasses RLS entirely, so a single accidental client import would ship a key
 * that grants full read/write on every table to anyone who opens devtools.
 *
 * Rules for using this:
 *
 *   • Only inside `app/api/**` route handlers, and only AFTER `requireAdmin()`
 *     or `requireUser()` has returned. The key bypasses RLS, so the guard is
 *     the only thing standing between a request and the whole database.
 *   • Never in a Server Component that renders user-controlled data back out.
 *   • Never pass the client, or anything it returned, to a client component
 *     without deciding what the caller is allowed to see.
 *
 * For ordinary cookie-scoped access that RESPECTS RLS, use
 * `lib/supabase/server.ts` instead. Reach for this one only when the operation
 * genuinely cannot be done as the signed-in user — creating an auth user,
 * writing app_metadata, reading across departments for an admin screen.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url) throw new Error("NEXT_PUBLIC_SUPABASE_URL is not set")
  if (!key) {
    // Deliberately does not echo anything about the value.
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not set. It must exist in the server " +
        "environment and must NEVER carry a NEXT_PUBLIC_ prefix.",
    )
  }

  return createClient<Database>(url, key, {
    auth: {
      // No session handling at all: this client is never a "user".
      persistSession: false,
      autoRefreshToken: false,
    },
  })
}
