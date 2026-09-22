// ============================================================================
// U1 acceptance test — every new API route must answer
//   401 to an anonymous caller, and 403 to a signed-in rep.
//
// This is the whole point of shipping the guards before the logic: a route
// whose guard arrives at the same time as its handler is a route whose guard
// was never tested on its own.
//
// Run against a dev server pointed at STAGING:
//
//   NEXT_PUBLIC_SUPABASE_URL=<staging url> \
//   NEXT_PUBLIC_SUPABASE_ANON_KEY=<staging anon key> npm run dev
//   node scripts/u1-verify-routes.mjs [http://localhost:3000]
//
// The rep case needs a real session. @supabase/ssr keeps it in a COOKIE, not an
// Authorization header, so this signs a throwaway rep in and rebuilds the same
// cookie the browser would send. Sending a bare bearer token would test
// nothing: the guard would see no user and answer 401, and the 403 path — the
// one that actually matters — would never run.
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

const ROUTES = [
  ["GET", "/api/admin/users"],
  ["POST", "/api/admin/users"],
  ["PATCH", "/api/admin/users/00000000-0000-0000-0000-000000000000"],
  ["POST", "/api/admin/users/00000000-0000-0000-0000-000000000000/login"],
  ["POST", "/api/admin/users/00000000-0000-0000-0000-000000000000/department"],
  ["POST", "/api/admin/users/00000000-0000-0000-0000-000000000000/reset-password"],
  ["POST", "/api/admin/users/00000000-0000-0000-0000-000000000000/require-password-change"],
  ["POST", "/api/admin/users/00000000-0000-0000-0000-000000000000/deactivate"],
  ["POST", "/api/admin/users/00000000-0000-0000-0000-000000000000/reactivate"],
  ["GET", "/api/admin/users/00000000-0000-0000-0000-000000000000/audit"],
  ["GET", "/api/admin/audit"],
  ["GET", "/api/whatsapp/test"], // admin-only as of U1
]

// requireUser routes: a rep is ALLOWED through the guard, so the expected
// signed-in answer is "not 401/403", not 403.
const USER_ROUTES = [
  ["POST", "/api/account/password", 501],
  ["POST", "/api/whatsapp/send", null], // 400 (missing body) proves the guard passed
  ["POST", "/api/whatsapp/installed-message", null],
]

const admin = createClient(URL_, SVC, { auth: { persistSession: false, autoRefreshToken: false } })
const projectRef = new URL(URL_).hostname.split(".")[0]

let pass = 0, fail = 0
const check = (label, ok, detail) => {
  if (ok) { pass++; console.log(`  PASS  ${label}`) }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`) }
}

const email = `u1-route-${Date.now()}@example.invalid`
const password = randomBytes(18).toString("base64url")
let userId, cookie

try {
  // ── Is the server even up? ───────────────────────────────────────────────
  try {
    await fetch(`${BASE}/api/admin/users`, { method: "GET" })
  } catch {
    console.error(`\n  No server at ${BASE}. Start it first (see the header).\n`)
    process.exit(1)
  }

  // ── 1. Anonymous: every admin route must be 401 ──────────────────────────
  console.log("\n-- anonymous (no cookie) --")
  for (const [method, path] of ROUTES) {
    const r = await fetch(`${BASE}${path}`, { method })
    check(`${method.padEnd(5)} ${path.padEnd(72)} -> ${r.status}`, r.status === 401, `expected 401`)
  }
  for (const [method, path] of USER_ROUTES) {
    const r = await fetch(`${BASE}${path}`, { method })
    check(`${method.padEnd(5)} ${path.padEnd(72)} -> ${r.status}`, r.status === 401, `expected 401`)
  }

  // ── 2. Sign a throwaway REP in and rebuild the browser's cookie ──────────
  const { data: created, error: ce } = await admin.auth.admin.createUser({
    email, password, email_confirm: true, app_metadata: { role: "telemarketer" },
  })
  if (ce) throw new Error(`createUser: ${ce.message}`)
  userId = created.user.id

  const user = createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data: signIn, error: se } = await user.auth.signInWithPassword({ email, password })
  if (se) throw new Error(`signIn: ${se.message}`)

  // @supabase/ssr stores the whole session as base64url JSON behind a
  // "base64-" prefix, under sb-<project-ref>-auth-token.
  const encoded = Buffer.from(JSON.stringify(signIn.session)).toString("base64url")
  cookie = `sb-${projectRef}-auth-token=base64-${encoded}`

  console.log("\n-- signed in as a REP --")
  for (const [method, path] of ROUTES) {
    const r = await fetch(`${BASE}${path}`, { method, headers: { cookie } })
    check(`${method.padEnd(5)} ${path.padEnd(72)} -> ${r.status}`, r.status === 403, `expected 403`)
  }

  console.log("\n-- signed in as a REP, routes a rep MAY call --")
  for (const [method, path, expect] of USER_ROUTES) {
    const r = await fetch(`${BASE}${path}`, {
      method, headers: { cookie, "content-type": "application/json" }, body: "{}",
    })
    const ok = expect ? r.status === expect : r.status !== 401 && r.status !== 403
    check(`${method.padEnd(5)} ${path.padEnd(72)} -> ${r.status}`, ok,
      expect ? `expected ${expect}` : "guard should have let a rep through")
  }
} catch (err) {
  fail++
  console.error(`\n  ERROR: ${err.message}`)
} finally {
  if (userId) {
    await admin.auth.admin.deleteUser(userId)
    console.log("\n  throwaway rep deleted")
  }
}

console.log(`\n${fail === 0 ? `ALL ${pass} CHECKS PASSED` : `${fail} of ${pass + fail} FAILED`}\n`)
await new Promise((r) => setTimeout(r, 50))
process.exit(fail === 0 ? 0 : 1)
