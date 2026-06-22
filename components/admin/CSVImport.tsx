"use client"

import { useRef, useState } from "react"
import { Upload, FileText, X, AlertCircle, CheckCircle2, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { createClient } from "@/lib/supabase/client"
import { PRODUCTS } from "@/types/crm"
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

const CRM_FIELDS = [
  { value: "_ignore", label: "— Ignore column —" },
  { value: "phone_number", label: "Phone Number *" },
  { value: "full_name", label: "Full Name" },
  { value: "location", label: "Location" },
  { value: "vehicle_type", label: "Vehicle Type" },
  { value: "product_interested", label: "Product" },
  { value: "campaign_name", label: "Campaign Name" },
]

function autoMap(header: string): string {
  const h = header.toLowerCase().replace(/[\s_-]/g, "")
  if (h.includes("phone") || h.includes("mobile") || h.includes("number") || h === "msisdn") return "phone_number"
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
      h.forEach((header) => { autoMapped[header] = autoMap(header) })
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

  async function runImport() {
    const phoneField = Object.entries(mapping).find(([, v]) => v === "phone_number")?.[0]
    if (!phoneField) {
      toast.error("You must map a column to Phone Number")
      return
    }

    setImporting(true)
    const supabase = createClient()
    const leads: any[] = []
    const skippedReasons: string[] = []

    rows.forEach((row, idx) => {
      const lead: any = { lead_source: "manual" }
      headers.forEach((header, colIdx) => {
        const field = mapping[header]
        if (field && field !== "_ignore") {
          const val = row[colIdx]?.trim()
          if (val) lead[field] = val
        }
      })

      if (!lead.phone_number) {
        skippedReasons.push(`Row ${idx + 2}: missing phone number`)
        return
      }

      // Normalize phone: if starts with 07 or 01, prefix +254
      if (/^0[0-9]{9}$/.test(lead.phone_number)) {
        lead.phone_number = "+254" + lead.phone_number.slice(1)
      }

      // Validate product if provided
      if (lead.product_interested && !PRODUCTS.includes(lead.product_interested as any)) {
        lead.product_interested = null
      }

      leads.push(lead)
    })

    let importedCount = 0
    const errorMsgs: string[] = [...skippedReasons]

    // Insert in batches of 50
    const BATCH = 50
    for (let i = 0; i < leads.length; i += BATCH) {
      const batch = leads.slice(i, i + BATCH)
      const { error, data } = await (supabase.from("leads") as any)
        .insert(batch)
        .select("id")
      if (error) {
        errorMsgs.push(`Batch ${Math.floor(i / BATCH) + 1}: ${error.message}`)
      } else {
        importedCount += (data?.length ?? batch.length)
      }
    }

    setResult({
      imported: importedCount,
      skipped: skippedReasons.length,
      errors: errorMsgs.filter((m) => !skippedReasons.includes(m)),
    })

    if (importedCount > 0) {
      toast.success(`${importedCount} lead${importedCount !== 1 ? "s" : ""} imported`)
    }
    setImporting(false)
  }

  const mappedPhoneColumn = Object.values(mapping).includes("phone_number")
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
                        {CRM_FIELDS.map((f) => (
                          <option key={f.value} value={f.value}>{f.label}</option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

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
            disabled={!mappedPhoneColumn || importing}
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
              {result.skipped > 0 && (
                <p className="text-xs text-amber-600 pl-6">{result.skipped} row{result.skipped !== 1 ? "s" : ""} skipped (missing phone number)</p>
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
