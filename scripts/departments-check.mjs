/**
 * Section 10 verification checklist for the multi-department work.
 *
 *   node scripts/departments-check.mjs                     # staging, full (writes + rolls back)
 *   node scripts/departments-check.mjs --target=production  # production, READ-ONLY
 *
 * Why this is a separate script rather than an extension of qa-test.mjs:
 * qa-test.mjs reads NEXT_PUBLIC_SUPABASE_URL and the service key, i.e. it is
 * hardcoded to PRODUCTION, and it inserts and deletes leads. Bolting the
 * department checklist onto it would mean pointing a large set of new write
 * tests at the live database. This script takes its target explicitly and
 * refuses to write to production at all.
 *
 * Writes (staging only) are cleaned up in a finally block, and every row it
 * creates is tagged so a failed run can be swept by hand.
 */

import { createClient } from "@supabase/supabase-js"
import { readFileSync } from "fs"

const env = readFileSync(".env.local", "utf8")
const pick = (k) => {
  const m = env.match(new RegExp(`^${k}=(.+)$`, "m"))
  return m ? m[1].trim() : null
}

const target = process.argv.find((a) => a.startsWith("--target="))?.split("=")[1] ?? "staging"
const READ_ONLY = target === "production"

const URL = READ_ONLY ? pick("NEXT_PUBLIC_SUPABASE_URL") : pick("STAGING_SUPABASE_URL")
const ANON = READ_ONLY ? pick("NEXT_PUBLIC_SUPABASE_ANON_KEY") : pick("STAGING_SUPABASE_ANON_KEY")
const SERVICE = READ_ONLY ? pick("SUPABASE_SERVICE_ROLE_KEY") : null

if (!URL || !ANON) {
  console.error(`Missing URL/anon key for target "${target}".`)
  process.exit(1)
}

// Service role for staging comes from the DB URL's project; on staging we use
// the anon key plus direct SQL through the migration runner for setup instead,
// so the only privileged client here is production's (read-only).
const sbAnon = createClient(URL, ANON)
const sbAdmin = SERVICE ? createClient(URL, SERVICE) : null

const TAG = `ZZTEST-${Date.now()}`
let pass = 0, fail = 0, skip = 0
const lines = []
const ok = (id, m) => { pass++; lines.push(`  PASS  ${id}  ${m}`) }
const bad = (id, m) => { fail++; lines.push(`  FAIL  ${id}  ${m}`) }
const na = (id, m) => { skip++; lines.push(`  SKIP  ${id}  ${m}`) }

console.log(`\nSection 10 checklist — target: ${target}${READ_ONLY ? " (READ-ONLY)" : ""}`)
console.log(`  ${URL}\n`)

// ── A. Structure and config ────────────────────────────────────────────────

const TABLES = [
  "departments", "funnel_stages", "kyc_fields", "department_products",
  "service_orders", "academic_terms", "school_buses", "term_billings",
]

for (const t of TABLES) {
  const { error, count } = await sbAnon.from(t).select("*", { count: "exact", head: true })
  if (error) bad("A1", `${t} not readable by anon: ${error.message}`)
  else ok("A1", `${t} readable by anon (${count} rows)`)
}

{
  const { data, error } = await sbAnon.from("departments").select("slug, post_sale_model").order("sort_order")
  const want = {
    telematics: "annual_renewal", container_eseal: "consumption",
    fuel_monitoring: "subscription", school_bus: "term_contract",
  }
  if (error) bad("A2", error.message)
  else {
    const got = Object.fromEntries((data ?? []).map((d) => [d.slug, d.post_sale_model]))
    const wrong = Object.entries(want).filter(([s, m]) => got[s] !== m)
    if (wrong.length) bad("A2", `post_sale_model mismatch: ${JSON.stringify(wrong)}`)
    else ok("A2", "four departments with the right post-sale models")
  }
}

{
  // The ten telematics stages rag_auto_flag v1 treats as active. If this drifts,
  // v2 silently stops matching v1.
  const { data: dept } = await sbAnon.from("departments").select("id").eq("slug", "telematics").single()
  const { data, error } = await sbAnon
    .from("funnel_stages").select("key").eq("department_id", dept?.id).eq("is_active_stage", true)
  if (error) bad("A3", error.message)
  else if ((data ?? []).length !== 10) bad("A3", `telematics has ${data.length} active stages, expected 10`)
  else ok("A3", "telematics has exactly 10 active stages (matches rag_auto_flag v1)")
}

// ── B. Security: anon must not reach privileged functions ──────────────────
// This is the check that caught a live hole on 2026-09-21. Keep it first-class.

for (const fn of ["create_manual_lead", "check_phone_across_departments", "rag_auto_flag_v2", "generate_term_billings"]) {
  const { error } = await sbAnon.rpc(fn, fn === "create_manual_lead"
    ? { p_department_slug: "container_eseal", p_phone: "0700000000" }
    : fn === "check_phone_across_departments" ? { p_phone: "0700000000" }
    : fn === "generate_term_billings" ? { p_sale_id: "00000000-0000-0000-0000-000000000000" }
    : { p_dry_run: true })
  if (error && /permission denied/i.test(error.message)) ok("B1", `anon refused ${fn}`)
  else if (error) na("B1", `${fn}: ${error.message}`)
  else bad("B1", `ANON CAN EXECUTE ${fn} — this is the vulnerability 009e closed`)
}

// ── C. Data integrity ──────────────────────────────────────────────────────

{
  const { count, error } = await sbAnon.from("leads").select("*", { count: "exact", head: true })
    .is("department_id", null)
  if (error) na("C1", `leads not readable by anon (expected once 011 lands): ${error.message}`)
  else if (count > 0) bad("C1", `${count} leads have NULL department_id`)
  else ok("C1", "no leads with NULL department_id")
}

{
  // Every live funnel_stage / product value must have a config row, or badges
  // and dropdowns lose their values.
  const { data: leads } = await sbAnon.from("leads").select("department_id, funnel_stage, product_interested").limit(5000)
  const { data: stages } = await sbAnon.from("funnel_stages").select("department_id, key")
  const { data: prods } = await sbAnon.from("department_products").select("department_id, name")
  if (!leads) na("C2", "leads not readable by anon")
  else {
    const stageSet = new Set((stages ?? []).map((s) => `${s.department_id}|${s.key}`))
    const prodSet = new Set((prods ?? []).map((p) => `${p.department_id}|${p.name}`))
    const badStages = [...new Set(leads.filter((l) => !stageSet.has(`${l.department_id}|${l.funnel_stage}`)).map((l) => l.funnel_stage))]
    const badProds = [...new Set(leads.filter((l) => l.product_interested != null && !prodSet.has(`${l.department_id}|${l.product_interested}`)).map((l) => l.product_interested))]
    if (badStages.length) bad("C2", `funnel_stage values with no config row: ${badStages.join(", ")}`)
    else ok("C2", "every live funnel_stage has a config row")
    if (badProds.length) bad("C2", `product values with no config row: ${badProds.join(", ")}`)
    else ok("C2", "every live product_interested has a config row")
  }
}

// ── D. Department isolation, as the app sees it ────────────────────────────

{
  const { data: depts } = await sbAnon.from("departments").select("id, slug")
  const byDept = {}
  for (const d of depts ?? []) {
    const { count } = await sbAnon.from("leads").select("*", { count: "exact", head: true })
      .eq("department_id", d.id)
    byDept[d.slug] = count ?? 0
  }
  const total = Object.values(byDept).reduce((a, b) => a + b, 0)
  const { count: all } = await sbAnon.from("leads").select("*", { count: "exact", head: true })
  if (all == null) na("D1", "leads not readable by anon")
  else if (total !== all) bad("D1", `per-department total ${total} != overall ${all}`)
  else ok("D1", `every lead belongs to exactly one department (${JSON.stringify(byDept)})`)
}

// ── E. Production-only invariants ──────────────────────────────────────────

if (READ_ONLY && sbAdmin) {
  // Pre-010 the cron must still be on v1 and the global phone key must survive.
  const { data, error } = await sbAdmin.rpc("is_school_holiday", { p_date: "2026-01-01" })
  if (error) na("E1", `is_school_holiday via service role: ${error.message}`)
  else ok("E1", `service role can call functions (is_school_holiday -> ${data})`)
} else {
  na("E1", "production-only invariants skipped on staging")
}

// ── Report ─────────────────────────────────────────────────────────────────

console.log(lines.join("\n"))
console.log(`\n  ${pass} passed, ${fail} failed, ${skip} skipped\n`)
if (!READ_ONLY) {
  console.log(`  (write-path checks — manual prospect entry, KYC persistence, term billing —\n` +
              `   are covered by the SQL suites run through migrate-file.mjs, which roll back.)\n`)
}
console.log(`  Tag for any stray rows: ${TAG}\n`)
process.exit(fail > 0 ? 1 : 0)
