import { requireAdmin } from "@/lib/auth/requireAdmin"
import { notImplemented } from "@/lib/auth/notImplemented"

// Edit a rep's name, phone, job title or login email (§8.4).
//
// Stub. The guard is live and tested; the logic arrives in U2.
// requireAdmin() is the ONLY gate here — middleware.ts returns early for
// every /api path, and the handler will act through the service role,
// which bypasses RLS.

export async function PATCH() {
  const guard = await requireAdmin()
  if (!guard.ok) return guard.response
  return notImplemented("U2")
}
