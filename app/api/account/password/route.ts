import { requireUser } from "@/lib/auth/requireUser"
import { notImplemented } from "@/lib/auth/notImplemented"

// Any signed-in user changes their own password (§8.7).
//
// requireUser, not requireAdmin: a rep changing their own password is the
// normal case. The handler will verify the CURRENT password against a
// throwaway server-side client before accepting the new one, so possession of
// a session alone is not enough to change it.

export async function POST() {
  const guard = await requireUser()
  if (!guard.ok) return guard.response
  return notImplemented("U3")
}
