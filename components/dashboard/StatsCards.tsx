"use client"

import { useEffect, useState } from "react"
import { Phone, PhoneCall, CalendarClock, TrendingUp } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { createClient } from "@/lib/supabase/client"
import { Telemarketer } from "@/types/crm"
import { format, startOfMonth } from "date-fns"

interface Props {
  telemarketer: Telemarketer
}

interface Stats {
  totalLeads: number
  callsToday: number
  followupsDue: number
  salesThisMonth: number
}

export function StatsCards({ telemarketer }: Props) {
  const [stats, setStats] = useState<Stats | null>(null)

  useEffect(() => {
    const supabase = createClient()
    const today = format(new Date(), "yyyy-MM-dd")
    const monthStart = format(startOfMonth(new Date()), "yyyy-MM-dd")
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0)

    Promise.all([
      supabase
        .from("leads")
        .select("*", { count: "exact", head: true })
        .eq("assigned_to", telemarketer.id),
      supabase
        .from("call_logs")
        .select("*", { count: "exact", head: true })
        .eq("telemarketer_id", telemarketer.id)
        .gte("called_at", todayStart.toISOString()),
      supabase
        .from("followup_schedule")
        .select("*", { count: "exact", head: true })
        .eq("telemarketer_id", telemarketer.id)
        .eq("scheduled_date", today)
        .eq("status", "pending"),
      supabase
        .from("sales")
        .select("*", { count: "exact", head: true })
        .eq("telemarketer_id", telemarketer.id)
        .gte("sale_date", monthStart),
    ]).then(([leads, calls, followups, sales]) => {
      setStats({
        totalLeads: leads.count ?? 0,
        callsToday: calls.count ?? 0,
        followupsDue: followups.count ?? 0,
        salesThisMonth: sales.count ?? 0,
      })
    }).catch((err) => {
      console.error("StatsCards fetch failed:", err)
      setStats({ totalLeads: 0, callsToday: 0, followupsDue: 0, salesThisMonth: 0 })
    })
  }, [telemarketer.id])

  const cards = [
    {
      label: "Total Leads",
      value: stats?.totalLeads,
      icon: Phone,
      color: "bg-blue-50 text-blue-600",
    },
    {
      label: "Calls Today",
      value: stats?.callsToday,
      icon: PhoneCall,
      color: "bg-green-50 text-green-600",
    },
    {
      label: "Follow-ups Due",
      value: stats?.followupsDue,
      icon: CalendarClock,
      color: "bg-amber-50 text-amber-600",
    },
    {
      label: "Sales This Month",
      value: stats?.salesThisMonth,
      icon: TrendingUp,
      color: "bg-purple-50 text-purple-600",
    },
  ]

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {cards.map(({ label, value, icon: Icon, color }) => (
        <Card key={label} className="border border-slate-200 shadow-none">
          <CardContent className="p-4 lg:p-5">
            <div className={`inline-flex h-9 w-9 items-center justify-center rounded-lg ${color} mb-3`}>
              <Icon className="h-4 w-4" />
            </div>
            {value === undefined ? (
              <Skeleton className="h-8 w-16 mb-1" />
            ) : (
              <p className="text-2xl font-bold text-slate-900">{value}</p>
            )}
            <p className="text-xs text-slate-500 mt-0.5">{label}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
