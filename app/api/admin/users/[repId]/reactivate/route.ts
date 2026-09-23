import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth/requireAdmin"
import { createAdminClient } from "@/lib/supabase/admin"
import { generateTempPassword } from "@/lib/auth/tempPassword"
import { writeAudit } from "@/lib/auth/audit"

// Bring a rep back: unban, reactivate, and issue a new temporary password.
//
// WHY A NEW PASSWORD IS FORCED
// Someone who has been away may have shared their password, written it down, or
// simply had it sitting in a browser on a machine they no longer use. Handing
// back the old one would carry all of that forward, so reactivation always
// issues a fresh temporary password and forces a change.
//
// LEADS ARE NOT RETURNED. Their old leads now belong to whoever inherited them
// and have been worked since. Silently pulling them back would take live work
// off another rep's queue with no record. The dialog says so and points at
// Admin -> Assignment.

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

  const { error: updErr } = await admin
    .from("telemarketers")
    .update({ is_active: true, deactivated_at: null, deactivated_reason: null })
    .eq("id", params.repId)

  if (updErr) {
    console.error("[reactivate] update failed:", updErr.message)
    return NextResponse.json(
      { ok: false, error: "Could not reactivate the rep." },
      { status: 500 },
    )
  }

  // No login to restore — an old row made by the pre-U2 button. They are active
  // again, but still cannot sign in until someone presses "Create login".
  if (!rep.user_id) {
    await writeAudit(admin, guard, {
      action: "reactivated",
      target_rep_id: rep.id,
      details: { note: "no login to restore" },
    })
    return NextResponse.json({
      ok: true,
      full_name: rep.full_name,
      no_login: true,
    })
  }

  const tempPassword = generateTempPassword()

  const { error: authErr } = await admin.auth.admin.updateUserById(rep.user_id, {
    ban_duration: "none",
    password: tempPassword,
    app_metadata: { must_change_password: true },
  })

  if (authErr) {
    console.error("[reactivate] auth update failed:", authErr.message)
    return NextResponse.json(
      {
        ok: false,
        error:
          "They were reactivated, but their login could not be restored. Press Retry.",
        stage: "auth",
      },
      { status: 500 },
    )
  }

  await writeAudit(admin, guard, {
    action: "reactivated",
    target_user_id: rep.user_id,
    target_rep_id: rep.id,
    details: { leads_returned: false },
  })

  const dept = (rep as unknown as { departments: { name: string; slug: string } | null }).departments

  return NextResponse.json({
    ok: true,
    tempPassword,
    email: rep.email,
    full_name: rep.full_name,
    department: dept ? { name: dept.name, slug: dept.slug } : null,
  })
}
