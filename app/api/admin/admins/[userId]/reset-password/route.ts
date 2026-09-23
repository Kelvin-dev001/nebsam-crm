import { NextResponse } from "next/server"
import { z } from "zod"
import { requireAdmin } from "@/lib/auth/requireAdmin"
import { createAdminClient } from "@/lib/supabase/admin"
import { generateTempPassword } from "@/lib/auth/tempPassword"
import { verifyActorPassword, STEP_UP_FAILED } from "@/lib/auth/verifyActorPassword"
import { writeAudit } from "@/lib/auth/audit"

// Reset another administrator's password (§8.8). Step-up required.
//
// Refused for the caller's own row: an admin changing their own password uses
// "Change password" in the user menu, which requires their CURRENT password.
// Allowing self-reset here would let an unattended session set a new password
// without knowing the old one — the exact thing step-up exists to stop.

const Schema = z.object({ actorPassword: z.string().min(1, "Enter your password to continue.") })

export async function POST(request: Request, { params }: { params: { userId: string } }) {
  const guard = await requireAdmin()
  if (!guard.ok) return guard.response

  let raw: unknown = {}
  try { raw = await request.json() } catch { /* handled by the schema */ }
  const parsed = Schema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: parsed.error.issues[0]?.message }, { status: 400 })
  }

  if (params.userId === guard.user.id) {
    return NextResponse.json(
      { ok: false, error: "Use Change password in your user menu for your own account." },
      { status: 400 },
    )
  }

  const admin = createAdminClient()
  const stepUp = await verifyActorPassword(admin, guard, parsed.data.actorPassword, {
    action: "admin_password_reset", target_user_id: params.userId,
  })
  if (!stepUp) return NextResponse.json({ ok: false, error: STEP_UP_FAILED }, { status: 403 })

  const { data: profile } = await admin
    .from("admin_profiles").select("*").eq("user_id", params.userId).maybeSingle()
  if (!profile) {
    return NextResponse.json({ ok: false, error: "That administrator does not exist." }, { status: 404 })
  }

  const { data: target } = await admin.auth.admin.getUserById(params.userId)
  const tempPassword = generateTempPassword()

  const { error } = await admin.auth.admin.updateUserById(params.userId, {
    password: tempPassword,
    app_metadata: { must_change_password: true },
  })
  if (error) {
    console.error("[admins reset] failed:", error.message)
    return NextResponse.json({ ok: false, error: "Could not reset the password." }, { status: 500 })
  }

  const { error: revokeErr } = await admin.rpc("revoke_user_sessions", { p_user_id: params.userId })
  if (revokeErr) console.error("[admins reset] revoke failed:", revokeErr.message)

  await writeAudit(admin, guard, {
    action: "admin_password_reset",
    target_kind: "admin",
    target_user_id: params.userId,
    details: { full_name: profile.full_name },
  })

  return NextResponse.json({
    ok: true, tempPassword, email: target?.user?.email ?? null, full_name: profile.full_name,
  })
}
