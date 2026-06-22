"use client"

import { useEffect, useMemo, useState } from "react"
import {
  useReactTable,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  getPaginationRowModel,
  type ColumnDef,
  type SortingState,
  type ColumnFiltersState,
  type PaginationState,
} from "@tanstack/react-table"
import Link from "next/link"
import { CheckCircle2, XCircle, RefreshCcw, ChevronUp, ChevronDown, ChevronsUpDown } from "lucide-react"
import { toast } from "sonner"
import { Button, buttonVariants } from "@/components/ui/button"
import { createClient } from "@/lib/supabase/client"
import { PRODUCTS } from "@/types/crm"
import { daysUntil, getRenewalColorClass, formatDate } from "@/lib/utils/dateHelpers"
import { format } from "date-fns"
import { cn } from "@/lib/utils"
import { RenewalsTable } from "./RenewalsTable"
import { RenewalsFilters } from "./RenewalsFilters"

// ── Types ─────────────────────────────────────────────────────────────────────

export type RenewalStatus = "active" | "due" | "renewed" | "churned"

export interface RenewalRow {
  id: string
  lead_id: string
  product: string
  sale_amount: number | null
  currency: string
  sale_date: string
  installation_date: string | null
  renewal_due_date: string | null
  telemarketer_id: string
  lead: {
    id: string
    full_name: string | null
    phone_number: string
    funnel_stage: string
    rag_status: string
  } | null
  telemarketer: {
    id: string
    full_name: string
  } | null
  // computed
  days_until: number | null
  status: RenewalStatus
}

interface TelemarketerOption {
  id: string
  full_name: string
}

function deriveStatus(funnelStage: string): RenewalStatus {
  if (funnelStage === "renewed") return "renewed"
  if (funnelStage === "lost" || funnelStage === "unqualified") return "churned"
  if (funnelStage === "renewal_due") return "due"
  return "active"
}

// ── Component ─────────────────────────────────────────────────────────────────

export function RenewalsShell() {
  const [data, setData] = useState<RenewalRow[]>([])
  const [loading, setLoading] = useState(true)
  const [telemarketers, setTelemarketers] = useState<TelemarketerOption[]>([])
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  const [globalFilter, setGlobalFilter] = useState("")
  const [sorting, setSorting] = useState<SortingState>([{ id: "days_until", desc: false }])
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 20 })

  useEffect(() => {
    const supabase = createClient()

    Promise.all([
      supabase
        .from("sales")
        .select(`
          id, lead_id, product, sale_amount, currency,
          sale_date, installation_date, renewal_due_date, telemarketer_id,
          lead:leads(id, full_name, phone_number, funnel_stage, rag_status),
          telemarketer:telemarketers(id, full_name)
        `)
        .not("renewal_due_date", "is", null)
        .order("renewal_due_date", { ascending: true }),
      supabase
        .from("telemarketers")
        .select("id, full_name")
        .eq("is_active", true)
        .order("full_name"),
    ]).then(([salesResult, tmResult]) => {
      if (salesResult.data) {
        const rows = (salesResult.data as any[]).map((s): RenewalRow => {
          const days = s.renewal_due_date ? daysUntil(s.renewal_due_date) : null
          const stage = s.lead?.funnel_stage ?? "post_sale"
          return {
            ...s,
            days_until: days,
            status: deriveStatus(stage),
          }
        })
        setData(rows)
      }
      if (tmResult.data) {
        setTelemarketers(tmResult.data as TelemarketerOption[])
      }
      setLoading(false)
    })
  }, [])

  async function markRenewed(row: RenewalRow) {
    if (!row.lead_id) return
    setActionLoading(row.id)
    const supabase = createClient()

    const [leadResult] = await Promise.all([
      (supabase.from("leads") as any).update({ funnel_stage: "renewed" }).eq("id", row.lead_id),
      (supabase.from("sales") as any).update({ renewal_reminder_sent: true }).eq("id", row.id),
    ])

    if (leadResult.error) {
      toast.error("Failed to mark as renewed")
    } else {
      setData((prev) =>
        prev.map((r) =>
          r.id === row.id
            ? { ...r, status: "renewed", lead: r.lead ? { ...r.lead, funnel_stage: "renewed" } : r.lead }
            : r
        )
      )
      toast.success(`${row.lead?.full_name ?? row.lead?.phone_number} marked as renewed`)
    }
    setActionLoading(null)
  }

  async function markChurned(row: RenewalRow) {
    if (!row.lead_id) return
    setActionLoading(row.id + "-churned")
    const supabase = createClient()

    const { error } = await (supabase.from("leads") as any)
      .update({ funnel_stage: "lost" })
      .eq("id", row.lead_id)

    if (error) {
      toast.error("Failed to mark as churned")
    } else {
      setData((prev) =>
        prev.map((r) =>
          r.id === row.id
            ? { ...r, status: "churned", lead: r.lead ? { ...r.lead, funnel_stage: "lost" } : r.lead }
            : r
        )
      )
      toast.success(`${row.lead?.full_name ?? row.lead?.phone_number} marked as churned`)
    }
    setActionLoading(null)
  }

  const columns = useMemo<ColumnDef<RenewalRow>[]>(
    () => [
      {
        id: "client",
        header: "Client",
        accessorFn: (row) => row.lead?.full_name ?? row.lead?.phone_number ?? "",
        cell: ({ row }) => (
          <div>
            <Link
              href={`/leads/${row.original.lead_id}`}
              className="font-medium text-slate-800 hover:text-blue-600 text-sm transition-colors"
            >
              {row.original.lead?.full_name ?? <span className="text-slate-400 italic font-normal">Unknown</span>}
            </Link>
            <p className="text-xs text-slate-400 font-mono mt-0.5">{row.original.lead?.phone_number}</p>
          </div>
        ),
      },
      {
        id: "product",
        accessorKey: "product",
        header: "Product",
        cell: ({ row }) => (
          <span className="text-slate-600 text-xs">{row.original.product}</span>
        ),
        filterFn: "equals",
      },
      {
        id: "telemarketer",
        header: "Assigned To",
        accessorFn: (row) => row.telemarketer?.full_name ?? "",
        cell: ({ row }) => (
          <span className="text-slate-600 text-sm">{row.original.telemarketer?.full_name ?? "—"}</span>
        ),
        filterFn: "equals",
      },
      {
        id: "sale_amount",
        accessorKey: "sale_amount",
        header: "Amount",
        cell: ({ row }) =>
          row.original.sale_amount != null ? (
            <span className="text-slate-700 text-sm font-medium">
              KES {row.original.sale_amount.toLocaleString()}
            </span>
          ) : (
            <span className="text-slate-400 text-xs">—</span>
          ),
      },
      {
        id: "renewal_due_date",
        accessorKey: "renewal_due_date",
        header: "Renewal Due",
        cell: ({ row }) =>
          row.original.renewal_due_date ? (
            <span className="text-slate-600 text-sm whitespace-nowrap">
              {formatDate(row.original.renewal_due_date)}
            </span>
          ) : (
            <span className="text-slate-400 text-xs">—</span>
          ),
        filterFn: (row, _id, filterValue: string) => {
          if (!filterValue || !row.original.renewal_due_date) return !filterValue
          return format(new Date(row.original.renewal_due_date), "yyyy-MM") === filterValue
        },
      },
      {
        id: "days_until",
        accessorKey: "days_until",
        header: "Days Left",
        cell: ({ row }) => {
          const days = row.original.days_until
          if (row.original.status === "renewed") {
            return <span className="text-green-600 text-xs font-medium">Renewed</span>
          }
          if (row.original.status === "churned") {
            return <span className="text-slate-400 text-xs font-medium">Churned</span>
          }
          if (days === null) return <span className="text-slate-400 text-xs">—</span>
          const colorClass = getRenewalColorClass(days)
          return (
            <span className={cn("text-sm font-semibold", colorClass)}>
              {days < 0 ? `${Math.abs(days)}d overdue` : days === 0 ? "Today" : `${days}d`}
            </span>
          )
        },
        sortingFn: (a, b) => {
          const da = a.original.days_until ?? 99999
          const db = b.original.days_until ?? 99999
          return da - db
        },
      },
      {
        id: "status",
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
        filterFn: "equals",
      },
      {
        id: "actions",
        header: "",
        enableSorting: false,
        cell: ({ row }) => {
          const r = row.original
          const isRenewed = r.status === "renewed"
          const isChurned = r.status === "churned"
          if (isRenewed || isChurned) {
            return (
              <Link
                href={`/leads/${r.lead_id}`}
                className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "h-7 px-2 text-xs text-slate-500")}
              >
                View
              </Link>
            )
          }
          return (
            <div className="flex items-center gap-1 justify-end">
              <Button
                size="sm"
                variant="outline"
                className="h-7 px-2 text-xs gap-1 text-green-700 border-green-200 hover:bg-green-50 whitespace-nowrap"
                disabled={actionLoading === r.id}
                onClick={() => markRenewed(r)}
              >
                <CheckCircle2 className="h-3 w-3" />
                Renewed
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7 px-2 text-xs gap-1 text-red-600 border-red-200 hover:bg-red-50 whitespace-nowrap"
                disabled={actionLoading === r.id + "-churned"}
                onClick={() => markChurned(r)}
              >
                <XCircle className="h-3 w-3" />
                Churned
              </Button>
            </div>
          )
        },
      },
    ],
    [actionLoading]
  )

  const table = useReactTable({
    data,
    columns,
    state: { sorting, columnFilters, globalFilter, pagination },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onGlobalFilterChange: setGlobalFilter,
    onPaginationChange: setPagination,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    globalFilterFn: (row, _columnId, value) => {
      const q = value.toLowerCase()
      return (
        (row.original.lead?.full_name ?? "").toLowerCase().includes(q) ||
        (row.original.lead?.phone_number ?? "").toLowerCase().includes(q) ||
        row.original.product.toLowerCase().includes(q)
      )
    },
  })

  const renewalMonths = useMemo(() => {
    const months = new Set<string>()
    data.forEach((r) => {
      if (r.renewal_due_date) months.add(format(new Date(r.renewal_due_date), "yyyy-MM"))
    })
    return Array.from(months).sort()
  }, [data])

  const stats = useMemo(() => {
    const total = data.length
    const due = data.filter((r) => r.status === "due").length
    const renewed = data.filter((r) => r.status === "renewed").length
    const churned = data.filter((r) => r.status === "churned").length
    return { total, due, renewed, churned }
  }, [data])

  return (
    <div className="p-4 lg:p-6 space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Renewals</h1>
          <p className="text-slate-500 text-sm mt-0.5">
            {loading ? "Loading…" : `${table.getFilteredRowModel().rows.length} of ${data.length} clients`}
          </p>
        </div>
        {!loading && (
          <div className="flex gap-3 text-center shrink-0">
            <StatChip label="Total" value={stats.total} color="text-slate-700" />
            <StatChip label="Due" value={stats.due} color="text-red-600" />
            <StatChip label="Renewed" value={stats.renewed} color="text-green-600" />
            <StatChip label="Churned" value={stats.churned} color="text-slate-400" />
          </div>
        )}
      </div>

      <RenewalsFilters
        table={table}
        globalFilter={globalFilter}
        onGlobalFilterChange={setGlobalFilter}
        telemarketers={telemarketers}
        renewalMonths={renewalMonths}
      />

      <RenewalsTable table={table} loading={loading} />
    </div>
  )
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: RenewalStatus }) {
  const map: Record<RenewalStatus, { label: string; className: string }> = {
    active: { label: "Active", className: "bg-blue-50 text-blue-700" },
    due: { label: "Due", className: "bg-red-50 text-red-700" },
    renewed: { label: "Renewed", className: "bg-green-50 text-green-700" },
    churned: { label: "Churned", className: "bg-slate-100 text-slate-500" },
  }
  const { label, className } = map[status]
  return (
    <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium", className)}>
      {label}
    </span>
  )
}

function StatChip({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="bg-white border border-slate-200 rounded-lg px-3 py-1.5 min-w-[56px]">
      <p className={cn("text-lg font-bold leading-none", color)}>{value}</p>
      <p className="text-xs text-slate-400 mt-0.5">{label}</p>
    </div>
  )
}
