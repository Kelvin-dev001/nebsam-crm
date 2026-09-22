import type { User } from "@supabase/supabase-js"

/**
 * The single place the application reads a user's role.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Roles used to be read from `user_metadata`, in five different places. That
 * field is writable by the user it belongs to, from the browser, with the anon
 * key that ships in the bundle:
 *
 *     await supabase.auth.updateUser({ data: { role: 'admin' } })
 *
 * So any signed-in rep could make themselves an admin. `app_metadata` can only
 * be written by the service role, which is why authorization moved there in
 * migration 012.
 *
 * Funnelling every read through one function is what makes that enforceable:
 * `scripts/qa-test.mjs` greps for authorization reads of `user_metadata` and
 * fails if one ever comes back.
 *
 * NEVER read `user_metadata.role` again. It still holds the old value — 012
 * deliberately left it in place so that nothing broke during the cutover — and
 * it is not to be trusted for any decision.
 */

export type Role = "admin" | "telemarketer"

/**
 * The user's role, or null when the key is absent or holds something
 * unrecognised.
 *
 * Callers making an authorization decision should use `roleOrDefault` instead,
 * so that an unknown role can never be treated as admin.
 */
export function getRole(user: User | null | undefined): Role | null {
  const raw = (user?.app_metadata as { role?: unknown } | undefined)?.role
  return raw === "admin" || raw === "telemarketer" ? raw : null
}

/**
 * Fail closed: an unknown or missing role is treated as `telemarketer`, the
 * least-privileged role, and never as admin.
 *
 * This matters more than it looks. Several call sites are written as
 * `role === "telemarketer" ? … : …`, where the *else* branch is the admin path
 * — so a null role would silently take the admin branch. Always resolve through
 * here before branching.
 */
export function roleOrDefault(user: User | null | undefined): Role {
  return getRole(user) ?? "telemarketer"
}

/** Convenience for the common check. Fail-closed by construction. */
export function isAdminRole(user: User | null | undefined): boolean {
  return getRole(user) === "admin"
}
