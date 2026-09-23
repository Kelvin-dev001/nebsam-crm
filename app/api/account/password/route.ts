import { NextResponse } from "next/server"
import { z } from "zod"
import { requireUser } from "@/lib/auth/requireUser"
import { createAdminClient } from "@/lib/supabase/admin"
import { verifyPassword } from "@/lib/auth/verifyPassword"
import { checkPasswordPolicy } from "@/lib/auth/passwordPolicy"

// Any signed-in user changes their own password (§8.7).
//
// requireUser, not requireAdmin: a rep changing their own password is the
// normal case, and an admin uses this same route from their user menu.

const Schema = z.object({
  current_password: z.string().min(1, "Enter your current password."),
  new_password: z.string().min(1, "Enter a new password."),
})

export async function POST(request: Request) {
  const guard = await requireUser()
  if (!guard.ok) return guard.response

  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 })
  }

  const parsed = Schema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.issues[0]?.message ?? "Please check the form." },
      { status: 400 },
    )
  }

  const { current_password, new_password } = parsed.data
  const email = guard.user.email

  if (!email) {
    return NextResponse.json(
      { ok: false, error: "Your account has no email address. Contact your administrator." },
      { status: 400 },
    )
  }

  const policyError = checkPasswordPolicy(new_password)
  if (policyError) {
    return NextResponse.json({ ok: false, error: policyError }, { status: 400 })
  }

  if (new_password === current_password) {
    return NextResponse.json(
      { ok: false, error: "Your new password must be different from your current one." },
      { status: 400 },
    )
  }

  // Prove they know the CURRENT password. Holding a session is not enough — a
  // browser left unlocked would otherwise be enough to lock its owner out.
  // The email comes from getUser(), never from the body.
  const correct = await verifyPassword(email, current_password)
  if (!correct) {
    return NextResponse.json(
      { ok: false, error: "Your current password was not correct." },
      { status: 403 },
    )
  }

  const admin = createAdminClient()

  // GoTrue MERGES app_metadata, so role survives and only the flag is cleared.
  const { error } = await admin.auth.admin.updateUserById(guard.user.id, {
    password: new_password,
    app_metadata: { must_change_password: false },
  })

  if (error) {
    console.error("[account/password] update failed:", error.message)
    return NextResponse.json(
      { ok: false, error: "Could not update your password. Please try again." },
      { status: 500 },
    )
  }

  // Resolve a display name for the activity feed. Without this the feed reads
  // "password_changed by null", which is worse than useless on a screen whose
  // whole purpose is answering "who did this?".
  //
  // Looked up here and SNAPSHOTTED, like every other audit row: the log must
  // still read correctly after the person is renamed or deactivated.
  const [{ data: asAdmin }, { data: asRep }] = await Promise.all([
    admin.from("admin_profiles").select("full_name").eq("user_id", guard.user.id).maybeSingle(),
    admin.from("telemarketers").select("full_name").eq("user_id", guard.user.id).maybeSingle(),
  ])
  const actorName = asAdmin?.full_name ?? asRep?.full_name ?? email

  // Audit it. NEVER the password — not the old one, not the new one, not a
  // hash, not a length (§5.1).
  const { error: auditErr } = await admin.from("user_admin_audit").insert({
    action: "password_changed",
    target_kind: asAdmin ? "admin" : "rep",
    target_user_id: guard.user.id,
    target_rep_id: null,
    performed_by: guard.user.id,
    performed_by_name: actorName,
    performed_by_email: email,
    details: { self_service: true },
  })
  if (auditErr) console.error("[account/password] audit failed:", auditErr.message)

  return NextResponse.json({ ok: true })
}
