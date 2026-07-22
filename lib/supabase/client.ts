import { createBrowserClient } from "@supabase/ssr"
import { Database } from "./types"

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

  return createBrowserClient<Database>(url!, anonKey!)
}
