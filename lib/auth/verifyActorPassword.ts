import "server-only"

import type { SupabaseClient, User } from "@supabase/supabase-js"
import { verifyPassword } from "./verifyPassword"
import type { AdminProfile } from "./requireAdmin"

/**
 * Step-up authentication for admin-targeted actions (U-D7c).
 *
 * WHY ADMIN ACTIONS NEED A SECOND FACTOR OF SORTS
 * -----------------------------------------------
 * Once named admins exist, one admin can create, reset, deactivate or reactivate
 * another — and retire the shared login. A browser left unlocked on a desk is
 * therefore enough to take over administrative access to the whole CRM, quietly,
 * with the owner's name on every audit line.
 *
 * Re-entering the password makes that require something the attacker does not
 * have. It is not MFA and does not pretend to be; it raises the cost of walking
 * past an unattended screen, which is the realistic threat in a shared office.
 *
 * Rep-targeted actions deliberately do NOT require it. Resetting a rep's
 * password is routine and reversible; demanding a password every time would
 * train admins to type it reflexively, which is worse than not asking.
 *
 * The email comes from getUser(), never the request body.
 *
 * A FAILURE IS AUDITED. Repeated step-up failures are exactly what someone
 * probing an unattended session looks like, and the activity feed should show
 * it. The attempted password is of course never recorded.
 */
export async function verifyActorPassword(
  admin: SupabaseClient,
  actor: { user: User; adminProfile: AdminProfile },
  actorPassword: string | undefined | null,
  attempted: { action: string; target_user_id?: string | null },
): Promise<boolean> {
  const email = actor.user.email
  if (!email || !actorPassword) {
    await recordFailure(admin, actor, attempted, "missing")
    return false
  }

  const ok = await verifyPassword(email, actorPassword)
  if (!ok) await recordFailure(admin, actor, attempted, "wrong")
  return ok
}

async function recordFailure(
  admin: SupabaseClient,
  actor: { user: User; adminProfile: AdminProfile },
  attempted: { action: string; target_user_id?: string | null },
  why: "missing" | "wrong",
) {
  const { error } = await admin.from("user_admin_audit").insert({
    action: "step_up_failed",
    target_kind: "admin",
    target_user_id: attempted.target_user_id ?? null,
    performed_by: actor.user.id,
    performed_by_name: actor.adminProfile.full_name,
    performed_by_email: actor.user.email ?? null,
    details: { attempted_action: attempted.action, reason: why },
  })
  if (error) console.error("[step-up] could not record the failure:", error.message)
}

/** The one message every step-up failure returns. Never says which part was wrong. */
export const STEP_UP_FAILED = "Your password was not correct."
