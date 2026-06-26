"use client"

import { useEffect, useState } from "react"
import { CalendarCheck, Phone } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Button } from "@/components/ui/button"
import { createClient } from "@/lib/supabase/client"
import { Telemarketer, FunnelStage, RAGStatus } from "@/types/crm"
import { formatFollowUpDate } from "@/lib/utils/dateHelpers"
import { CallLogModal, type CallingLead } from "@/components/leads/CallLogModal"

interface Props {
  telemarketer: Telemarketer
}

interface FollowUpItem {
  id: string
  notes: string | null
  followup_type: string
  scheduled_date: string
  lead: {
    id: string
    full_name: string | null
    phone_number: string
    product_interested: string | null
    funnel_stage: string
  } | null
}

export function FollowUpToday({ telemarketer }: Props) {
  const [items, setItems] = useState<FollowUpItem[]>([])
  const [loading, setLoading] = useState(true)
  const [callingLead, setCallingLead] = useState<CallingLead | null>(null)

  useEffect(() => {
    const supabase = createClient()
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0)
    const tomorrowStart = new Date(todayStart); tomorrowStart.setDate(tomorrowStart.getDate() + 1)

    ;(async () => {
      try {
        const { data, error } = await supabase
          .from("followup_schedule")
          .select("id, notes, followup_type, scheduled_date, lead:leads(id, full_name, phone_number, product_interested, funnel_stage)")
          .eq("telemarketer_id", telemarketer.id)
          .gte("scheduled_date", todayStart.toISOString())
          .lt("scheduled_date", tomorrowStart.toISOString())
          .eq("status", "pending")
          .order("scheduled_date", { ascending: true })
        if (error) console.error("FollowUpToday fetch error:", error)
        setItems((data as unknown as FollowUpItem[]) ?? [])
      } catch (err) {
        console.error("FollowUpToday fetch failed:", err)
      } finally {
        setLoading(false)
      }
    })()
  }, [telemarketer.id])

  return (
    <>
    <Card className="border border-slate-200 shadow-none h-full">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold text-slate-700 flex items-center gap-2">
          <CalendarCheck className="h-4 w-4 text-amber-500" />
          Follow-ups Due Today
          {!loading && (
            <Badge variant="secondary" className="ml-auto text-xs">
              {items.length}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {loading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 p-3 rounded-lg border border-slate-100">
              <Skeleton className="h-8 w-8 rounded-full shrink-0" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-3.5 w-32" />
                <Skeleton className="h-3 w-48" />
              </div>
              <Skeleton className="h-8 w-20" />
            </div>
          ))
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <CalendarCheck className="h-8 w-8 text-slate-300 mb-2" />
            <p className="text-sm text-slate-500">No follow-ups due today</p>
            <p className="text-xs text-slate-400 mt-0.5">Enjoy the clear schedule!</p>
          </div>
        ) : (
          items.map((item) => (
            <div key={item.id} className="flex items-center gap-3 p-3 rounded-lg border border-slate-100 hover:border-slate-200 hover:bg-slate-50 transition-colors">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-100 text-blue-700 text-xs font-bold shrink-0">
                {(item.lead?.full_name ?? item.lead?.phone_number ?? "?")[0].toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-800 truncate">
                  {item.lead?.full_name ?? item.lead?.phone_number}
                </p>
                <p className="text-xs text-slate-500 truncate">
                  {formatFollowUpDate(item.scheduled_date)} &middot; {item.notes ?? item.lead?.product_interested ?? "No notes"}
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="shrink-0 gap-1.5 text-xs h-8"
                onClick={() => item.lead && setCallingLead({
                  id: item.lead.id,
                  phone_number: item.lead.phone_number,
                  full_name: item.lead.full_name,
                  product_interested: item.lead.product_interested,
                  funnel_stage: item.lead.funnel_stage as FunnelStage,
                  rag_status: "amber" as RAGStatus,
                })}
              >
                <Phone className="h-3 w-3" />
                Call Now
              </Button>
            </div>
          ))
        )}
      </CardContent>
    </Card>

    <CallLogModal
      lead={callingLead}
      onClose={() => setCallingLead(null)}
      onSaved={() => setCallingLead(null)}
    />
    </>
  )
}
