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

  assertSameProject(url, key)

  return createClient<Database>(url, key, {
    auth: {
      // No session handling at all: this client is never a "user".
      persistSession: false,
      autoRefreshToken: false,
    },
  })
}

/**
 * Fails loudly when the URL and the service-role key belong to different
 * Supabase projects.
 *
 * This is easy to do by accident and the symptom is badly misleading. Point a
 * dev server at staging by overriding NEXT_PUBLIC_SUPABASE_URL but leave
 * SUPABASE_SERVICE_ROLE_KEY as production's, and every admin route answers
 * "Could not verify your administrator access" — which reads as a permissions
 * problem, sends you looking at RLS and roles, and is nothing of the sort.
 *
 * A legacy service key is a JWT carrying a `ref` claim naming its project. It
 * is decoded here WITHOUT verification: the signature is irrelevant, we only
 * want the project name for a sanity check, and Supabase rejects a bad key
 * anyway. Newer `sb_secret_…` keys carry no claims, so they are skipped rather
 * than guessed at.
 */
function assertSameProject(url: string, key: string) {
  const urlRef = new URL(url).hostname.split(".")[0]

  const parts = key.split(".")
  if (parts.length !== 3) return // sb_secret_… or similar: nothing to compare.

  let keyRef: string | undefined
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64").toString("utf8"))
    keyRef = payload?.ref
  } catch {
    return // Unparseable: let Supabase be the judge.
  }

  if (keyRef && keyRef !== urlRef) {
    throw new Error(
      `Supabase project mismatch: NEXT_PUBLIC_SUPABASE_URL points at "${urlRef}" ` +
        `but SUPABASE_SERVICE_ROLE_KEY belongs to "${keyRef}". ` +
        `Running against staging needs all three variables overridden, not just the URL.`,
    )
  }
}
