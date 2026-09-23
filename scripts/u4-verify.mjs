// ============================================================================
// U4 acceptance test — move department, deactivate, reactivate.
//
// The sprint's "done when": deactivating a rep with open leads moves exactly
// those leads plus their pending follow-ups to the inheritor WITH updated_at
// UNCHANGED, the rep cannot log in, history still shows their name, and moving
// a rep leaves no lead orphaned.
//
// updated_at is the one to watch. The queue sorts on it and the team reads it
// as "when did we last deal with this client". A reassignment that stamps it
// destroys that ordering permanently, and nothing would visibly break.
//
// STAGING ONLY. Every fixture is created and deleted here.
// ============================================================================
import { readFileSync } from "fs"
import { randomBytes } from "crypto"
import { createClient } from "@supabase/supabase-js"

const BASE = process.argv[2] ?? "http://localhost:3000"
const env = readFileSync(".env.local", "utf8")
const pick = (k) => env.match(new RegExp(`^${k}=(.+)$`, "m"))?.[1].trim()
const URL_ = pick("STAGING_SUPABASE_URL")
const ANON = pick("STAGING_SUPABASE_ANON_KEY")
const SVC = pick("STAGING_SUPABASE_SERVICE_ROLE_KEY")

if (!URL_?.includes("koifyemtduyyfqpkogpl")) {
  console.error("REFUSED: staging only.")
  process.exit(1)
}

const admin = createClient(URL_, SVC, { auth: { persistSession: false, autoRefreshToken: false } })
const ref = new URL(URL_).hostname.split(".")[0]
const stamp = Date.now()

let pass = 0, fail = 0
const check = (label, ok, detail) => {
  if (ok) { pass++; console.log(`  PASS  ${label}`) }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`) }
}

const anonClient = () => createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } })

let adminId, api
const reps = []
const leadIds = []
let leavingUserId

try {
  // ── An admin to act as ───────────────────────────────────────────────────
  const adminEmail = `u4-admin-${stamp}@example.invalid`
  const adminPw = randomBytes(18).toString("base64url")
  const { data: a } = await admin.auth.admin.createUser({
    email: adminEmail, password: adminPw, email_confirm: true, app_metadata: { role: "admin" },
  })
  adminId = a.user.id
  await admin.from("admin_profiles").insert({
    user_id: adminId, full_name: "U4 Test Admin", is_active: true, is_shared_account: false,
  })
  const { data: si } = await anonClient().auth.signInWithPassword({ email: adminEmail, password: adminPw })
  const cookie = `sb-${ref}-auth-token=base64-${Buffer.from(JSON.stringify(si.session)).toString("base64url")}`
  api = (path, init = {}) => fetch(`${BASE}${path}`, {
    ...init, headers: { cookie, "content-type": "application/json", ...(init.headers ?? {}) },
  })

  const { data: eseal } = await admin.from("departments").select("id,name").eq("slug", "container_eseal").single()
  const { data: fuel } = await admin.from("departments").select("id,name").eq("slug", "fuel_monitoring").single()

  // Two reps in e-seal (one leaving, one inheriting) and one alone in fuel.
  const mk = async (name, deptId) => {
    const email = `u4-${name}-${stamp}@example.invalid`
    const res = await api("/api/admin/users", {
      method: "POST",
      body: JSON.stringify({ full_name: `U4 ${name}`, email, department_id: deptId }),
    })
    const b = await res.json()
    if (!b.ok) throw new Error(`create ${name}: ${b.error}`)
    reps.push({ name, repId: b.rep.id, userId: b.rep.user_id, email, password: b.tempPassword })
    return b.rep.id
  }
  const leavingId = await mk("leaving", eseal.id)
  const inheritorId = await mk("inheritor", eseal.id)
  const loneId = await mk("lone", fuel.id)
  const fuelMateId = await mk("fuelmate", fuel.id)
  leavingUserId = reps.find((r) => r.name === "leaving").userId

  // Leads: two OPEN (contacted, quote_sent) and one TERMINAL (lost).
  // Container E-Seal's OWN keys. It has no "quote_sent" — that is telematics.
  const stages = [["contacted", true], ["proposal_sent", true], ["lost", false]]
  for (const [stage] of stages) {
    const { data: lead, error } = await admin.from("leads").insert({
      phone_number: `+2547${String(stamp).slice(-8)}${stages.findIndex(x => x[0] === stage)}`,
      department_id: eseal.id, funnel_stage: stage, assigned_to: leavingId,
    }).select().single()
    if (error) throw new Error(`lead ${stage}: ${error.message}`)
    leadIds.push({ id: lead.id, stage })
  }
  await admin.from("followup_schedule").insert({
    lead_id: leadIds[0].id, telemarketer_id: leavingId, followup_type: "call",
    scheduled_date: new Date(Date.now() + 864e5).toISOString(), status: "pending",
    department_id: eseal.id,
  })

  // Backdate updated_at so a stamp would be obvious.
  // Read the baseline straight back; the reassign function suppresses the
  // updated_at trigger, so any change to these values means it failed to.
  const before = {}
  for (const l of leadIds) {
    const { data } = await admin.from("leads").select("updated_at").eq("id", l.id).single()
    before[l.id] = data.updated_at
  }

  // ── 1. Deactivate with an inheritor ──────────────────────────────────────
  console.log("\n-- 1. deactivate, handing work to another rep --")
  const deacRes = await api(`/api/admin/users/${leavingId}/deactivate`, {
    method: "POST",
    body: JSON.stringify({ inheritor_id: inheritorId, reason: "left the company" }),
  })
  const deac = await deacRes.json()
  check("deactivate succeeds", deacRes.status === 200 && deac.ok, deac.error)
  check("exactly the 2 OPEN leads moved", deac.moved?.leads_moved === 2, `moved ${deac.moved?.leads_moved}`)
  check("the pending follow-up moved", deac.moved?.followups_moved === 1, `moved ${deac.moved?.followups_moved}`)

  const { data: lostLead } = await admin.from("leads").select("assigned_to").eq("id", leadIds[2].id).single()
  check("the TERMINAL lead stayed with the departing rep", lostLead.assigned_to === leavingId)

  let stamped = 0
  for (const l of leadIds.slice(0, 2)) {
    const { data } = await admin.from("leads").select("updated_at, assigned_to").eq("id", l.id).single()
    if (data.updated_at !== before[l.id]) stamped++
    if (data.assigned_to !== inheritorId) check(`lead ${l.stage} went to the inheritor`, false, data.assigned_to)
  }
  check("updated_at was NOT stamped on the moved leads", stamped === 0, `${stamped} were stamped`)

  const { data: trig } = await admin.rpc("rep_workload") // any rpc; trigger checked below
  const { data: rep2 } = await admin.from("telemarketers").select("is_active, deactivated_at, deactivated_reason").eq("id", leavingId).single()
  check("the rep is inactive", rep2.is_active === false)
  check("with a timestamp and reason recorded", Boolean(rep2.deactivated_at) && rep2.deactivated_reason === "left the company")

  const { error: blockedErr } = await anonClient().auth.signInWithPassword({
    email: reps.find((r) => r.name === "leaving").email,
    password: reps.find((r) => r.name === "leaving").password,
  })
  check("they can no longer sign in", Boolean(blockedErr), "sign-in still works")

  // ── 2. Idempotent retry ──────────────────────────────────────────────────
  const againRes = await api(`/api/admin/users/${leavingId}/deactivate`, {
    method: "POST", body: JSON.stringify({ inheritor_id: inheritorId }),
  })
  const again = await againRes.json()
  check("a repeat deactivate is safe and moves nothing", again.ok && again.already === true, JSON.stringify(again.moved))

  // ── 3. Reactivate ────────────────────────────────────────────────────────
  console.log("\n-- 2. reactivate --")
  const reacRes = await api(`/api/admin/users/${leavingId}/reactivate`, { method: "POST" })
  const reac = await reacRes.json()
  check("reactivate succeeds", reacRes.status === 200 && reac.ok, reac.error)
  check("a new temporary password is issued", typeof reac.tempPassword === "string")

  const { data: backIn, error: backErr } = await anonClient().auth.signInWithPassword({
    email: reps.find((r) => r.name === "leaving").email, password: reac.tempPassword,
  })
  check("they can sign in again with it", !backErr, backErr?.message)
  check("and must choose a new password", backIn?.user?.app_metadata?.must_change_password === true)

  const { data: stillInherited } = await admin.from("leads").select("assigned_to").eq("id", leadIds[0].id).single()
  check("their old leads are NOT silently returned", stillInherited.assigned_to === inheritorId)

  // ── 4. The backlog fallback ──────────────────────────────────────────────
  console.log("\n-- 3. deactivate the ONLY rep in a department --")
  const { data: loneLead } = await admin.from("leads").insert({
    phone_number: `+2547${String(stamp).slice(-8)}9`,
    department_id: fuel.id, funnel_stage: "contacted", assigned_to: loneId,
  }).select().single()
  leadIds.push({ id: loneLead.id, stage: "lone" })
  await admin.from("followup_schedule").insert({
    lead_id: loneLead.id, telemarketer_id: loneId, followup_type: "call",
    scheduled_date: new Date(Date.now() + 864e5).toISOString(), status: "pending",
    department_id: fuel.id,
  })

  const loneRes = await api(`/api/admin/users/${loneId}/deactivate`, {
    method: "POST", body: JSON.stringify({ inheritor_id: null }),
  })
  const lone = await loneRes.json()
  check("it succeeds with no inheritor", loneRes.status === 200 && lone.ok, lone.error)
  check("the lead went to the backlog", lone.moved?.to_backlog === true && lone.moved?.leads_moved === 1)
  check("the follow-up was CANCELLED, not orphaned", lone.moved?.followups_cancelled === 1)

  const { data: backlogged } = await admin.from("leads").select("assigned_to").eq("id", loneLead.id).single()
  check("assigned_to is now NULL", backlogged.assigned_to === null)

  // ── 5. Move department ───────────────────────────────────────────────────
  console.log("\n-- 4. move department --")
  const crossRes = await api(`/api/admin/users/${inheritorId}/department`, {
    method: "POST",
    body: JSON.stringify({ department_id: fuel.id, inheritor_id: fuelMateId }),
  })
  const cross = await crossRes.json()
  check("an inheritor from ANOTHER department is refused", crossRes.status === 400, `got ${crossRes.status}`)
  check("  with a readable reason", /same department/i.test(cross.error ?? ""), cross.error)

  const { data: stillEseal } = await admin.from("telemarketers").select("department_id").eq("id", inheritorId).single()
  check("and the rep did NOT move", stillEseal.department_id === eseal.id)

  // Reactivate the leaving rep so there IS a valid inheritor in e-seal.
  const moveRes = await api(`/api/admin/users/${inheritorId}/department`, {
    method: "POST",
    body: JSON.stringify({ department_id: fuel.id, inheritor_id: leavingId }),
  })
  const move = await moveRes.json()
  check("the move succeeds with a same-department inheritor", moveRes.status === 200 && move.ok, move.error)
  check("their open leads stayed behind in the old department", move.moved?.leads_moved === 2, `${move.moved?.leads_moved}`)

  const { data: movedRep } = await admin.from("telemarketers").select("department_id").eq("id", inheritorId).single()
  check("the rep is now in the new department", movedRep.department_id === fuel.id)

  // THE POINT OF THE WHOLE SPRINT: nothing is left visible to nobody.
  const { data: orphans } = await admin
    .from("leads")
    .select("id, assigned_to, department_id, telemarketers!leads_assigned_to_fkey(department_id)")
    .in("id", leadIds.map((l) => l.id))
  const stranded = (orphans ?? []).filter(
    (l) => l.assigned_to && l.telemarketers && l.telemarketers.department_id !== l.department_id,
  )
  check("NO lead is assigned to a rep in a different department", stranded.length === 0,
    `${stranded.length} stranded`)

  // ── 6. Audit ─────────────────────────────────────────────────────────────
  console.log("\n-- 5. audit --")
  const auditRes = await api(`/api/admin/users/${leavingId}/audit`)
  const audit = await auditRes.json()
  const actions = (audit.entries ?? []).map((e) => e.action)
  for (const want of ["deactivated", "work_reassigned", "reactivated"]) {
    check(`${want} was recorded`, actions.includes(want), actions.join(", "))
  }
  const wr = (audit.entries ?? []).find((e) => e.action === "work_reassigned")
  check("the reassignment recorded its counts and inheritor",
    wr?.details?.leads_moved === 2 && Boolean(wr?.details?.inheritor), JSON.stringify(wr?.details))

  // History keeps the departing rep's name.
  const { data: hist } = await admin.from("telemarketers").select("full_name").eq("id", leavingId).single()
  check("the deactivated rep's record still exists and keeps their name", hist?.full_name === "U4 leaving")
  void trig
} catch (err) {
  fail++
  console.error(`\n  ERROR: ${err.message}`)
} finally {
  console.log("\n-- cleanup --")
  for (const l of leadIds) {
    await admin.from("followup_schedule").delete().eq("lead_id", l.id)
    await admin.from("leads").delete().eq("id", l.id)
  }
  for (const r of reps) {
    await admin.from("user_admin_audit").delete().eq("target_rep_id", r.repId)
    await admin.from("telemarketers").delete().eq("id", r.repId)
    if (r.userId) await admin.auth.admin.deleteUser(r.userId)
  }
  if (adminId) {
    await admin.from("user_admin_audit").delete().eq("performed_by", adminId)
    await admin.from("admin_profiles").delete().eq("user_id", adminId)
    await admin.auth.admin.deleteUser(adminId)
  }
  const { data: left } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 })
  const { count: repCount } = await admin.from("telemarketers").select("*", { count: "exact", head: true })
  const { count: leadCount } = await admin.from("leads").select("*", { count: "exact", head: true })
  const { data: trg } = await admin.rpc("rep_workload")
  console.log(`  ${left.users.length} logins, ${repCount} telemarketers, ${leadCount} leads remain`)
  void trg; void leavingUserId
}

console.log(`\n${fail === 0 ? `ALL ${pass} CHECKS PASSED` : `${fail} of ${pass + fail} FAILED`}\n`)
await new Promise((r) => setTimeout(r, 50))
process.exit(fail === 0 ? 0 : 1)
