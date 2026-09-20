"use client"

import { type Table } from "@tanstack/react-table"
import { Search, X } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { FUNNEL_STAGE_LABELS, FUNNEL_STAGES, PRODUCTS } from "@/types/crm"
import { useDepartment } from "@/lib/departments/useDepartment"
import { orderedStages } from "@/lib/utils/funnelHelpers"
import type { ProcessedLead } from "./LeadsShell"

interface Props {
  table: Table<ProcessedLead>
  globalFilter: string
  onGlobalFilterChange: (value: string) => void
}

const RAG_OPTIONS = [
  { value: "green", label: "Green" },
  { value: "amber", label: "Amber" },
  { value: "red",   label: "Red"   },
]

export function LeadFilters({ table, globalFilter, onGlobalFilterChange }: Props) {
  // Stage and product options come from the active department's config.
  // The hardcoded telematics constants remain the fallback for the first paint
  // and for any environment where the config could not be loaded, so the
  // filters are never empty.
  const { stages, products } = useDepartment()

  const stageOptions =
    stages.length > 0
      ? orderedStages(stages).map((s) => ({ value: s.key, label: s.label }))
      : FUNNEL_STAGES.map((s) => ({ value: s as string, label: FUNNEL_STAGE_LABELS[s] }))

  const productOptions =
    products.length > 0
      ? products.map((p) => p.name)
      : (PRODUCTS as readonly string[])

  const ragFilter = (table.getColumn("rag_status")?.getFilterValue() as string) ?? ""
  const stageFilter = (table.getColumn("funnel_stage")?.getFilterValue() as string) ?? ""
  const productFilter = (table.getColumn("product_interested")?.getFilterValue() as string) ?? ""
  const contactedFilter = (table.getColumn("contacted")?.getFilterValue() as string) ?? ""

  const hasActiveFilters = !!globalFilter || !!ragFilter || !!stageFilter || !!productFilter || !!contactedFilter

  function clearAll() {
    onGlobalFilterChange("")
    table.getColumn("rag_status")?.setFilterValue(undefined)
    table.getColumn("funnel_stage")?.setFilterValue(undefined)
    table.getColumn("product_interested")?.setFilterValue(undefined)
    table.getColumn("contacted")?.setFilterValue(undefined)
    table.resetPagination()
  }

  return (
    <div className="flex flex-col sm:flex-row gap-2 flex-wrap">
      {/* Search */}
      <div className="relative flex-1 min-w-48">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400 pointer-events-none" />
        <Input
          placeholder="Search name or phone…"
          value={globalFilter}
          onChange={(e) => { onGlobalFilterChange(e.target.value); table.resetPagination() }}
          className="pl-8 h-9 text-sm"
        />
      </div>

      {/* RAG filter */}
      <select
        value={ragFilter}
        onChange={(e) => { table.getColumn("rag_status")?.setFilterValue(e.target.value || undefined); table.resetPagination() }}
        className="h-9 rounded-md border border-input bg-background px-3 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-ring"
      >
        <option value="">All RAG</option>
        {RAG_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>

      {/* Funnel stage filter */}
      <select
        value={stageFilter}
        onChange={(e) => { table.getColumn("funnel_stage")?.setFilterValue(e.target.value || undefined); table.resetPagination() }}
        className="h-9 rounded-md border border-input bg-background px-3 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-ring"
      >
        <option value="">All Stages</option>
        {stageOptions.map((s) => (
          <option key={s.value} value={s.value}>{s.label}</option>
        ))}
      </select>

      {/* Product filter */}
      <select
        value={productFilter}
        onChange={(e) => { table.getColumn("product_interested")?.setFilterValue(e.target.value || undefined); table.resetPagination() }}
        className="h-9 rounded-md border border-input bg-background px-3 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-ring"
      >
        <option value="">All Products</option>
        {productOptions.map((p) => (
          <option key={p} value={p}>{p}</option>
        ))}
      </select>

      {/* Contacted filter */}
      <select
        value={contactedFilter}
        onChange={(e) => { table.getColumn("contacted")?.setFilterValue(e.target.value || undefined); table.resetPagination() }}
        className="h-9 rounded-md border border-input bg-background px-3 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-ring"
      >
        <option value="">All Contact</option>
        <option value="contacted">Contacted</option>
        <option value="not">Not contacted</option>
      </select>

      {/* Clear */}
      {hasActiveFilters && (
        <Button variant="ghost" size="sm" onClick={clearAll} className="h-9 gap-1.5 text-slate-500">
          <X className="h-3.5 w-3.5" />
          Clear
        </Button>
      )}
    </div>
  )
}
