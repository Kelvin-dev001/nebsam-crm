"use client"

import { useState } from "react"
import { CalendarPlus, CalendarX2, CheckCircle2, Loader2, Trash2, AlertTriangle } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { createClient } from "@/lib/supabase/client"
import { loadDepartmentConfig } from "@/lib/departments/useDepartment"
import { formatDate } from "@/lib/utils/dateHelpers"
import type { AcademicTerm } from "@/types/crm"

/**
 * The school term calendar — global reference data, not per-department.
 *
 * It drives three things at once, which is why it validates before saving:
 *   · term_billings.due_date (term start minus 14 days)
 *   · the RAG holiday hold for School Bus
 *   · the holiday warning on the follow-up picker
 *
 * Production ships with this EMPTY on purpose. The prompt forbids inventing
 * Kenyan term dates, so they are entered here from the real school calendar.
 * Until then School Bus degrades gracefully rather than guessing.
 */

interface Props {
  terms: AcademicTerm[]
  onChanged: () => void
}

const inputSm = "h-8 text-sm"

export function TermCalendarEditor({ terms, onChanged }: Props) {
  const [busy, setBusy] = useState(false)
  const [problems, setProblems] = useState<string[] | null>(null)

  const nextYear = new Date().getFullYear()
  const [year, setYear] = useState(String(nextYear))
  const [termNumber, setTermNumber] = useState("1")
  const [start, setStart] = useState("")
  const [end, setEnd] = useState("")
  const [holidayStart, setHolidayStart] = useState("")
  const [holidayEnd, setHolidayEnd] = useState("")

  const ordered = [...terms].sort((a, b) => a.start_date.localeCompare(b.start_date))

  async function refresh() {
    await loadDepartmentConfig()
    onChanged()
    await validate()
  }

  /** Ask the database, which is the only place that sees the whole calendar. */
  async function validate() {
    try {
      const supabase = createClient()
      const { data, error } = await supabase.rpc("validate_academic_terms")
      if (error) throw error
      const r = data as unknown as { ok: boolean; problems: string[] }
      setProblems(r.problems ?? [])
    } catch (err) {
      console.error(err)
      setProblems(null)
    }
  }

  async function addTerm() {
    if (!start || !end) {
      toast.error("Start and end dates are required")
      return
    }
    if (end <= start) {
      toast.error("The term must end after it starts")
      return
    }
    if (holidayStart && holidayEnd && holidayEnd < holidayStart) {
      toast.error("The holiday must end after it starts")
      return
    }

    setBusy(true)
    try {
      const supabase = createClient()
      const name = `Term ${termNumber} ${year}`
      const { error } = await supabase.from("academic_terms").insert({
        year: Number(year),
        term_number: Number(termNumber),
        name,
        start_date: start,
        end_date: end,
        holiday_start: holidayStart || null,
        holiday_end: holidayEnd || null,
      })
      if (error) {
        toast.error(
          error.code === "23505"
            ? `${name} already exists`
            : `Could not add the term: ${error.message}`,
        )
        return
      }
      toast.success(`${name} added`)
      setStart(""); setEnd(""); setHolidayStart(""); setHolidayEnd("")
      await refresh()
    } catch (err) {
      console.error(err)
      toast.error("Could not add the term")
    } finally {
      setBusy(false)
    }
  }

  async function removeTerm(t: AcademicTerm) {
    if (
      !window.confirm(
        `Remove ${t.name}?\n\nAny term billing already generated for it will lose its term. ` +
          "Only do this if the dates were entered wrongly and nothing has been billed.",
      )
    ) {
      return
    }
    setBusy(true)
    try {
      const supabase = createClient()
      const { error } = await supabase.from("academic_terms").delete().eq("id", t.id)
      if (error) {
        // A billing row references it — the FK is doing its job.
        toast.error(
          error.code === "23503"
            ? `${t.name} has term billings against it and cannot be removed.`
            : error.message,
        )
        return
      }
      toast.success(`${t.name} removed`)
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="space-y-3">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h3 className="font-semibold text-slate-800 text-sm">School Term Calendar</h3>
          <p className="text-xs text-slate-500">
            Shared by all departments. Drives term billing dates, the School Bus holiday hold and
            the follow-up warning.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => void validate()} disabled={busy}>
          Check calendar
        </Button>
      </header>

      {terms.length === 0 && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3">
          <p className="flex items-center gap-2 text-sm font-medium text-amber-900">
            <CalendarX2 className="h-4 w-4" />
            Term calendar not configured
          </p>
          <p className="text-xs text-amber-800 mt-1">
            School Bus term billing cannot be generated and the holiday hold is inactive until
            the real term dates are entered here. Three terms per school year, each with the
            holiday that follows it.
          </p>
        </div>
      )}

      {problems !== null && problems.length === 0 && terms.length > 0 && (
        <p className="flex items-center gap-1.5 text-xs text-green-700">
          <CheckCircle2 className="h-3.5 w-3.5" />
          Calendar is consistent — no overlaps, and every holiday sits between its term and the next.
        </p>
      )}
      {problems !== null && problems.length > 0 && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3">
          <p className="flex items-center gap-1.5 text-sm font-medium text-red-800">
            <AlertTriangle className="h-4 w-4" />
            The calendar has problems
          </p>
          <ul className="text-xs text-red-700 mt-1 list-disc pl-4 space-y-0.5">
            {problems.map((p) => <li key={p}>{p}</li>)}
          </ul>
        </div>
      )}

      {/* Add a term */}
      <div className="flex flex-wrap items-end gap-2 rounded-md border border-slate-200 p-3 bg-slate-50">
        <div className="space-y-1">
          <Label className="text-xs text-slate-600">Year</Label>
          <Input value={year} onChange={(e) => setYear(e.target.value)} type="number"
                 className={`${inputSm} w-24`} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-slate-600">Term</Label>
          <select value={termNumber} onChange={(e) => setTermNumber(e.target.value)}
                  className="h-8 rounded-md border border-input bg-background px-2 text-sm">
            <option value="1">1</option><option value="2">2</option><option value="3">3</option>
          </select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-slate-600">Term starts</Label>
          <Input type="date" value={start} onChange={(e) => setStart(e.target.value)} className={inputSm} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-slate-600">Term ends</Label>
          <Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} className={inputSm} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-slate-600">Holiday starts</Label>
          <Input type="date" value={holidayStart} onChange={(e) => setHolidayStart(e.target.value)} className={inputSm} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-slate-600">Holiday ends</Label>
          <Input type="date" value={holidayEnd} onChange={(e) => setHolidayEnd(e.target.value)} className={inputSm} />
        </div>
        <Button size="sm" onClick={() => void addTerm()} disabled={busy} className="gap-1.5">
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CalendarPlus className="h-3.5 w-3.5" />}
          Add Term
        </Button>
      </div>

      {/* Existing terms */}
      {ordered.length > 0 && (
        <div className="rounded-lg border border-slate-200 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="text-left font-medium px-3 py-2">Term</th>
                <th className="text-left font-medium px-3 py-2">Starts</th>
                <th className="text-left font-medium px-3 py-2">Ends</th>
                <th className="text-left font-medium px-3 py-2">Holiday</th>
                <th className="text-left font-medium px-3 py-2">Billing due</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {ordered.map((t) => {
                const due = new Date(t.start_date)
                due.setDate(due.getDate() - 14)
                return (
                  <tr key={t.id} className="border-t border-slate-100">
                    <td className="px-3 py-2 font-medium text-slate-800">{t.name}</td>
                    <td className="px-3 py-2 text-slate-600">{formatDate(t.start_date)}</td>
                    <td className="px-3 py-2 text-slate-600">{formatDate(t.end_date)}</td>
                    <td className="px-3 py-2 text-slate-600">
                      {t.holiday_start && t.holiday_end
                        ? `${formatDate(t.holiday_start)} – ${formatDate(t.holiday_end)}`
                        : "—"}
                    </td>
                    <td className="px-3 py-2 text-slate-500">
                      {formatDate(due.toISOString().slice(0, 10))}
                      <span className="text-xs text-slate-400 ml-1">(−14d)</span>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-slate-500"
                              disabled={busy} onClick={() => void removeTerm(t)}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
