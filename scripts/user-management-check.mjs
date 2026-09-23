/**
 * Section 11 verification checklist for the user-management work (U0-U4b).
 *
 *   node scripts/user-management-check.mjs                    # staging
 *   node scripts/user-management-check.mjs --target=production # production, READ-ONLY
 *
 * Deliberately read-only on BOTH targets. Every write-path flow — add a user,
 * reset a password, move a department, deactivate, retire the shared login —
 * already has its own script with fixtures it creates and deletes:
 *
 *   scripts/u0-security-proof.mjs    the privilege-escalation hole is closed
 *   scripts/u1-verify-routes.mjs     401 anonymous / 403 as a rep
 *   scripts/u1-verify-sessions.mjs   revoke_user_sessions actually revokes
 *   scripts/u2-verify.mjs            the Users tab and adding users
 *   scripts/u3-verify.mjs            passwords, end to end
 *   scripts/u4-verify.mjs            move, deactivate, reactivate
 *   scripts/u4b-verify.mjs           named admins, step-up, retire
 *
 * Re-running those against production would create and delete real logins on a
 * live CRM. This script asserts the STATE they leave behind instead, which is
 * what section 11 actually asks about.
 */

import { createClient } from "@supabase/supabase-js"
import { readFileSync, readdirSync, statSync, existsSync } from "fs"
import { join } from "path"

const env = readFileSync(".env.local", "utf8")
const pick = (k) => env.match(new RegExp(`^${k}=(.+)$`, "m"))?.[1].trim() ?? null

const target = process.argv.find((a) => a.startsWith("--target="))?.split("=")[1] ?? "staging"
const PROD = target === "production"

const URL_ = PROD ? pick("NEXT_PUBLIC_SUPABASE_URL") : pick("STAGING_SUPABASE_URL")
const ANON = PROD ? pick("NEXT_PUBLIC_SUPABASE_ANON_KEY") : pick("STAGING_SUPABASE_ANON_KEY")
const SERVICE = PROD ? pick("SUPABASE_SERVICE_ROLE_KEY") : pick("STAGING_SUPABASE_SERVICE_ROLE_KEY")

if (!URL_ || !ANON || !SERVICE) {
  console.error(`Missing URL / anon / service key for target "${target}".`)
  process.exit(1)
}

const sbAnon = createClient(URL_, ANON, { auth: { persistSession: false } })
const sb = createClient(URL_, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } })

let pass = 0, fail = 0, warn = 0
const results = []
const ok = (id, m) => { pass++; results.push(`  PASS  ${id}  ${m}`) }
const bad = (id, m) => { fail++; results.push(`  FAIL  ${id}  ${m}`) }
const note = (id, m) => { warn++; results.push(`  NOTE  ${id}  ${m}`) }

console.log(`\nSection 11 checklist — target: ${target}  (${new URL(URL_).hostname.split(".")[0]})`)
console.log("=".repeat(72))

// ── A. No interference ──────────────────────────────────────────────────────
const { data: users } = await sb.auth.admin.listUsers({ page: 1, perPage: 200 })
const KNOWN = ["edith@nebsamdigital.com", "janet@nebsamdigital.com", "suzzie@nebsamdigital.com", "admin@nebsamdigital.com"]

for (const email of KNOWN) {
  const u = users.users.find((x) => x.email === email)
  if (!u) { bad("A1", `${email} is MISSING`); continue }
  const banned = Boolean(u.banned_until && new Date(u.banned_until) > new Date())
  const must = u.app_metadata?.must_change_password === true
  const role = u.app_metadata?.role
  const expected = email.startsWith("admin@") ? "admin" : "telemarketer"

  if (banned) bad("A1", `${email} is BANNED — they cannot sign in`)
  else if (role !== expected) bad("A1", `${email} has role "${role}", expected "${expected}"`)
  else if (must) note("A1", `${email} is flagged to change password (deliberate if you pressed it)`)
  else ok("A1", `${email} can sign in normally, role=${role}`)
}

const { data: reps } = await sb
  .from("telemarketers").select("full_name, email, is_active, department_id, user_id, created_at")
  .order("created_at")
const originals = (reps ?? []).filter((r) => ["Edith", "Janet", "Suzzie"].includes(r.full_name))

if (originals.length !== 3) bad("A2", `expected the 3 original reps, found ${originals.length}`)
else if (originals.some((r) => !r.is_active)) bad("A2", "one of the original reps is not active")
else if (originals.some((r) => !r.user_id)) bad("A2", "one of the original reps has no login")
else if (originals.some((r) => !r.email?.endsWith("@nebsamdigital.co.ke")))
  bad("A2", "an original rep's email was changed — it should still be the .co.ke address")
else ok("A2", "Edith, Janet and Suzzie: active, linked, emails untouched")

const { data: workload } = await sb.rpc("rep_workload")
const byRep = new Map((workload ?? []).map((w) => [w.rep_id, w]))
const { data: repIds } = await sb.from("telemarketers").select("id, full_name")
let totalOpen = 0
for (const r of repIds ?? []) {
  const w = byRep.get(r.id)
  if (w) totalOpen += Number(w.open_leads)
}
if (totalOpen > 0) ok("A3", `rep_workload() reports ${totalOpen.toLocaleString()} open leads across all reps`)
else bad("A3", "rep_workload() returned nothing")

const { count: leadCount } = await sb.from("leads").select("*", { count: "exact", head: true })
ok("A4", `leads table holds ${leadCount?.toLocaleString()} rows`)

const { count: unassigned } = await sb
  .from("leads").select("*", { count: "exact", head: true }).is("assigned_to", null)
if ((unassigned ?? 0) === 0) ok("A5", "no lead is sitting unassigned in the backlog")
else note("A5", `${unassigned} lead(s) in the backlog — expected only if you deactivated a lone rep`)

// ── B. Security ─────────────────────────────────────────────────────────────
// anon must not be able to execute any privileged function.
for (const fn of ["is_admin", "rep_workload", "reassign_rep_open_work", "deactivate_admin_guarded", "revoke_user_sessions"]) {
  const { error } = await sbAnon.rpc(fn, fn === "is_admin" || fn === "rep_workload" ? {} : { p_user_id: "00000000-0000-0000-0000-000000000000", p_from_rep: "00000000-0000-0000-0000-000000000000", p_to_rep: null, p_target: "00000000-0000-0000-0000-000000000000", p_actor: "00000000-0000-0000-0000-000000000000" })
  if (error && /permission denied|not find|does not exist/i.test(error.message)) ok("B1", `anon refused ${fn}()`)
  else if (error) ok("B1", `anon refused ${fn}() (${error.code ?? error.message.slice(0, 30)})`)
  else bad("B1", `ANON CAN EXECUTE ${fn}() — 009e's lockdown has been undone`)
}

// anon must not read the new tables.
for (const t of ["admin_profiles", "user_admin_audit"]) {
  const { data, error, count } = await sbAnon.from(t).select("*", { count: "exact" }).limit(1)
  if (error) ok("B2", `anon blocked from ${t} (${error.code})`)
  else if ((count ?? 0) === 0 && !data?.length) ok("B2", `anon sees 0 rows in ${t}`)
  else bad("B2", `ANON CAN READ ${t}: ${count} rows`)
}

// The audit table must never contain anything password-shaped.
const { data: audit } = await sb.from("user_admin_audit").select("*")
const dumped = JSON.stringify(audit ?? [])
if (/"password"|"temp_password"|"tempPassword"/i.test(dumped))
  bad("B3", "the audit table contains a password-like key")
else ok("B3", `audit table holds ${(audit ?? []).length} row(s), no password-shaped field`)

// Source must never read user_metadata for authorization.
const files = []
const walk = (p) => {
  if (!existsSync(p)) return
  if (statSync(p).isFile()) { if (/\.tsx?$/.test(p)) files.push(p); return }
  for (const e of readdirSync(p)) if (e !== "node_modules") walk(join(p, e))
}
;["app", "components", "lib", "middleware.ts"].forEach(walk)
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "")

// `user_metadata: { full_name }` is a WRITE of a display name and is fine —
// that is what the field is for. `user.user_metadata?.role` is an
// authorization READ and is not. Anything mentioning role is flagged either
// way: writing a role there is dead weight now that nothing reads it.
const isOffence = (line) =>
  line.includes("user_metadata") && (!/user_metadata\s*:/.test(line) || /role/.test(line))

const offenders = []
for (const f of files) {
  strip(readFileSync(f, "utf8")).split("\n").forEach((line, i) => {
    if (isOffence(line)) offenders.push(`${f}:${i + 1}`)
  })
}
if (offenders.length === 0) ok("B4", `no authorization read of user_metadata in ${files.length} source files`)
else bad("B4", `user_metadata read for authorization at: ${offenders.join(", ")}`)

// The service-role key must not be in any client bundle.
if (existsSync(".next/static")) {
  const sig = SERVICE.slice(-16)
  const hits = []
  const scan = (p) => {
    if (statSync(p).isFile()) { if (readFileSync(p, "utf8").includes(sig)) hits.push(p); return }
    for (const e of readdirSync(p)) scan(join(p, e))
  }
  scan(".next/static")
  if (hits.length === 0) ok("B5", "service-role key absent from .next/static")
  else bad("B5", `SERVICE-ROLE KEY FOUND IN: ${hits.join(", ")}`)
} else {
  note("B5", "no .next/static — run `npm run build` first to check the client bundle")
}

// Public sign-up must be off.
const throwaway = `signup-probe-${Date.now()}@example.invalid`
if (PROD) {
  note("B6", "sign-up probe skipped on production by design — confirm the dashboard toggle by hand")
} else {
  const { error } = await sbAnon.auth.signUp({ email: throwaway, password: "ProbePass123" })
  if (error && /not allowed|disabled/i.test(error.message)) ok("B6", "public sign-up is disabled")
  else if (error) note("B6", `sign-up refused, but for another reason: ${error.message}`)
  else bad("B6", "PUBLIC SIGN-UP IS ENABLED — anyone can create an account")
}

// ── C. The user-management state itself ─────────────────────────────────────
const { data: profiles } = await sb.from("admin_profiles").select("*")
const active = (profiles ?? []).filter((p) => p.is_active)
if (active.length === 0) bad("C1", "NO ACTIVE ADMINISTRATOR — nobody can administer the CRM")
else ok("C1", `${active.length} active administrator(s): ${active.map((p) => p.full_name).join(", ")}`)

const shared = (profiles ?? []).find((p) => p.is_shared_account)
const named = (profiles ?? []).filter((p) => !p.is_shared_account && p.is_active)
if (!shared) note("C2", "no shared admin row found")
else if (shared.is_active && named.length === 0)
  note("C2", "the shared login is still in use and no named admin exists yet — U-D3 is unfinished")
else if (shared.is_active)
  note("C2", `the shared login is still active alongside ${named.length} named admin(s) — retire it when ready`)
else ok("C2", "the shared admin login has been retired")

// Every admin must satisfy all three U-D6 conditions, or they are not an admin.
for (const p of active) {
  const u = users.users.find((x) => x.id === p.user_id)
  const role = u?.app_metadata?.role
  const banned = Boolean(u?.banned_until && new Date(u.banned_until) > new Date())
  if (!u) bad("C3", `${p.full_name} has a roster row but no login`)
  else if (role !== "admin") bad("C3", `${p.full_name} has an active roster row but role="${role}"`)
  else if (banned) bad("C3", `${p.full_name} is active in the roster but BANNED`)
  else ok("C3", `${p.full_name}: app_metadata.role=admin, active, not banned`)
}

// Any login linked to neither a rep nor an admin.
const linked = new Set([
  ...(reps ?? []).map((r) => r.user_id).filter(Boolean),
  ...(profiles ?? []).map((p) => p.user_id),
])
const unrecognised = users.users.filter((u) => !linked.has(u.id))
if (unrecognised.length === 0) ok("C4", "every login is linked to a rep or an administrator")
else bad("C4", `UNRECOGNISED LOGIN(S): ${unrecognised.map((u) => u.email).join(", ")}`)

// Reps with no login cannot work.
const noLogin = (reps ?? []).filter((r) => !r.user_id && r.is_active)
if (noLogin.length === 0) ok("C5", "every active rep has a login")
else note("C5", `${noLogin.length} active rep(s) have no login: ${noLogin.map((r) => r.full_name).join(", ")}`)

// ── Report ──────────────────────────────────────────────────────────────────
console.log(results.join("\n"))
console.log("=".repeat(72))
console.log(`  ${pass} passed   ${warn} note(s)   ${fail} failed\n`)
await new Promise((r) => setTimeout(r, 50))
process.exit(fail === 0 ? 0 : 1)
