import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth/requireAdmin"
import { createAdminClient } from "@/lib/supabase/admin"

// One person's audit history (§8.9), newest first.
//
// Read through the service role rather than the caller's client so the query
// does not depend on RLS evaluating is_admin() a second time — requireAdmin has
// already established who this is, and more strictly than the policy does.

export async function GET(
  _request: Request,
  { params }: { params: { repId: string } },
) {
  const guard = await requireAdmin()
  if (!guard.ok) return guard.response

  const admin = createAdminClient()

  const { data, error } = await admin
    .from("user_admin_audit")
    .select("*")
    .eq("target_rep_id", params.repId)
    .order("created_at", { ascending: false })
    .limit(100)

  if (error) {
    console.error("[users/audit] read failed:", error.message)
    return NextResponse.json({ ok: false, error: "Could not read the history." }, { status: 500 })
  }

  return NextResponse.json({ ok: true, entries: data ?? [] })
}
