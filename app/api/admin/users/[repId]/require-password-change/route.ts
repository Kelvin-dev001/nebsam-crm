import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth/requireAdmin"
import { createAdminClient } from "@/lib/supabase/admin"
import { writeAudit } from "@/lib/auth/audit"

// Set must_change_password WITHOUT resetting the password (§3 item 3).
//
// This is the button Kelvin presses for the three existing reps when he is
// ready. His decision (2026-09-22) was NOT to force a change at rollout: doing
// it automatically would interrupt whoever signs in first, mid-workday, with
// no warning and probably a phone call to him.
//
// The difference from Reset password matters: the person keeps their current
// password and can still sign in with it. They are simply asked to choose a new
// one before they can reach the app. Nothing is issued, so there is nothing to
// share and no dialog — which is exactly why it is safe to press for all three
// at once.

export async function POST(
  _request: Request,
  { params }: { params: { repId: string } },
) {
  const guard = await requireAdmin()
  if (!guard.ok) return guard.response

  const admin = createAdminClient()

  const { data: rep } = await admin
    .from("telemarketers")
    .select("id, full_name, user_id")
    .eq("id", params.repId)
    .maybeSingle()

  if (!rep) {
    return NextResponse.json({ ok: false, error: "That rep no longer exists." }, { status: 404 })
  }
  if (!rep.user_id) {
    return NextResponse.json(
      { ok: false, error: `${rep.full_name} has no login yet.` },
      { status: 409 },
    )
  }

  const { error } = await admin.auth.admin.updateUserById(rep.user_id, {
    app_metadata: { must_change_password: true },
  })

  if (error) {
    console.error("[require-password-change] failed:", error.message)
    return NextResponse.json(
      { ok: false, error: "Could not set the flag. Please try again." },
      { status: 500 },
    )
  }

  // Sessions are deliberately NOT revoked. The point is to prompt at the next
  // navigation, not to throw someone out of the app mid-call.
  await writeAudit(admin, guard, {
    action: "password_change_required",
    target_user_id: rep.user_id,
    target_rep_id: rep.id,
  })

  return NextResponse.json({
    ok: true,
    full_name: rep.full_name,
  })
}
