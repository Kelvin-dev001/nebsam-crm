import { NextResponse } from "next/server"
import { z } from "zod"
import { requireAdmin } from "@/lib/auth/requireAdmin"
import { createAdminClient } from "@/lib/supabase/admin"
import { writeAudit } from "@/lib/auth/audit"
import { normalizePhone } from "@/lib/utils/phoneHelpers"

// Edit a rep's name, phone, job title or login email (§8.4).
//
// Department is NOT editable here. Moving departments moves work, so it has its
// own route, its own dialog and its own inheritor step — see ./department.
// Allowing it here would let an admin strand a queue with one careless click.

const Schema = z.object({
  full_name: z.string().trim().min(2, "Full name is required.").optional(),
  phone: z.string().trim().nullable().optional(),
  job_title: z.string().trim().nullable().optional(),
  email: z.string().trim().toLowerCase().email("That does not look like an email address.").optional(),
})

export async function PATCH(
  request: Request,
  { params }: { params: { repId: string } },
) {
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

  const { data: rep } = await admin
    .from("telemarketers").select("*").eq("id", params.repId).maybeSingle()

  if (!rep) {
    return NextResponse.json({ ok: false, error: "That rep no longer exists." }, { status: 404 })
  }

  const emailChanged = Boolean(input.email && input.email !== rep.email?.toLowerCase())

  // An email change has to be unique across BOTH places, and they are not the
  // same column: auth.users.email is the login, telemarketers.email is the
  // record. A rep row can exist with no login at all.
  if (emailChanged) {
    const { data: clash } = await admin
      .from("telemarketers").select("id, full_name").eq("email", input.email!).neq("id", params.repId).maybeSingle()
    if (clash) {
      return NextResponse.json(
        { ok: false, error: `${input.email} is already used by ${clash.full_name}.` },
        { status: 409 },
      )
    }

    const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 })
    const taken = list?.users.find(
      (u) => u.email?.toLowerCase() === input.email && u.id !== rep.user_id,
    )
    if (taken) {
      return NextResponse.json(
        { ok: false, error: `${input.email} already belongs to another login.` },
        { status: 409 },
      )
    }
  }

  const patch: {
    full_name?: string
    job_title?: string | null
    phone?: string | null
    email?: string
  } = {}
  if (input.full_name !== undefined) patch.full_name = input.full_name
  if (input.job_title !== undefined) patch.job_title = input.job_title || null
  if (input.phone !== undefined) patch.phone = input.phone ? normalizePhone(input.phone) : null
  if (input.email !== undefined) patch.email = input.email

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ ok: true, unchanged: true, rep })
  }

  const { data: updated, error } = await admin
    .from("telemarketers").update(patch).eq("id", params.repId).select("*").single()

  if (error) {
    console.error("[users PATCH] failed:", error.message)
    return NextResponse.json({ ok: false, error: "Could not save the changes." }, { status: 500 })
  }

  // Keep the login email in step. An admin editing the address on this screen
  // means "this is their address now", so both have to move or the two drift
  // apart — which is exactly how the existing .com / .co.ke split happened.
  if (emailChanged && rep.user_id) {
    const { error: authErr } = await admin.auth.admin.updateUserById(rep.user_id, {
      email: input.email!,
      email_confirm: true,
    })
    if (authErr) {
      console.error("[users PATCH] login email update failed:", authErr.message)
      return NextResponse.json(
        {
          ok: false,
          stage: "login_email",
          error:
            `The rep record was saved, but their LOGIN email is still ` +
            `${rep.email}. They must keep signing in with the old address until this is retried.`,
        },
        { status: 500 },
      )
    }
  }

  await writeAudit(admin, guard, {
    action: "profile_updated",
    target_user_id: rep.user_id,
    target_rep_id: rep.id,
    details: {
      changed: Object.keys(patch),
      ...(emailChanged ? { email_from: rep.email, email_to: input.email } : {}),
    },
  })

  return NextResponse.json({ ok: true, rep: updated })
}
