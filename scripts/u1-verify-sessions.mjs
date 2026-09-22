// ============================================================================
// U1 §7.5 — does revoke_user_sessions actually end a session?
//
// The spec is explicit that this must be PROVEN rather than assumed, and that
// the function is DROPPED if Supabase's auth schema rejects the delete, falling
// back to ban + the is_active RLS check. This script is that proof.
//
// STAGING ONLY. Creates and deletes its own throwaway user.
//
// What to expect, and why the result needs reading carefully: a Supabase access
// token is a JWT and is validated statelessly, so deleting the session row does
// NOT necessarily invalidate an access token that has already been issued. What
// it should break is the REFRESH. The practical effect is "the user is signed
// out within one token lifetime (1 hour here)", not "instantly". That is still
// worth having, but it is a different promise from the one the UI should make.
// ============================================================================
import { readFileSync } from "fs"
import { randomBytes } from "crypto"
import { createClient } from "@supabase/supabase-js"

const env = readFileSync(".env.local", "utf8")
const pick = (k) => env.match(new RegExp(`^${k}=(.+)$`, "m"))?.[1].trim()

const URL = pick("STAGING_SUPABASE_URL")
const ANON = pick("STAGING_SUPABASE_ANON_KEY")
const SVC = pick("STAGING_SUPABASE_SERVICE_ROLE_KEY")

if (!URL?.includes("koifyemtduyyfqpkogpl")) {
  console.error("REFUSED: staging only.")
  process.exit(1)
}

const admin = createClient(URL, SVC, { auth: { persistSession: false, autoRefreshToken: false } })
const email = `u1-session-${Date.now()}@example.invalid`
const password = randomBytes(18).toString("base64url")
let userId

try {
  const { data: created, error: ce } = await admin.auth.admin.createUser({
    email, password, email_confirm: true, app_metadata: { role: "telemarketer" },
  })
  if (ce) throw new Error(`createUser: ${ce.message}`)
  userId = created.user.id
  console.log(`  throwaway user created: ${email}\n`)

  // Sign in. autoRefreshToken off so nothing refreshes behind our back.
  const user = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data: signIn, error: se } = await user.auth.signInWithPassword({ email, password })
  if (se) throw new Error(`signIn: ${se.message}`)
  console.log(`  signed in, refresh_token present: ${Boolean(signIn.session?.refresh_token)}`)

  const { data: before } = await user.auth.getUser()
  console.log(`  getUser() before revoke: ${before.user ? "returns the user" : "null"}`)

  // Revoke.
  const { data: deleted, error: re } = await admin.rpc("revoke_user_sessions", { p_user_id: userId })
  if (re) {
    console.log(`\n  RESULT: revoke_user_sessions FAILED -> ${re.message}`)
    console.log(`  => Per §7.5 the function must be DROPPED from 013 and we rely on`)
    console.log(`     ban + the is_active RLS check instead. Do not work around it.\n`)
    process.exitCode = 2
  } else {
    console.log(`  revoke_user_sessions deleted ${deleted} session row(s)\n`)

    // 1. Does the existing ACCESS token still work?
    const { data: after, error: ae } = await user.auth.getUser()
    console.log(`  getUser() after revoke : ${after?.user ? "STILL returns the user" : "null"}` +
      (ae ? ` (${ae.message})` : ""))

    // 2. Does the REFRESH work? This is the one that should break.
    const { data: refreshed, error: rfe } = await user.auth.refreshSession({
      refresh_token: signIn.session.refresh_token,
    })
    const refreshWorked = Boolean(refreshed?.session) && !rfe
    console.log(`  refreshSession()       : ${refreshWorked ? "STILL WORKS" : "refused"}` +
      (rfe ? ` (${rfe.message})` : ""))

    console.log("")
    if (!refreshWorked && deleted > 0) {
      console.log("  RESULT: revoke_user_sessions WORKS. The session row is deleted and the")
      console.log("          refresh token is refused, so the user is signed out at the next")
      console.log(`          refresh${after?.user ? " (their current access token lasts until it expires)" : ""}.`)
      console.log("  => Keep the function. Wire it into reset-password and deactivate.")
    } else if (deleted === 0) {
      console.log("  RESULT: INCONCLUSIVE - no session row existed to delete. Supabase may not")
      console.log("          persist a session row for this sign-in shape. Treat as unproven.")
      process.exitCode = 3
    } else {
      console.log("  RESULT: the row was deleted but the refresh token STILL WORKS.")
      console.log("  => The function does not do what its name promises. Drop it per §7.5.")
      process.exitCode = 4
    }
  }
} catch (err) {
  console.error(`\n  ERROR: ${err.message}`)
  process.exitCode = 1
} finally {
  if (userId) {
    const { error } = await admin.auth.admin.deleteUser(userId)
    console.log(`\n  throwaway user deleted${error ? ` (FAILED: ${error.message})` : ""}`)
  }
}

await new Promise((r) => setTimeout(r, 50))
process.exit(process.exitCode ?? 0)
