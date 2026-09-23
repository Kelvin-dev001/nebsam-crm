// ============================================================================
// U3 acceptance test — passwords, end to end.
//
// The sprint's "done when": reset -> share -> forced change -> new password
// works end to end, the OLD password stops working, and change-password works
// for a rep and an admin.
//
// STAGING ONLY. Creates a throwaway admin to act as and a throwaway rep to act
// on, then deletes both.
//
//   NEXT_PUBLIC_SUPABASE_URL=<staging> NEXT_PUBLIC_SUPABASE_ANON_KEY=<staging>
//   SUPABASE_SERVICE_ROLE_KEY=<staging service key> npm run dev
//   node scripts/u3-verify.mjs [http://localhost:3000]
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
const cookieFor = (session) =>
  `sb-${ref}-auth-token=base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`

let adminId, repId, repUserId

try {
  // ── Actors ───────────────────────────────────────────────────────────────
  const adminEmail = `u3-admin-${stamp}@example.invalid`
  const adminPw = randomBytes(18).toString("base64url")
  const { data: a } = await admin.auth.admin.createUser({
    email: adminEmail, password: adminPw, email_confirm: true, app_metadata: { role: "admin" },
  })
  adminId = a.user.id
  await admin.from("admin_profiles").insert({
    user_id: adminId, full_name: "U3 Test Admin", is_active: true, is_shared_account: false,
  })

  const sbAdmin = anonClient()
  const { data: adminSignIn } = await sbAdmin.auth.signInWithPassword({ email: adminEmail, password: adminPw })
  const adminCookie = cookieFor(adminSignIn.session)
  const api = (path, init = {}) => fetch(`${BASE}${path}`, {
    ...init,
    headers: { cookie: adminCookie, "content-type": "application/json", ...(init.headers ?? {}) },
  })

  const { data: dept } = await admin.from("departments").select("id,slug").eq("slug", "container_eseal").single()
  const repEmail = `u3-rep-${stamp}@example.invalid`
  const createRes = await api("/api/admin/users", {
    method: "POST",
    body: JSON.stringify({ full_name: "U3 Test Rep", email: repEmail, department_id: dept.id }),
  })
  const created = await createRes.json()
  if (!created.ok) throw new Error(`could not create the rep: ${created.error}`)
  repId = created.rep.id
  repUserId = created.rep.user_id
  const firstPassword = created.tempPassword

  // ── 1. The forced-change flag is set on creation ─────────────────────────
  console.log("\n-- 1. a new user must change their password --")
  const sbRep = anonClient()
  const { data: repSignIn, error: repSignErr } = await sbRep.auth.signInWithPassword({
    email: repEmail, password: firstPassword,
  })
  check("the new rep can sign in with the temporary password", !repSignErr, repSignErr?.message)
  check("must_change_password is set", repSignIn?.user?.app_metadata?.must_change_password === true)

  // ── 2. They change it themselves ─────────────────────────────────────────
  console.log("\n-- 2. the user sets their own password --")
  const repCookie = cookieFor(repSignIn.session)
  const asRep = (path, init = {}) => fetch(`${BASE}${path}`, {
    ...init,
    headers: { cookie: repCookie, "content-type": "application/json", ...(init.headers ?? {}) },
  })

  const wrongRes = await asRep("/api/account/password", {
    method: "POST",
    body: JSON.stringify({ current_password: "not-the-password", new_password: "Brandnew99" }),
  })
  const wrongBody = await wrongRes.json()
  check("a wrong CURRENT password is refused with 403", wrongRes.status === 403, `got ${wrongRes.status}`)
  check("  and says so plainly", /current password was not correct/i.test(wrongBody.error ?? ""), wrongBody.error)

  const shortRes = await asRep("/api/account/password", {
    method: "POST", body: JSON.stringify({ current_password: firstPassword, new_password: "abc1" }),
  })
  check("a password below the 8-char policy is refused", shortRes.status === 400, `got ${shortRes.status}`)

  const lettersOnlyRes = await asRep("/api/account/password", {
    method: "POST", body: JSON.stringify({ current_password: firstPassword, new_password: "abcdefghij" }),
  })
  check("a password with no digit is refused", lettersOnlyRes.status === 400, `got ${lettersOnlyRes.status}`)

  const sameRes = await asRep("/api/account/password", {
    method: "POST", body: JSON.stringify({ current_password: firstPassword, new_password: firstPassword }),
  })
  check("reusing the current password is refused", sameRes.status === 400, `got ${sameRes.status}`)

  const chosen = "MyOwnPass99"
  const changeRes = await asRep("/api/account/password", {
    method: "POST", body: JSON.stringify({ current_password: firstPassword, new_password: chosen }),
  })
  const changeBody = await changeRes.json()
  check("the change succeeds with the correct current password", changeRes.status === 200 && changeBody.ok, changeBody.error)

  const sbCheck = anonClient()
  const { data: newSignIn, error: newErr } = await sbCheck.auth.signInWithPassword({ email: repEmail, password: chosen })
  check("the NEW password works", !newErr && Boolean(newSignIn?.session), newErr?.message)
  check("must_change_password is now cleared", newSignIn?.user?.app_metadata?.must_change_password === false)
  check("role survived the app_metadata merge", newSignIn?.user?.app_metadata?.role === "telemarketer")

  const { error: oldErr } = await anonClient().auth.signInWithPassword({ email: repEmail, password: firstPassword })
  check("the OLD temporary password no longer works", Boolean(oldErr), "it still works")

  // ── 3. Admin reset ───────────────────────────────────────────────────────
  console.log("\n-- 3. admin resets it --")
  const resetRes = await api(`/api/admin/users/${repId}/reset-password`, { method: "POST" })
  const reset = await resetRes.json()
  check("the reset succeeds", resetRes.status === 200 && reset.ok, reset.error)
  check("a new temporary password is returned", typeof reset.tempPassword === "string" && reset.tempPassword !== chosen)

  const { error: afterResetOld } = await anonClient().auth.signInWithPassword({ email: repEmail, password: chosen })
  check("the password they CHOSE stops working", Boolean(afterResetOld), "it still works")

  const sbReset = anonClient()
  const { data: resetSignIn, error: resetErr } = await sbReset.auth.signInWithPassword({
    email: repEmail, password: reset.tempPassword,
  })
  check("the new temporary password works", !resetErr, resetErr?.message)
  check("and forces a change again", resetSignIn?.user?.app_metadata?.must_change_password === true)

  // ── 4. Require change without resetting ──────────────────────────────────
  console.log("\n-- 4. require a change WITHOUT resetting --")
  const settled = "SettledPass77"
  await asRepSession(resetSignIn.session, "/api/account/password", {
    current_password: reset.tempPassword, new_password: settled,
  })
  const { data: settledUser } = await anonClient().auth.signInWithPassword({ email: repEmail, password: settled })
  check("the rep has a settled password again", settledUser?.user?.app_metadata?.must_change_password === false)

  const reqRes = await api(`/api/admin/users/${repId}/require-password-change`, { method: "POST" })
  const req = await reqRes.json()
  check("require-change succeeds", reqRes.status === 200 && req.ok, req.error)

  const { data: flagged, error: flagErr } = await anonClient().auth.signInWithPassword({
    email: repEmail, password: settled,
  })
  check("their CURRENT password still works (nothing was reset)", !flagErr, flagErr?.message)
  check("but they are flagged to change it", flagged?.user?.app_metadata?.must_change_password === true)

  // ── 5. The audit trail ───────────────────────────────────────────────────
  console.log("\n-- 5. audit --")
  const auditRes = await api(`/api/admin/users/${repId}/audit`)
  const audit = await auditRes.json()
  const actions = (audit.entries ?? []).map((e) => e.action)
  check("password_reset was recorded", actions.includes("password_reset"), actions.join(", "))
  check("password_change_required was recorded", actions.includes("password_change_required"), actions.join(", "))
  check("attributed to the acting admin", (audit.entries ?? [])[0]?.performed_by_name === "U3 Test Admin")

  const dumped = JSON.stringify(audit.entries ?? [])
  const leaked = [firstPassword, chosen, settled, reset.tempPassword].filter((p) => dumped.includes(p))
  check("NO password of any kind appears in the audit trail", leaked.length === 0, `${leaked.length} leaked`)

  // ── 6. An admin can change their own password too ────────────────────────
  console.log("\n-- 6. an admin changes their own password --")
  const adminNew = "AdminPass2026"
  const adminChange = await api("/api/account/password", {
    method: "POST",
    body: JSON.stringify({ current_password: adminPw, new_password: adminNew }),
  })
  const adminChangeBody = await adminChange.json()
  check("the admin's own change succeeds", adminChange.status === 200 && adminChangeBody.ok, adminChangeBody.error)

  const { data: adminAfter, error: adminAfterErr } = await anonClient().auth.signInWithPassword({
    email: adminEmail, password: adminNew,
  })
  check("they can sign in with it", !adminAfterErr, adminAfterErr?.message)
  check("and they are still an admin", adminAfter?.user?.app_metadata?.role === "admin")
} catch (err) {
  fail++
  console.error(`\n  ERROR: ${err.message}`)
} finally {
  console.log("\n-- cleanup --")
  if (repId) {
    await admin.from("user_admin_audit").delete().eq("target_rep_id", repId)
    await admin.from("telemarketers").delete().eq("id", repId)
  }
  if (repUserId) await admin.auth.admin.deleteUser(repUserId)
  if (adminId) {
    await admin.from("user_admin_audit").delete().eq("performed_by", adminId)
    await admin.from("admin_profiles").delete().eq("user_id", adminId)
    await admin.auth.admin.deleteUser(adminId)
  }
  const { data: left } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 })
  const { count: reps } = await admin.from("telemarketers").select("*", { count: "exact", head: true })
  console.log(`  ${left.users.length} logins, ${reps} telemarketers remain`)
}

async function asRepSession(session, path, body) {
  return fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { cookie: cookieFor(session), "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

console.log(`\n${fail === 0 ? `ALL ${pass} CHECKS PASSED` : `${fail} of ${pass + fail} FAILED`}\n`)
await new Promise((r) => setTimeout(r, 50))
process.exit(fail === 0 ? 0 : 1)
