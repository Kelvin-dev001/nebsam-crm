import { NextResponse } from "next/server"
import { z } from "zod"
import { requireAdmin } from "@/lib/auth/requireAdmin"
import { createAdminClient } from "@/lib/supabase/admin"
import { writeAudit } from "@/lib/auth/audit"

// Deactivate a rep: reassign their open work, THEN block the login (§8.5).
//
// ORDER MATTERS AND IS NOT NEGOTIABLE.
// Reassign first. If the login were blocked first and the reassignment then
// failed, the work would be stranded: invisible to the departing rep (they
// cannot sign in), invisible to every other rep (RLS scopes by assigned_to),
// and visible only to an admin who happened to go looking. Doing it the other
// way round means the worst case is work that has already moved to someone who
// can see it, with a login that is still active — obvious, and safe to retry.

const Schema = z.object({
  // null = send the open leads to the department backlog (U-D4).
  inheritor_id: z.string().uuid().nullable().optional(),
  reason: z.string().trim().max(500).optional().nullable(),
})

const BAN_FOREVER = "876000h" // 100 years. Supabase has no "permanent".

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
    // Body optional: no inheritor means the backlog.
  }

  const parsed = Schema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.issues[0]?.message ?? "Please check the form." },
      { status: 400 },
    )
  }

  const inheritorId = parsed.data.inheritor_id ?? null
  const reason = parsed.data.reason?.trim() || null
  const admin = createAdminClient()

  const { data: rep } = await admin
    .from("telemarketers")
    .select("*, departments(name)")
    .eq("id", params.repId)
    .maybeSingle()

  if (!rep) {
    return NextResponse.json({ ok: false, error: "That rep no longer exists." }, { status: 404 })
  }

  // Idempotent: a retry of a call that already succeeded is not an error.
  const alreadyOff = !rep.is_active

  // ── 1. Move the open work ─────────────────────────────────────────────────
  let moved = { leads_moved: 0, followups_moved: 0, followups_cancelled: 0, to_backlog: inheritorId === null }

  if (!alreadyOff) {
    const { data: result, error: reassignErr } = await admin.rpc("reassign_rep_open_work", {
      p_from_rep: params.repId,
      p_to_rep: inheritorId,
    })

    if (reassignErr) {
      // Nothing has changed. The message from the function is written for
      // humans (same department, active, not themselves), so show it as-is.
      return NextResponse.json(
        { ok: false, error: reassignErr.message, stage: "reassign" },
        { status: 400 },
      )
    }
    moved = result as unknown as typeof moved
  }

  // ── 2. Take them off the rota ─────────────────────────────────────────────
  // Immediate in RLS: current_rep() filters on is_active, so from this moment
  // they see nothing even with a live session. It also removes them from
  // assign_lead_round_robin_v2, so no new WhatsApp lead lands on them.
  const { error: updErr } = await admin
    .from("telemarketers")
    .update({ is_active: false, deactivated_at: new Date().toISOString(), deactivated_reason: reason })
    .eq("id", params.repId)

  if (updErr) {
    console.error("[deactivate] telemarketers update failed:", updErr.message)
    return NextResponse.json(
      {
        ok: false,
        stage: "deactivate",
        error:
          `Their open work was reassigned, but marking them inactive failed. ` +
          `Press Retry — reassigning again moves nothing, so it is safe.`,
      },
      { status: 500 },
    )
  }

  // ── 3. Block the login ────────────────────────────────────────────────────
  const warnings: string[] = []

  if (rep.user_id) {
    const { error: banErr } = await admin.auth.admin.updateUserById(rep.user_id, {
      ban_duration: BAN_FOREVER,
    })
    if (banErr) {
      console.error("[deactivate] ban failed:", banErr.message)
      warnings.push("their login could not be blocked")
    }

    const { error: revokeErr } = await admin.rpc("revoke_user_sessions", { p_user_id: rep.user_id })
    if (revokeErr) {
      console.error("[deactivate] session revoke failed:", revokeErr.message)
      warnings.push("open sessions could not be ended")
    }
  }

  // ── 4. Audit ──────────────────────────────────────────────────────────────
  let inheritorName: string | null = null
  if (inheritorId) {
    const { data: inh } = await admin
      .from("telemarketers").select("full_name").eq("id", inheritorId).maybeSingle()
    inheritorName = inh?.full_name ?? null
  }

  await writeAudit(admin, guard, {
    action: "deactivated",
    target_user_id: rep.user_id,
    target_rep_id: rep.id,
    details: {
      reason,
      department: (rep as unknown as { departments: { name: string } | null }).departments?.name ?? null,
      warnings: warnings.length ? warnings : undefined,
    },
  })

  if (!alreadyOff && (moved.leads_moved || moved.followups_moved || moved.followups_cancelled)) {
    await writeAudit(admin, guard, {
      action: "work_reassigned",
      target_user_id: rep.user_id,
      target_rep_id: rep.id,
      details: { ...moved, inheritor: inheritorName, inheritor_id: inheritorId },
    })
  }

  return NextResponse.json({
    ok: true,
    already: alreadyOff,
    moved,
    inheritor: inheritorName,
    full_name: rep.full_name,
    // Reported rather than swallowed: the data layer is already safe, but an
    // admin who thinks a login is blocked when it is not deserves to know.
    warnings: warnings.length ? warnings : undefined,
  })
}
