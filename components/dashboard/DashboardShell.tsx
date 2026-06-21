"use client"

import { useTelemarketerStore } from "@/lib/stores/telemarketerStore"
import { StatsCards } from "./StatsCards"
import { FollowUpToday } from "./FollowUpToday"
import { RAGSummary } from "./RAGSummary"
import { RecentActivity } from "./RecentActivity"
import { UpcomingRenewals } from "./UpcomingRenewals"
import { Users } from "lucide-react"

function getGreeting() {
  const h = new Date().getHours()
  if (h < 12) return "Good morning"
  if (h < 17) return "Good afternoon"
  return "Good evening"
}

export function DashboardShell() {
  const { activeTelemarketer } = useTelemarketerStore()

  if (!activeTelemarketer) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3 text-center p-6">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-slate-100">
          <Users className="h-7 w-7 text-slate-400" />
        </div>
        <h2 className="text-lg font-semibold text-slate-800">No telemarketer selected</h2>
        <p className="text-sm text-slate-500 max-w-xs">
          Use the switcher in the top-right corner to choose a telemarketer and load the dashboard.
        </p>
      </div>
    )
  }

  return (
    <div className="p-4 lg:p-6 space-y-6">
      {/* Greeting */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900">
          {getGreeting()}, {activeTelemarketer.full_name}
        </h1>
        <p className="text-slate-500 text-sm mt-0.5">Here&apos;s what&apos;s happening today.</p>
      </div>

      {/* Stats row */}
      <StatsCards telemarketer={activeTelemarketer} />

      {/* Follow-ups + RAG */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <FollowUpToday telemarketer={activeTelemarketer} />
        </div>
        <div>
          <RAGSummary telemarketer={activeTelemarketer} />
        </div>
      </div>

      {/* Recent activity + Upcoming renewals */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <RecentActivity telemarketer={activeTelemarketer} />
        <UpcomingRenewals telemarketer={activeTelemarketer} />
      </div>
    </div>
  )
}
