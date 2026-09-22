import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"
import type { User } from "@supabase/supabase-js"
import type { AdminProfile } from "./requireAdmin"

/**
 * Writes one row to `user_admin_audit`.
 *
 * WHY THE ACTOR IS SNAPSHOTTED
 * ----------------------------
 * `performed_by_name` and `performed_by_email` are copied in at write time
 * rather than joined at read time. The log has to keep reading correctly after
 * an admin is renamed, has their login email changed, or is deactivated — which
 * is the entire point of moving off one shared admin account. A join would
 * silently rewrite history every time someone's details changed.
 *
 * The email comes from `getUser()`, never from the request body, so a caller
 * cannot attribute their action to somebody else.
 *
 * NEVER PUT A PASSWORD IN `details`. Not a temporary one, not a hash, not a
 * prefix. §5.1: a temporary password exists in exactly one HTTP response and
 * one dialog, and nowhere else ever.
 *
 * Failure here is logged but never thrown. An audit write that fails must not
 * roll back the action the admin actually asked for — losing one log line is
 * bad, but telling an admin their deactivation failed when it succeeded is
 * worse, and would push them into retrying a half-applied change.
 */
export async function writeAudit(
  admin: SupabaseClient,
  actor: { user: User; adminProfile: AdminProfile },
  entry: {
    action: string
    target_kind?: "rep" | "admin"
    target_user_id?: string | null
    target_rep_id?: string | null
    details?: Record<string, unknown>
  },
): Promise<void> {
  const { error } = await admin.from("user_admin_audit").insert({
    action: entry.action,
    target_kind: entry.target_kind ?? "rep",
    target_user_id: entry.target_user_id ?? null,
    target_rep_id: entry.target_rep_id ?? null,
    performed_by: actor.user.id,
    performed_by_name: actor.adminProfile.full_name,
    performed_by_email: actor.user.email ?? null,
    details: (entry.details ?? {}) as never,
  })

  if (error) {
    console.error(`[audit] failed to record "${entry.action}":`, error.message)
  }
}
