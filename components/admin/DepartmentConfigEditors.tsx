"use client"

import { useState } from "react"
import { ArrowDown, ArrowUp, Loader2, Plus, Save, Trash2, AlertTriangle } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { createClient } from "@/lib/supabase/client"
import { loadDepartmentConfig } from "@/lib/departments/useDepartment"
import { stageBadgeClasses } from "@/lib/utils/funnelHelpers"
import { cn } from "@/lib/utils"
import type { DepartmentProduct, FunnelStageDef, KycFieldDef, KycFieldType } from "@/types/crm"

/**
 * The editors that make decision D3 pay off: adding a stage, a KYC question or
 * a product is an admin action, not a deploy.
 *
 * Every save refreshes the shared department config, so a rep's next page load
 * shows the change — no rebuild, no restart.
 */

const COLOR_FAMILIES = [
  "slate", "zinc", "blue", "sky", "cyan", "indigo", "violet",
  "purple", "amber", "orange", "green", "emerald", "teal", "red",
]

const FIELD_TYPES: KycFieldType[] = [
  "text", "textarea", "number", "select", "multiselect",
  "boolean", "date", "phone", "email",
]

const inputSm = "h-8 text-sm"
const selectSm =
  "h-8 rounded-md border border-input bg-background px-2 text-sm text-slate-700"

// ────────────────────────────────────────────────────────────────────────────
// Stage editor
// ────────────────────────────────────────────────────────────────────────────

export function StageEditor({
  departmentId,
  stages,
  onChanged,
}: {
  departmentId: string
  stages: FunnelStageDef[]
  onChanged: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [adding, setAdding] = useState(false)
  const [newKey, setNewKey] = useState("")
  const [newLabel, setNewLabel] = useState("")

  const ordered = [...stages].sort((a, b) => a.sort_order - b.sort_order)

  async function refresh() {
    await loadDepartmentConfig()
    onChanged()
  }

  async function addStage() {
    const key = newKey.trim().toLowerCase().replace(/\s+/g, "_")
    if (!key || !newLabel.trim()) {
      toast.error("Key and label are required")
      return
    }
    if (!/^[a-z][a-z0-9_]*$/.test(key)) {
      toast.error("Key must be snake_case (letters, numbers, underscores)")
      return
    }
    setBusy(true)
    try {
      const supabase = createClient()
      const { error } = await supabase.from("funnel_stages").insert({
        department_id: departmentId,
        key,
        label: newLabel.trim(),
        sort_order: (ordered.at(-1)?.sort_order ?? 0) + 1,
        color: "slate",
      })
      if (error) throw error
      toast.success(`Stage “${newLabel}” added`)
      setNewKey("")
      setNewLabel("")
      setAdding(false)
      await refresh()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      toast.error(msg.includes("duplicate") ? "That key already exists" : msg)
    } finally {
      setBusy(false)
    }
  }

  async function patch(stage: FunnelStageDef, patchValues: Partial<FunnelStageDef>) {
    setBusy(true)
    try {
      const supabase = createClient()
      const { error } = await supabase
        .from("funnel_stages")
        .update(patchValues)
        .eq("id", stage.id)
      if (error) throw error
      await refresh()
    } catch (err) {
      console.error(err)
      toast.error("Could not save the stage")
    } finally {
      setBusy(false)
    }
  }

  /**
   * Renaming a key moves LEAD DATA, so it goes through the RPC, which does the
   * config row and the leads in one transaction with updated_at protected.
   */
  async function renameKey(stage: FunnelStageDef) {
    const proposed = window.prompt(
      `Rename the stage KEY "${stage.key}".\n\n` +
        "This is not just a label: every lead currently at this stage will be " +
        "migrated to the new key, and so will their call history. " +
        "It happens in one transaction and will not disturb the " +
        "last-touched ordering.\n\nNew key (snake_case):",
      stage.key,
    )
    if (!proposed || proposed === stage.key) return

    setBusy(true)
    try {
      const supabase = createClient()
      const { data, error } = await supabase.rpc("rename_funnel_stage", {
        p_stage_id: stage.id,
        p_new_key: proposed.trim(),
      })
      if (error) throw error
      const r = data as unknown as { leads_migrated?: number }
      toast.success(`Renamed. ${r?.leads_migrated ?? 0} lead(s) migrated.`)
      await refresh()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      toast.error(msg)
    } finally {
      setBusy(false)
    }
  }

  async function move(index: number, direction: -1 | 1) {
    const next = [...ordered]
    const target = index + direction
    if (target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target], next[index]]

    setBusy(true)
    try {
      const supabase = createClient()
      const { error } = await supabase.rpc("reorder_funnel_stages", {
        p_stage_ids: next.map((s) => s.id),
      })
      if (error) throw error
      await refresh()
    } catch (err) {
      console.error(err)
      toast.error("Could not reorder the stages")
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="space-y-3">
      <header className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-slate-800 text-sm">Funnel Stages</h3>
          <p className="text-xs text-slate-500">
            Order is the funnel. “In pipeline” is what RAG and the stats count.
          </p>
        </div>
        <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setAdding(true)}>
          <Plus className="h-3.5 w-3.5" /> Add Stage
        </Button>
      </header>

      {adding && (
        <div className="flex flex-wrap items-end gap-2 rounded-md border border-slate-200 p-3 bg-slate-50">
          <div className="space-y-1">
            <Label className="text-xs text-slate-600">Key</Label>
            <Input
              value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
              placeholder="board_review"
              className={cn(inputSm, "font-mono w-44")}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-slate-600">Label</Label>
            <Input
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              placeholder="Board Review"
              className={cn(inputSm, "w-44")}
            />
          </div>
          <Button size="sm" onClick={() => void addStage()} disabled={busy} className="gap-1.5">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            Add
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>Cancel</Button>
        </div>
      )}

      <div className="rounded-lg border border-slate-200 divide-y divide-slate-100">
        {ordered.map((s, i) => (
          <div key={s.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
            <div className="flex flex-col">
              <button
                type="button" disabled={i === 0 || busy}
                onClick={() => void move(i, -1)}
                className="text-slate-400 hover:text-slate-700 disabled:opacity-25"
                title="Move up"
              >
                <ArrowUp className="h-3 w-3" />
              </button>
              <button
                type="button" disabled={i === ordered.length - 1 || busy}
                onClick={() => void move(i, 1)}
                className="text-slate-400 hover:text-slate-700 disabled:opacity-25"
                title="Move down"
              >
                <ArrowDown className="h-3 w-3" />
              </button>
            </div>

            <span className={cn("inline-flex rounded-full border px-2 py-0.5 text-xs font-medium", stageBadgeClasses(s.key, stages))}>
              {s.label}
            </span>

            <button
              type="button"
              onClick={() => void renameKey(s)}
              disabled={busy}
              className="font-mono text-xs text-slate-500 hover:text-blue-600 hover:underline"
              title="Rename the key (migrates existing leads)"
            >
              {s.key}
            </button>

            <Input
              defaultValue={s.label}
              onBlur={(e) => {
                if (e.target.value !== s.label) void patch(s, { label: e.target.value })
              }}
              className={cn(inputSm, "w-36")}
            />

            <select
              value={s.color}
              onChange={(e) => void patch(s, { color: e.target.value })}
              className={selectSm}
            >
              {COLOR_FAMILIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>

            <div className="flex items-center gap-3 ml-auto text-xs text-slate-600">
              <label className="flex items-center gap-1" title="Counts as in-pipeline for RAG and stats">
                <input
                  type="checkbox" checked={s.is_active_stage} disabled={busy}
                  onChange={(e) => void patch(s, { is_active_stage: e.target.checked })}
                  className="h-3.5 w-3.5"
                />
                In pipeline
              </label>
              <label className="flex items-center gap-1" title="Reveals the Sale tab">
                <input
                  type="checkbox" checked={s.is_won} disabled={busy}
                  onChange={(e) => void patch(s, { is_won: e.target.checked })}
                  className="h-3.5 w-3.5"
                />
                Won
              </label>
              <label className="flex items-center gap-1" title="Lost / unqualified / dormant">
                <input
                  type="checkbox" checked={s.is_terminal} disabled={busy}
                  onChange={(e) => void patch(s, { is_terminal: e.target.checked })}
                  className="h-3.5 w-3.5"
                />
                Terminal
              </label>
            </div>
          </div>
        ))}
        {ordered.length === 0 && (
          <p className="px-3 py-6 text-center text-sm text-slate-500">
            No stages yet. Add the first one to start the funnel.
          </p>
        )}
      </div>
    </section>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// KYC field editor
// ────────────────────────────────────────────────────────────────────────────

export function KycFieldEditor({
  departmentId,
  fields,
  onChanged,
}: {
  departmentId: string
  fields: KycFieldDef[]
  onChanged: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [adding, setAdding] = useState(false)
  const [key, setKey] = useState("")
  const [label, setLabel] = useState("")
  const [type, setType] = useState<KycFieldType>("text")
  const [options, setOptions] = useState("")

  const ordered = [...fields].sort((a, b) => a.sort_order - b.sort_order)

  async function refresh() {
    await loadDepartmentConfig()
    onChanged()
  }

  async function addField() {
    const k = key.trim().toLowerCase().replace(/\s+/g, "_")
    if (!k || !label.trim()) {
      toast.error("Key and label are required")
      return
    }
    setBusy(true)
    try {
      const supabase = createClient()
      const { error } = await supabase.from("kyc_fields").insert({
        department_id: departmentId,
        key: k,
        label: label.trim(),
        field_type: type,
        options:
          (type === "select" || type === "multiselect") && options.trim()
            ? options.split(",").map((o) => o.trim()).filter(Boolean)
            : null,
        sort_order: (ordered.at(-1)?.sort_order ?? 0) + 1,
      })
      if (error) throw error
      toast.success(`Question “${label}” added`)
      setKey(""); setLabel(""); setOptions(""); setType("text"); setAdding(false)
      await refresh()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      toast.error(msg.includes("duplicate") ? "That key already exists" : msg)
    } finally {
      setBusy(false)
    }
  }

  async function patch(f: KycFieldDef, values: Partial<KycFieldDef>) {
    setBusy(true)
    try {
      const supabase = createClient()
      const { error } = await supabase.from("kyc_fields").update(values).eq("id", f.id)
      if (error) throw error
      await refresh()
    } catch (err) {
      console.error(err)
      toast.error("Could not save the question")
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="space-y-3">
      <header className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-slate-800 text-sm">KYC Questions</h3>
          <p className="text-xs text-slate-500">
            Answers live in <code className="text-[11px]">leads.kyc</code>. Removing a question
            hides it but keeps every answer already given.
          </p>
        </div>
        <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setAdding(true)}>
          <Plus className="h-3.5 w-3.5" /> Add Question
        </Button>
      </header>

      {adding && (
        <div className="flex flex-wrap items-end gap-2 rounded-md border border-slate-200 p-3 bg-slate-50">
          <div className="space-y-1">
            <Label className="text-xs text-slate-600">Key</Label>
            <Input value={key} onChange={(e) => setKey(e.target.value)}
                   placeholder="annual_budget" className={cn(inputSm, "font-mono w-40")} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-slate-600">Label</Label>
            <Input value={label} onChange={(e) => setLabel(e.target.value)}
                   placeholder="Annual Budget" className={cn(inputSm, "w-40")} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-slate-600">Type</Label>
            <select value={type} onChange={(e) => setType(e.target.value as KycFieldType)} className={selectSm}>
              {FIELD_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          {(type === "select" || type === "multiselect") && (
            <div className="space-y-1 flex-1 min-w-48">
              <Label className="text-xs text-slate-600">Options (comma separated)</Label>
              <Input value={options} onChange={(e) => setOptions(e.target.value)}
                     placeholder="Small, Medium, Large" className={inputSm} />
            </div>
          )}
          <Button size="sm" onClick={() => void addField()} disabled={busy} className="gap-1.5">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            Add
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>Cancel</Button>
        </div>
      )}

      <div className="rounded-lg border border-slate-200 divide-y divide-slate-100">
        {ordered.map((f) => (
          <div
            key={f.id}
            className={cn("flex flex-wrap items-center gap-2 px-3 py-2", !f.is_active && "opacity-50")}
          >
            <span className="font-mono text-xs text-slate-500 w-40 truncate">{f.key}</span>
            <Input
              defaultValue={f.label}
              onBlur={(e) => { if (e.target.value !== f.label) void patch(f, { label: e.target.value }) }}
              className={cn(inputSm, "w-52")}
            />
            <span className="text-xs text-slate-500 w-20">{f.field_type}</span>

            <div className="flex items-center gap-3 ml-auto text-xs text-slate-600">
              <label className="flex items-center gap-1">
                <input type="checkbox" checked={f.is_required} disabled={busy}
                       onChange={(e) => void patch(f, { is_required: e.target.checked })}
                       className="h-3.5 w-3.5" />
                Required
              </label>
              <label className="flex items-center gap-1" title="Show as a column in the leads table">
                <input type="checkbox" checked={f.show_in_table} disabled={busy}
                       onChange={(e) => void patch(f, { show_in_table: e.target.checked })}
                       className="h-3.5 w-3.5" />
                In table
              </label>
              <Button
                size="sm" variant="ghost"
                className="h-7 px-2 text-xs text-slate-500"
                disabled={busy}
                title={f.is_active ? "Hide this question (answers are kept)" : "Show this question again"}
                onClick={() => void patch(f, { is_active: !f.is_active })}
              >
                <Trash2 className="h-3 w-3" />
                {f.is_active ? "Remove" : "Restore"}
              </Button>
            </div>
          </div>
        ))}
        {ordered.length === 0 && (
          <p className="px-3 py-6 text-center text-sm text-slate-500">
            No KYC questions for this department yet.
          </p>
        )}
      </div>
    </section>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Product editor
// ────────────────────────────────────────────────────────────────────────────

export function ProductEditor({
  departmentId,
  products,
  onChanged,
}: {
  departmentId: string
  products: DepartmentProduct[]
  onChanged: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [name, setName] = useState("")
  const [price, setPrice] = useState("")

  const ordered = [...products].sort((a, b) => a.sort_order - b.sort_order)

  async function refresh() {
    await loadDepartmentConfig()
    onChanged()
  }

  async function add() {
    if (!name.trim()) {
      toast.error("Product name is required")
      return
    }
    setBusy(true)
    try {
      const supabase = createClient()
      const { error } = await supabase.from("department_products").insert({
        department_id: departmentId,
        name: name.trim(),
        unit_price: price ? Number(price) : null,
        sort_order: (ordered.at(-1)?.sort_order ?? 0) + 1,
      })
      if (error) throw error
      toast.success(`Product “${name}” added`)
      setName(""); setPrice("")
      await refresh()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      toast.error(msg.includes("duplicate") ? "That product already exists" : msg)
    } finally {
      setBusy(false)
    }
  }

  async function patch(p: DepartmentProduct, values: Partial<DepartmentProduct>) {
    setBusy(true)
    try {
      const supabase = createClient()
      const { error } = await supabase.from("department_products").update(values).eq("id", p.id)
      if (error) throw error
      await refresh()
    } catch {
      toast.error("Could not save the product")
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="space-y-3">
      <header>
        <h3 className="font-semibold text-slate-800 text-sm">Products</h3>
        <p className="text-xs text-slate-500">
          Deactivating keeps historical leads readable while removing it from the dropdown.
        </p>
      </header>

      <div className="flex flex-wrap items-end gap-2">
        <Input value={name} onChange={(e) => setName(e.target.value)}
               placeholder="New product name" className={cn(inputSm, "w-64")} />
        <Input value={price} onChange={(e) => setPrice(e.target.value)} type="number"
               placeholder="Unit price (KES)" className={cn(inputSm, "w-40")} />
        <Button size="sm" onClick={() => void add()} disabled={busy} className="gap-1.5">
          <Plus className="h-3.5 w-3.5" /> Add
        </Button>
      </div>

      <div className="rounded-lg border border-slate-200 divide-y divide-slate-100">
        {ordered.map((p) => (
          <div key={p.id} className={cn("flex items-center gap-2 px-3 py-2", !p.is_active && "opacity-50")}>
            <Input
              defaultValue={p.name}
              onBlur={(e) => { if (e.target.value !== p.name) void patch(p, { name: e.target.value }) }}
              className={cn(inputSm, "flex-1")}
            />
            <Input
              type="number"
              defaultValue={p.unit_price ?? ""}
              onBlur={(e) => {
                const v = e.target.value ? Number(e.target.value) : null
                if (v !== p.unit_price) void patch(p, { unit_price: v })
              }}
              className={cn(inputSm, "w-32")}
              placeholder="KES"
            />
            <label className="flex items-center gap-1 text-xs text-slate-600">
              <input type="checkbox" checked={p.is_active} disabled={busy}
                     onChange={(e) => void patch(p, { is_active: e.target.checked })}
                     className="h-3.5 w-3.5" />
              Active
            </label>
          </div>
        ))}
        {ordered.length === 0 && (
          <p className="px-3 py-6 text-center text-sm text-slate-500">No products yet.</p>
        )}
      </div>

      {ordered.some((p) => p.name === "") && (
        <p className="flex items-start gap-1.5 text-[11px] text-amber-700">
          <AlertTriangle className="h-3.5 w-3.5 mt-px shrink-0" />
          The blank entry is a legacy value kept so historical leads still render. Leave it
          inactive rather than deleting it.
        </p>
      )}
    </section>
  )
}
