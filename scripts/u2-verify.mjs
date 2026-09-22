// ============================================================================
// U2 acceptance test — the Users tab's server side, end to end.
//
// STAGING ONLY. Creates a throwaway admin to act AS, and a throwaway rep to act
// ON, then deletes both. Every assertion is about behaviour an admin would see
// in the UI, exercised through the real HTTP routes with a real session cookie.
//
//   NEXT_PUBLIC_SUPABASE_URL=<staging> NEXT_PUBLIC_SUPABASE_ANON_KEY=<staging>
//     npm run dev
//   node scripts/u2-verify.mjs [http://localhost:3000]
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

let adminId, cookie, createdRepId, createdUserId, orphanRepId, orphanUserId
const cleanup = []

try {
  // ── An admin to act as ───────────────────────────────────────────────────
  const adminEmail = `u2-admin-${stamp}@example.invalid`
  const adminPw = randomBytes(18).toString("base64url")
  const { data: a, error: ae } = await admin.auth.admin.createUser({
    email: adminEmail, password: adminPw, email_confirm: true,
    app_metadata: { role: "admin" },
  })
  if (ae) throw new Error(`create admin: ${ae.message}`)
  adminId = a.user.id
  await admin.from("admin_profiles").insert({
    user_id: adminId, full_name: "U2 Test Admin", is_active: true, is_shared_account: false,
  })

  const sb = createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data: si, error: se } = await sb.auth.signInWithPassword({ email: adminEmail, password: adminPw })
  if (se) throw new Error(`admin sign-in: ${se.message}`)
  cookie = `sb-${ref}-auth-token=base64-${Buffer.from(JSON.stringify(si.session)).toString("base64url")}`

  const api = (path, init = {}) =>
    fetch(`${BASE}${path}`, {
      ...init,
      headers: { cookie, "content-type": "application/json", ...(init.headers ?? {}) },
    })

  // ── GET /api/admin/users ─────────────────────────────────────────────────
  console.log("\n-- GET /api/admin/users --")
  const listRes = await api("/api/admin/users")
  const list = await listRes.json()
  check("returns 200 for an admin", listRes.status === 200, `got ${listRes.status}`)
  check("lists the three existing reps", (list.users ?? []).length >= 3, `${list.users?.length} rows`)
  check("lists administrators separately", (list.admins ?? []).length >= 1)

  // The bug this replaces: counts were computed in the browser and silently
  // truncated at PostgREST's 1,000-row cap. Compare against SQL truth.
  const { data: truth } = await admin.rpc("rep_workload")
  const truthBy = new Map((truth ?? []).map((t) => [t.rep_id, Number(t.open_leads)]))
  const mismatched = (list.users ?? []).filter(
    (u) => truthBy.has(u.rep_id) && truthBy.get(u.rep_id) !== u.open_leads,
  )
  check("open-lead counts match rep_workload() exactly", mismatched.length === 0,
    mismatched.map((m) => `${m.full_name}: ${m.open_leads} vs ${truthBy.get(m.rep_id)}`).join("; "))

  const anyOverCap = (list.users ?? []).some((u) => u.open_leads > 1000)
  check("a count exceeds 1,000, proving the old client-side cap is gone", anyOverCap,
    "no rep has >1000 open leads on staging, so this is inconclusive rather than failed")

  // ── POST /api/admin/users ────────────────────────────────────────────────
  console.log("\n-- POST /api/admin/users (add a rep with a login) --")
  const { data: dept } = await admin.from("departments").select("id,name,slug").eq("slug", "container_eseal").single()
  const newEmail = `u2-rep-${stamp}@example.invalid`

  const createRes = await api("/api/admin/users", {
    method: "POST",
    body: JSON.stringify({
      full_name: "U2 Test Rep", email: newEmail, phone: "0722123456",
      department_id: dept.id, job_title: "Sales Representative",
    }),
  })
  const created = await createRes.json()
  check("creates the user", createRes.status === 200 && created.ok, created.error)
  check("returns a temporary password", typeof created.tempPassword === "string" && created.tempPassword.length >= 8)
  check("temp password satisfies the 8+ letters-and-digits policy",
    /^(?=.*[a-zA-Z])(?=.*[0-9]).{8,}$/.test(created.tempPassword ?? ""))
  createdRepId = created.rep?.id
  createdUserId = created.rep?.user_id
  check("phone was normalised to +254", created.rep?.phone === "+254722123456", created.rep?.phone)
  check("linked to a login", Boolean(createdUserId))

  // The new person can actually sign in — the whole point, and what the old
  // "Add Telemarketer" button never did.
  const sb2 = createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data: newSignIn, error: nse } = await sb2.auth.signInWithPassword({
    email: newEmail, password: created.tempPassword,
  })
  check("the new user can sign in with the temporary password", !nse && Boolean(newSignIn?.session), nse?.message)
  check("they are flagged must_change_password",
    newSignIn?.user?.app_metadata?.must_change_password === true)
  check("their role is telemarketer, not admin",
    newSignIn?.user?.app_metadata?.role === "telemarketer")

  // ── Duplicates are refused cleanly ───────────────────────────────────────
  console.log("\n-- duplicate handling --")
  const dupRes = await api("/api/admin/users", {
    method: "POST",
    body: JSON.stringify({ full_name: "Someone Else", email: newEmail, department_id: dept.id }),
  })
  const dup = await dupRes.json()
  check("a duplicate email is refused", dupRes.status === 409, `got ${dupRes.status}`)
  check("with a human message naming the clash", /already/i.test(dup.error ?? ""), dup.error)

  const { data: after } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 })
  const dupes = after.users.filter((u) => u.email === newEmail)
  check("no half-created login was left behind", dupes.length === 1, `${dupes.length} logins for that email`)

  // ── Validation ───────────────────────────────────────────────────────────
  const badRes = await api("/api/admin/users", {
    method: "POST", body: JSON.stringify({ full_name: "X", email: "not-an-email", department_id: dept.id }),
  })
  check("invalid input is refused with 400", badRes.status === 400, `got ${badRes.status}`)

  const noDeptRes = await api("/api/admin/users", {
    method: "POST", body: JSON.stringify({ full_name: "No Dept", email: `u2-nd-${stamp}@example.invalid` }),
  })
  check("a missing department is refused", noDeptRes.status === 400, `got ${noDeptRes.status}`)

  // ── Create login for an existing rep row with no login (defect 3) ────────
  console.log("\n-- create login for an unlinked rep row (defect 3) --")
  const { data: orphan } = await admin.from("telemarketers").insert({
    full_name: "U2 Orphan Rep", email: `u2-orphan-${stamp}@example.invalid`,
    department_id: dept.id, is_active: true,
  }).select().single()
  orphanRepId = orphan.id

  const listWithOrphan = await (await api("/api/admin/users")).json()
  const orphanRow = (listWithOrphan.users ?? []).find((u) => u.rep_id === orphanRepId)
  check("a rep with no login shows status 'no_login'", orphanRow?.status === "no_login", orphanRow?.status)

  const loginRes = await api(`/api/admin/users/${orphanRepId}/login`, { method: "POST" })
  const loginBody = await loginRes.json()
  check("a login can be created for them", loginRes.status === 200 && loginBody.ok, loginBody.error)
  check("and it returns a temporary password", typeof loginBody.tempPassword === "string")

  const { data: relinked } = await admin.from("telemarketers").select("user_id").eq("id", orphanRepId).single()
  orphanUserId = relinked?.user_id
  check("the rep row is now linked to that login", Boolean(orphanUserId))

  const repeatRes = await api(`/api/admin/users/${orphanRepId}/login`, { method: "POST" })
  check("a second attempt is refused", repeatRes.status === 409, `got ${repeatRes.status}`)

  // ── The audit trail recorded it ──────────────────────────────────────────
  console.log("\n-- audit --")
  const auditRes = await api(`/api/admin/users/${createdRepId}/audit`)
  const audit = await auditRes.json()
  const entry = (audit.entries ?? [])[0]
  check("the creation was recorded", entry?.action === "user_created", entry?.action)
  check("attributed to the acting admin by name", entry?.performed_by_name === "U2 Test Admin", entry?.performed_by_name)
  check("and by their real email from getUser()", entry?.performed_by_email === adminEmail, entry?.performed_by_email)

  const dumped = JSON.stringify(audit.entries ?? [])
  check("NO temporary password anywhere in the audit trail",
    !dumped.includes(created.tempPassword) && !dumped.includes(loginBody.tempPassword))
} catch (err) {
  fail++
  console.error(`\n  ERROR: ${err.message}`)
} finally {
  console.log("\n-- cleanup --")
  for (const repId of [createdRepId, orphanRepId].filter(Boolean)) {
    await admin.from("user_admin_audit").delete().eq("target_rep_id", repId)
    await admin.from("telemarketers").delete().eq("id", repId)
  }
  for (const uid of [createdUserId, orphanUserId].filter(Boolean)) {
    await admin.auth.admin.deleteUser(uid)
  }
  if (adminId) {
    await admin.from("user_admin_audit").delete().eq("performed_by", adminId)
    await admin.from("admin_profiles").delete().eq("user_id", adminId)
    await admin.auth.admin.deleteUser(adminId)
  }
  const { count: reps } = await admin.from("telemarketers").select("*", { count: "exact", head: true })
  const { data: left } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 })
  const { count: profiles } = await admin.from("admin_profiles").select("*", { count: "exact", head: true })
  console.log(`  ${reps} telemarketers, ${left.users.length} logins, ${profiles} admin_profiles remain`)
  cleanup.forEach((f) => f())
}

console.log(`\n${fail === 0 ? `ALL ${pass} CHECKS PASSED` : `${fail} of ${pass + fail} FAILED`}\n`)
await new Promise((r) => setTimeout(r, 50))
process.exit(fail === 0 ? 0 : 1)
