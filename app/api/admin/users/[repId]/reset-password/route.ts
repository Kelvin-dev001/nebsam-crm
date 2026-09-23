import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth/requireAdmin"
import { createAdminClient } from "@/lib/supabase/admin"
import { generateTempPassword } from "@/lib/auth/tempPassword"
import { writeAudit } from "@/lib/auth/audit"

// Issue a new temporary password and force a change (§8.6).
//
// This is the ONLY recovery path in the system. U-D2: there is no email flow
// and no "forgot password" — the login page tells users to ask their
// administrator, and this is what the administrator does.

export async function POST(
  _request: Request,
  { params }: { params: { repId: string } },
) {
  const guard = await requireAdmin()
  if (!guard.ok) return guard.response

  const admin = createAdminClient()

  const { data: rep } = await admin
    .from("telemarketers")
    .select("*, departments(name, slug)")
    .eq("id", params.repId)
    .maybeSingle()

  if (!rep) {
    return NextResponse.json({ ok: false, error: "That rep no longer exists." }, { status: 404 })
  }
  if (!rep.user_id) {
    return NextResponse.json(
      { ok: false, error: `${rep.full_name} has no login yet. Use "Create login" instead.` },
      { status: 409 },
    )
  }

  const tempPassword = generateTempPassword()

  const { data: updated, error } = await admin.auth.admin.updateUserById(rep.user_id, {
    password: tempPassword,
    app_metadata: { must_change_password: true },
  })

  if (error || !updated?.user) {
    console.error("[reset-password] update failed:", error?.message)
    return NextResponse.json(
      { ok: false, error: "Could not reset the password. Please try again." },
      { status: 500 },
    )
  }

  // End every existing session. Without this, a login left open on a shared
  // office computer keeps working after the reset — which defeats the point of
  // resetting it. Proven to work on staging in U1 (§7.5): the session row is
  // deleted, getUser() returns null and the refresh token is refused.
  const { data: revoked, error: revokeErr } = await admin.rpc("revoke_user_sessions", {
    p_user_id: rep.user_id,
  })
  if (revokeErr) {
    // Not fatal: the password has already changed, so the old one is dead. Say
    // nothing to the browser, but record it — a reset that could not end other
    // sessions is worth knowing about.
    console.error("[reset-password] session revoke failed:", revokeErr.message)
  }

  await writeAudit(admin, guard, {
    action: "password_reset",
    target_user_id: rep.user_id,
    target_rep_id: rep.id,
    details: {
      sessions_revoked: revokeErr ? null : revoked,
      revoke_failed: Boolean(revokeErr),
    },
  })

  const dept = (rep as unknown as { departments: { name: string; slug: string } | null }).departments

  // The temporary password crosses the wire exactly once, here.
  return NextResponse.json({
    ok: true,
    tempPassword,
    email: rep.email,
    full_name: rep.full_name,
    department: dept ? { name: dept.name, slug: dept.slug } : null,
  })
}
