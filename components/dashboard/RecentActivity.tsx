"use client"

import { useEffect, useState } from "react"
import { Activity } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { createClient } from "@/lib/supabase/client"
import { Telemarketer } from "@/types/crm"
import { formatRelative } from "@/lib/utils/dateHelpers"

interface Props {
  telemarketer: Telemarketer
}

interface ActivityItem {
  id: string
  called_at: string
  call_outcome: string
  call_notes: string | null
  duration_seconds: number | null
  lead: { full_name: string | null; phone_number: string } | null
}

const OUTCOME_STYLE: Record<string, { label: string; className: string }> = {
  answered:           { label: "Answered",           className: "bg-green-100 text-green-700 border-green-200" },
  no_answer:          { label: "No Answer",          className: "bg-slate-100 text-slate-600 border-slate-200" },
  busy:               { label: "Busy",               className: "bg-amber-100 text-amber-700 border-amber-200" },
  callback_requested: { label: "Callback",           className: "bg-blue-100 text-blue-700 border-blue-200" },
  wrong_number:       { label: "Wrong Number",       className: "bg-red-100 text-red-700 border-red-200" },
}

function formatDuration(seconds: number | null): string {
  if (!seconds) return ""
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}m ${s}s`
}

export function RecentActivity({ telemarketer }: Props) {
  const [items, setItems] = useState<ActivityItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const supabase = createClient()

    ;(async () => {
      try {
        const { data, error } = await supabase
          .from("call_logs")
          .select("id, called_at, call_outcome, call_notes, duration_seconds, lead:leads(full_name, phone_number)")
          .eq("telemarketer_id", telemarketer.id)
          .order("called_at", { ascending: false })
          .limit(5)
        if (error) console.error("RecentActivity fetch error:", error)
        setItems((data as unknown as ActivityItem[]) ?? [])
      } catch (err) {
        console.error("RecentActivity fetch failed:", err)
      } finally {
        setLoading(false)
      }
    })()
  }, [telemarketer.id])

  return (
    <Card className="border border-slate-200 shadow-none">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold text-slate-700 flex items-center gap-2">
          <Activity className="h-4 w-4 text-blue-500" />
          Recent Activity
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex gap-3 items-start">
              <Skeleton className="h-8 w-8 rounded-full shrink-0 mt-0.5" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-3.5 w-28" />
                <Skeleton className="h-3 w-48" />
              </div>
              <Skeleton className="h-5 w-16" />
            </div>
          ))
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <Activity className="h-8 w-8 text-slate-300 mb-2" />
            <p className="text-sm text-slate-500">No calls logged yet today</p>
          </div>
        ) : (
          items.map((item) => {
            const outcome = OUTCOME_STYLE[item.call_outcome] ?? { label: item.call_outcome, className: "bg-slate-100 text-slate-600 border-slate-200" }
            return (
              <div key={item.id} className="flex gap-3 items-start">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-600 text-xs font-bold shrink-0 mt-0.5">
                  {(item.lead?.full_name ?? item.lead?.phone_number ?? "?")[0].toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-medium text-slate-800">
                      {item.lead?.full_name ?? item.lead?.phone_number}
                    </p>
                    {item.duration_seconds ? (
                      <span className="text-xs text-slate-400">{formatDuration(item.duration_seconds)}</span>
                    ) : null}
                  </div>
                  {item.call_notes && (
                    <p className="text-xs text-slate-500 truncate mt-0.5">{item.call_notes}</p>
                  )}
                  <p className="text-xs text-slate-400 mt-0.5">{formatRelative(item.called_at)}</p>
                </div>
                <Badge variant="outline" className={`text-xs shrink-0 ${outcome.className}`}>
                  {outcome.label}
                </Badge>
              </div>
            )
          })
        )}
      </CardContent>
    </Card>
  )
}
