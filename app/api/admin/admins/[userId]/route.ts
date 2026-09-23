import { NextResponse } from "next/server"
import { z } from "zod"
import { requireAdmin } from "@/lib/auth/requireAdmin"
import { createAdminClient } from "@/lib/supabase/admin"
import { writeAudit } from "@/lib/auth/audit"
import { normalizePhone } from "@/lib/utils/phoneHelpers"

// Edit an administrator's name, phone or login email (§8.8).
//
// No step-up: §8.8 requires it for create, reset, deactivate and reactivate —
// the actions that grant or revoke access — but not for edits. Admins may edit
// their own name and phone, which is the common case and should not demand a
// password every time.

const Schema = z.object({
  full_name: z.string().trim().min(2, "Full name is required.").optional(),
  phone: z.string().trim().nullable().optional(),
  email: z.string().trim().toLowerCase().email("That does not look like an email address.").optional(),
})

export async function PATCH(request: Request, { params }: { params: { userId: string } }) {
  const guard = await requireAdmin()
  if (!guard.ok) return guard.response

  let raw: unknown
  try { raw = await request.json() } catch {
    return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 })
  }
  const parsed = Schema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: parsed.error.issues[0]?.message }, { status: 400 })
  }

  const input = parsed.data
  const admin = createAdminClient()

  const { data: profile } = await admin
    .from("admin_profiles").select("*").eq("user_id", params.userId).maybeSingle()
  if (!profile) {
    return NextResponse.json({ ok: false, error: "That administrator does not exist." }, { status: 404 })
  }

  if (input.email) {
    const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 })
    const taken = list?.users.find(
      (u) => u.email?.toLowerCase() === input.email && u.id !== params.userId,
    )
    if (taken) {
      return NextResponse.json(
        { ok: false, error: "That email already belongs to another login." },
        { status: 409 },
      )
    }

    const { error: authErr } = await admin.auth.admin.updateUserById(params.userId, {
      email: input.email, email_confirm: true,
    })
    if (authErr) {
      console.error("[admins PATCH] email failed:", authErr.message)
      return NextResponse.json({ ok: false, error: "Could not change the login email." }, { status: 500 })
    }
  }

  const patch: { full_name?: string; phone?: string | null } = {}
  if (input.full_name !== undefined) patch.full_name = input.full_name
  if (input.phone !== undefined) patch.phone = input.phone ? normalizePhone(input.phone) : null

  if (Object.keys(patch).length > 0) {
    const { error } = await admin.from("admin_profiles").update(patch).eq("user_id", params.userId)
    if (error) {
      console.error("[admins PATCH] profile failed:", error.message)
      return NextResponse.json({ ok: false, error: "Could not save the changes." }, { status: 500 })
    }
  }

  await writeAudit(admin, guard, {
    action: "admin_profile_updated",
    target_kind: "admin",
    target_user_id: params.userId,
    details: { changed: [...Object.keys(patch), ...(input.email ? ["email"] : [])] },
  })

  return NextResponse.json({ ok: true })
}
