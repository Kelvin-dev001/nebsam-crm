"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { Phone, MessageCircle, Eye, Inbox, Users, RefreshCcw, Loader2, Flame } from "lucide-react"
import { Button, buttonVariants } from "@/components/ui/button"
import { useTelemarketerStore } from "@/lib/stores/telemarketerStore"
import { createClient } from "@/lib/supabase/client"
import { CallLogModal, type CallSavedPayload } from "@/components/leads/CallLogModal"
import { ChatModal } from "@/components/chat/ChatModal"
import type { ChatLead } from "@/components/chat/WhatsAppChat"
import { FunnelStage, RAGStatus } from "@/types/crm"
import { cn } from "@/lib/utils"
import { formatDate } from "@/lib/utils/dateHelpers"
import { toast } from "sonner"

// A never-contacted lead — satisfies both CallingLead and ChatLead.
interface BacklogLead {
  id: string
  phone_number: string
  full_name: string | null
  product_interested: string | null
  funnel_stage: FunnelStage
  rag_status: RAGStatus
  location: string | null
  vehicle_type: string | null
  whatsapp_message: string | null
  created_at: string
  age_days: number
}

// Days-old badge colour. 14+ days = already crossed the RAG age-gate (RED).
function ageStyle(days: number) {
  if (days >= 14) return { badge: "bg-red-50 text-red-700 border-red-200", label: `${days}d cold` }
  if (days >= 7) return { badge: "bg-amber-50 text-amber-700 border-amber-200", label: `${days}d old` }
  return { badge: "bg-slate-100 text-slate-600 border-slate-200", label: `${days}d old` }
}

export function BacklogShell() {
  const { activeTelemarketer } = useTelemarketerStore()
  const [data, setData] = useState<BacklogLead[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [callingLead, setCallingLead] = useState<BacklogLead | null>(null)
  const [chatLead, setChatLead] = useState<ChatLead | null>(null)

  async function load(isRefresh = false) {
    if (!activeTelemarketer) { setLoading(false); return }
    const supabase = createClient()
    if (isRefresh) setRefreshing(true)
    else setLoading(true)
    try {
      const { data: raw, error } = await supabase
        .from("leads")
        .select("id, phone_number, full_name, product_interested, funnel_stage, rag_status, location, vehicle_type, whatsapp_message, created_at, call_logs(id)")
        .eq("assigned_to", activeTelemarketer.id)
        .eq("funnel_stage", "new")
        .order("created_at", { ascending: true }) // oldest first
      if (error) { console.error("BacklogShell fetch error:", error); return }

      type Raw = BacklogLead & { call_logs: Array<{ id: string }> }
      const now = Date.now()
      const backlog: BacklogLead[] = (raw as unknown as Raw[])
        .filter((l) => (l.call_logs?.length ?? 0) === 0) // never called
        .map((l) => ({
          id: l.id,
          phone_number: l.phone_number,
          full_name: l.full_name,
          product_interested: l.product_interested,
          funnel_stage: l.funnel_stage as FunnelStage,
          rag_status: l.rag_status as RAGStatus,
          location: l.location,
          vehicle_type: l.vehicle_type,
          whatsapp_message: l.whatsapp_message,
          created_at: l.created_at,
          age_days: Math.max(0, Math.floor((now - new Date(l.created_at).getTime()) / 86_400_000)),
        }))

      setData(backlog)
    } catch (err) {
      console.error("BacklogShell fetch failed:", err)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load() }, [activeTelemarketer])

  const oldest = data[0]?.age_days ?? 0
  const coldCount = useMemo(() => data.filter((l) => l.age_days >= 14).length, [data])

  // A logged call means the lead is now contacted — remove it from the pile (burndown).
  function handleCallSaved({ leadId, full_name }: CallSavedPayload & { full_name?: string }) {
    setData((prev) => prev.filter((l) => l.id !== leadId))
    toast.success("Contacted — cleared from backlog", {
      description: full_name ?? undefined,
    })
  }

  if (!activeTelemarketer) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3 text-center p-6">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-slate-100">
          <Users className="h-7 w-7 text-slate-400" />
        </div>
        <h2 className="text-lg font-semibold text-slate-800">No telemarketer selected</h2>
        <p className="text-sm text-slate-500 max-w-xs">
          Use the switcher in the top-right corner to choose a telemarketer and view their backlog.
        </p>
      </div>
    )
  }

  return (
    <div className="p-4 lg:p-6 space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <Inbox className="h-6 w-6 text-slate-400" />
            Backlog
          </h1>
          <p className="text-slate-500 text-sm mt-0.5">
            {loading
              ? "Loading…"
              : data.length === 0
                ? "Nothing waiting — you're all caught up."
                : `${data.length} never-contacted lead${data.length > 1 ? "s" : ""}, oldest first. Work top to bottom.`}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => load(true)} disabled={refreshing} className="gap-2 shrink-0">
          {refreshing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCcw className="h-3.5 w-3.5" />}
          Refresh
        </Button>
      </div>

      {/* Summary strip */}
      {!loading && data.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-xl border border-slate-200 bg-white p-3">
            <p className="text-xs text-slate-500">Waiting</p>
            <p className="text-2xl font-bold text-slate-900 tabular-nums">{data.length}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-3">
            <p className="text-xs text-slate-500">Oldest</p>
            <p className="text-2xl font-bold text-slate-900 tabular-nums">{oldest}<span className="text-sm font-medium text-slate-400"> days</span></p>
          </div>
          <div className={cn("rounded-xl border p-3", coldCount > 0 ? "border-red-200 bg-red-50" : "border-slate-200 bg-white")}>
            <p className={cn("text-xs flex items-center gap-1", coldCount > 0 ? "text-red-600" : "text-slate-500")}>
              {coldCount > 0 && <Flame className="h-3 w-3" />}Cold (14d+)
            </p>
            <p className={cn("text-2xl font-bold tabular-nums", coldCount > 0 ? "text-red-700" : "text-slate-900")}>{coldCount}</p>
          </div>
        </div>
      )}

      {/* List */}
      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-[76px] rounded-xl border border-slate-200 bg-white animate-pulse" />
          ))}
        </div>
      ) : data.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-slate-200 bg-slate-50 py-16 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-green-100">
            <Inbox className="h-7 w-7 text-green-600" />
          </div>
          <h2 className="text-lg font-semibold text-slate-800">Inbox zero 🎉</h2>
          <p className="text-sm text-slate-500 max-w-xs">
            No never-contacted leads in your queue. New WhatsApp leads will appear here for first contact.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {data.map((lead, i) => {
            const age = ageStyle(lead.age_days)
            return (
              <div
                key={lead.id}
                className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 hover:border-slate-300 transition-colors"
              >
                {/* Position */}
                <span className="hidden sm:flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-500 tabular-nums">
                  {i + 1}
                </span>

                {/* Identity */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-slate-800">
                      {lead.full_name ?? <span className="italic text-slate-400 font-normal">Unknown</span>}
                    </span>
                    <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-medium whitespace-nowrap", age.badge)}>
                      {age.label}
                    </span>
                    {lead.product_interested && (
                      <span className="rounded-full bg-blue-50 text-blue-700 border border-blue-100 px-2 py-0.5 text-[10px] font-medium">
                        {lead.product_interested}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="font-mono text-xs text-slate-500">{lead.phone_number}</span>
                    <span className="text-xs text-slate-300">·</span>
                    <span className="text-xs text-slate-400">in {formatDate(lead.created_at)}</span>
                  </div>
                  {lead.whatsapp_message && (
                    <p className="mt-1 text-xs text-slate-500 italic line-clamp-1 border-l-2 border-[#25D366] pl-2">
                      {lead.whatsapp_message}
                    </p>
                  )}
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1.5 shrink-0 ml-auto">
                  <Button
                    size="sm"
                    className="h-8 px-3 text-xs gap-1.5 bg-blue-600 hover:bg-blue-700"
                    onClick={() => setCallingLead(lead)}
                  >
                    <Phone className="h-3.5 w-3.5" />
                    Call
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    title="WhatsApp Chat"
                    className="h-8 w-8 p-0 text-green-600 border-green-200 hover:bg-green-50 hover:border-green-300"
                    onClick={() => setChatLead(lead)}
                  >
                    <MessageCircle className="h-4 w-4" />
                  </Button>
                  <Link
                    href={`/leads/${lead.id}`}
                    title="View profile"
                    className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "h-8 w-8 p-0")}
                  >
                    <Eye className="h-4 w-4" />
                  </Link>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <CallLogModal
        lead={callingLead}
        onClose={() => setCallingLead(null)}
        onSaved={(payload) => handleCallSaved({ ...payload, full_name: callingLead?.full_name ?? undefined })}
      />

      <ChatModal lead={chatLead} onClose={() => setChatLead(null)} />
    </div>
  )
}
