import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth/requireAdmin"
import { createAdminClient } from "@/lib/supabase/admin"
import { writeAudit } from "@/lib/auth/audit"

// Flag another administrator to change their password. No step-up: nothing is
// issued and nothing is revoked, so their current password keeps working. The
// worst an unattended session could do here is mildly inconvenience someone.

export async function POST(_request: Request, { params }: { params: { userId: string } }) {
  const guard = await requireAdmin()
  if (!guard.ok) return guard.response

  const admin = createAdminClient()
  const { data: profile } = await admin
    .from("admin_profiles").select("*").eq("user_id", params.userId).maybeSingle()
  if (!profile) {
    return NextResponse.json({ ok: false, error: "That administrator does not exist." }, { status: 404 })
  }

  const { error } = await admin.auth.admin.updateUserById(params.userId, {
    app_metadata: { must_change_password: true },
  })
  if (error) {
    console.error("[admins require-change] failed:", error.message)
    return NextResponse.json({ ok: false, error: "Could not set the flag." }, { status: 500 })
  }

  await writeAudit(admin, guard, {
    action: "admin_password_change_required",
    target_kind: "admin",
    target_user_id: params.userId,
    details: { full_name: profile.full_name },
  })

  return NextResponse.json({ ok: true, full_name: profile.full_name })
}
