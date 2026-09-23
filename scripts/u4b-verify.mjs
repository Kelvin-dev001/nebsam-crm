// ============================================================================
// U4b acceptance test — named administrators, step-up, retiring the shared login.
//
// The sprint's "done when": two named admins create, reset and deactivate each
// other; neither can deactivate themselves; the LAST active admin cannot be
// deactivated even when two attempts race; a wrong step-up password is refused
// AND logged.
//
// STAGING ONLY. Staging's own shared admin is touched in the retire test and
// restored in cleanup — verified at the end.
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

const svc = createClient(URL_, SVC, { auth: { persistSession: false, autoRefreshToken: false } })
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

const madeUserIds = []
let sharedBefore = null

try {
  // ── Admin A, the actor ───────────────────────────────────────────────────
  const aEmail = `u4b-a-${stamp}@example.invalid`
  const aPw = "ActorPass2026"
  const { data: a } = await svc.auth.admin.createUser({
    email: aEmail, password: aPw, email_confirm: true, app_metadata: { role: "admin" },
  })
  madeUserIds.push(a.user.id)
  await svc.from("admin_profiles").insert({
    user_id: a.user.id, full_name: "U4b Admin A", is_active: true, is_shared_account: false,
  })
  const { data: aSi } = await anonClient().auth.signInWithPassword({ email: aEmail, password: aPw })
  const api = (path, init = {}) => fetch(`${BASE}${path}`, {
    ...init,
    headers: { cookie: cookieFor(aSi.session), "content-type": "application/json", ...(init.headers ?? {}) },
  })

  // ── 1. Step-up ───────────────────────────────────────────────────────────
  console.log("\n-- 1. step-up --")
  const bEmail = `u4b-b-${stamp}@example.invalid`

  const noPw = await api("/api/admin/admins", {
    method: "POST",
    body: JSON.stringify({ full_name: "U4b Admin B", email: bEmail }),
  })
  check("creating an admin with NO password is refused", noPw.status === 400, `got ${noPw.status}`)

  const wrongPw = await api("/api/admin/admins", {
    method: "POST",
    body: JSON.stringify({ full_name: "U4b Admin B", email: bEmail, actorPassword: "wrong-password" }),
  })
  const wrongBody = await wrongPw.json()
  check("a WRONG step-up password is refused with 403", wrongPw.status === 403, `got ${wrongPw.status}`)
  check("  with a message that reveals nothing", wrongBody.error === "Your password was not correct.", wrongBody.error)

  const { data: failLog } = await svc.from("user_admin_audit")
    .select("*").eq("action", "step_up_failed").eq("performed_by", a.user.id)
  check("the failure is LOGGED as step_up_failed", (failLog ?? []).length >= 1, `${failLog?.length} rows`)
  check("  and records no password", !JSON.stringify(failLog ?? []).includes("wrong-password"))

  const { data: list1 } = await svc.auth.admin.listUsers({ page: 1, perPage: 200 })
  check("no admin was created by the failed attempts",
    !list1.users.some((u) => u.email === bEmail))

  // ── 2. Create admin B ────────────────────────────────────────────────────
  console.log("\n-- 2. create a second named admin --")
  const createRes = await api("/api/admin/admins", {
    method: "POST",
    body: JSON.stringify({ full_name: "U4b Admin B", email: bEmail, phone: "0722000111", actorPassword: aPw }),
  })
  const created = await createRes.json()
  check("creating with the CORRECT password succeeds", createRes.status === 200 && created.ok, created.error)
  check("a temporary password is returned", typeof created.tempPassword === "string")

  const { data: list2 } = await svc.auth.admin.listUsers({ page: 1, perPage: 200 })
  const bUser = list2.users.find((u) => u.email === bEmail)
  madeUserIds.push(bUser.id)
  check("their role is admin", bUser?.app_metadata?.role === "admin")
  check("and they must change their password", bUser?.app_metadata?.must_change_password === true)

  const { data: bProfile } = await svc.from("admin_profiles").select("*").eq("user_id", bUser.id).single()
  check("a roster row was created, attributed to the creator", bProfile?.created_by === a.user.id)
  check("phone normalised to +254", bProfile?.phone === "+254722000111", bProfile?.phone)

  // ── 3. Self-targeting is refused ─────────────────────────────────────────
  console.log("\n-- 3. you cannot act on yourself --")
  const selfReset = await api(`/api/admin/admins/${a.user.id}/reset-password`, {
    method: "POST", body: JSON.stringify({ actorPassword: aPw }),
  })
  const selfResetBody = await selfReset.json()
  check("resetting your OWN password here is refused", selfReset.status === 400, `got ${selfReset.status}`)
  check("  and points at the user menu", /user menu/i.test(selfResetBody.error ?? ""), selfResetBody.error)

  const selfDeac = await api(`/api/admin/admins/${a.user.id}/deactivate`, {
    method: "POST", body: JSON.stringify({ actorPassword: aPw }),
  })
  const selfDeacBody = await selfDeac.json()
  check("deactivating YOURSELF is refused", selfDeac.status === 400, `got ${selfDeac.status}`)
  check("  by the database guard, not the route",
    /your own account/i.test(selfDeacBody.error ?? ""), selfDeacBody.error)

  // ── 4. Admin A resets admin B ────────────────────────────────────────────
  console.log("\n-- 4. one admin resets another --")
  const resetRes = await api(`/api/admin/admins/${bUser.id}/reset-password`, {
    method: "POST", body: JSON.stringify({ actorPassword: aPw }),
  })
  const reset = await resetRes.json()
  check("the reset succeeds", resetRes.status === 200 && reset.ok, reset.error)
  const { data: bSi, error: bErr } = await anonClient().auth.signInWithPassword({
    email: bEmail, password: reset.tempPassword,
  })
  check("B can sign in with the new temporary password", !bErr, bErr?.message)

  // ── 5. The last-admin rule ───────────────────────────────────────────────
  console.log("\n-- 5. the last active admin cannot be removed --")
  // Park the real shared admin so A and B are the only active admins.
  const { data: shared } = await svc.from("admin_profiles").select("*").eq("is_shared_account", true).single()
  sharedBefore = shared
  await svc.from("admin_profiles").update({ is_active: false }).eq("user_id", shared.user_id)

  const removeB = await api(`/api/admin/admins/${bUser.id}/deactivate`, {
    method: "POST", body: JSON.stringify({ actorPassword: aPw, reason: "test" }),
  })
  const removedB = await removeB.json()
  check("removing B succeeds while A remains", removeB.status === 200 && removedB.ok, removedB.error)
  check("  and reports how many admins remain", removedB.remaining_admins === 1, `${removedB.remaining_admins}`)

  // A is now the only one. Have B's (now powerless) session try to act.
  const bApi = (path, init = {}) => fetch(`${BASE}${path}`, {
    ...init,
    headers: { cookie: cookieFor(bSi.session), "content-type": "application/json", ...(init.headers ?? {}) },
  })
  const bTries = await bApi(`/api/admin/admins/${a.user.id}/deactivate`, {
    method: "POST", body: JSON.stringify({ actorPassword: reset.tempPassword }),
  })
  check("a just-removed admin can no longer act, in their EXISTING session",
    bTries.status === 401 || bTries.status === 403, `got ${bTries.status}`)

  // Two concurrent attempts to remove the last admin must both fail.
  await svc.from("admin_profiles").update({ is_active: true }).eq("user_id", bUser.id)
  await svc.auth.admin.updateUserById(bUser.id, { ban_duration: "none" })
  const { data: bSi2 } = await anonClient().auth.signInWithPassword({ email: bEmail, password: reset.tempPassword })
  const bApi2 = (path, init = {}) => fetch(`${BASE}${path}`, {
    ...init,
    headers: { cookie: cookieFor(bSi2.session), "content-type": "application/json", ...(init.headers ?? {}) },
  })

  const [r1, r2] = await Promise.all([
    api(`/api/admin/admins/${bUser.id}/deactivate`, { method: "POST", body: JSON.stringify({ actorPassword: aPw }) }),
    bApi2(`/api/admin/admins/${a.user.id}/deactivate`, { method: "POST", body: JSON.stringify({ actorPassword: reset.tempPassword }) }),
  ])
  const oks = [r1.status === 200, r2.status === 200].filter(Boolean).length
  check("two admins removing each other at once: exactly ONE succeeds", oks === 1, `${oks} succeeded`)

  const { data: survivors } = await svc
    .from("admin_profiles").select("user_id").eq("is_active", true)
  check("at least one administrator survives the race", (survivors ?? []).length >= 1,
    `${survivors?.length} active`)

  // ── 6. Retiring the shared login ─────────────────────────────────────────
  console.log("\n-- 6. retire the shared login --")
  await svc.from("admin_profiles").update({ is_active: true }).eq("user_id", shared.user_id)
  await svc.from("admin_profiles").update({ is_active: true }).eq("user_id", a.user.id)
  await svc.auth.admin.updateUserById(a.user.id, { ban_duration: "none" })
  // A has never "signed in and set their own password" from the app's point of
  // view: must_change_password was never set on them, so they count as proven.
  // Force the unproven case instead.
  await svc.auth.admin.updateUserById(a.user.id, { app_metadata: { must_change_password: true } })
  await svc.from("admin_profiles").update({ is_active: false }).eq("user_id", bUser.id)

  const { data: aSi2 } = await anonClient().auth.signInWithPassword({ email: aEmail, password: aPw })
  const api2 = (path, init = {}) => fetch(`${BASE}${path}`, {
    ...init,
    headers: { cookie: cookieFor(aSi2.session), "content-type": "application/json", ...(init.headers ?? {}) },
  })

  const tooSoon = await api2("/api/admin/admins/retire-shared", {
    method: "POST", body: JSON.stringify({ actorPassword: aPw }),
  })
  const tooSoonBody = await tooSoon.json()
  check("retiring is REFUSED while no named admin has set their own password",
    tooSoon.status === 409, `got ${tooSoon.status}`)
  check("  and explains why", /signed in and set their own password/i.test(tooSoonBody.error ?? ""),
    tooSoonBody.error)

  const { data: stillShared } = await svc
    .from("admin_profiles").select("is_active").eq("user_id", shared.user_id).single()
  check("  the shared login is untouched", stillShared.is_active === true)

  // Now make A proven and retire for real.
  await svc.auth.admin.updateUserById(a.user.id, { app_metadata: { must_change_password: false } })
  const { data: aSi3 } = await anonClient().auth.signInWithPassword({ email: aEmail, password: aPw })
  const api3 = (path, init = {}) => fetch(`${BASE}${path}`, {
    ...init,
    headers: { cookie: cookieFor(aSi3.session), "content-type": "application/json", ...(init.headers ?? {}) },
  })

  const retire = await api3("/api/admin/admins/retire-shared", {
    method: "POST", body: JSON.stringify({ actorPassword: aPw }),
  })
  const retired = await retire.json()
  check("retiring succeeds once a named admin is proven", retire.status === 200 && retired.ok, retired.error)
  check("  and names who made it safe", (retired.proven_named_admins ?? []).includes("U4b Admin A"),
    JSON.stringify(retired.proven_named_admins))

  const { data: afterShared } = await svc
    .from("admin_profiles").select("is_active, deactivated_reason").eq("user_id", shared.user_id).single()
  check("the shared roster row is now inactive", afterShared.is_active === false)
  check("  with the reason recorded", /Retired/i.test(afterShared.deactivated_reason ?? ""))

  const { entries: auditFeed } = await api3("/api/admin/audit").then((r) => r.json())
  const feedActions = (auditFeed ?? []).map((e) => e.action)
  check("the activity feed shows shared_admin_retired", feedActions.includes("shared_admin_retired"),
    feedActions.slice(0, 6).join(", "))
  check("  attributed to a named person", (auditFeed ?? [])[0]?.performed_by_name === "U4b Admin A",
    (auditFeed ?? [])[0]?.performed_by_name)
} catch (err) {
  fail++
  console.error(`\n  ERROR: ${err.message}`)
} finally {
  console.log("\n-- cleanup --")
  // Restore staging's shared admin to exactly how it was.
  if (sharedBefore) {
    await svc.from("admin_profiles").update({
      is_active: sharedBefore.is_active,
      deactivated_at: sharedBefore.deactivated_at,
      deactivated_reason: sharedBefore.deactivated_reason,
    }).eq("user_id", sharedBefore.user_id)
    await svc.auth.admin.updateUserById(sharedBefore.user_id, { ban_duration: "none" })
    const { data: restored } = await svc
      .from("admin_profiles").select("is_active").eq("user_id", sharedBefore.user_id).single()
    const { data: u } = await svc.auth.admin.getUserById(sharedBefore.user_id)
    const banned = Boolean(u?.user?.banned_until && new Date(u.user.banned_until) > new Date())
    console.log(`  shared admin restored: is_active=${restored?.is_active} banned=${banned}`)
    if (!restored?.is_active || banned) { fail++; console.log("  FAIL  shared admin was NOT fully restored") }
  }
  for (const id of madeUserIds) {
    await svc.from("user_admin_audit").delete().eq("target_user_id", id)
    await svc.from("user_admin_audit").delete().eq("performed_by", id)
    await svc.from("admin_profiles").delete().eq("user_id", id)
    await svc.auth.admin.deleteUser(id)
  }
  const { data: left } = await svc.auth.admin.listUsers({ page: 1, perPage: 200 })
  const { count: profiles } = await svc.from("admin_profiles").select("*", { count: "exact", head: true })
  console.log(`  ${left.users.length} logins, ${profiles} admin_profiles remain`)
}

console.log(`\n${fail === 0 ? `ALL ${pass} CHECKS PASSED` : `${fail} of ${pass + fail} FAILED`}\n`)
await new Promise((r) => setTimeout(r, 50))
process.exit(fail === 0 ? 0 : 1)
