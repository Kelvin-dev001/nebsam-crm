// ============================================================================
// Nebsam CRM — Sprint U0, Step A: backfill auth.users.app_metadata.role
//
//   node scripts/backfill-app-metadata-roles.mjs                     # audit only
//   node scripts/backfill-app-metadata-roles.mjs --confirm=<ref>     # write
//   node scripts/backfill-app-metadata-roles.mjs --target=staging    # pick project
//   node scripts/backfill-app-metadata-roles.mjs --snapshot=<path>   # write rollback file
//
// WHY THIS EXISTS
// ---------------
// Authorization currently reads auth.users.raw_user_meta_data->>'role'. That
// field is writable by the user it belongs to, through the client SDK, with the
// anon key that ships inside the browser bundle:
//
//     await supabase.auth.updateUser({ data: { role: 'admin' } })
//
// is_admin() reads it live and every RLS policy in 011 calls is_admin(), so any
// signed-in rep can grant themselves read/write on every lead, call log, sale
// and rep record in all four departments.
//
// app_metadata is the fix: only the service role can write it. This script
// copies each user's existing role from user_metadata into app_metadata so that
// migration 012 can switch the source over without anyone's access changing.
//
// WHAT IT DELIBERATELY DOES NOT DO
// --------------------------------
//   • It never touches user_metadata. The deployed app still reads it for page
//     routing until Step C ships, so clearing it now would log everybody out of
//     their correct landing page.
//   • It never creates, deletes or bans a user.
//   • It never invents a role. A user with no user_metadata.role is reported and
//     skipped, not guessed at.
//   • It stops entirely on an unrecognised account (see ROGUE ACCOUNTS below).
//
// ROLLBACK
// --------
// Every run writes a snapshot of all four users' metadata BEFORE changing
// anything (--snapshot, default under the backups directory, never the repo —
// it is auth data). app_metadata.role is a NEW key, so undoing this run means
// restoring each user's recorded app_metadata verbatim. The snapshot file
// carries the exact command in its own header.
//
// ROGUE ACCOUNTS
// --------------
// If any auth user is not one of the four known logins, the script STOPS and
// reports. It does not delete the account and does not give it a role. An
// unknown account — especially one claiming role 'admin' — may mean the hole
// has already been used, and what to do about that is Kelvin's decision, not
// this script's.
// ============================================================================

import { readFileSync, writeFileSync, mkdirSync } from "fs"
import { dirname } from "path"
import { createClient } from "@supabase/supabase-js"

// ── The four accounts this system is known to have ──────────────────────────
// Sourced from scripts/setup-auth-users.mjs, which created them.
const KNOWN_LOGINS = new Set([
  "edith@nebsamdigital.com",
  "janet@nebsamdigital.com",
  "suzzie@nebsamdigital.com",
  "admin@nebsamdigital.com",
])

const VALID_ROLES = new Set(["admin", "telemarketer"])

// ── Arguments ───────────────────────────────────────────────────────────────
const args = process.argv.slice(2)
const argOf = (name) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : null
}

const target  = argOf("target") ?? "production"
const confirm = argOf("confirm")
const apply   = confirm !== null

if (!["production", "staging"].includes(target)) {
  console.error(`\n  --target must be "production" or "staging" (got "${target}")\n`)
  process.exit(1)
}

// ── Credentials ─────────────────────────────────────────────────────────────
// Read from .env.local the same way the rest of scripts/ does. The service-role
// key is required: listUsers and updateUserById are Auth *admin* endpoints and
// the anon key cannot call them.
const env = readFileSync(".env.local", "utf8")
const pick = (key) => {
  const m = env.match(new RegExp(`^${key}=(.+)$`, "m"))
  return m ? m[1].trim() : null
}

const URL_KEY = target === "production" ? "NEXT_PUBLIC_SUPABASE_URL"      : "STAGING_SUPABASE_URL"
const SVC_KEY = target === "production" ? "SUPABASE_SERVICE_ROLE_KEY"     : "STAGING_SUPABASE_SERVICE_ROLE_KEY"

const url = pick(URL_KEY)
const svc = pick(SVC_KEY)

if (!url || !svc) {
  console.error(`\n  Missing ${!url ? URL_KEY : SVC_KEY} in .env.local.`)
  if (target === "staging" && !svc) {
    console.error(`  The staging service-role key is in Supabase → project koifyemtduyyfqpkogpl`)
    console.error(`  → Settings → API. Add it to .env.local as ${SVC_KEY} (the file is gitignored).`)
  }
  console.error()
  process.exit(1)
}

// The project ref is the only safe discriminator between environments: Supabase
// pooler hostnames are shared per region and staging/production differ by a
// single character (aws-0 vs aws-1). migrate-file.mjs matches on the ref for
// exactly this reason; so does this script.
const projectRef = new URL(url).hostname.split(".")[0]

// ── Banner — print the target BEFORE connecting ─────────────────────────────
console.log(`
  +-- nebsam-crm backfill-app-metadata-roles -------------------
  | target   : ${target.toUpperCase()}
  | url      : ${url}
  | project  : ${projectRef}
  | mode     : ${apply ? "APPLY - writes app_metadata.role" : "AUDIT ONLY - no writes"}
  +------------------------------------------------------------
`)

if (apply && confirm !== projectRef) {
  console.error(`  REFUSED: --confirm=${confirm || "(empty)"} does not match the target project ref.`)
  console.error(`  To write to ${target}, pass --confirm=${projectRef}\n`)
  process.exit(1)
}

const sb = createClient(url, svc, { auth: { persistSession: false, autoRefreshToken: false } })

// Exit helper. The Supabase client holds keep-alive sockets, and calling
// process.exit() while one is mid-close trips a libuv assertion on Windows
// ("!(handle->flags & UV_HANDLE_CLOSING)"). It is harmless, but an "Assertion
// failed" line in the output of a security script is alarming and could mask a
// real failure, so give the sockets a moment to settle first.
async function finish(code) {
  await new Promise((r) => setTimeout(r, 50))
  process.exit(code)
}

// ── 1. List every auth user, paginating to exhaustion ───────────────────────
async function listAllUsers() {
  const all = []
  const perPage = 200
  for (let page = 1; ; page++) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage })
    if (error) throw new Error(`listUsers failed: ${error.message}`)
    all.push(...data.users)
    if (data.users.length < perPage) break
  }
  return all
}

const users = await listAllUsers()
const roleOf    = (u, which) => (which === "app" ? u.app_metadata : u.user_metadata)?.role ?? null
const providers = (u) => u.app_metadata?.provider ?? "(none)"

console.log(`  ${users.length} auth user(s) found.\n`)
console.log(`  ${"email".padEnd(30)} ${"created".padEnd(11)} ${"user_meta".padEnd(13)} ${"app_meta".padEnd(13)} last sign-in`)
console.log(`  ${"-".repeat(30)} ${"-".repeat(11)} ${"-".repeat(13)} ${"-".repeat(13)} ${"-".repeat(11)}`)
for (const u of users) {
  console.log(
    `  ${(u.email ?? "(none)").padEnd(30)}` +
    ` ${(u.created_at ?? "").slice(0, 10).padEnd(11)}` +
    ` ${String(roleOf(u, "user") ?? "-").padEnd(13)}` +
    ` ${String(roleOf(u, "app") ?? "-").padEnd(13)}` +
    ` ${(u.last_sign_in_at ?? "never").slice(0, 10)}`,
  )
}

// ── 2. Rogue-account check — this gate comes before any write ───────────────
const unknown = users.filter((u) => !KNOWN_LOGINS.has((u.email ?? "").toLowerCase()))

if (unknown.length > 0) {
  console.error(`
  ============================================================
  STOPPED - ${unknown.length} UNRECOGNISED ACCOUNT(S)
  ============================================================
`)
  for (const u of unknown) {
    console.error(`    email      : ${u.email ?? "(none)"}`)
    console.error(`    id         : ${u.id}`)
    console.error(`    created    : ${u.created_at}`)
    console.error(`    user_meta  : role=${roleOf(u, "user") ?? "-"}`)
    console.error(`    app_meta   : role=${roleOf(u, "app") ?? "-"}  provider=${providers(u)}`)
    console.error(`    last sign-in: ${u.last_sign_in_at ?? "never"}`)
    console.error()
  }
  console.error(`  Expected only: ${[...KNOWN_LOGINS].join(", ")}`)
  console.error(`
  Nothing has been changed. Report this to Kelvin before going further.
  An account claiming role 'admin' here may mean the user_metadata hole has
  already been used. Do not delete it and do not give it a role: preserving it
  as evidence matters more than tidying it away, and the decision is his.
`)
  await finish(2)
}

console.log(`\n  Rogue-account check: PASS - all ${users.length} accounts recognised.\n`)

// ── 3. Validate every role value before writing any of them ─────────────────
const problems = []
for (const u of users) {
  const from = roleOf(u, "user")
  const to   = roleOf(u, "app")
  if (to !== null && !VALID_ROLES.has(to))   problems.push(`${u.email}: app_metadata.role="${to}" is not a known role`)
  if (to === null && from === null)          problems.push(`${u.email}: has no role in either place - cannot infer one`)
  if (to === null && from !== null && !VALID_ROLES.has(from))
    problems.push(`${u.email}: user_metadata.role="${from}" is not a known role`)
  if (to !== null && from !== null && to !== from)
    problems.push(`${u.email}: app_metadata.role="${to}" already disagrees with user_metadata.role="${from}"`)
}

if (problems.length > 0) {
  console.error(`  STOPPED - role values did not validate:\n`)
  for (const p of problems) console.error(`    - ${p}`)
  console.error(`\n  Nothing has been changed.\n`)
  await finish(3)
}

const todo = users.filter((u) => roleOf(u, "app") === null)

if (todo.length === 0) {
  console.log(`  Nothing to do - every user already carries app_metadata.role.\n`)
  await finish(0)
}

console.log(`  ${todo.length} user(s) need app_metadata.role:`)
for (const u of todo) console.log(`    ${u.email}  ->  ${roleOf(u, "user")}`)
console.log()

// ── 4. Snapshot BEFORE writing — this is the rollback ───────────────────────
const stamp        = new Date().toISOString().replace(/[:.]/g, "-")
const snapshotPath = argOf("snapshot") ??
  `C:/Projects/nebsam-crm-backups/auth-metadata-${target}-${stamp}.json`

if (apply) {
  const snapshot = {
    captured_at: new Date().toISOString(),
    target,
    project_ref: projectRef,
    note:
      "Pre-Step-A snapshot of auth.users metadata. To roll back, restore each " +
      "user's app_metadata verbatim with " +
      "sb.auth.admin.updateUserById(id, { app_metadata }). user_metadata was " +
      "never modified by this script and is recorded only for comparison.",
    users: users.map((u) => ({
      id: u.id,
      email: u.email,
      app_metadata: u.app_metadata,
      user_metadata: u.user_metadata,
    })),
  }
  mkdirSync(dirname(snapshotPath), { recursive: true })
  writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2))
  console.log(`  Rollback snapshot written: ${snapshotPath}\n`)
} else {
  console.log(`  (audit only - no snapshot written, no changes made)\n`)
  console.log(`  To apply: node scripts/backfill-app-metadata-roles.mjs --target=${target} --confirm=${projectRef}\n`)
  await finish(0)
}

// ── 5. Write, one user at a time ────────────────────────────────────────────
// Only the `role` key is passed. GoTrue MERGES app_metadata rather than
// replacing it, so provider/providers should survive — but §6.1 says to verify
// that rather than assume it, which step 6 does.
let written = 0
for (const u of todo) {
  const role = roleOf(u, "user")
  const { error } = await sb.auth.admin.updateUserById(u.id, { app_metadata: { role } })
  if (error) {
    console.error(`  FAILED ${u.email}: ${error.message}`)
    console.error(`\n  Stopped after ${written} successful write(s). Safe to re-run:`)
    console.error(`  the script skips users that already carry app_metadata.role.\n`)
    await finish(4)
  }
  written++
  console.log(`  written  ${u.email}  app_metadata.role=${role}`)
}

// ── 6. Verify by re-reading — never trust the write ─────────────────────────
console.log(`\n  Re-reading all users to verify...\n`)
const after = await listAllUsers()
const byId  = new Map(after.map((u) => [u.id, u]))
const bad   = []

for (const before of users) {
  const now = byId.get(before.id)
  if (!now) { bad.push(`${before.email}: disappeared`); continue }

  const expected = roleOf(before, "app") ?? roleOf(before, "user")
  if (roleOf(now, "app") !== expected)
    bad.push(`${now.email}: app_metadata.role is "${roleOf(now, "app")}", expected "${expected}"`)

  // The merge must not have dropped the identity provider.
  if (before.app_metadata?.provider && !now.app_metadata?.provider)
    bad.push(`${now.email}: app_metadata.provider was LOST by the merge`)
  if (before.app_metadata?.providers && !now.app_metadata?.providers)
    bad.push(`${now.email}: app_metadata.providers was LOST by the merge`)

  // user_metadata must be untouched.
  if (JSON.stringify(now.user_metadata) !== JSON.stringify(before.user_metadata))
    bad.push(`${now.email}: user_metadata CHANGED - it must not have`)
}

console.log(`  ${"email".padEnd(30)} ${"app_meta.role".padEnd(15)} ${"provider".padEnd(12)} user_meta.role`)
console.log(`  ${"-".repeat(30)} ${"-".repeat(15)} ${"-".repeat(12)} ${"-".repeat(14)}`)
for (const u of after) {
  console.log(
    `  ${(u.email ?? "").padEnd(30)}` +
    ` ${String(roleOf(u, "app") ?? "-").padEnd(15)}` +
    ` ${String(providers(u)).padEnd(12)}` +
    ` ${roleOf(u, "user") ?? "-"}`,
  )
}

if (bad.length > 0) {
  console.error(`\n  VERIFICATION FAILED:\n`)
  for (const b of bad) console.error(`    - ${b}`)
  console.error(`\n  Roll back with the snapshot at:\n    ${snapshotPath}\n`)
  await finish(5)
}

console.log(`
  +------------------------------------------------------------
  | DONE - ${String(written).padEnd(2)} user(s) updated, all verified.
  |
  | user_metadata was not modified. The deployed app still reads
  | it for routing and keeps working unchanged.
  |
  | Next: migration 012 switches is_admin() over to app_metadata,
  | then Step C deploys the app change. Leave at least an hour
  | between this run and the Step C deploy (jwt_expiry = 3600s).
  |
  | Rollback: ${snapshotPath}
  +------------------------------------------------------------
`)
