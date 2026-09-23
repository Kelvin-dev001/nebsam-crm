import { NextResponse } from "next/server"
import { z } from "zod"
import { requireAdmin } from "@/lib/auth/requireAdmin"
import { createAdminClient } from "@/lib/supabase/admin"
import { verifyActorPassword, STEP_UP_FAILED } from "@/lib/auth/verifyActorPassword"
import { writeAudit } from "@/lib/auth/audit"

// Deactivate another administrator (§8.8). Step-up required.
//
// The not-self and not-last-admin rules are enforced by deactivate_admin_guarded
// (§7.6), NOT here. Checking in the route would be a race: two admins
// deactivating each other at the same instant would both see a count of 2, both
// proceed, and the system would end with ZERO administrators — recoverable only
// by the break-glass script. The function takes an advisory lock so the check
// and the write cannot interleave.
//
// Admins own no leads, so there is no reassignment step.

const Schema = z.object({
  actorPassword: z.string().min(1, "Enter your password to continue."),
  reason: z.string().trim().max(500).optional().nullable(),
})

const BAN_FOREVER = "876000h"

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
    action: "admin_deactivated", target_user_id: params.userId,
  })
  if (!stepUp) return NextResponse.json({ ok: false, error: STEP_UP_FAILED }, { status: 403 })

  const { data: profile } = await admin
    .from("admin_profiles").select("*").eq("user_id", params.userId).maybeSingle()

  // The guard decides. Its messages are written for humans, so show them as-is.
  const { data: result, error: guardErr } = await admin.rpc("deactivate_admin_guarded", {
    p_target: params.userId,
    p_actor: guard.user.id,
    p_reason: parsed.data.reason?.trim() || null,
  })

  if (guardErr) {
    return NextResponse.json({ ok: false, error: guardErr.message }, { status: 400 })
  }

  const res = result as unknown as { ok: boolean; already?: boolean; remaining_admins?: number }

  // From here they are ALREADY powerless: is_admin() reads admin_profiles live,
  // and requireAdmin checks is_active. The ban below is belt and braces, so a
  // failure is reported rather than treated as fatal.
  const warnings: string[] = []
  if (!res.already) {
    const { error: banErr } = await admin.auth.admin.updateUserById(params.userId, {
      ban_duration: BAN_FOREVER,
    })
    if (banErr) { console.error("[admins deactivate] ban failed:", banErr.message); warnings.push("their login could not be blocked") }

    const { error: revokeErr } = await admin.rpc("revoke_user_sessions", { p_user_id: params.userId })
    if (revokeErr) { console.error("[admins deactivate] revoke failed:", revokeErr.message); warnings.push("open sessions could not be ended") }
  }

  await writeAudit(admin, guard, {
    action: profile?.is_shared_account ? "shared_admin_retired" : "admin_deactivated",
    target_kind: "admin",
    target_user_id: params.userId,
    details: {
      full_name: profile?.full_name ?? null,
      reason: parsed.data.reason?.trim() || null,
      remaining_admins: res.remaining_admins ?? null,
      warnings: warnings.length ? warnings : undefined,
    },
  })

  return NextResponse.json({
    ok: true,
    already: res.already ?? false,
    remaining_admins: res.remaining_admins ?? null,
    full_name: profile?.full_name ?? null,
    warnings: warnings.length ? warnings : undefined,
  })
}
