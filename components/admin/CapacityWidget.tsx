"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import { createClient } from "@/lib/supabase/client"
import { TrendingUp, TrendingDown, ArrowDownToLine, PhoneCall, Layers } from "lucide-react"
import { format, subDays, startOfDay, eachDayOfInterval } from "date-fns"
import { cn } from "@/lib/utils"

const WINDOW_DAYS = 14

interface DayBucket {
  date: string      // yyyy-MM-dd
  label: string     // d MMM
  short: string     // day-of-month
  inflow: number
  calls: number
}

interface RepRow {
  id: string
  name: string
  inflow: number    // new leads in window
  calls: number     // calls logged in window
  backlog: number   // never-contacted 'new' leads (all time)
}

interface Data {
  days: DayBucket[]
  reps: RepRow[]
  inflowAvg: number
  callsAvg: number
  gapPerDay: number
  backlogTotal: number
}

// Paginate past Supabase's 1000-row default cap so the backlog total is accurate.
async function fetchAllNewStageLeads(supabase: ReturnType<typeof createClient>) {
  const rows: { id: string; assigned_to: string | null }[] = []
  const page = 1000
  for (let from = 0; ; from += page) {
    const { data, error } = await supabase
      .from("leads")
      .select("id, assigned_to")
      .eq("funnel_stage", "new")
      .range(from, from + page - 1)
    if (error) { console.error("CapacityWidget new-stage fetch error:", error); break }
    rows.push(...((data ?? []) as { id: string; assigned_to: string | null }[]))
    if (!data || data.length < page) break
  }
  return rows
}

export function CapacityWidget() {
  const [data, setData] = useState<Data | null>(null)

  useEffect(() => {
    const supabase = createClient()
    const now = new Date()
    const windowStart = startOfDay(subDays(now, WINDOW_DAYS - 1))
    const windowStartISO = windowStart.toISOString()

    ;(async () => {
      try {
        const [tmRes, inflowRes, callsRes, newStageLeads, calledRes] = await Promise.all([
          supabase.from("telemarketers").select("id, full_name").eq("is_active", true).order("full_name"),
          supabase.from("leads").select("created_at, assigned_to").gte("created_at", windowStartISO),
          supabase.from("call_logs").select("called_at, telemarketer_id").gte("called_at", windowStartISO),
          fetchAllNewStageLeads(supabase),
          supabase.from("call_logs").select("lead_id"),
        ])

        const telemarketers = (tmRes.data ?? []) as { id: string; full_name: string }[]
        const inflow = (inflowRes.data ?? []) as { created_at: string; assigned_to: string | null }[]
        const calls = (callsRes.data ?? []) as { called_at: string; telemarketer_id: string }[]
        const calledSet = new Set(((calledRes.data ?? []) as { lead_id: string | null }[]).map((c) => c.lead_id))

        // Never-contacted 'new' leads = backlog
        const backlogLeads = newStageLeads.filter((l) => !calledSet.has(l.id))

        // Daily buckets across the window
        const dayList = eachDayOfInterval({ start: windowStart, end: startOfDay(now) })
        const days: DayBucket[] = dayList.map((d) => {
          const key = format(d, "yyyy-MM-dd")
          return {
            date: key,
            label: format(d, "d MMM"),
            short: format(d, "d"),
            inflow: inflow.filter((l) => l.created_at.slice(0, 10) === key).length,
            calls: calls.filter((c) => c.called_at.slice(0, 10) === key).length,
          }
        })

        // Per-rep breakdown
        const reps: RepRow[] = telemarketers.map((tm) => ({
          id: tm.id,
          name: tm.full_name,
          inflow: inflow.filter((l) => l.assigned_to === tm.id).length,
          calls: calls.filter((c) => c.telemarketer_id === tm.id).length,
          backlog: backlogLeads.filter((l) => l.assigned_to === tm.id).length,
        }))

        const totalInflow = inflow.length
        const totalCalls = calls.length

        setData({
          days,
          reps,
          inflowAvg: totalInflow / WINDOW_DAYS,
          callsAvg: totalCalls / WINDOW_DAYS,
          gapPerDay: (totalInflow - totalCalls) / WINDOW_DAYS,
          backlogTotal: backlogLeads.length,
        })
      } catch (err) {
        console.error("CapacityWidget fetch failed:", err)
      }
    })()
  }, [])

  if (!data) {
    return (
      <Card className="border border-slate-200 shadow-none">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold text-slate-700">Team Capacity</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
          </div>
          <Skeleton className="h-40 rounded-xl" />
        </CardContent>
      </Card>
    )
  }

  const maxBar = Math.max(1, ...data.days.flatMap((d) => [d.inflow, d.calls]))
  const underwater = data.gapPerDay > 0

  const cards = [
    { label: "New leads / day", value: data.inflowAvg.toFixed(1), sub: `${WINDOW_DAYS}-day avg`, icon: ArrowDownToLine, tone: "text-blue-600" },
    { label: "Calls made / day", value: data.callsAvg.toFixed(1), sub: `${WINDOW_DAYS}-day avg`, icon: PhoneCall, tone: "text-green-600" },
    {
      label: underwater ? "Falling behind / day" : "Net headroom / day",
      value: (underwater ? "+" : "") + data.gapPerDay.toFixed(1),
      sub: underwater ? "more in than worked" : "keeping pace",
      icon: underwater ? TrendingUp : TrendingDown,
      tone: underwater ? "text-red-600" : "text-green-600",
    },
    { label: "Backlog (never contacted)", value: String(data.backlogTotal), sub: "new leads, 0 calls", icon: Layers, tone: "text-amber-600" },
  ]

  return (
    <Card className="border border-slate-200 shadow-none">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold text-slate-700">Team Capacity</CardTitle>
        <p className="text-xs text-slate-400">
          Inbound WhatsApp leads vs. calls actually made — last {WINDOW_DAYS} days. If new leads outpace calls, the backlog grows.
        </p>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Summary cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {cards.map(({ label, value, sub, icon: Icon, tone }) => (
            <div key={label} className="rounded-xl border border-slate-200 bg-white p-3">
              <div className="flex items-center justify-between">
                <p className="text-xs text-slate-500">{label}</p>
                <Icon className={cn("h-4 w-4", tone)} />
              </div>
              <p className={cn("text-2xl font-bold tabular-nums mt-1", tone)}>{value}</p>
              <p className="text-[11px] text-slate-400">{sub}</p>
            </div>
          ))}
        </div>

        {/* Callout */}
        {underwater && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            <span className="font-semibold">Underwater:</span> ~{data.gapPerDay.toFixed(0)} more leads arrive each day than the team calls
            {data.callsAvg > 0 && <> ({(data.inflowAvg / data.callsAvg).toFixed(1)}× inflow vs. throughput)</>}.
            The never-contacted pile grows until call volume rises.
          </div>
        )}

        {/* Daily trend */}
        <div>
          <div className="flex items-center gap-4 mb-2">
            <span className="flex items-center gap-1.5 text-xs text-slate-500"><span className="h-2.5 w-2.5 rounded-sm bg-blue-500" /> New leads</span>
            <span className="flex items-center gap-1.5 text-xs text-slate-500"><span className="h-2.5 w-2.5 rounded-sm bg-green-500" /> Calls made</span>
          </div>
          <div className="flex items-end gap-1.5 h-36 rounded-xl border border-slate-200 bg-slate-50/50 px-3 pt-3 pb-1 overflow-x-auto">
            {data.days.map((d) => (
              <div key={d.date} className="flex flex-col items-center justify-end gap-1 flex-1 min-w-[16px] h-full group">
                <div className="flex items-end gap-0.5 h-full w-full justify-center">
                  <div
                    className="w-1/2 max-w-[10px] rounded-t-sm bg-blue-500 transition-all"
                    style={{ height: `${(d.inflow / maxBar) * 100}%` }}
                    title={`${d.label}: ${d.inflow} new leads`}
                  />
                  <div
                    className="w-1/2 max-w-[10px] rounded-t-sm bg-green-500 transition-all"
                    style={{ height: `${(d.calls / maxBar) * 100}%` }}
                    title={`${d.label}: ${d.calls} calls`}
                  />
                </div>
                <span className="text-[9px] text-slate-400 tabular-nums">{d.short}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Per-rep table */}
        <div className="rounded-xl border border-slate-200 overflow-hidden bg-white">
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50 hover:bg-slate-50">
                {["Telemarketer", `New (${WINDOW_DAYS}d)`, `Calls (${WINDOW_DAYS}d)`, "Backlog", "Pace"].map((h) => (
                  <TableHead key={h} className="text-xs font-semibold text-slate-500 uppercase tracking-wide py-3 whitespace-nowrap">
                    {h}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.reps.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-20 text-center text-slate-400 text-sm">No telemarketers found</TableCell>
                </TableRow>
              ) : (
                <>
                  {data.reps.map((r) => {
                    const behind = r.inflow > r.calls
                    return (
                      <TableRow key={r.id} className="hover:bg-slate-50">
                        <TableCell className="font-semibold text-slate-800">{r.name}</TableCell>
                        <TableCell className="text-blue-700 tabular-nums">{r.inflow}</TableCell>
                        <TableCell className="text-green-700 tabular-nums">{r.calls}</TableCell>
                        <TableCell className={cn("tabular-nums font-medium", r.backlog > 0 ? "text-amber-600" : "text-slate-500")}>{r.backlog}</TableCell>
                        <TableCell>
                          <span className={cn(
                            "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
                            behind ? "bg-red-50 text-red-600" : "bg-green-50 text-green-600"
                          )}>
                            {behind ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                            {behind ? `−${r.inflow - r.calls} behind` : "keeping pace"}
                          </span>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                  <TableRow className="bg-slate-50 border-t-2 border-slate-200">
                    <TableCell className="font-bold text-slate-700 text-xs uppercase tracking-wide">Team</TableCell>
                    <TableCell className="font-bold text-blue-700 tabular-nums">{data.reps.reduce((a, r) => a + r.inflow, 0)}</TableCell>
                    <TableCell className="font-bold text-green-700 tabular-nums">{data.reps.reduce((a, r) => a + r.calls, 0)}</TableCell>
                    <TableCell className="font-bold text-amber-600 tabular-nums">{data.backlogTotal}</TableCell>
                    <TableCell />
                  </TableRow>
                </>
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  )
}
