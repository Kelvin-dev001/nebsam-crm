"use client"

import { useEffect, useState } from "react"
import { Building2, Loader2, Users } from "lucide-react"
import { toast } from "sonner"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { createClient } from "@/lib/supabase/client"
import { loadDepartmentConfig } from "@/lib/departments/useDepartment"
import { useDepartmentStore } from "@/lib/stores/departmentStore"
import { StageEditor, KycFieldEditor, ProductEditor } from "./DepartmentConfigEditors"
import { TermCalendarEditor } from "./TermCalendarEditor"
import { cn } from "@/lib/utils"
import type { AssignmentMode, Department, LeadIntake, PostSaleModel } from "@/types/crm"

/**
 * Admin → Departments.
 *
 * This is what makes decision D3 pay off: a stage, a KYC question, a product or
 * a fourth department is an admin action rather than a deploy. Every save
 * refreshes the shared config, so reps pick the change up on their next page
 * load.
 */

interface RepRow {
  id: string
  full_name: string
  email: string
  is_active: boolean
  department_id: string | null
  job_title: string | null
}

const POST_SALE_MODELS: PostSaleModel[] = [
  "annual_renewal", "subscription", "consumption", "term_contract", "none",
]
const INTAKES: LeadIntake[] = ["whatsapp_webhook", "manual"]
const ASSIGNMENT_MODES: AssignmentMode[] = ["round_robin", "creator", "unassigned"]

const selectSm =
  "h-8 rounded-md border border-input bg-background px-2 text-sm text-slate-700"

export function DepartmentManager() {
  const departments = useDepartmentStore((s) => s.departments)
  const configs = useDepartmentStore((s) => s.configs)
  const academicTerms = useDepartmentStore((s) => s.academicTerms)
  const loaded = useDepartmentStore((s) => s.loaded)

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [reps, setReps] = useState<RepRow[]>([])
  const [busy, setBusy] = useState(false)
  const [tick, setTick] = useState(0)

  const selected = departments.find((d) => d.id === selectedId) ?? departments[0] ?? null
  const config = selected ? configs[selected.id] ?? null : null

  useEffect(() => {
    if (!selectedId && departments.length > 0) setSelectedId(departments[0].id)
  }, [departments, selectedId])

  useEffect(() => {
    const supabase = createClient()
    ;(async () => {
      const { data, error } = await supabase
        .from("telemarketers")
        .select("id, full_name, email, is_active, department_id, job_title")
        .order("full_name")
      if (error) {
        console.error(error)
        return
      }
      setReps((data ?? []) as unknown as RepRow[])
    })()
  }, [tick])

  async function patchDepartment(dept: Department, values: Partial<Department>) {
    setBusy(true)
    try {
      const supabase = createClient()
      const { error } = await supabase.from("departments").update(values).eq("id", dept.id)
      if (error) throw error
      await loadDepartmentConfig()
      setTick((t) => t + 1)
      toast.success("Department updated")
    } catch (err) {
      console.error(err)
      toast.error("Could not update the department")
    } finally {
      setBusy(false)
    }
  }

  async function assignRep(rep: RepRow, departmentId: string | null) {
    setBusy(true)
    try {
      const supabase = createClient()
      const { error } = await supabase
        .from("telemarketers")
        .update({ department_id: departmentId })
        .eq("id", rep.id)
      if (error) throw error
      setReps((prev) =>
        prev.map((r) => (r.id === rep.id ? { ...r, department_id: departmentId } : r)),
      )
      toast.success(`${rep.full_name} moved`)
    } catch (err) {
      console.error(err)
      toast.error("Could not reassign the rep")
    } finally {
      setBusy(false)
    }
  }

  if (!loaded) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
      </div>
    )
  }

  if (departments.length === 0) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
        <p className="font-medium text-amber-900">No departments found</p>
        <p className="text-sm text-amber-800 mt-1">
          Migration 009 seeds the four departments. If this list is empty, the database this app
          is pointed at has not had it applied.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Department picker */}
      <div className="flex flex-wrap gap-2">
        {departments.map((d) => (
          <button
            key={d.id}
            type="button"
            onClick={() => setSelectedId(d.id)}
            className={cn(
              "rounded-lg border px-3 py-2 text-left transition-colors",
              selected?.id === d.id
                ? "border-slate-800 bg-slate-50"
                : "border-slate-200 hover:border-slate-300",
              !d.is_active && "opacity-50",
            )}
          >
            <span className="flex items-center gap-1.5 text-sm font-medium text-slate-800">
              <span
                className="inline-block h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: d.accent_color }}
              />
              {d.name}
            </span>
            <span className="text-xs text-slate-500">
              {configs[d.id]?.stages.length ?? 0} stages ·{" "}
              {configs[d.id]?.kycFields.filter((f) => f.is_active).length ?? 0} questions
            </span>
          </button>
        ))}
      </div>

      {selected && (
        <>
          {/* Department settings */}
          <section className="space-y-3">
            <h3 className="font-semibold text-slate-800 text-sm flex items-center gap-1.5">
              <Building2 className="h-4 w-4" />
              {selected.name}
              <span className="font-mono text-xs text-slate-400">{selected.slug}</span>
            </h3>

            <div className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 p-3">
              <div className="space-y-1">
                <Label className="text-xs text-slate-600">Display name</Label>
                <Input
                  defaultValue={selected.name}
                  onBlur={(e) => {
                    if (e.target.value !== selected.name) {
                      void patchDepartment(selected, { name: e.target.value })
                    }
                  }}
                  className="h-8 text-sm w-52"
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs text-slate-600">Lead intake</Label>
                <select
                  value={selected.lead_intake}
                  onChange={(e) => void patchDepartment(selected, { lead_intake: e.target.value as LeadIntake })}
                  className={selectSm}
                >
                  {INTAKES.map((i) => <option key={i} value={i}>{i}</option>)}
                </select>
              </div>

              <div className="space-y-1">
                <Label className="text-xs text-slate-600">Assignment</Label>
                <select
                  value={selected.assignment_mode}
                  onChange={(e) => void patchDepartment(selected, { assignment_mode: e.target.value as AssignmentMode })}
                  className={selectSm}
                >
                  {ASSIGNMENT_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>

              <div className="space-y-1">
                <Label className="text-xs text-slate-600">Post-sale model</Label>
                <select
                  value={selected.post_sale_model}
                  onChange={(e) => void patchDepartment(selected, { post_sale_model: e.target.value as PostSaleModel })}
                  className={selectSm}
                >
                  {POST_SALE_MODELS.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>

              <div className="space-y-1">
                <Label className="text-xs text-slate-600">Accent</Label>
                <Input
                  type="color"
                  defaultValue={selected.accent_color}
                  onBlur={(e) => {
                    if (e.target.value !== selected.accent_color) {
                      void patchDepartment(selected, { accent_color: e.target.value })
                    }
                  }}
                  className="h-8 w-16 p-1"
                />
              </div>

              <label className="flex items-center gap-1.5 text-xs text-slate-600 h-8">
                <input
                  type="checkbox"
                  checked={selected.is_active}
                  disabled={busy}
                  onChange={(e) => void patchDepartment(selected, { is_active: e.target.checked })}
                  className="h-3.5 w-3.5"
                />
                Active
              </label>

              {busy && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
            </div>

            <p className="text-[11px] text-slate-400">
              The slug is deliberately not editable: it is written into RPC calls and into the
              webhook route, so changing it would break inbound lead creation.
            </p>
          </section>

          {config && (
            <StageEditor
              departmentId={selected.id}
              stages={config.stages}
              onChanged={() => setTick((t) => t + 1)}
            />
          )}

          {config && (
            <KycFieldEditor
              departmentId={selected.id}
              fields={config.kycFields}
              onChanged={() => setTick((t) => t + 1)}
            />
          )}

          {config && (
            <ProductEditor
              departmentId={selected.id}
              products={config.products}
              onChanged={() => setTick((t) => t + 1)}
            />
          )}

          {/* Reps */}
          <section className="space-y-3">
            <header>
              <h3 className="font-semibold text-slate-800 text-sm flex items-center gap-1.5">
                <Users className="h-4 w-4" />
                Sales Reps
              </h3>
              <p className="text-xs text-slate-500">
                A rep sees only their own department&apos;s leads. Moving someone changes what
                they can see on their next page load.
              </p>
            </header>

            <div className="rounded-lg border border-slate-200 divide-y divide-slate-100">
              {reps.map((r) => (
                <div key={r.id} className={cn("flex items-center gap-3 px-3 py-2", !r.is_active && "opacity-50")}>
                  <span className="text-sm font-medium text-slate-800 w-40 truncate">{r.full_name}</span>
                  <span className="text-xs text-slate-500 flex-1 truncate">{r.email}</span>
                  <select
                    value={r.department_id ?? ""}
                    disabled={busy}
                    onChange={(e) => void assignRep(r, e.target.value || null)}
                    className={selectSm}
                  >
                    <option value="">Unassigned</option>
                    {departments.map((d) => (
                      <option key={d.id} value={d.id}>{d.name}</option>
                    ))}
                  </select>
                </div>
              ))}
              {reps.length === 0 && (
                <p className="px-3 py-6 text-center text-sm text-slate-500">No reps yet.</p>
              )}
            </div>
          </section>
        </>
      )}

      {/* Global, shown once rather than per department */}
      <TermCalendarEditor terms={academicTerms} onChanged={() => setTick((t) => t + 1)} />
    </div>
  )
}
