// ============================================================
// Nebsam CRM — One-time Auth User Setup
// Run: node scripts/setup-auth-users.mjs
// ============================================================
// Creates 4 Supabase Auth users, links them to telemarketer
// records, and writes CREDENTIALS.md (gitignored).
// Safe to re-run: skips users that already exist.

import { readFileSync, writeFileSync } from "fs"
import { randomBytes } from "crypto"
import { createClient } from "@supabase/supabase-js"

const env     = readFileSync(".env.local", "utf8")
const url     = env.match(/NEXT_PUBLIC_SUPABASE_URL=(.+)/)[1].trim()
const svcKey  = env.match(/SUPABASE_SERVICE_ROLE_KEY=(.+)/)[1].trim()
const supabase = createClient(url, svcKey)

function genPassword() {
  // 16-char base64url: letters, digits, - and _
  return randomBytes(12).toString("base64url")
}

const USERS = [
  { email: "edith@nebsamdigital.com", role: "telemarketer", tmEmail: "edith@nebsamdigital.co.ke" },
  { email: "janet@nebsamdigital.com",  role: "telemarketer", tmEmail: "janet@nebsamdigital.co.ke"  },
  { email: "suzzie@nebsamdigital.com", role: "telemarketer", tmEmail: "suzzie@nebsamdigital.co.ke" },
  { email: "admin@nebsamdigital.com",  role: "admin",        tmEmail: null                         },
]

const lines = [
  "# Nebsam CRM — Auth Credentials",
  "# KEEP THIS FILE SECRET — never commit to git",
  "",
  `Generated: ${new Date().toISOString()}`,
  "",
  "| Email | Password | Role |",
  "|---|---|---|",
]

for (const user of USERS) {
  const password = genPassword()

  // Check if user already exists
  const { data: existing } = await supabase.auth.admin.listUsers()
  const alreadyExists = existing?.users?.find(u => u.email === user.email)

  let userId
  if (alreadyExists) {
    console.log(`⏩ User already exists: ${user.email}`)
    userId = alreadyExists.id
  } else {
    const { data, error } = await supabase.auth.admin.createUser({
      email: user.email,
      password,
      email_confirm: true,
      user_metadata: { role: user.role },
    })

    if (error) {
      console.error(`❌ Failed to create ${user.email}:`, error.message)
      lines.push(`| ${user.email} | ERROR: ${error.message} | ${user.role} |`)
      continue
    }

    userId = data.user.id
    console.log(`✅ Created: ${user.email} (${user.role})`)
    lines.push(`| ${user.email} | ${password} | ${user.role} |`)
  }

  // Link to telemarketer record (skip for admin)
  if (user.tmEmail) {
    const { error: linkErr } = await supabase
      .from("telemarketers")
      .update({ user_id: userId })
      .eq("email", user.tmEmail)

    if (linkErr) {
      console.error(`  ⚠️  Could not link ${user.email} to telemarketers:`, linkErr.message)
    } else {
      console.log(`  🔗 Linked to telemarketers.email = ${user.tmEmail}`)
    }
  }
}

lines.push("")
lines.push("## After running this script:")
lines.push("1. Apply the auth-scoped RLS block in supabase/migrations/006_auth.sql")
lines.push("2. Share credentials securely — never via git or chat")

writeFileSync("CREDENTIALS.md", lines.join("\n"), "utf8")
console.log("\n📄 CREDENTIALS.md written (gitignored)")
console.log("✔  Setup complete")
