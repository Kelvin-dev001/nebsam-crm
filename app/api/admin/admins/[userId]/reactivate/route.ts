import { NextResponse } from "next/server"
import { z } from "zod"
import { requireAdmin } from "@/lib/auth/requireAdmin"
import { createAdminClient } from "@/lib/supabase/admin"
import { generateTempPassword } from "@/lib/auth/tempPassword"
import { verifyActorPassword, STEP_UP_FAILED } from "@/lib/auth/verifyActorPassword"
import { writeAudit } from "@/lib/auth/audit"

// Bring an administrator back (§8.8). Step-up required.
//
// Always issues a NEW temporary password. Someone whose admin access was
// removed may have shared the old one or left it in a browser; restoring it
// unchanged would carry all of that forward into an account that can see every
// lead in every department.
//
// No guard is needed: reactivating can never reduce the administrator count.

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

  const admin = createAdminClient()
  const stepUp = await verifyActorPassword(admin, guard, parsed.data.actorPassword, {
    action: "admin_reactivated", target_user_id: params.userId,
  })
  if (!stepUp) return NextResponse.json({ ok: false, error: STEP_UP_FAILED }, { status: 403 })

  const { data: profile } = await admin
    .from("admin_profiles").select("*").eq("user_id", params.userId).maybeSingle()
  if (!profile) {
    return NextResponse.json({ ok: false, error: "That administrator does not exist." }, { status: 404 })
  }

  const { error: reErr } = await admin.rpc("reactivate_admin", { p_target: params.userId })
  if (reErr) {
    console.error("[admins reactivate] failed:", reErr.message)
    return NextResponse.json({ ok: false, error: reErr.message }, { status: 400 })
  }

  const tempPassword = generateTempPassword()
  const { data: target, error: authErr } = await admin.auth.admin.updateUserById(params.userId, {
    ban_duration: "none",
    password: tempPassword,
    app_metadata: { must_change_password: true },
  })

  if (authErr) {
    console.error("[admins reactivate] auth update failed:", authErr.message)
    return NextResponse.json(
      { ok: false, error: "Their roster row was restored, but the login was not. Press Retry.", stage: "auth" },
      { status: 500 },
    )
  }

  await writeAudit(admin, guard, {
    action: "admin_reactivated",
    target_kind: "admin",
    target_user_id: params.userId,
    details: { full_name: profile.full_name },
  })

  return NextResponse.json({
    ok: true, tempPassword, email: target?.user?.email ?? null, full_name: profile.full_name,
  })
}
