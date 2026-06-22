"use client"

import { X, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { type Table } from "@tanstack/react-table"
import { format } from "date-fns"
import { PRODUCTS } from "@/types/crm"
import type { RenewalRow } from "./RenewalsShell"

interface TelemarketerOption {
  id: string
  full_name: string
}

interface Props {
  table: Table<RenewalRow>
  globalFilter: string
  onGlobalFilterChange: (v: string) => void
  telemarketers: TelemarketerOption[]
  renewalMonths: string[]
}

export function RenewalsFilters({ table, globalFilter, onGlobalFilterChange, telemarketers, renewalMonths }: Props) {
  const statusFilter = (table.getColumn("status")?.getFilterValue() as string) ?? ""
  const productFilter = (table.getColumn("product")?.getFilterValue() as string) ?? ""
  const telemarketerFilter = (table.getColumn("telemarketer")?.getFilterValue() as string) ?? ""
  const monthFilter = (table.getColumn("renewal_due_date")?.getFilterValue() as string) ?? ""

  const hasFilters = globalFilter || statusFilter || productFilter || telemarketerFilter || monthFilter

  function clearAll() {
    onGlobalFilterChange("")
    table.getColumn("status")?.setFilterValue("")
    table.getColumn("product")?.setFilterValue("")
    table.getColumn("telemarketer")?.setFilterValue("")
    table.getColumn("renewal_due_date")?.setFilterValue("")
  }

  return (
    <div className="flex flex-wrap gap-2 items-center">
      {/* Search */}
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
        <Input
          placeholder="Search client, phone, product…"
          value={globalFilter}
          onChange={(e) => onGlobalFilterChange(e.target.value)}
          className="pl-8 h-9 text-sm w-56"
        />
      </div>

      {/* Status */}
      <select
        value={statusFilter}
        onChange={(e) => table.getColumn("status")?.setFilterValue(e.target.value || undefined)}
        className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        <option value="">All Statuses</option>
        <option value="active">Active</option>
        <option value="due">Due</option>
        <option value="renewed">Renewed</option>
        <option value="churned">Churned</option>
      </select>

      {/* Telemarketer */}
      {telemarketers.length > 0 && (
        <select
          value={telemarketerFilter}
          onChange={(e) => table.getColumn("telemarketer")?.setFilterValue(e.target.value || undefined)}
          className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">All Telemarketers</option>
          {telemarketers.map((t) => (
            <option key={t.id} value={t.full_name}>{t.full_name}</option>
          ))}
        </select>
      )}

      {/* Product */}
      <select
        value={productFilter}
        onChange={(e) => table.getColumn("product")?.setFilterValue(e.target.value || undefined)}
        className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        <option value="">All Products</option>
        {PRODUCTS.map((p) => (
          <option key={p} value={p}>{p}</option>
        ))}
      </select>

      {/* Renewal Month */}
      {renewalMonths.length > 0 && (
        <select
          value={monthFilter}
          onChange={(e) => table.getColumn("renewal_due_date")?.setFilterValue(e.target.value || undefined)}
          className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">All Months</option>
          {renewalMonths.map((m) => (
            <option key={m} value={m}>
              {format(new Date(m + "-01"), "MMM yyyy")}
            </option>
          ))}
        </select>
      )}

      {/* Clear */}
      {hasFilters && (
        <Button variant="ghost" size="sm" className="h-9 gap-1.5 text-slate-500" onClick={clearAll}>
          <X className="h-3.5 w-3.5" />
          Clear
        </Button>
      )}
    </div>
  )
}
