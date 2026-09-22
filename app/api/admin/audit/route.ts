import { requireAdmin } from "@/lib/auth/requireAdmin"
import { notImplemented } from "@/lib/auth/notImplemented"

// The activity feed across all users, newest first (§8.9).
//
// Stub. The guard is live and tested; the logic arrives in U4b.
// requireAdmin() is the ONLY gate here — middleware.ts returns early for
// every /api path, and the handler will act through the service role,
// which bypasses RLS.

export async function GET() {
  const guard = await requireAdmin()
  if (!guard.ok) return guard.response
  return notImplemented("U4b")
}
