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
import { Phone, Eye, ChevronUp, ChevronDown, ChevronsUpDown } from "lucide-react"
import { Button, buttonVariants } from "@/components/ui/button"
import { useTelemarketerStore } from "@/lib/stores/telemarketerStore"
import { createClient } from "@/lib/supabase/client"
import { FunnelStage, RAGStatus } from "@/types/crm"
import { FunnelStageBadge } from "./FunnelStageBadge"
import { RAGBadge } from "./RAGBadge"
import { LeadFilters } from "./LeadFilters"
import { LeadTable } from "./LeadTable"
import { formatDate } from "@/lib/utils/dateHelpers"
import { isPast } from "date-fns"
import { cn } from "@/lib/utils"
import { Users } from "lucide-react"

export interface ProcessedLead {
  id: string
  phone_number: string
  full_name: string | null
  product_interested: string | null
  funnel_stage: FunnelStage
  rag_status: RAGStatus
  lead_source: string
  campaign_name: string | null
  location: string | null
  vehicle_type: string | null
  whatsapp_message: string | null
  assigned_to: string | null
  created_at: string
  updated_at: string
  last_called: string | null
  next_followup: string | null
}

export function LeadsShell() {
  const { activeTelemarketer } = useTelemarketerStore()
  const [data, setData] = useState<ProcessedLead[]>([])
  const [loading, setLoading] = useState(true)
  const [globalFilter, setGlobalFilter] = useState("")
  const [sorting, setSorting] = useState<SortingState>([{ id: "updated_at", desc: true }])
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 20 })

  useEffect(() => {
    if (!activeTelemarketer) { setLoading(false); return }

    const supabase = createClient()
    setLoading(true)

    supabase
      .from("leads")
      .select("*, call_logs(called_at, call_outcome), followup_schedule(scheduled_date, status)")
      .eq("assigned_to", activeTelemarketer.id)
      .order("updated_at", { ascending: false })
      .then(({ data: raw }) => {
        if (!raw) { setLoading(false); return }

        const processed: ProcessedLead[] = (raw as any[]).map((lead) => {
          const sortedCalls = [...(lead.call_logs ?? [])].sort(
            (a: any, b: any) => new Date(b.called_at).getTime() - new Date(a.called_at).getTime()
          )
          const pendingFollowups = (lead.followup_schedule ?? [])
            .filter((f: any) => f.status === "pending")
            .sort((a: any, b: any) => new Date(a.scheduled_date).getTime() - new Date(b.scheduled_date).getTime())

          return {
            id: lead.id,
            phone_number: lead.phone_number,
            full_name: lead.full_name,
            product_interested: lead.product_interested,
            funnel_stage: lead.funnel_stage,
            rag_status: lead.rag_status,
            lead_source: lead.lead_source,
            campaign_name: lead.campaign_name,
            location: lead.location,
            vehicle_type: lead.vehicle_type,
            whatsapp_message: lead.whatsapp_message,
            assigned_to: lead.assigned_to,
            created_at: lead.created_at,
            updated_at: lead.updated_at,
            last_called: sortedCalls[0]?.called_at ?? null,
            next_followup: pendingFollowups[0]?.scheduled_date ?? null,
          }
        })

        setData(processed)
        setLoading(false)
      })
  }, [activeTelemarketer?.id])

  const columns = useMemo<ColumnDef<ProcessedLead>[]>(
    () => [
      {
        id: "phone_number",
        accessorKey: "phone_number",
        header: "Phone",
        cell: ({ row }) => (
          <Link
            href={`/leads/${row.original.id}`}
            className="font-mono text-blue-600 hover:underline text-xs whitespace-nowrap"
          >
            {row.original.phone_number}
          </Link>
        ),
      },
      {
        id: "full_name",
        accessorKey: "full_name",
        header: "Name",
        cell: ({ row }) =>
          row.original.full_name ? (
            <span className="text-slate-800 font-medium text-sm">{row.original.full_name}</span>
          ) : (
            <span className="text-slate-400 italic text-xs">Unknown</span>
          ),
      },
      {
        id: "product_interested",
        accessorKey: "product_interested",
        header: "Product",
        cell: ({ row }) => (
          <span className="text-slate-600 text-xs">{row.original.product_interested ?? "—"}</span>
        ),
        filterFn: "equals",
      },
      {
        id: "funnel_stage",
        accessorKey: "funnel_stage",
        header: "Stage",
        cell: ({ row }) => <FunnelStageBadge stage={row.original.funnel_stage} />,
        filterFn: "equals",
      },
      {
        id: "rag_status",
        accessorKey: "rag_status",
        header: "RAG",
        cell: ({ row }) => <RAGBadge status={row.original.rag_status} />,
        filterFn: "equals",
      },
      {
        id: "last_called",
        accessorKey: "last_called",
        header: "Last Called",
        cell: ({ row }) => (
          <span className="text-slate-500 text-xs whitespace-nowrap">
            {row.original.last_called ? formatDate(row.original.last_called) : "—"}
          </span>
        ),
        sortingFn: (a, b) => {
          if (!a.original.last_called) return 1
          if (!b.original.last_called) return -1
          return new Date(a.original.last_called).getTime() - new Date(b.original.last_called).getTime()
        },
      },
      {
        id: "next_followup",
        accessorKey: "next_followup",
        header: "Next Follow-up",
        cell: ({ row }) => {
          const d = row.original.next_followup
          if (!d) return <span className="text-slate-400 text-xs">—</span>
          const overdue = isPast(new Date(d + "T00:00:00"))
          return (
            <span className={cn("text-xs font-medium whitespace-nowrap", overdue ? "text-red-600" : "text-slate-600")}>
              {formatDate(d)}
            </span>
          )
        },
      },
      {
        id: "actions",
        header: "",
        enableSorting: false,
        cell: ({ row }) => (
          <div className="flex items-center gap-1 justify-end">
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2 text-xs gap-1 whitespace-nowrap"
              onClick={() => {/* Sprint 5: open Call Log Modal */}}
            >
              <Phone className="h-3 w-3" />
              Call Now
            </Button>
            <Link
              href={`/leads/${row.original.id}`}
              className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "h-7 px-2 text-xs")}
            >
              <Eye className="h-3 w-3" />
            </Link>
          </div>
        ),
      },
    ],
    []
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
        (row.original.full_name ?? "").toLowerCase().includes(q) ||
        row.original.phone_number.toLowerCase().includes(q)
      )
    },
  })

  if (!activeTelemarketer) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3 text-center p-6">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-slate-100">
          <Users className="h-7 w-7 text-slate-400" />
        </div>
        <h2 className="text-lg font-semibold text-slate-800">No telemarketer selected</h2>
        <p className="text-sm text-slate-500 max-w-xs">
          Use the switcher in the top-right corner to choose a telemarketer and view their leads.
        </p>
      </div>
    )
  }

  return (
    <div className="p-4 lg:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">My Leads</h1>
          <p className="text-slate-500 text-sm mt-0.5">
            {loading ? "Loading…" : `${table.getFilteredRowModel().rows.length} of ${data.length} leads`}
          </p>
        </div>
      </div>

      <LeadFilters table={table} globalFilter={globalFilter} onGlobalFilterChange={setGlobalFilter} />
      <LeadTable table={table} loading={loading} />
    </div>
  )
}
