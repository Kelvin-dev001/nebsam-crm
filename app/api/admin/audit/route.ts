import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth/requireAdmin"
import { createAdminClient } from "@/lib/supabase/admin"

// The activity feed across all users (§8.9), newest first.
//
// Built entirely from the SNAPSHOT columns (performed_by_name,
// performed_by_email) rather than joining to admin_profiles. That is the whole
// point of snapshotting: the log has to keep reading correctly after an admin
// is renamed, has their email changed, or is deactivated — otherwise history
// quietly rewrites itself every time someone's details change.

const PAGE_SIZE = 50

export async function GET(request: Request) {
  const guard = await requireAdmin()
  if (!guard.ok) return guard.response

  const url = new URL(request.url)
  const page = Math.max(0, Number(url.searchParams.get("page") ?? 0) || 0)
  const action = url.searchParams.get("action")
  const actor = url.searchParams.get("actor")

  const admin = createAdminClient()

  let query = admin
    .from("user_admin_audit")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)

  if (action) query = query.eq("action", action)
  if (actor) query = query.eq("performed_by", actor)

  const { data, error, count } = await query

  if (error) {
    console.error("[admin/audit] read failed:", error.message)
    return NextResponse.json({ ok: false, error: "Could not read the activity feed." }, { status: 500 })
  }

  // Resolve target names for display. Read separately rather than joined so a
  // deleted or renamed target cannot break the feed.
  const repIds = Array.from(
    new Set((data ?? []).map((e) => e.target_rep_id).filter((v): v is string => Boolean(v))),
  )
  const names = new Map<string, string>()
  if (repIds.length) {
    const { data: reps } = await admin.from("telemarketers").select("id, full_name").in("id", repIds)
    for (const r of reps ?? []) names.set(r.id, r.full_name)
  }

  return NextResponse.json({
    ok: true,
    entries: (data ?? []).map((e) => ({
      ...e,
      target_name: e.target_rep_id ? names.get(e.target_rep_id) ?? null : null,
    })),
    total: count ?? 0,
    page,
    page_size: PAGE_SIZE,
  })
}
