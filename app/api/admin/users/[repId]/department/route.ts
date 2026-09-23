import { NextResponse } from "next/server"
import { z } from "zod"
import { requireAdmin } from "@/lib/auth/requireAdmin"
import { createAdminClient } from "@/lib/supabase/admin"
import { writeAudit } from "@/lib/auth/audit"

// Move a rep between departments (§8.4, defect 6).
//
// THIS IS A SEPARATE ACTION FROM "EDIT" BECAUSE IT MOVES WORK.
//
// leads_dept_scoped requires `department_id = current_rep_department() AND
// assigned_to = current_rep()`. So the moment a rep changes department, every
// lead still assigned to them in the OLD department matches nobody: not them
// (wrong department now), not their former colleagues (wrong assignee). The
// leads do not disappear from the database, but they disappear from every
// rep's queue, which looks identical from the floor.
//
// So the open work is reassigned FIRST, inside the old department, and only
// then is the rep moved. If the reassignment fails, the rep does not move.

const Schema = z.object({
  department_id: z.string().uuid("Choose a department."),
  // null = leave the open leads in the old department's backlog.
  inheritor_id: z.string().uuid().nullable().optional(),
})

export async function POST(
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

  const { department_id } = parsed.data
  const inheritorId = parsed.data.inheritor_id ?? null
  const admin = createAdminClient()

  const { data: rep } = await admin
    .from("telemarketers")
    .select("*, departments(id, name)")
    .eq("id", params.repId)
    .maybeSingle()

  if (!rep) {
    return NextResponse.json({ ok: false, error: "That rep no longer exists." }, { status: 404 })
  }

  const fromDept = (rep as unknown as { departments: { id: string; name: string } | null }).departments

  if (rep.department_id === department_id) {
    return NextResponse.json(
      { ok: false, error: `${rep.full_name} is already in ${fromDept?.name ?? "that department"}.` },
      { status: 400 },
    )
  }

  const { data: toDept } = await admin
    .from("departments").select("id, name, is_active").eq("id", department_id).maybeSingle()

  if (!toDept) {
    return NextResponse.json({ ok: false, error: "That department no longer exists." }, { status: 400 })
  }
  if (!toDept.is_active) {
    return NextResponse.json(
      { ok: false, error: `${toDept.name} is not active.` },
      { status: 400 },
    )
  }

  // ── 1. Hand over the open work, still inside the OLD department ──────────
  const { data: result, error: reassignErr } = await admin.rpc("reassign_rep_open_work", {
    p_from_rep: params.repId,
    p_to_rep: inheritorId,
  })

  if (reassignErr) {
    // The rep has NOT moved. The function's messages are written for humans.
    return NextResponse.json(
      { ok: false, error: reassignErr.message, stage: "reassign" },
      { status: 400 },
    )
  }

  const moved = result as unknown as {
    leads_moved: number; followups_moved: number; followups_cancelled: number; to_backlog: boolean
  }

  // ── 2. Now move them ──────────────────────────────────────────────────────
  const { error: moveErr } = await admin
    .from("telemarketers")
    .update({ department_id })
    .eq("id", params.repId)

  if (moveErr) {
    console.error("[department] move failed:", moveErr.message)
    return NextResponse.json(
      {
        ok: false,
        stage: "move",
        error:
          `Their open work was handed over, but the move itself failed. ` +
          `They are still in ${fromDept?.name ?? "their old department"} with an empty queue. Press Retry.`,
      },
      { status: 500 },
    )
  }

  let inheritorName: string | null = null
  if (inheritorId) {
    const { data: inh } = await admin
      .from("telemarketers").select("full_name").eq("id", inheritorId).maybeSingle()
    inheritorName = inh?.full_name ?? null
  }

  await writeAudit(admin, guard, {
    action: "department_changed",
    target_user_id: rep.user_id,
    target_rep_id: rep.id,
    details: {
      from_department: fromDept?.name ?? null,
      to_department: toDept.name,
      ...moved,
      inheritor: inheritorName,
    },
  })

  return NextResponse.json({
    ok: true,
    full_name: rep.full_name,
    from: fromDept?.name ?? null,
    to: toDept.name,
    moved,
    inheritor: inheritorName,
  })
}
