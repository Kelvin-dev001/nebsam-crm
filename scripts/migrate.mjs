/**
 * Sprint 1 migration runner.
 * Usage: node scripts/migrate.mjs [--seed]
 *
 * Requires DATABASE_URL in .env.local (Session-mode pooler from Supabase dashboard
 * → Settings → Database → Connection string → URI).
 */

import pg from "pg"
import { readFileSync } from "fs"
import { resolve, dirname } from "path"
import { fileURLToPath } from "url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, "..")

// Parse .env.local manually (no dotenv dependency)
function loadEnv() {
  const envPath = resolve(root, ".env.local")
  const lines = readFileSync(envPath, "utf-8").split("\n")
  const env = {}
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const [key, ...rest] = trimmed.split("=")
    env[key.trim()] = rest.join("=").trim()
  }
  return env
}

const env = loadEnv()
const DATABASE_URL = env.DATABASE_URL

if (!DATABASE_URL || DATABASE_URL.includes("your-")) {
  console.error(
    "\nERROR: DATABASE_URL is not set in .env.local\n" +
    "Get it from: Supabase Dashboard → Settings → Database → Connection string\n" +
    "Choose 'Session mode' (port 5432) and paste it as:\n" +
    "DATABASE_URL=postgresql://postgres.slnphqsrrjpqcthezgun:PASSWORD@aws-0-REGION.pooler.supabase.com:5432/postgres\n"
  )
  process.exit(1)
}

const { Client } = pg
const client = new Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } })

const runSeed = process.argv.includes("--seed")

async function run() {
  await client.connect()
  console.log("✓ Connected to database")

  try {
    const migrationSql = readFileSync(
      resolve(root, "supabase/migrations/001_initial_schema.sql"),
      "utf-8"
    )
    console.log("Running migration 001_initial_schema.sql …")
    await client.query(migrationSql)
    console.log("✓ Migration complete")

    if (runSeed) {
      const seedSql = readFileSync(resolve(root, "supabase/seed.sql"), "utf-8")
      console.log("Running seed.sql …")
      await client.query(seedSql)
      console.log("✓ Seed complete")
    }
  } finally {
    await client.end()
  }
}

run().catch((err) => {
  console.error("Migration failed:", err.message)
  process.exit(1)
})
