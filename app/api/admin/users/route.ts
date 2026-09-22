import { NextResponse } from "next/server"
import { z } from "zod"
import { requireAdmin } from "@/lib/auth/requireAdmin"
import { createAdminClient } from "@/lib/supabase/admin"
import { generateTempPassword } from "@/lib/auth/tempPassword"
import { writeAudit } from "@/lib/auth/audit"
import { normalizePhone } from "@/lib/utils/phoneHelpers"

// GET  — the Users tab list (§8.2)
// POST — add a rep with a login (§8.3)
//
// requireAdmin() is the ONLY gate: middleware.ts returns early for every /api
// path, and everything below acts through the service role, which bypasses RLS.

// The shape of the telemarketers + departments embed. Declared here because
// lib/supabase/types.ts carries `Relationships: []`, so the generated types
// cannot infer an embedded select and collapse it to SelectQueryError.
interface RepWithDept {
  id: string
  full_name: string
  email: string | null
  phone: string | null
  job_title: string | null
  department_id: string | null
  is_active: boolean
  user_id: string | null
  departments: { id: string; name: string; slug: string } | null
}

export interface UserRow {
  rep_id: string | null
  user_id: string | null
  full_name: string
  login_email: string | null
  rep_email: string | null
  phone: string | null
  job_title: string | null
  department_id: string | null
  department_name: string | null
  is_active: boolean
  must_change_password: boolean
  banned: boolean
  last_sign_in_at: string | null
  open_leads: number
  pending_followups: number
  status: "active" | "must_change_password" | "deactivated" | "no_login"
}

export async function GET() {
  const guard = await requireAdmin()
  if (!guard.ok) return guard.response

  const admin = createAdminClient()

  // Auth users, paginated to exhaustion — listUsers caps per page.
  const authUsers: Array<Record<string, unknown>> = []
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 })
    if (error) {
      console.error("[admin/users] listUsers failed:", error.message)
      return NextResponse.json({ ok: false, error: "Could not read the login list." }, { status: 500 })
    }
    authUsers.push(...(data.users as unknown as Array<Record<string, unknown>>))
    if (data.users.length < 200) break
  }

  const [{ data: reps, error: repErr }, { data: workload }, { data: admins }] = await Promise.all([
    admin.from("telemarketers").select("*, departments(id, name, slug)").order("created_at"),
    admin.rpc("rep_workload"),
    admin.from("admin_profiles").select("*"),
  ])

  if (repErr) {
    console.error("[admin/users] telemarketers failed:", repErr.message)
    return NextResponse.json({ ok: false, error: "Could not read the rep list." }, { status: 500 })
  }

  const repRows = (reps ?? []) as unknown as RepWithDept[]
  const workRows = (workload ?? []) as unknown as Array<{
    rep_id: string; open_leads: number; pending_followups: number
  }>

  const byUserId = new Map(authUsers.map((u) => [u.id as string, u]))
  const workloadBy = new Map(workRows.map((w) => [w.rep_id, w]))

  const isBanned = (u: Record<string, unknown> | undefined) => {
    const b = u?.banned_until as string | undefined
    return Boolean(b && new Date(b) > new Date())
  }
  const mustChange = (u: Record<string, unknown> | undefined) =>
    (u?.app_metadata as { must_change_password?: boolean } | undefined)?.must_change_password === true

  const users: UserRow[] = repRows.map((r) => {
    const u = r.user_id ? byUserId.get(r.user_id) : undefined
    const w = workloadBy.get(r.id)
    const dept = r.departments

    // Deactivated wins over must-change: someone who cannot sign in at all
    // should not be shown as merely needing a new password.
    const status: UserRow["status"] = !r.user_id
      ? "no_login"
      : !r.is_active || isBanned(u)
        ? "deactivated"
        : mustChange(u)
          ? "must_change_password"
          : "active"

    return {
      rep_id: r.id,
      user_id: r.user_id,
      full_name: r.full_name,
      login_email: (u?.email as string) ?? null,
      rep_email: r.email,
      phone: r.phone,
      job_title: r.job_title,
      department_id: r.department_id,
      department_name: dept?.name ?? null,
      is_active: r.is_active,
      must_change_password: mustChange(u),
      banned: isBanned(u),
      last_sign_in_at: (u?.last_sign_in_at as string) ?? null,
      open_leads: Number(w?.open_leads ?? 0),
      pending_followups: Number(w?.pending_followups ?? 0),
      status,
    }
  })

  // Administrators, from the roster rather than from a role string.
  const adminRows = (admins ?? []).map((a) => {
    const u = byUserId.get(a.user_id)
    return {
      user_id: a.user_id,
      full_name: a.full_name,
      phone: a.phone,
      login_email: (u?.email as string) ?? null,
      is_active: a.is_active,
      is_shared_account: a.is_shared_account,
      created_by: a.created_by,
      last_sign_in_at: (u?.last_sign_in_at as string) ?? null,
      must_change_password: mustChange(u),
      banned: isBanned(u),
      status: !a.is_active || isBanned(u)
        ? "deactivated"
        : mustChange(u)
          ? "must_change_password"
          : "active",
    }
  })

  // Any login linked to NEITHER a rep row nor a roster row. This is how an
  // account created through the old user_metadata hole would surface, and how a
  // half-finished create would show up. Offer no action on it — see §8.2.
  const known = new Set<string>([
    ...repRows.map((r) => r.user_id).filter((v): v is string => Boolean(v)),
    ...(admins ?? []).map((a) => a.user_id),
  ])
  const unrecognised = authUsers
    .filter((u) => !known.has(u.id as string))
    .map((u) => ({
      user_id: u.id as string,
      email: (u.email as string) ?? null,
      created_at: (u.created_at as string) ?? null,
      role: (u.app_metadata as { role?: string } | undefined)?.role ?? null,
      last_sign_in_at: (u.last_sign_in_at as string) ?? null,
    }))

  return NextResponse.json({ ok: true, users, admins: adminRows, unrecognised })
}

// ── POST: add a rep with a login ────────────────────────────────────────────

const CreateSchema = z.object({
  full_name: z.string().trim().min(2, "Full name is required."),
  email: z.string().trim().toLowerCase().email("That does not look like an email address."),
  phone: z.string().trim().optional().nullable(),
  department_id: z.string().uuid("Choose a department."),
  job_title: z.string().trim().optional().nullable(),
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

  const parsed = CreateSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.issues[0]?.message ?? "Please check the form." },
      { status: 400 },
    )
  }
  const input = parsed.data
  const admin = createAdminClient()

  // Reject a duplicate BEFORE creating anything, with a message that names the
  // clash in kind. Checking both places matters: the two are not the same
  // column, and a rep row can exist with no login.
  const { data: existingRep } = await admin
    .from("telemarketers").select("id, full_name").eq("email", input.email).maybeSingle()
  if (existingRep) {
    return NextResponse.json(
      { ok: false, error: `${input.email} is already used by ${existingRep.full_name}.` },
      { status: 409 },
    )
  }

  const { data: authList } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 })
  if (authList?.users.some((u) => u.email?.toLowerCase() === input.email)) {
    return NextResponse.json(
      { ok: false, error: `${input.email} already has a login.` },
      { status: 409 },
    )
  }

  const { data: dept } = await admin
    .from("departments").select("id, name, slug").eq("id", input.department_id).maybeSingle()
  if (!dept) {
    return NextResponse.json({ ok: false, error: "That department no longer exists." }, { status: 400 })
  }

  const tempPassword = generateTempPassword()

  // email_confirm: true because there is no mail flow in this project (U-D2).
  // Without it the account would sit unconfirmed and unable to sign in.
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email: input.email,
    password: tempPassword,
    email_confirm: true,
    app_metadata: { role: "telemarketer", must_change_password: true },
    user_metadata: { full_name: input.full_name },
  })

  if (createErr || !created?.user) {
    console.error("[admin/users] createUser failed:", createErr?.message)
    return NextResponse.json(
      { ok: false, error: "Could not create the login. The email may already be in use." },
      { status: 400 },
    )
  }

  const { data: rep, error: repInsertErr } = await admin
    .from("telemarketers")
    .insert({
      full_name: input.full_name,
      email: input.email,
      phone: input.phone ? normalizePhone(input.phone) : null,
      department_id: input.department_id,
      job_title: input.job_title || null,
      is_active: true,
      user_id: created.user.id,
    })
    .select("*")
    .single()

  if (repInsertErr || !rep) {
    // Undo the login. A login with no rep row is powerless but would appear
    // under "Unrecognised logins" and look like an intrusion — never leave one.
    await admin.auth.admin.deleteUser(created.user.id)
    console.error("[admin/users] telemarketers insert failed:", repInsertErr?.message)
    return NextResponse.json(
      { ok: false, error: "Could not create the rep record. Nothing was saved." },
      { status: 500 },
    )
  }

  await writeAudit(admin, guard, {
    action: "user_created",
    target_user_id: created.user.id,
    target_rep_id: rep.id,
    details: { department: dept.name, job_title: input.job_title || null },
  })

  // tempPassword crosses the wire exactly once, here.
  return NextResponse.json({
    ok: true,
    rep,
    tempPassword,
    email: input.email,
    full_name: input.full_name,
    department: { name: dept.name, slug: dept.slug },
  })
}
