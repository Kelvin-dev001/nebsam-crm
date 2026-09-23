// ============================================================
// Nebsam CRM — One-time Auth User Setup
// Run: node scripts/setup-auth-users.mjs
// ============================================================
// Creates 4 Supabase Auth users, links them to telemarketer
// records, and writes CREDENTIALS.md (gitignored).
// Safe to re-run: skips users that already exist.

// ============================================================================
// DEPRECATED — do not run this (U3, defect 2).
//
// TWO REASONS:
//
// 1. IT DESTROYS ITS OWN OUTPUT. Users that already exist are skipped WITHOUT
//    adding a line to the credentials table, and then writeFileSync overwrites
//    CREDENTIALS.md wholesale. Running it to add a fifth person therefore
//    erases the recorded passwords of the first four.
//
// 2. IT IS NO LONGER THE WAY USERS ARE MADE. Admin -> Users creates the login
//    and the rep row together, audits it, issues a temporary password and
//    forces a change. This script does none of that, and it writes
//    user_metadata.role, which migration 012 stopped trusting for
//    authorization — an account made here would have no app_metadata.role at
//    all and would be treated as a rep regardless of what is passed.
//
// Kept for historical reference only. To reset an admin who cannot sign in,
// use scripts/admin-reset-password.mjs.
// ============================================================================

if (!process.argv.includes("--force-legacy")) {
  console.error(`
  DEPRECATED - add users in Admin -> Users instead.

  This script overwrites CREDENTIALS.md and erases the passwords of anyone it
  skips, and it writes the role to user_metadata, which is no longer read for
  authorization (migration 012).

  If you genuinely need the legacy behaviour, pass --force-legacy.
`)
  process.exit(1)
}

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
