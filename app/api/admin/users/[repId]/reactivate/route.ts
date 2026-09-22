import { requireAdmin } from "@/lib/auth/requireAdmin"
import { notImplemented } from "@/lib/auth/notImplemented"

// Unban, reactivate, and force a password change (§8.5).
//
// Stub. The guard is live and tested; the logic arrives in U4.
// requireAdmin() is the ONLY gate here — middleware.ts returns early for
// every /api path, and the handler will act through the service role,
// which bypasses RLS.

export async function POST() {
  const guard = await requireAdmin()
  if (!guard.ok) return guard.response
  return notImplemented("U4")
}
