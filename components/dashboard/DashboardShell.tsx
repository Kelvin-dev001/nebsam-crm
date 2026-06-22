"use client"

import { useState } from "react"
import { useTelemarketerStore } from "@/lib/stores/telemarketerStore"
import { StatsCards } from "./StatsCards"
import { FollowUpToday } from "./FollowUpToday"
import { RAGSummary } from "./RAGSummary"
import { RecentActivity } from "./RecentActivity"
import { UpcomingRenewals } from "./UpcomingRenewals"
import { Users, FileDown, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { fetchReportData } from "@/lib/reports/fetchReportData"
import { downloadReport } from "@/lib/reports/generatePDF"
import { format } from "date-fns"
import { toast } from "sonner"
import type { Telemarketer } from "@/types/crm"

function getGreeting() {
  const h = new Date().getHours()
  if (h < 12) return "Good morning"
  if (h < 17) return "Good afternoon"
  return "Good evening"
}

function DownloadReportButton({ telemarketer }: { telemarketer: Telemarketer }) {
  const [loading, setLoading] = useState(false)

  async function handleDownload() {
    setLoading(true)
    try {
      const today = format(new Date(), "yyyy-MM-dd")
      const reports = await fetchReportData([telemarketer], today)
      const filename = `Nebsam_Report_${telemarketer.full_name}_${today}.pdf`
      await downloadReport(reports, today, filename)
      toast.success("Report downloaded")
    } catch {
      toast.error("Failed to generate report")
    } finally {
      setLoading(false)
    }
  }

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleDownload}
      disabled={loading}
      className="gap-2 shrink-0"
    >
      {loading ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <FileDown className="h-3.5 w-3.5" />
      )}
      {loading ? "Generating…" : "Download My Report"}
    </Button>
  )
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
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">
            {getGreeting()}, {activeTelemarketer.full_name}
          </h1>
          <p className="text-slate-500 text-sm mt-0.5">Here&apos;s what&apos;s happening today.</p>
        </div>
        <DownloadReportButton telemarketer={activeTelemarketer} />
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
