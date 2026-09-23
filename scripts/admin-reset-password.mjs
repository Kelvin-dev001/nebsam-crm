// ============================================================================
// BREAK-GLASS — reset an administrator's password from a laptop (§8.6).
//
//   node scripts/admin-reset-password.mjs --email <admin email> [--reactivate]
//                                         [--target=staging]
//
// WHEN TO USE THIS
// ----------------
// Only when NO administrator can sign in. With named admins (U4b) the normal
// path is one admin resetting another in Admin -> Users, which is audited and
// requires a step-up password. This script is the recovery of last resort for
// the case that path cannot reach: everyone locked out at once.
//
// IT BYPASSES THE LAST-ADMIN GUARD BY DESIGN
// ------------------------------------------
// deactivate_admin_guarded (§7.6) exists so the system can never be left with
// zero administrators. This script does not go through it, because the
// situation it exists for is precisely the one where that guard has already
// failed to help — the roster is fine and nobody can get in anyway. Run it with
// that in mind.
//
// THE PASSWORD IS PRINTED ONCE, TO THE TERMINAL, AND WRITTEN NOWHERE.
// Not to a file, not to the audit table, not to the clipboard. Copy it before
// you close the window. If you lose it, run this again.
// ============================================================================

import { readFileSync } from "fs"
import { createInterface } from "readline"
import { randomInt } from "crypto"
import { createClient } from "@supabase/supabase-js"

// ── Password generation, mirroring lib/auth/tempPassword.ts ────────────────
// Duplicated deliberately: this script must keep working even if the app does
// not build, which is one of the ways you end up needing it.
const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ"
const LOWER = "abcdefghijkmnpqrstuvwxyz"
const DIGIT = "23456789"
const ALL = UPPER + LOWER + DIGIT
const pick = (set) => set[randomInt(set.length)]

function generateTempPassword() {
  const chars = [pick(UPPER), pick(LOWER), pick(DIGIT)]
  while (chars.length < 12) chars.push(pick(ALL))
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1)
    ;[chars[i], chars[j]] = [chars[j], chars[i]]
  }
  return chars.join("")
}

// ── Arguments ───────────────────────────────────────────────────────────────
const args = process.argv.slice(2)
const argOf = (name) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`))
  if (hit) return hit.slice(name.length + 3)
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : null
}

const email = argOf("email")?.trim().toLowerCase()
const target = argOf("target") ?? "production"
const reactivate = args.includes("--reactivate")

if (!email) {
  console.error(`
  Usage: node scripts/admin-reset-password.mjs --email <admin email> [--reactivate] [--target=staging]

    --reactivate   also unban the login and set admin_profiles.is_active = true
    --target       "production" (default) or "staging"
`)
  process.exit(1)
}

const env = readFileSync(".env.local", "utf8")
const pickEnv = (k) => env.match(new RegExp(`^${k}=(.+)$`, "m"))?.[1].trim()
const URL_KEY = target === "production" ? "NEXT_PUBLIC_SUPABASE_URL" : "STAGING_SUPABASE_URL"
const SVC_KEY = target === "production" ? "SUPABASE_SERVICE_ROLE_KEY" : "STAGING_SUPABASE_SERVICE_ROLE_KEY"
const url = pickEnv(URL_KEY)
const svc = pickEnv(SVC_KEY)

if (!url || !svc) {
  console.error(`\n  Missing ${!url ? URL_KEY : SVC_KEY} in .env.local.\n`)
  process.exit(1)
}

const projectRef = new URL(url).hostname.split(".")[0]
const sb = createClient(url, svc, { auth: { persistSession: false, autoRefreshToken: false } })

console.log(`
  +-- BREAK-GLASS admin password reset ------------------------
  | target   : ${target.toUpperCase()}
  | url      : ${url}
  | project  : ${projectRef}
  | email    : ${email}
  | also     : ${reactivate ? "unban + reactivate the roster row" : "password only"}
  +------------------------------------------------------------
`)

// ── Find the account, and say what it is before touching it ────────────────
const { data: list, error: listErr } = await sb.auth.admin.listUsers({ page: 1, perPage: 200 })
if (listErr) {
  console.error(`  Could not list users: ${listErr.message}\n`)
  process.exit(1)
}

const user = list.users.find((u) => u.email?.toLowerCase() === email)
if (!user) {
  console.error(`  No login found for ${email}.\n`)
  process.exit(1)
}

const { data: profile } = await sb.from("admin_profiles").select("*").eq("user_id", user.id).maybeSingle()

console.log(`  Found:`)
console.log(`    id            : ${user.id}`)
console.log(`    role          : ${user.app_metadata?.role ?? "(none)"}`)
console.log(`    banned        : ${user.banned_until ? `yes, until ${user.banned_until}` : "no"}`)
console.log(`    roster row    : ${profile ? (profile.is_active ? "active" : "INACTIVE") : "NONE"}`)
console.log(`    roster name   : ${profile?.full_name ?? "—"}`)
console.log(`    last sign-in  : ${user.last_sign_in_at ?? "never"}\n`)

if (user.app_metadata?.role !== "admin") {
  console.error(`  REFUSED: this account's role is "${user.app_metadata?.role ?? "none"}", not "admin".`)
  console.error(`  This script is for administrators. Reset a rep from Admin -> Users.\n`)
  process.exit(1)
}

if (!profile && !reactivate) {
  console.error(`  REFUSED: ${email} has role=admin but NO admin_profiles row, so is_admin()`)
  console.error(`  returns false and resetting the password would not restore access.`)
  console.error(`  Investigate before continuing — this is what an "Unrecognised login" looks like.\n`)
  process.exit(1)
}

// ── Typed confirmation ──────────────────────────────────────────────────────
const rl = createInterface({ input: process.stdin, output: process.stdout })
const answer = await new Promise((resolve) =>
  rl.question(`  Type the project ref (${projectRef}) to continue: `, resolve),
)
rl.close()

if (answer.trim() !== projectRef) {
  console.error(`\n  Aborted — "${answer.trim()}" does not match. Nothing was changed.\n`)
  process.exit(1)
}

// ── Do it ───────────────────────────────────────────────────────────────────
const tempPassword = generateTempPassword()

const { error: updErr } = await sb.auth.admin.updateUserById(user.id, {
  password: tempPassword,
  app_metadata: { must_change_password: true },
  ...(reactivate ? { ban_duration: "none" } : {}),
})

if (updErr) {
  console.error(`\n  FAILED: ${updErr.message}\n`)
  process.exit(1)
}

if (reactivate) {
  const { error } = await sb.rpc("reactivate_admin", { p_target: user.id })
  if (error) console.error(`  WARNING: roster reactivation failed: ${error.message}`)
  else console.log(`\n  Roster row reactivated.`)
}

const { error: revokeErr } = await sb.rpc("revoke_user_sessions", { p_user_id: user.id })
if (revokeErr) console.error(`  WARNING: could not end existing sessions: ${revokeErr.message}`)

// Audited like any other admin action, attributed to the script so the activity
// feed never shows a password reset with no actor.
await sb.from("user_admin_audit").insert({
  action: "admin_password_reset",
  target_kind: "admin",
  target_user_id: user.id,
  performed_by: null,
  performed_by_name: "break-glass script",
  performed_by_email: null,
  details: { reactivated: reactivate, via: "scripts/admin-reset-password.mjs" },
})

console.log(`
  +------------------------------------------------------------
  | DONE. Temporary password for ${email}:
  |
  |     ${tempPassword}
  |
  | Shown once. Not stored anywhere, including the audit log.
  | Copy it now — if you lose it, run this again.
  |
  | They will be asked to set their own password at sign-in.
  +------------------------------------------------------------
`)

await new Promise((r) => setTimeout(r, 50))
process.exit(0)
