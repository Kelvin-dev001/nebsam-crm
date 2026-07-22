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
import { Phone, Eye, Wifi, MessageCircle, StickyNote, CheckCircle2 } from "lucide-react"
import { Button, buttonVariants } from "@/components/ui/button"
import { LeadNotesDialog } from "./LeadNotesDialog"
import { useTelemarketerStore } from "@/lib/stores/telemarketerStore"
import { createClient } from "@/lib/supabase/client"
import type { LeadRow } from "@/lib/supabase/types"
import { FunnelStage, RAGStatus } from "@/types/crm"
import { FunnelStageBadge } from "./FunnelStageBadge"
import { RAGBadge } from "./RAGBadge"
import { LeadFilters } from "./LeadFilters"
import { LeadTable } from "./LeadTable"
import { CallLogModal, type CallSavedPayload } from "./CallLogModal"
import { ChatModal } from "@/components/chat/ChatModal"
import type { ChatLead } from "@/components/chat/WhatsAppChat"
import { formatDate } from "@/lib/utils/dateHelpers"
import { isPast } from "date-fns"
import { cn } from "@/lib/utils"
import { Users } from "lucide-react"
import { toast } from "sonner"

export interface CallNoteEntry {
  called_at: string
  call_outcome: string
  call_notes: string | null
}

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
  call_count: number
  call_history: CallNoteEntry[]
}

export function LeadsShell() {
  const { activeTelemarketer } = useTelemarketerStore()
  const [data, setData] = useState<ProcessedLead[]>([])
  const [loading, setLoading] = useState(true)
  const [callingLead, setCallingLead] = useState<ProcessedLead | null>(null)
  const [chatLead,    setChatLead]    = useState<ChatLead | null>(null)
  const [notesLead,   setNotesLead]   = useState<ProcessedLead | null>(null)
  const [globalFilter, setGlobalFilter] = useState("")
  const [sorting, setSorting] = useState<SortingState>([{ id: "updated_at", desc: true }])
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 20 })

  useEffect(() => {
    if (!activeTelemarketer) { setLoading(false); return }

    const supabase = createClient()
    setLoading(true)

    ;(async () => {
      try {
        const { data: raw, error } = await supabase
          .from("leads")
          .select("*, call_logs(called_at, call_outcome, call_notes), followup_schedule(scheduled_date, status)")
          .eq("assigned_to", activeTelemarketer.id)
          .order("updated_at", { ascending: false })
        if (error) console.error("LeadsShell fetch error:", error)
        if (!raw) return

        type RawLead = LeadRow & {
          call_logs: Array<{ called_at: string; call_outcome: string; call_notes: string | null }>
          followup_schedule: Array<{ scheduled_date: string; status: string }>
        }
        const processed: ProcessedLead[] = (raw as unknown as RawLead[]).map((lead) => {
          const sortedCalls = [...(lead.call_logs ?? [])].sort(
            (a, b) => new Date(b.called_at).getTime() - new Date(a.called_at).getTime()
          )
          const pendingFollowups = (lead.followup_schedule ?? [])
            .filter((f) => f.status === "pending")
            .sort((a, b) => new Date(a.scheduled_date).getTime() - new Date(b.scheduled_date).getTime())

          return {
            id: lead.id,
            phone_number: lead.phone_number,
            full_name: lead.full_name,
            product_interested: lead.product_interested,
            funnel_stage: lead.funnel_stage as FunnelStage,
            rag_status: lead.rag_status as RAGStatus,
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
            call_count: sortedCalls.length,
            call_history: sortedCalls.map((c) => ({
              called_at: c.called_at,
              call_outcome: c.call_outcome,
              call_notes: c.call_notes,
            })),
          }
        })

        setData(processed)
      } catch (err) {
        console.error("LeadsShell fetch failed:", err)
      } finally {
        setLoading(false)
      }
    })()
  }, [activeTelemarketer])

  // Realtime subscription — new and updated leads appear instantly
  useEffect(() => {
    if (!activeTelemarketer) return
    const supabase = createClient()

    const channel = supabase
      .channel(`leads-realtime-${activeTelemarketer.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "leads",
          filter: `assigned_to=eq.${activeTelemarketer.id}`,
        },
        (payload) => {
          const raw = payload.new as ProcessedLead
          const newLead: ProcessedLead = {
            id: raw.id,
            phone_number: raw.phone_number,
            full_name: raw.full_name,
            product_interested: raw.product_interested,
            funnel_stage: raw.funnel_stage,
            rag_status: raw.rag_status,
            lead_source: raw.lead_source,
            campaign_name: raw.campaign_name,
            location: raw.location,
            vehicle_type: raw.vehicle_type,
            whatsapp_message: raw.whatsapp_message,
            assigned_to: raw.assigned_to,
            created_at: raw.created_at,
            updated_at: raw.updated_at,
            last_called: null,
            next_followup: null,
            call_count: 0,
            call_history: [],
          }
          setData((prev) => [newLead, ...prev])
          toast.info(`New lead: ${newLead.full_name ?? newLead.phone_number}`, {
            description: "Arrived via WhatsApp",
            icon: <Wifi className="h-4 w-4" />,
          })
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "leads",
          filter: `assigned_to=eq.${activeTelemarketer.id}`,
        },
        (payload) => {
          const raw = payload.new as ProcessedLead
          setData((prev) =>
            prev.map((lead) =>
              lead.id === raw.id
                ? {
                    ...lead,
                    funnel_stage: raw.funnel_stage,
                    rag_status: raw.rag_status,
                    full_name: raw.full_name,
                    product_interested: raw.product_interested,
                    updated_at: raw.updated_at,
                  }
                : lead
            )
          )
        }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [activeTelemarketer])

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
        id: "contacted",
        accessorFn: (row) => (row.call_count > 0 ? "contacted" : "not"),
        header: "Contact",
        enableSorting: false,
        filterFn: "equals",
        cell: ({ row }) => {
          const lead = row.original
          if (lead.call_count === 0) {
            return <span className="text-xs text-slate-400 whitespace-nowrap">Not contacted</span>
          }
          return (
            <button
              type="button"
              onClick={() => setNotesLead(lead)}
              title="View call notes"
              className="inline-flex items-center gap-1.5 rounded-full border border-green-200 bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700 hover:bg-green-100 transition-colors whitespace-nowrap"
            >
              <CheckCircle2 className="h-3 w-3" />
              {lead.call_count} call{lead.call_count > 1 ? "s" : ""}
              <StickyNote className="h-3 w-3 opacity-70" />
            </button>
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
              onClick={() => setCallingLead(row.original)}
            >
              <Phone className="h-3 w-3" />
              Call Now
            </Button>
            <Button
              size="sm"
              variant="outline"
              title="WhatsApp Chat"
              className="h-7 w-7 p-0 text-green-600 border-green-200 hover:bg-green-50 hover:border-green-300"
              onClick={() => setChatLead(row.original)}
            >
              <MessageCircle className="h-3.5 w-3.5" />
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
    autoResetPageIndex: false,
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

  function handleCallSaved({ leadId, ragStatus, funnelStage, callOutcome, callNote, calledAt }: CallSavedPayload) {
    setData((prev) =>
      prev.map((lead) =>
        lead.id === leadId
          ? {
              ...lead,
              rag_status: ragStatus,
              funnel_stage: funnelStage,
              last_called: calledAt,
              call_count: lead.call_count + 1,
              call_history: [
                { called_at: calledAt, call_outcome: callOutcome, call_notes: callNote },
                ...lead.call_history,
              ],
            }
          : lead
      )
    )
  }

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

      <CallLogModal
        lead={callingLead}
        onClose={() => setCallingLead(null)}
        onSaved={handleCallSaved}
      />

      <ChatModal
        lead={chatLead}
        onClose={() => setChatLead(null)}
      />

      <LeadNotesDialog
        lead={notesLead}
        onClose={() => setNotesLead(null)}
      />
    </div>
  )
}
