import { createClient } from "@/lib/supabase/client"

// Bulletproof sign-out. The default signOut() scope makes a server call to
// revoke the session — which HANGS when the current token is already stale or
// expired (exactly the state that makes logout appear to "just load forever").
// We use scope: "local" (clears local storage only, no network round-trip),
// race it against a short timeout as a safety net, clear persisted app state,
// then force a full navigation so middleware re-evaluates and lands on /login.
export async function performSignOut() {
  try {
    const supabase = createClient()
    await Promise.race([
      supabase.auth.signOut({ scope: "local" }),
      new Promise((resolve) => setTimeout(resolve, 2000)),
    ])
  } catch {
    // Ignore — we redirect regardless of what signOut does.
  }

  try {
    window.localStorage.removeItem("nebsam-active-telemarketer")
  } catch {
    // ignore storage errors
  }

  // Hard navigation guarantees the auth cookies are re-checked by middleware.
  window.location.href = "/login"
}
