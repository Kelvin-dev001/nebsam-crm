import "server-only"

import { createClient } from "@supabase/supabase-js"

/**
 * Checks a password without disturbing the caller's session.
 *
 * Used in two places:
 *   · `/api/account/password` — proving you know your CURRENT password before
 *     you are allowed to set a new one. Possession of a session is not enough:
 *     a browser left unlocked on a shared office computer would otherwise let
 *     anyone walking past change that person's password and lock them out.
 *   · U4b's step-up, where an admin re-enters their own password before
 *     creating, resetting or deactivating another admin.
 *
 * WHY A THROWAWAY CLIENT
 * ----------------------
 * `signInWithPassword` issues a fresh session. Calling it on the request's own
 * SSR client would overwrite the caller's cookies — so a user changing their
 * password, or an admin doing a step-up, would silently have their session
 * swapped underneath them. This client has `persistSession: false` and writes
 * no cookies, so the session it creates is discarded the moment this function
 * returns.
 *
 * The email must come from `getUser()`, never from the request body. Letting a
 * caller supply the email would turn this into an oracle for testing passwords
 * against other people's accounts.
 */
export async function verifyPassword(email: string, password: string): Promise<boolean> {
  if (!email || !password) return false

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anon) throw new Error("Supabase URL or anon key is not set")

  const throwaway = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data, error } = await throwaway.auth.signInWithPassword({ email, password })

  // Tidy up the session this just minted so it cannot be reused. Failure here
  // is not fatal: the session was never persisted anywhere, and it expires.
  if (data?.session) {
    await throwaway.auth.signOut().catch(() => {})
  }

  return !error && Boolean(data?.user)
}
