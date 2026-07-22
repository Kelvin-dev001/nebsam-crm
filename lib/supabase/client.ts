import { createBrowserClient } from "@supabase/ssr"
import { Database } from "./types"

// Single shared browser client for the whole app.
//
// createBrowserClient() returns a NEW client on every call, and each one spins
// up its own GoTrueClient with its own token-refresh timer. With ~a dozen call
// sites (widgets, providers, modals) that means a dozen auth instances all
// racing to refresh the SAME single-use refresh token the moment the access
// token expires. One wins, the rest get "refresh token already used", the
// session is invalidated, and every subsequent request hangs — which is exactly
// the "works on login, dies after a few minutes" symptom. A singleton keeps
// token refresh under one owner.
let browserClient: ReturnType<typeof createBrowserClient<Database>> | undefined

export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  // Surface misconfiguration loudly. Without these, createBrowserClient builds a
  // client whose requests silently hang forever — which reads as "loading" in the
  // UI with no error. A visible console error makes the real cause obvious.
  if (!url || !anonKey) {
    console.error(
      "[supabase] Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY. " +
        "Data requests will not work. Check the deployment's environment variables."
    )
  }

  if (!browserClient) {
    browserClient = createBrowserClient<Database>(url!, anonKey!)
  }
  return browserClient
}
