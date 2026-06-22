// Run once if your tables show "permission denied" via the Data API:
// node scripts/fix-grants.mjs

import { readFileSync } from "fs"
import { resolve, dirname } from "path"
import { fileURLToPath } from "url"
import pg from "pg"

const __dirname = dirname(fileURLToPath(import.meta.url))
const envPath = resolve(__dirname, "../.env.local")
const envContent = readFileSync(envPath, "utf-8")
const env = Object.fromEntries(
  envContent.split("\n").filter(Boolean).map((l) => {
    const [k, ...v] = l.split("=")
    return [k.trim(), v.join("=").trim()]
  })
)

const client = new pg.Client({ connectionString: env.DATABASE_URL })
await client.connect()

const sql = `
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated, service_role;
`

try {
  await client.query(sql)
  console.log("✓ Grants applied — all tables now accessible via the Data API")
} catch (err) {
  console.error("Error:", err.message)
} finally {
  await client.end()
}
