"use client"

import { useEffect, useState, useCallback } from "react"
import { ArrowRightLeft, RefreshCw, Loader2 } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { createClient } from "@/lib/supabase/client"
import { Telemarketer } from "@/types/crm"
import { toast } from "sonner"


interface TelemarketerStat {
  telemarketer: Telemarketer
  totalLeads: number
  todayLeads: number
  allTimeWins: number
  winRate: number
}

interface RoundRobinData {
  nextTelemarketer: Telemarketer | null
  stats: TelemarketerStat[]
}

export function RoundRobinWidget() {
  const [data, setData] = useState<RoundRobinData | null>(null)
  const [loading, setLoading] = useState(true)
  const [resetting, setResetting] = useState(false)
  const [rrDeptId, setRrDeptId] = useState<string | null>(null)
  const [orderedReps, setOrderedReps] = useState<Telemarketer[]>([])

  const load = useCallback(async () => {
    const supabase = createClient()
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0)

    // Round robin applies only to the department whose leads arrive from the
    // WhatsApp chatbot. The manual departments assign to whoever created the
    // lead, so rotating them would be meaningless — and round_robin_state now
    // has a row PER DEPARTMENT, so an unscoped .limit(1) would pick one at
    // random and show the wrong rep as "next up".
    const { data: rrDept } = await supabase
      .from("departments")
      .select("id")
      .eq("assignment_mode", "round_robin")
      .order("sort_order")
      .limit(1)
      .maybeSingle()

    const deptId = (rrDept as { id: string } | null)?.id ?? null
    setRrDeptId(deptId)
    const rrDeptId = deptId

    const [telemarketersRes, rrStateRes] = await Promise.all([
      (() => {
        let q = supabase.from("telemarketers").select("*").eq("is_active", true)
        if (rrDeptId) q = q.eq("department_id", rrDeptId)
        return q.order("created_at")
      })(),
      (() => {
        let q = supabase.from("round_robin_state").select("*")
        if (rrDeptId) q = q.eq("department_id", rrDeptId)
        return q.limit(1).maybeSingle()
      })(),
    ])

    const telemarketers: Telemarketer[] = telemarketersRes.data ?? []
    setOrderedReps(telemarketers)
    const lastAssigned = rrStateRes.data?.last_assigned_telemarketer_id ?? null

    // Determine next in cycle
    const lastIdx = telemarketers.findIndex((t) => t.id === lastAssigned)
    const nextIdx = lastIdx === -1 ? 0 : (lastIdx + 1) % telemarketers.length
    const nextTelemarketer = telemarketers[nextIdx] ?? null

    // Fetch per-telemarketer stats in parallel
    const stats = await Promise.all(
      telemarketers.map(async (t) => {
        const [totalRes, todayRes, winsRes] = await Promise.all([
          supabase
            .from("leads")
            .select("*", { count: "exact", head: true })
            .eq("assigned_to", t.id),
          supabase
            .from("leads")
            .select("*", { count: "exact", head: true })
            .eq("assigned_to", t.id)
            .gte("created_at", todayStart.toISOString()),
          supabase
            .from("sales")
            .select("*", { count: "exact", head: true })
            .eq("telemarketer_id", t.id),
        ])

        const totalLeads = totalRes.count ?? 0
        const todayLeads = todayRes.count ?? 0
        const allTimeWins = winsRes.count ?? 0
        const winRate =
          totalLeads > 0 ? Math.round((allTimeWins / totalLeads) * 1000) / 10 : 0

        return { telemarketer: t, totalLeads, todayLeads, allTimeWins, winRate }
      })
    )

    setData({ nextTelemarketer, stats })
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  async function handleReset() {
    // "Next lead goes to the first rep" means marking the LAST rep in the
    // rotation as most recently assigned. Derived from the live rep list rather
    // than a hardcoded seed UUID, which would be wrong in any database that was
    // not built from seed.sql.
    const first = orderedReps[0]
    const last = orderedReps[orderedReps.length - 1]
    if (!first || !last) {
      toast.error("No active reps in the round-robin department")
      return
    }
    if (!confirm(`Reset round robin order? The next lead will be assigned to ${first.full_name}.`)) return

    setResetting(true)
    const supabase = createClient()

    // Scoped to this department's row. The previous version updated EVERY row
    // in round_robin_state, which with per-department rows would stamp the
    // other departments with a rep who does not belong to them.
    let q = supabase
      .from("round_robin_state")
      .update({ last_assigned_telemarketer_id: last.id })
    q = rrDeptId ? q.eq("department_id", rrDeptId) : q.not("id", "is", null)
    const { error } = await q

    if (error) {
      toast.error("Reset failed: " + error.message)
    } else {
      toast.success(`Round robin reset — next lead goes to ${first.full_name}`)
      await load()
    }
    setResetting(false)
  }

  return (
    <Card className="border border-blue-200 bg-blue-50/40 shadow-none">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600 text-white">
              <ArrowRightLeft className="h-4 w-4" />
            </div>
            <CardTitle className="text-base text-slate-900">Round Robin Assignment</CardTitle>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleReset}
            disabled={resetting || loading}
            className="gap-1.5 text-xs h-8"
          >
            {resetting ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <RefreshCw className="h-3 w-3" />
            )}
            Reset Order
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading…
          </div>
        ) : (
          <>
            {/* Next assignee banner */}
            <div className="flex items-center gap-3 rounded-lg bg-white border border-blue-200 px-4 py-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-600 text-white text-sm font-bold shrink-0">
                {data?.nextTelemarketer?.full_name[0].toUpperCase() ?? "?"}
              </div>
              <div>
                <p className="text-xs text-slate-500 uppercase tracking-wide">Next lead assigned to</p>
                <p className="text-lg font-bold text-slate-900">
                  {data?.nextTelemarketer?.full_name ?? "—"}
                </p>
              </div>
            </div>

            {/* Stats table */}
            <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50">
                    <th className="px-3 py-2 text-left text-xs font-medium text-slate-500">Telemarketer</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-slate-500">Total Leads</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-slate-500">Today&apos;s Leads</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-slate-500">Win Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {data?.stats.map((s) => {
                    const isNext = s.telemarketer.id === data.nextTelemarketer?.id
                    return (
                      <tr
                        key={s.telemarketer.id}
                        className={`border-b border-slate-100 last:border-0 ${isNext ? "bg-blue-50" : ""}`}
                      >
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-2">
                            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-100 text-blue-700 text-xs font-bold shrink-0">
                              {s.telemarketer.full_name[0]}
                            </div>
                            <span className={`font-medium ${isNext ? "text-blue-700" : "text-slate-700"}`}>
                              {s.telemarketer.full_name}
                            </span>
                            {isNext && (
                              <span className="text-[10px] rounded-full bg-blue-600 text-white px-1.5 py-0.5 font-medium">
                                NEXT
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-right text-slate-700">{s.totalLeads}</td>
                        <td className="px-3 py-2.5 text-right text-slate-700">{s.todayLeads}</td>
                        <td className="px-3 py-2.5 text-right">
                          <span
                            className={`font-medium ${
                              s.winRate >= 20
                                ? "text-green-600"
                                : s.winRate >= 10
                                ? "text-amber-600"
                                : "text-red-600"
                            }`}
                          >
                            {s.winRate}%
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
