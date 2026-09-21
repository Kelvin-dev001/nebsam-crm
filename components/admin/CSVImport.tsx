"use client"

import { useMemo, useRef, useState } from "react"
import { Upload, FileText, X, AlertCircle, CheckCircle2, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { createClient } from "@/lib/supabase/client"
import { useDepartment } from "@/lib/departments/useDepartment"
import { useDepartmentStore } from "@/lib/stores/departmentStore"
import { useTelemarketerStore } from "@/lib/stores/telemarketerStore"
import { normalizePhone, isValidPhone } from "@/lib/utils/phoneHelpers"
import type { KycFieldDef } from "@/types/crm"
import { cn } from "@/lib/utils"

// ── CSV parser ─────────────────────────────────────────────────────────────────

function parseCSV(text: string): { headers: string[]; rows: string[][] } {
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim().split("\n").filter(Boolean)
  if (lines.length === 0) return { headers: [], rows: [] }

  function parseLine(line: string): string[] {
    const result: string[] = []
    let current = ""
    let inQuotes = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') { current += '"'; i++ }
        else inQuotes = !inQuotes
      } else if (ch === "," && !inQuotes) {
        result.push(current.trim())
        current = ""
      } else {
        current += ch
      }
    }
    result.push(current.trim())
    return result
  }

  return { headers: parseLine(lines[0]), rows: lines.slice(1).map(parseLine) }
}

// ── CRM field options ──────────────────────────────────────────────────────────

const CORE_FIELDS = [
  { value: "_ignore", label: "— Ignore column —" },
  { value: "phone_number", label: "Phone Number *" },
  { value: "full_name", label: "Contact Name" },
  { value: "company_name", label: "Company / School Name" },
  { value: "location", label: "Location" },
  { value: "product_interested", label: "Product" },
]

/**
 * Columns a CSV can map onto: the core lead fields plus whatever KYC questions
 * the chosen department actually asks. That is the point of routing the import
 * through the same config the forms use — an e-seal CSV can carry Fleet Size
 * and Routes Served without a code change.
 */
function fieldsFor(kycFields: KycFieldDef[]) {
  const coreKeys = new Set(CORE_FIELDS.map((f) => f.value))
  const kyc = kycFields
    .filter((f) => f.is_active && !coreKeys.has(f.key))
    .map((f) => ({ value: `kyc:${f.key}`, label: `${f.label} (KYC)` }))
  return [...CORE_FIELDS, ...kyc]
}

function autoMap(header: string, kycFields: KycFieldDef[] = []): string {
  // Try the department's own KYC questions first — a column called "Fleet Size"
  // should land on the fleet_size question, not be ignored.
  const norm = (v: string) => v.toLowerCase().replace(/[\s_-]/g, "")
  const hNorm = norm(header)
  for (const f of kycFields) {
    if (!f.is_active) continue
    if (norm(f.label) === hNorm || norm(f.key) === hNorm) return `kyc:${f.key}`
  }
  return autoMapCore(header)
}

function autoMapCore(header: string): string {
  const h = header.toLowerCase().replace(/[\s_-]/g, "")
  if (h.includes("phone") || h.includes("mobile") || h.includes("number") || h === "msisdn") return "phone_number"
  if (h.includes("company") || h.includes("school") || h.includes("organisation") || h.includes("organization")) return "company_name"
  if (h.includes("name") && !h.includes("campaign")) return "full_name"
  if (h.includes("location") || h.includes("city") || h.includes("area")) return "location"
  if (h.includes("vehicle") || h.includes("car")) return "vehicle_type"
  if (h.includes("product") || h.includes("service")) return "product_interested"
  if (h.includes("campaign")) return "campaign_name"
  return "_ignore"
}

// ── Component ─────────────────────────────────────────────────────────────────

interface ImportResult {
  imported: number
  skipped: number
  duplicates: number
  /** Rows rejected only because the pre-010 global phone constraint still exists. */
  crossDepartmentBlocked: number
  errors: string[]
}

export function CSVImport() {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [fileName, setFileName] = useState<string | null>(null)
  const [headers, setHeaders] = useState<string[]>([])
  const [rows, setRows] = useState<string[][]>([])
  const [mapping, setMapping] = useState<Record<string, string>>({})
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)

  // A CSV belongs to exactly one department: it decides the funnel the leads
  // enter, which KYC questions the columns can map onto, and who they are
  // assigned to.
  const { departments } = useDepartment()
  const configs = useDepartmentStore((s) => s.configs)
  const { activeTelemarketer } = useTelemarketerStore()
  const [departmentId, setDepartmentId] = useState<string>("")

  const kycFields = useMemo(
    () => (departmentId ? configs[departmentId]?.kycFields ?? [] : []),
    [configs, departmentId],
  )
  const fieldOptions = useMemo(() => fieldsFor(kycFields), [kycFields])
  const selectedDepartment = departments.find((d) => d.id === departmentId) ?? null

  function processFile(file: File) {
    if (!file.name.endsWith(".csv")) {
      toast.error("Please upload a .csv file")
      return
    }
    const reader = new FileReader()
    reader.onload = (e) => {
      const text = e.target?.result as string
      const { headers: h, rows: r } = parseCSV(text)
      if (h.length === 0) {
        toast.error("CSV appears to be empty")
        return
      }
      setHeaders(h)
      setRows(r)
      setFileName(file.name)
      setResult(null)
      const autoMapped: Record<string, string> = {}
      h.forEach((header) => { autoMapped[header] = autoMap(header, kycFields) })
      setMapping(autoMapped)
    }
    reader.readAsText(file)
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) processFile(file)
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) processFile(file)
    e.target.value = ""
  }

  function clearFile() {
    setFileName(null)
    setHeaders([])
    setRows([])
    setMapping({})
    setResult(null)
  }

  /**
   * Import row by row through `create_manual_lead` rather than a bulk insert.
   *
   * Slower, and deliberately so: the RPC applies the department's assignment
   * mode, resolves its first funnel stage, normalises the phone and writes the
   * KYC blob alongside the promoted columns — none of which a raw insert does.
   * It also means one bad row costs one row, where the old batched insert threw
   * away fifty at a time and reported a single opaque error.
   */
  async function runImport() {
    const phoneField = Object.entries(mapping).find(([, v]) => v === "phone_number")?.[0]
    if (!phoneField) {
      toast.error("You must map a column to Phone Number")
      return
    }
    if (!departmentId || !selectedDepartment) {
      toast.error("Choose a department first")
      return
    }

    setImporting(true)
    const supabase = createClient()

    let imported = 0
    let duplicates = 0
    let crossDepartmentBlocked = 0
    let skipped = 0
    const errors: string[] = []

    for (let idx = 0; idx < rows.length; idx++) {
      const row = rows[idx]
      const rowNo = idx + 2 // 1-based, plus the header line
      const core: Record<string, string> = {}
      const kyc: Record<string, unknown> = {}

      headers.forEach((header, colIdx) => {
        const field = mapping[header]
        if (!field || field === "_ignore") return
        const val = row[colIdx]?.trim()
        if (!val) return
        if (field.startsWith("kyc:")) {
          const key = field.slice(4)
          const def = kycFields.find((f) => f.key === key)
          if (def?.field_type === "multiselect") {
            kyc[key] = val.split(/[;,|]/).map((v) => v.trim()).filter(Boolean)
          } else if (def?.field_type === "number") {
            const n = Number(val.replace(/[^0-9.-]/g, ""))
            if (!Number.isNaN(n)) kyc[key] = n
          } else if (def?.field_type === "boolean") {
            kyc[key] = /^(y|yes|true|1)$/i.test(val)
          } else {
            kyc[key] = val
          }
        } else {
          core[field] = val
        }
      })

      const phone = normalizePhone(core.phone_number ?? "")
      if (!phone || !isValidPhone(phone)) {
        skipped++
        if (errors.length < 50) {
          errors.push(`Row ${rowNo}: ${core.phone_number ? `"${core.phone_number}" is not a valid phone number` : "missing phone number"}`)
        }
        continue
      }

      const { error } = await supabase.rpc("create_manual_lead", {
        p_department_slug: selectedDepartment.slug,
        p_phone: phone,
        p_company: core.company_name ?? null,
        p_contact_name: core.full_name ?? null,
        p_kyc: kyc as never,
        p_product: core.product_interested ?? null,
        p_source: "manual",
        p_created_by: activeTelemarketer?.id ?? null,
        p_location: core.location ?? null,
      })

      if (!error) {
        imported++
        continue
      }

      // Tell the two kinds of "duplicate" apart. They mean different things and
      // one of them is temporary.
      if (error.message.includes("already exists in department")) {
        duplicates++
        if (errors.length < 50) errors.push(`Row ${rowNo}: ${phone} is already in ${selectedDepartment.name}`)
      } else if (error.message.includes("leads_phone_number_key")) {
        // Pre-cutover only: the OLD global unique on leads(phone_number) is
        // still in place, so a number held by another department cannot be
        // entered here yet. Migration 010 drops it and these rows will import.
        crossDepartmentBlocked++
        if (errors.length < 50) {
          errors.push(`Row ${rowNo}: ${phone} exists in another department — blocked until migration 010 drops the global phone constraint`)
        }
      } else {
        skipped++
        if (errors.length < 50) errors.push(`Row ${rowNo}: ${error.message}`)
      }
    }

    setResult({ imported, skipped, duplicates, crossDepartmentBlocked, errors })

    if (imported > 0) {
      toast.success(`${imported} lead${imported !== 1 ? "s" : ""} imported into ${selectedDepartment.name}`)
    } else {
      toast.warning("No rows were imported — see the report below")
    }
    setImporting(false)
  }

  const mappedPhoneColumn = Object.values(mapping).includes("phone_number")
  const canImport = mappedPhoneColumn && !!departmentId
  const previewRows = rows.slice(0, 5)

  return (
    <div className="space-y-5 max-w-3xl">
      {/* Upload area */}
      {!fileName ? (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={cn(
            "flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-12 text-center cursor-pointer transition-colors",
            dragging ? "border-blue-400 bg-blue-50" : "border-slate-200 hover:border-slate-300 hover:bg-slate-50"
          )}
        >
          <Upload className="h-10 w-10 text-slate-300" />
          <div>
            <p className="text-sm font-medium text-slate-700">Drop your CSV file here</p>
            <p className="text-xs text-slate-400 mt-1">or click to browse · .csv files only</p>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            className="hidden"
            onChange={handleFile}
          />
        </div>
      ) : (
        <div className="flex items-center gap-3 p-4 bg-slate-50 rounded-xl border border-slate-200">
          <FileText className="h-5 w-5 text-blue-500 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-slate-800 truncate">{fileName}</p>
            <p className="text-xs text-slate-400">{rows.length} data rows · {headers.length} columns detected</p>
          </div>
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-slate-400" onClick={clearFile}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      )}

      {/* Column mapping */}
      {headers.length > 0 && (
        <div className="space-y-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-800">Map Columns</h3>
            <p className="text-xs text-slate-400 mt-0.5">Match each CSV column to a CRM field. Phone Number is required.</p>
          </div>
          <div className="rounded-xl border border-slate-200 overflow-hidden bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wide px-4 py-2.5 w-1/2">CSV Column</th>
                  <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wide px-4 py-2.5 w-1/2">Maps To</th>
                </tr>
              </thead>
              <tbody>
                {headers.map((header) => (
                  <tr key={header} className="border-b border-slate-100 last:border-0">
                    <td className="px-4 py-2.5 font-mono text-xs text-slate-600">{header}</td>
                    <td className="px-4 py-2.5">
                      <select
                        value={mapping[header] ?? "_ignore"}
                        onChange={(e) => setMapping((m) => ({ ...m, [header]: e.target.value }))}
                        className={cn(
                          "w-full h-8 rounded-lg border px-2 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500",
                          mapping[header] === "_ignore"
                            ? "border-slate-200 text-slate-400 bg-white"
                            : mapping[header] === "phone_number"
                              ? "border-blue-200 text-blue-700 bg-blue-50"
                              : "border-green-200 text-green-700 bg-green-50"
                        )}
                      >
                        {fieldOptions.map((f) => (
                          <option key={f.value} value={f.value}>{f.label}</option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Department comes first: it decides the funnel, the KYC columns
              available for mapping, and who the leads are assigned to. */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-600">
              Import into department <span className="text-red-500">*</span>
            </label>
            <select
              value={departmentId}
              onChange={(e) => {
                setDepartmentId(e.target.value)
                // Re-run auto-mapping against the new department's questions.
                const next: Record<string, string> = {}
                const cfg = configs[e.target.value]?.kycFields ?? []
                headers.forEach((h) => { next[h] = autoMap(h, cfg) })
                setMapping(next)
              }}
              className="h-9 w-full sm:w-72 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">Select a department…</option>
              {departments.filter((d) => d.is_active).map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
            {departmentId && (
              <p className="text-[11px] text-slate-500">
                Leads enter this department&apos;s first funnel stage and are assigned by its{" "}
                <span className="font-medium">{selectedDepartment?.assignment_mode}</span> rule.
                {kycFields.length > 0 && ` ${kycFields.filter((f) => f.is_active).length} KYC question(s) available for mapping.`}
              </p>
            )}
          </div>

          {!departmentId && (
            <p className="text-xs text-amber-600">Choose a department before mapping columns.</p>
          )}

          {!mappedPhoneColumn && (
            <div className="flex items-center gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700">
              <AlertCircle className="h-4 w-4 shrink-0" />
              Phone Number column must be mapped before importing.
            </div>
          )}
        </div>
      )}

      {/* Preview */}
      {previewRows.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-slate-800">
            Preview <span className="text-slate-400 font-normal">(first {previewRows.length} rows)</span>
          </h3>
          <div className="rounded-xl border border-slate-200 overflow-auto bg-white">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  {headers.map((h) => (
                    <th key={h} className="text-left font-semibold text-slate-500 px-3 py-2 whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {previewRows.map((row, i) => (
                  <tr key={i} className="border-b border-slate-100 last:border-0">
                    {row.map((cell, j) => (
                      <td key={j} className="px-3 py-2 text-slate-600 whitespace-nowrap max-w-[160px] truncate">
                        {cell || <span className="text-slate-300">—</span>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Import button + result */}
      {headers.length > 0 && (
        <div className="space-y-3">
          <Button
            className="gap-2"
            disabled={!canImport || importing}
            onClick={runImport}
          >
            {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {importing ? `Importing ${rows.length} rows…` : `Import ${rows.length} lead${rows.length !== 1 ? "s" : ""}`}
          </Button>

          {result && (
            <div className={cn(
              "rounded-xl border p-4 space-y-2",
              result.errors.length > 0 ? "border-amber-200 bg-amber-50" : "border-green-200 bg-green-50"
            )}>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
                <p className="text-sm font-medium text-green-700">
                  {result.imported} lead{result.imported !== 1 ? "s" : ""} imported successfully
                </p>
              </div>
              {result.duplicates > 0 && (
                <p className="text-xs text-amber-700 pl-6">
                  {result.duplicates} row{result.duplicates !== 1 ? "s" : ""} already in this department
                </p>
              )}
              {result.crossDepartmentBlocked > 0 && (
                <p className="text-xs text-amber-700 pl-6">
                  {result.crossDepartmentBlocked} row{result.crossDepartmentBlocked !== 1 ? "s" : ""} held by
                  another department — these will import once migration 010 drops the global phone
                  constraint. They are not errors in your file.
                </p>
              )}
              {result.skipped > 0 && (
                <p className="text-xs text-amber-600 pl-6">
                  {result.skipped} row{result.skipped !== 1 ? "s" : ""} skipped (missing or invalid phone number)
                </p>
              )}
              {result.errors.length > 0 && (
                <div className="pl-6 space-y-1">
                  {result.errors.map((e, i) => (
                    <p key={i} className="text-xs text-red-600">{e}</p>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
