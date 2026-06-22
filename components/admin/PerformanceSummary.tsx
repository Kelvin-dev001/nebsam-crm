"use client"

import { useEffect, useState } from "react"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import { createClient } from "@/lib/supabase/client"
import { format, startOfMonth, endOfMonth } from "date-fns"

interface TelemarketerStats {
  id: string
  full_name: string
  total_leads: number
  calls_this_month: number
  won: number
  green: number
  amber: number
  red: number
}

export function PerformanceSummary() {
  const [stats, setStats] = useState<TelemarketerStats[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const supabase = createClient()
    const now = new Date()
    const monthStart = format(startOfMonth(now), "yyyy-MM-dd")
    const monthEnd = format(endOfMonth(now), "yyyy-MM-dd")

    Promise.all([
      supabase.from("telemarketers").select("id, full_name").eq("is_active", true).order("full_name"),
      supabase.from("leads").select("assigned_to, funnel_stage, rag_status"),
      supabase
        .from("call_logs")
        .select("telemarketer_id")
        .gte("called_at", monthStart)
        .lte("called_at", monthEnd + "T23:59:59"),
    ]).then(([tmResult, leadsResult, callsResult]) => {
      const telemarketers = (tmResult.data ?? []) as { id: string; full_name: string }[]
      const leads = (leadsResult.data ?? []) as { assigned_to: string | null; funnel_stage: string; rag_status: string }[]
      const calls = (callsResult.data ?? []) as { telemarketer_id: string }[]

      const result: TelemarketerStats[] = telemarketers.map((tm) => {
        const tmLeads = leads.filter((l) => l.assigned_to === tm.id)
        const tmCalls = calls.filter((c) => c.telemarketer_id === tm.id)
        return {
          id: tm.id,
          full_name: tm.full_name,
          total_leads: tmLeads.length,
          calls_this_month: tmCalls.length,
          won: tmLeads.filter((l) => ["won", "installed", "post_sale", "renewal_due", "renewed"].includes(l.funnel_stage)).length,
          green: tmLeads.filter((l) => l.rag_status === "green").length,
          amber: tmLeads.filter((l) => l.rag_status === "amber").length,
          red: tmLeads.filter((l) => l.rag_status === "red").length,
        }
      })

      setStats(result)
      setLoading(false)
    })
  }, [])

  const month = format(new Date(), "MMMM yyyy")

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-400">Calls counted for {month}. Won = stages won through renewed.</p>
      <div className="rounded-xl border border-slate-200 overflow-hidden bg-white">
        <Table>
          <TableHeader>
            <TableRow className="bg-slate-50 hover:bg-slate-50">
              {[
                "Telemarketer",
                "Total Leads",
                `Calls (${format(new Date(), "MMM")})`,
                "Won",
                "🟢 Green",
                "🟡 Amber",
                "🔴 Red",
                "Win Rate",
              ].map((h) => (
                <TableHead key={h} className="text-xs font-semibold text-slate-500 uppercase tracking-wide py-3 whitespace-nowrap">
                  {h}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 8 }).map((_, j) => (
                    <TableCell key={j}><Skeleton className="h-4 w-16" /></TableCell>
                  ))}
                </TableRow>
              ))
            ) : stats.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="h-24 text-center text-slate-400 text-sm">
                  No telemarketers found
                </TableCell>
              </TableRow>
            ) : (
              <>
                {stats.map((s) => {
                  const winRate = s.total_leads > 0 ? Math.round((s.won / s.total_leads) * 100) : 0
                  return (
                    <TableRow key={s.id} className="hover:bg-slate-50">
                      <TableCell className="font-semibold text-slate-800">{s.full_name}</TableCell>
                      <TableCell className="text-slate-700 tabular-nums">{s.total_leads}</TableCell>
                      <TableCell className="text-slate-700 tabular-nums">{s.calls_this_month}</TableCell>
                      <TableCell className="text-slate-700 tabular-nums font-medium">{s.won}</TableCell>
                      <TableCell className="text-green-700 tabular-nums">{s.green}</TableCell>
                      <TableCell className="text-amber-600 tabular-nums">{s.amber}</TableCell>
                      <TableCell className="text-red-600 tabular-nums">{s.red}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <div className="w-16 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                            <div
                              className="h-full rounded-full bg-green-500"
                              style={{ width: `${winRate}%` }}
                            />
                          </div>
                          <span className="text-xs text-slate-600 tabular-nums">{winRate}%</span>
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
                {/* Totals row */}
                {stats.length > 1 && (() => {
                  const totals = stats.reduce(
                    (acc, s) => ({
                      total_leads: acc.total_leads + s.total_leads,
                      calls_this_month: acc.calls_this_month + s.calls_this_month,
                      won: acc.won + s.won,
                      green: acc.green + s.green,
                      amber: acc.amber + s.amber,
                      red: acc.red + s.red,
                    }),
                    { total_leads: 0, calls_this_month: 0, won: 0, green: 0, amber: 0, red: 0 }
                  )
                  const totalWinRate = totals.total_leads > 0 ? Math.round((totals.won / totals.total_leads) * 100) : 0
                  return (
                    <TableRow className="bg-slate-50 border-t-2 border-slate-200">
                      <TableCell className="font-bold text-slate-700 text-xs uppercase tracking-wide">Total</TableCell>
                      <TableCell className="font-bold text-slate-800 tabular-nums">{totals.total_leads}</TableCell>
                      <TableCell className="font-bold text-slate-800 tabular-nums">{totals.calls_this_month}</TableCell>
                      <TableCell className="font-bold text-slate-800 tabular-nums">{totals.won}</TableCell>
                      <TableCell className="font-bold text-green-700 tabular-nums">{totals.green}</TableCell>
                      <TableCell className="font-bold text-amber-600 tabular-nums">{totals.amber}</TableCell>
                      <TableCell className="font-bold text-red-600 tabular-nums">{totals.red}</TableCell>
                      <TableCell>
                        <span className="text-sm font-bold text-slate-700">{totalWinRate}%</span>
                      </TableCell>
                    </TableRow>
                  )
                })()}
              </>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
