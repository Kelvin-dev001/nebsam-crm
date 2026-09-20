/**
 * Nebsam CRM migration runner.
 *
 * Replaces scripts/migrate.mjs, which is hardcoded to 001_initial_schema.sql and
 * must never be run against production. See DEPARTMENTS-MASTER-PROMPT.md section 1.
 *
 * Usage:
 *   node scripts/migrate-file.mjs <path-to.sql> [options]
 *
 * Options:
 *   --dry-run              Wrap the file in BEGIN ... ROLLBACK. Nothing is committed.
 *                          Every NOTICE and every returned row is printed.
 *   --no-transaction       Split the file on "-- @statement" markers and run each
 *                          chunk on its own, unwrapped. Required for
 *                          CREATE INDEX CONCURRENTLY. Cannot combine with --dry-run.
 *   --confirm=<substring>  REQUIRED for any real apply. Must appear in the target
 *                          host or the script aborts before connecting. This is what
 *                          stops you applying to production believing you are on staging.
 *   --url-env=NAME         Which env var holds the connection string. Defaults to
 *                          MIGRATION_DATABASE_URL, falling back to DATABASE_URL.
 *
 * Examples:
 *   node scripts/migrate-file.mjs supabase/migrations/009_departments_additive.sql --dry-run
 *   node scripts/migrate-file.mjs supabase/migrations/009_departments_additive.sql \
 *        --url-env=STAGING_DATABASE_URL --confirm=<fragment-of-staging-host>
 */

import pg from "pg"
import { readFileSync, existsSync } from "fs"
import { createHash } from "crypto"
import { resolve, dirname, relative } from "path"
import { fileURLToPath } from "url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, "..")

function die(msg) {
  console.error("")
  console.error("  ERROR  " + msg)
  console.error("")
  process.exit(1)
}

// Same .env.local parsing as scripts/migrate.mjs (no dotenv dependency).
function loadEnv() {
  const envPath = resolve(root, ".env.local")
  if (!existsSync(envPath)) die("`.env.local` not found at " + envPath)
  const env = {}
  for (const line of readFileSync(envPath, "utf-8").split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const [key, ...rest] = trimmed.split("=")
    env[key.trim()] = rest.join("=").trim()
  }
  return env
}

// ---- Arguments -----------------------------------------------------------

const argv = process.argv.slice(2)
const flags = argv.filter((a) => a.startsWith("--"))
const positional = argv.filter((a) => !a.startsWith("--"))

const dryRun = flags.includes("--dry-run")
const noTransaction = flags.includes("--no-transaction")
const confirmArg = flags.find((f) => f.startsWith("--confirm="))
const confirm = confirmArg ? confirmArg.slice("--confirm=".length) : null
const urlEnvArg = flags.find((f) => f.startsWith("--url-env="))
const urlEnvName = urlEnvArg ? urlEnvArg.slice("--url-env=".length) : null

const unknown = flags.filter(
  (f) =>
    !["--dry-run", "--no-transaction"].includes(f) &&
    !f.startsWith("--confirm=") &&
    !f.startsWith("--url-env=")
)
if (unknown.length) die("Unknown option(s): " + unknown.join(" "))

if (positional.length !== 1) {
  die(
    "Exactly one SQL file path is required.\n" +
      "         Usage: node scripts/migrate-file.mjs <path-to.sql> " +
      "[--dry-run] [--no-transaction] [--confirm=<host-substring>] [--url-env=NAME]"
  )
}

if (dryRun && noTransaction) {
  die(
    "--dry-run cannot be combined with --no-transaction.\n" +
      "         --no-transaction exists for CREATE INDEX CONCURRENTLY, which cannot run\n" +
      "         inside a transaction and therefore cannot be rolled back. A 'dry run' of\n" +
      "         it would be a lie. Dry-run the rest of the file first, then run the\n" +
      "         CONCURRENTLY statements for real."
  )
}

const filePath = resolve(root, positional[0])
if (!existsSync(filePath)) die("SQL file not found: " + filePath)
const sql = readFileSync(filePath, "utf-8")
if (!sql.trim()) die("SQL file is empty: " + filePath)
const sha = createHash("sha256").update(sql).digest("hex")

// ---- Connection string ---------------------------------------------------

const env = loadEnv()
const resolvedEnvName =
  urlEnvName || (env.MIGRATION_DATABASE_URL ? "MIGRATION_DATABASE_URL" : "DATABASE_URL")
const connectionString = env[resolvedEnvName]

if (!connectionString || connectionString.includes("your-")) {
  die(
    resolvedEnvName +
      " is not set in .env.local.\n" +
      "         Get a SESSION-mode connection string (port 5432) from the Supabase\n" +
      "         dashboard: Settings -> Database -> Connection string -> URI."
  )
}

let url
try {
  url = new URL(connectionString)
} catch {
  die(resolvedEnvName + " is not a valid connection URL.")
}

// Supabase's transaction-mode pooler (6543) multiplexes statements across backend
// connections. Session state, advisory locks, CREATE INDEX CONCURRENTLY and
// multi-round-trip transactions are all unreliable through it. Migrations need
// session mode (port 5432) or a direct connection.
if (url.port === "6543") {
  die(
    resolvedEnvName +
      " points at port 6543 - the TRANSACTION-mode pooler.\n" +
      "         Migrations must run over a SESSION-mode connection (port 5432).\n" +
      "         Fix: set MIGRATION_DATABASE_URL in .env.local to the same URL with\n" +
      "         port 5432, or pass --url-env=<NAME> naming a session-mode variable."
  )
}

// ---- Target identity -----------------------------------------------------

// Supabase pooler hostnames are shared per region: production and a staging
// project in the same region resolve to the SAME hostname
// (aws-1-us-east-1.pooler.supabase.com). The only part of the connection string
// that distinguishes one project from another is the project ref, which the
// pooler carries in the username as "postgres.<ref>". So --confirm is matched
// against the whole identity, not just the host, and the ref is what you should
// actually pass.
const dbUser = decodeURIComponent(url.username)
const projectRef = dbUser.includes(".") ? dbUser.split(".").slice(1).join(".") : null
const targetId = dbUser + "@" + url.hostname + ":" + (url.port || "5432")

// ---- Safety gate: a real apply must name its target ----------------------

if (!dryRun) {
  if (!confirm) {
    die(
      "Refusing to apply for real without --confirm=<substring>.\n" +
        "         Target is: " +
        targetId +
        "\n" +
        "         Re-run naming the target, ideally by project ref:\n" +
        "         --confirm=" +
        (projectRef || url.hostname.split(".")[0]) +
        "\n" +
        "         (Or add --dry-run to run it inside a transaction and roll back.)"
    )
  }
  if (!targetId.includes(confirm)) {
    die(
      "--confirm=" +
        confirm +
        " does not appear in the target identity.\n" +
        "         Target is: " +
        targetId +
        "\n" +
        "         You are probably pointed at a different database than you think.\n" +
        "         Nothing was sent. No connection was opened."
    )
  }
  // A region hostname alone matches every project in that region. Refuse it.
  if (projectRef && !confirm.includes(projectRef) && url.hostname.includes(confirm)) {
    die(
      "--confirm=" +
        confirm +
        " only matches the shared pooler hostname.\n" +
        "         Every Supabase project in this region answers on " +
        url.hostname +
        ",\n" +
        "         so that confirms nothing. Pass the project ref instead:\n" +
        "         --confirm=" +
        projectRef
    )
  }
}

// ---- Banner --------------------------------------------------------------

const mode = dryRun
  ? "DRY RUN - BEGIN ... ROLLBACK, nothing is committed"
  : noTransaction
  ? "APPLY - no wrapping transaction, statement by statement"
  : "APPLY - BEGIN ... COMMIT, rolled back on any error"

console.log("")
console.log("  +-- nebsam-crm migrate-file ---------------------------------")
console.log("  | file     : " + relative(root, filePath).replace(/\\/g, "/"))
console.log("  | sha256   : " + sha)
console.log("  | env var  : " + resolvedEnvName)
console.log("  | host     : " + url.hostname)
console.log("  | port     : " + (url.port || "5432"))
console.log("  | database : " + (url.pathname.slice(1) || "postgres"))
console.log("  | user     : " + dbUser)
if (projectRef) console.log("  | project  : " + projectRef)
console.log("  | mode     : " + mode)
console.log("  +------------------------------------------------------------")
console.log("")

// ---- Output helpers ------------------------------------------------------

function printResult(res, label) {
  if (!res) return
  if (res.rows && res.rows.length) {
    console.log("  -- " + label + ": " + res.rows.length + " row(s) --")
    for (const [i, row] of res.rows.entries()) {
      const entries = Object.entries(row)
      // A single long text column (e.g. pg_get_functiondef) prints raw.
      if (
        entries.length === 1 &&
        typeof entries[0][1] === "string" &&
        entries[0][1].includes("\n")
      ) {
        console.log(entries[0][1])
      } else {
        console.log(
          "  [" +
            i +
            "] " +
            entries
              .map(([k, v]) => k + "=" + (v === null ? "NULL" : String(v)))
              .join("  ")
        )
      }
    }
    console.log("")
  } else if (res.command) {
    const count = typeof res.rowCount === "number" ? " (" + res.rowCount + ")" : ""
    console.log("  " + label + ": " + res.command + count)
  }
}

function printResults(out, label) {
  if (Array.isArray(out)) out.forEach((r, i) => printResult(r, label + "[" + i + "]"))
  else printResult(out, label)
}

// ---- Run -----------------------------------------------------------------

const client = new pg.Client({
  connectionString,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 20000,
})

let noticeCount = 0
client.on("notice", (msg) => {
  noticeCount++
  console.log("  NOTICE  " + msg.message)
})

function splitStatements(text) {
  return text
    .split(/^--\s*@statement.*$/m)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !/^(--[^\n]*\n?)+$/.test(s))
}

async function run() {
  await client.connect()
  const v = await client.query(
    "SELECT current_setting('server_version') AS version, current_database() AS db"
  )
  console.log("  connected  PostgreSQL " + v.rows[0].version + "  db=" + v.rows[0].db)
  console.log("")

  if (noTransaction) {
    const statements = splitStatements(sql)
    if (statements.length === 0) {
      die("No statements found after splitting on `-- @statement`.")
    }
    console.log("  Running " + statements.length + " statement(s) with no wrapping transaction.")
    console.log("")
    for (const [i, stmt] of statements.entries()) {
      const firstLine =
        stmt.split("\n").find((l) => l.trim() && !l.trim().startsWith("--")) || stmt
      console.log(
        "  -> [" + (i + 1) + "/" + statements.length + "] " + firstLine.trim().slice(0, 100)
      )
      printResults(await client.query(stmt), "stmt " + (i + 1))
    }
    console.log("")
    console.log(
      "  DONE. " + statements.length + " statement(s) applied. " + noticeCount + " notice(s)."
    )
    return
  }

  await client.query("BEGIN")
  try {
    printResults(await client.query(sql), "result")
    if (dryRun) {
      await client.query("ROLLBACK")
      console.log(
        "  ROLLED BACK - dry run complete, nothing was committed. " + noticeCount + " notice(s)."
      )
    } else {
      await client.query("COMMIT")
      console.log("  COMMITTED. " + noticeCount + " notice(s).")
    }
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {})
    console.error("")
    console.error("  ROLLED BACK - " + err.message)
    if (err.position) console.error("  at character position " + err.position)
    if (err.hint) console.error("  hint: " + err.hint)
    if (err.detail) console.error("  detail: " + err.detail)
    throw err
  }
}

run()
  .then(async () => {
    await client.end()
    console.log("")
  })
  .catch(async (err) => {
    try {
      await client.end()
    } catch {}
    console.error("")
    console.error("  FAILED: " + err.message)
    process.exit(1)
  })
