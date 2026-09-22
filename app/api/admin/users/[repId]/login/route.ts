import { NextResponse } from "next/server"
import { z } from "zod"
import { requireAdmin } from "@/lib/auth/requireAdmin"
import { createAdminClient } from "@/lib/supabase/admin"
import { generateTempPassword } from "@/lib/auth/tempPassword"
import { writeAudit } from "@/lib/auth/audit"

// Create a login for an existing rep row that has none (defect 3).
//
// The old "Add Telemarketer" button inserted a telemarketers row straight from
// the browser and created no auth user at all, so the person it described could
// never sign in — and nothing in the UI said so. This is the repair path for
// any row left behind that way.

const Schema = z.object({
  email: z.string().trim().toLowerCase().email("That does not look like an email address.").optional(),
})

export async function POST(
  request: Request,
  { params }: { params: { repId: string } },
) {
  const guard = await requireAdmin()
  if (!guard.ok) return guard.response

  let raw: unknown = {}
  try {
    raw = await request.json()
  } catch {
    // Body is optional — with no email we fall back to the rep's own.
  }

  const parsed = Schema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.issues[0]?.message ?? "Please check the form." },
      { status: 400 },
    )
  }

  const admin = createAdminClient()

  const { data: rep } = await admin
    .from("telemarketers")
    .select("*, departments(name)")
    .eq("id", params.repId)
    .maybeSingle()

  if (!rep) {
    return NextResponse.json({ ok: false, error: "That rep no longer exists." }, { status: 404 })
  }
  if (rep.user_id) {
    return NextResponse.json(
      { ok: false, error: `${rep.full_name} already has a login. Use Reset password instead.` },
      { status: 409 },
    )
  }

  const email = parsed.data.email ?? rep.email?.trim().toLowerCase()
  if (!email) {
    return NextResponse.json(
      { ok: false, error: "This rep has no email address. Add one first." },
      { status: 400 },
    )
  }

  const { data: authList } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 })
  if (authList?.users.some((u) => u.email?.toLowerCase() === email)) {
    return NextResponse.json(
      {
        ok: false,
        error:
          `${email} already has a login belonging to someone else. ` +
          `Give this rep a different address.`,
      },
      { status: 409 },
    )
  }

  const tempPassword = generateTempPassword()

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password: tempPassword,
    email_confirm: true,
    app_metadata: { role: "telemarketer", must_change_password: true },
    user_metadata: { full_name: rep.full_name },
  })

  if (createErr || !created?.user) {
    console.error("[users/login] createUser failed:", createErr?.message)
    return NextResponse.json({ ok: false, error: "Could not create the login." }, { status: 400 })
  }

  const { error: linkErr } = await admin
    .from("telemarketers")
    .update({ user_id: created.user.id, email })
    .eq("id", params.repId)

  if (linkErr) {
    // Same rule as §8.3 step 6: never leave a login with no rep row behind it.
    await admin.auth.admin.deleteUser(created.user.id)
    console.error("[users/login] link failed:", linkErr.message)
    return NextResponse.json(
      { ok: false, error: "Could not link the login to the rep. Nothing was saved." },
      { status: 500 },
    )
  }

  await writeAudit(admin, guard, {
    action: "login_created",
    target_user_id: created.user.id,
    target_rep_id: rep.id,
    details: { email },
  })

  return NextResponse.json({
    ok: true,
    tempPassword,
    email,
    full_name: rep.full_name,
    department: {
      name: (rep as unknown as { departments: { name: string } | null }).departments?.name ?? null,
    },
  })
}
