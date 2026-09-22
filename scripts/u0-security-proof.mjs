// ============================================================================
// Sprint U0 — the security proof, run against STAGING only.
//
// Proves, with real JWTs rather than the service role, that:
//   1. a rep can still WRITE user_metadata.role = 'admin'  (nothing stops them)
//   2. ...and it buys them NOTHING: is_admin() stays false and RLS still hides
//      other people's leads
//   3. a genuine admin (app_metadata + active roster row) does get access
//   4. clearing admin_profiles.is_active revokes it IMMEDIATELY, in an existing
//      session, without waiting for the JWT to expire
//
// Uses throwaway accounts created and deleted here, so no real account's
// credentials are involved and no real row is modified.
// ============================================================================
import { readFileSync } from "fs"
import { randomBytes } from "crypto"
import { createClient } from "@supabase/supabase-js"

const env = readFileSync(".env.local", "utf8")
const pick = (k) => env.match(new RegExp(`^${k}=(.+)$`, "m"))?.[1].trim()

const URL  = pick("STAGING_SUPABASE_URL")
const ANON = pick("STAGING_SUPABASE_ANON_KEY")
const SVC  = pick("STAGING_SUPABASE_SERVICE_ROLE_KEY")

if (!URL.includes("koifyemtduyyfqpkogpl")) {
  console.error("REFUSED: this script runs against staging only.")
  process.exit(1)
}

const admin = createClient(URL, SVC, { auth: { persistSession: false, autoRefreshToken: false } })
const asUser = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })

const pw = () => randomBytes(18).toString("base64url")
const REP_EMAIL   = `u0-proof-rep-${Date.now()}@example.invalid`
const ADMIN_EMAIL = `u0-proof-admin-${Date.now()}@example.invalid`
const REP_PW = pw(), ADMIN_PW = pw()

let repId, adminId, failures = 0
const check = (label, actual, expected) => {
  const good = JSON.stringify(actual) === JSON.stringify(expected)
  if (!good) failures++
  console.log(`  ${good ? "PASS" : "FAIL"}  ${label}`)
  if (!good) console.log(`        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
}

try {
  // ── setup ────────────────────────────────────────────────────────────────
  console.log("\n-- setup --")
  const { data: r, error: re } = await admin.auth.admin.createUser({
    email: REP_EMAIL, password: REP_PW, email_confirm: true,
    app_metadata: { role: "telemarketer" },
  })
  if (re) throw new Error(`create rep: ${re.message}`)
  repId = r.user.id
  console.log(`  created throwaway rep   ${REP_EMAIL}`)

  const { data: a, error: ae } = await admin.auth.admin.createUser({
    email: ADMIN_EMAIL, password: ADMIN_PW, email_confirm: true,
    app_metadata: { role: "admin" },
  })
  if (ae) throw new Error(`create admin: ${ae.message}`)
  adminId = a.user.id
  const { error: pe } = await admin.from("admin_profiles").insert({
    user_id: adminId, full_name: "U0 proof admin", is_active: true, is_shared_account: false,
  })
  if (pe) throw new Error(`insert admin_profiles: ${pe.message}`)
  console.log(`  created throwaway admin ${ADMIN_EMAIL} + roster row`)

  // ── 1. the attack ────────────────────────────────────────────────────────
  console.log("\n-- 1. rep attempts the privilege escalation --")
  const rep = asUser()
  const { error: se } = await rep.auth.signInWithPassword({ email: REP_EMAIL, password: REP_PW })
  if (se) throw new Error(`rep sign-in: ${se.message}`)

  const { error: ue } = await rep.auth.updateUser({ data: { role: "admin" } })
  check("the write itself still succeeds (nothing prevents it)", ue === null, true)

  const { data: meta } = await rep.auth.getUser()
  check("  user_metadata.role is now 'admin'", meta.user.user_metadata.role, "admin")
  check("  app_metadata.role is untouched", meta.user.app_metadata.role, "telemarketer")

  // ── 2. and it buys them nothing ──────────────────────────────────────────
  console.log("\n-- 2. ...and it grants no access --")
  const { data: repIsAdmin, error: rie } = await rep.rpc("is_admin")
  if (rie) throw new Error(`rep is_admin(): ${rie.message}`)
  check("is_admin() returns FALSE for the self-promoted rep", repIsAdmin, false)

  const { count: repLeads } = await rep.from("leads").select("*", { count: "exact", head: true })
  check("rep sees 0 leads (RLS unchanged)", repLeads ?? 0, 0)

  const { count: repProfiles } = await rep.from("admin_profiles").select("*", { count: "exact", head: true })
  check("rep cannot read the admin roster", repProfiles ?? 0, 0)

  // ── 3. a real admin does get access ──────────────────────────────────────
  console.log("\n-- 3. a genuine admin still works --")
  const adm = asUser()
  const { error: ase } = await adm.auth.signInWithPassword({ email: ADMIN_EMAIL, password: ADMIN_PW })
  if (ase) throw new Error(`admin sign-in: ${ase.message}`)

  const { data: admIsAdmin } = await adm.rpc("is_admin")
  check("is_admin() returns TRUE", admIsAdmin, true)

  const { count: admLeads } = await adm.from("leads").select("*", { count: "exact", head: true })
  console.log(`        admin sees ${admLeads} leads`)
  check("admin sees the whole table", (admLeads ?? 0) > 3000, true)

  // ── 4. deactivation bites immediately, in the SAME session ───────────────
  console.log("\n-- 4. deactivating the roster row, WITHOUT signing out --")
  await admin.from("admin_profiles").update({ is_active: false }).eq("user_id", adminId)

  const { data: afterOff } = await adm.rpc("is_admin")
  check("is_admin() flips to FALSE in the existing session", afterOff, false)

  const { count: leadsOff } = await adm.from("leads").select("*", { count: "exact", head: true })
  check("access is revoked with no JWT refresh", leadsOff ?? 0, 0)

  await admin.from("admin_profiles").update({ is_active: true }).eq("user_id", adminId)
  const { data: afterOn } = await adm.rpc("is_admin")
  check("restoring the row restores access", afterOn, true)
} catch (err) {
  failures++
  console.error(`\n  ERROR: ${err.message}`)
} finally {
  // ── cleanup ──────────────────────────────────────────────────────────────
  console.log("\n-- cleanup --")
  if (adminId) {
    // admin_profiles.user_id is ON DELETE RESTRICT, so the roster row goes first.
    await admin.from("admin_profiles").delete().eq("user_id", adminId)
    const { error } = await admin.auth.admin.deleteUser(adminId)
    console.log(`  throwaway admin deleted${error ? ` (FAILED: ${error.message})` : ""}`)
  }
  if (repId) {
    const { error } = await admin.auth.admin.deleteUser(repId)
    console.log(`  throwaway rep deleted${error ? ` (FAILED: ${error.message})` : ""}`)
  }
  const { data: left } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 })
  console.log(`  ${left.users.length} auth user(s) remain on staging`)
  const { count: profiles } = await admin.from("admin_profiles").select("*", { count: "exact", head: true })
  console.log(`  ${profiles} admin_profiles row(s) remain`)
}

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}\n`)
await new Promise((r) => setTimeout(r, 50))
process.exit(failures === 0 ? 0 : 1)
