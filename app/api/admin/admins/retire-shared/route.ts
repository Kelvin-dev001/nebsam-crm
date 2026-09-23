import { NextResponse } from "next/server"
import { z } from "zod"
import { requireAdmin } from "@/lib/auth/requireAdmin"
import { createAdminClient } from "@/lib/supabase/admin"
import { verifyActorPassword, STEP_UP_FAILED } from "@/lib/auth/verifyActorPassword"
import { writeAudit } from "@/lib/auth/audit"

// Retire the shared admin login (§8.8, U-D3). Step-up required.
//
// This is the point of the whole user-management project: after this, every
// administrative action in the audit trail names a real person, and the
// password that several people know stops working.
//
// It is DEACTIVATION, never deletion. admin_profiles.user_id is
// ON DELETE RESTRICT and the account owns audit history. Reactivate reverses
// it completely, which is what makes it safe to do.
//
// THE PRECONDITIONS ARE THE WHOLE SAFETY STORY
// --------------------------------------------
// A named admin account that exists is not proof that anyone can use it. It
// could have been created with a typo in the email, or its temporary password
// could have been lost before anyone signed in. Retiring the shared login on
// that basis would lock every human out of administering the CRM, and only the
// break-glass script could recover it.
//
// So a named admin must have PROVED the login works:
//   1. they have signed in at least once, AND
//   2. they have set their own password (must_change_password is false)
//
// Together those mean somebody received the temporary password, used it, and
// chose a new one. That is as close to "this account definitely works" as can
// be established without holding their password.

const Schema = z.object({ actorPassword: z.string().min(1, "Enter your password to continue.") })

const BAN_FOREVER = "876000h"

export async function POST(request: Request) {
  const guard = await requireAdmin()
  if (!guard.ok) return guard.response

  let raw: unknown = {}
  try { raw = await request.json() } catch { /* handled by the schema */ }
  const parsed = Schema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: parsed.error.issues[0]?.message }, { status: 400 })
  }

  const admin = createAdminClient()

  // The shared login cannot retire itself. Even with a correct password, an
  // unattended shared session must not be able to end the account it is using.
  if (guard.adminProfile.is_shared_account) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "The shared login cannot retire itself. Sign in with your own administrator account first.",
      },
      { status: 403 },
    )
  }

  const stepUp = await verifyActorPassword(admin, guard, parsed.data.actorPassword, {
    action: "shared_admin_retired",
  })
  if (!stepUp) return NextResponse.json({ ok: false, error: STEP_UP_FAILED }, { status: 403 })

  const { data: shared } = await admin
    .from("admin_profiles").select("*").eq("is_shared_account", true).maybeSingle()

  if (!shared) {
    return NextResponse.json(
      { ok: false, error: "There is no shared administrator login to retire." },
      { status: 404 },
    )
  }
  if (!shared.is_active) {
    return NextResponse.json({ ok: true, already: true, full_name: shared.full_name })
  }

  // ── The precondition: at least one PROVEN named admin ─────────────────────
  const { data: named } = await admin
    .from("admin_profiles").select("*").eq("is_shared_account", false).eq("is_active", true)

  const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 })
  const byId = new Map((list?.users ?? []).map((u) => [u.id, u]))

  const proven = (named ?? []).filter((p) => {
    const u = byId.get(p.user_id)
    if (!u) return false
    const signedIn = Boolean(u.last_sign_in_at)
    const chosePassword =
      (u.app_metadata as { must_change_password?: boolean } | undefined)?.must_change_password !== true
    const banned = Boolean(u.banned_until && new Date(u.banned_until) > new Date())
    return signedIn && chosePassword && !banned
  })

  if (proven.length === 0) {
    const why = (named ?? []).length === 0
      ? "There are no named administrator accounts yet."
      : "No named administrator has signed in and set their own password yet."
    return NextResponse.json(
      {
        ok: false,
        error:
          `${why} Retiring the shared login now could leave nobody able to administer the CRM. ` +
          `Have a named administrator sign in and choose their own password first.`,
        named_count: (named ?? []).length,
      },
      { status: 409 },
    )
  }

  // ── Retire it, through the same race-safe guard as any other admin ────────
  const { data: result, error: guardErr } = await admin.rpc("deactivate_admin_guarded", {
    p_target: shared.user_id,
    p_actor: guard.user.id,
    p_reason: "Retired: replaced by named administrator accounts",
  })

  if (guardErr) {
    return NextResponse.json({ ok: false, error: guardErr.message }, { status: 400 })
  }

  const warnings: string[] = []
  const { error: banErr } = await admin.auth.admin.updateUserById(shared.user_id, {
    ban_duration: BAN_FOREVER,
  })
  if (banErr) { console.error("[retire-shared] ban failed:", banErr.message); warnings.push("the login could not be blocked") }

  const { error: revokeErr } = await admin.rpc("revoke_user_sessions", { p_user_id: shared.user_id })
  if (revokeErr) { console.error("[retire-shared] revoke failed:", revokeErr.message); warnings.push("open sessions could not be ended") }

  await writeAudit(admin, guard, {
    action: "shared_admin_retired",
    target_kind: "admin",
    target_user_id: shared.user_id,
    details: {
      proven_named_admins: proven.map((p) => p.full_name),
      remaining_admins: (result as unknown as { remaining_admins?: number })?.remaining_admins ?? null,
      warnings: warnings.length ? warnings : undefined,
    },
  })

  return NextResponse.json({
    ok: true,
    full_name: shared.full_name,
    proven_named_admins: proven.map((p) => p.full_name),
    warnings: warnings.length ? warnings : undefined,
  })
}
