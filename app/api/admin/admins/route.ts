import { NextResponse } from "next/server"
import { z } from "zod"
import { requireAdmin } from "@/lib/auth/requireAdmin"
import { createAdminClient } from "@/lib/supabase/admin"
import { generateTempPassword } from "@/lib/auth/tempPassword"
import { verifyActorPassword, STEP_UP_FAILED } from "@/lib/auth/verifyActorPassword"
import { writeAudit } from "@/lib/auth/audit"
import { normalizePhone } from "@/lib/utils/phoneHelpers"

// Create a named administrator (§8.8). Step-up required.
//
// This is the action that ends the shared login. Every admin created here is a
// real person with their own credentials, so from this point the audit trail
// names someone rather than saying "admin".

const Schema = z.object({
  full_name: z.string().trim().min(2, "Full name is required."),
  email: z.string().trim().toLowerCase().email("That does not look like an email address."),
  phone: z.string().trim().optional().nullable(),
  actorPassword: z.string().min(1, "Enter your password to continue."),
})

export async function POST(request: Request) {
  const guard = await requireAdmin()
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

  const input = parsed.data
  const admin = createAdminClient()

  const stepUp = await verifyActorPassword(admin, guard, input.actorPassword, {
    action: "admin_created",
  })
  if (!stepUp) {
    return NextResponse.json({ ok: false, error: STEP_UP_FAILED }, { status: 403 })
  }

  // Every email belongs to exactly one login (Supabase enforces it). Say what
  // KIND of thing holds it, never whose account it is — an admin screen should
  // not confirm that a given address belongs to a particular person.
  const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 })
  const taken = list?.users.find((u) => u.email?.toLowerCase() === input.email)

  if (taken) {
    const { data: asRep } = await admin
      .from("telemarketers").select("id").eq("user_id", taken.id).maybeSingle()
    return NextResponse.json(
      {
        ok: false,
        error: asRep
          ? `This email already belongs to a sales rep login. Use a different address, or free ` +
            `this one by changing that rep's login email first.`
          : `This email already belongs to another login.`,
      },
      { status: 409 },
    )
  }

  const tempPassword = generateTempPassword()

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email: input.email,
    password: tempPassword,
    email_confirm: true,
    app_metadata: { role: "admin", must_change_password: true },
    user_metadata: { full_name: input.full_name },
  })

  if (createErr || !created?.user) {
    console.error("[admins POST] createUser failed:", createErr?.message)
    return NextResponse.json({ ok: false, error: "Could not create the login." }, { status: 400 })
  }

  const { error: profileErr } = await admin.from("admin_profiles").insert({
    user_id: created.user.id,
    full_name: input.full_name,
    phone: input.phone ? normalizePhone(input.phone) : null,
    is_active: true,
    is_shared_account: false,
    created_by: guard.user.id,
  })

  if (profileErr) {
    // An auth user with role=admin and NO roster row is powerless — is_admin()
    // requires all three conditions — but it would appear under "Unrecognised
    // logins" and look exactly like an intrusion. Never leave one behind.
    await admin.auth.admin.deleteUser(created.user.id)
    console.error("[admins POST] admin_profiles insert failed:", profileErr.message)
    return NextResponse.json(
      { ok: false, error: "Could not create the administrator record. Nothing was saved." },
      { status: 500 },
    )
  }

  await writeAudit(admin, guard, {
    action: "admin_created",
    target_kind: "admin",
    target_user_id: created.user.id,
    details: { full_name: input.full_name, email: input.email },
  })

  return NextResponse.json({
    ok: true,
    tempPassword,
    email: input.email,
    full_name: input.full_name,
  })
}
