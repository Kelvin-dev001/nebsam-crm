"use client"

import { useEffect, useState } from "react"
import { FileDown, FileBarChart, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { createClient } from "@/lib/supabase/client"
import { fetchReportData, TelemarketerReport } from "@/lib/reports/fetchReportData"
import { downloadReport } from "@/lib/reports/generatePDF"
import { Telemarketer } from "@/types/crm"
import { format } from "date-fns"
import { toast } from "sonner"

const ALL = "__all__"

function RAGDot({ color }: { color: "green" | "amber" | "red" }) {
  const cls = {
    green: "bg-green-500",
    amber: "bg-amber-500",
    red: "bg-red-500",
  }[color]
  return <span className={`inline-block h-2 w-2 rounded-full ${cls} mr-1`} />
}

export function ReportsTab() {
  const [telemarketers, setTelemarketers] = useState<Telemarketer[]>([])
  const [selectedId, setSelectedId] = useState<string>(ALL)
  const [date, setDate] = useState(format(new Date(), "yyyy-MM-dd"))
  const [reports, setReports] = useState<TelemarketerReport[]>([])
  const [loadingData, setLoadingData] = useState(false)
  const [downloadingOne, setDownloadingOne] = useState(false)
  const [downloadingAll, setDownloadingAll] = useState(false)

  // Load telemarketer list
  useEffect(() => {
    createClient()
      .from("telemarketers")
      .select("*")
      .eq("is_active", true)
      .order("created_at")
      .then(({ data }) => {
        if (data) setTelemarketers(data as Telemarketer[])
      })
  }, [])

  // Fetch preview data whenever selection or date changes
  useEffect(() => {
    if (telemarketers.length === 0) return
    const targets =
      selectedId === ALL
        ? telemarketers
        : telemarketers.filter((t) => t.id === selectedId)

    setLoadingData(true)
    fetchReportData(targets, date)
      .then(setReports)
      .finally(() => setLoadingData(false))
  }, [selectedId, date, telemarketers])

  async function handleDownloadOne() {
    if (reports.length === 0) return
    setDownloadingOne(true)
    try {
      const report = reports[0]
      const name = report.name.replace(/\s+/g, "_")
      await downloadReport(reports.slice(0, 1), date, `Nebsam_Report_${name}_${date}.pdf`)
      toast.success("Report downloaded")
    } catch {
      toast.error("Failed to generate PDF")
    } finally {
      setDownloadingOne(false)
    }
  }

  async function handleDownloadAll() {
    if (telemarketers.length === 0) return
    setDownloadingAll(true)
    try {
      const all = await fetchReportData(telemarketers, date)
      await downloadReport(all, date, `Nebsam_Report_All_${date}.pdf`)
      toast.success("All reports downloaded")
    } catch {
      toast.error("Failed to generate PDF")
    } finally {
      setDownloadingAll(false)
    }
  }

  return (
    <div className="space-y-5">
      {/* Controls */}
      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
        <div className="space-y-1">
          <label className="text-xs font-medium text-slate-600 block">Telemarketer</label>
          <select
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value)}
            className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value={ALL}>All Telemarketers</option>
            {telemarketers.map((t) => (
              <option key={t.id} value={t.id}>{t.full_name}</option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-slate-600 block">Date</label>
          <input
            type="date"
            value={date}
            max={format(new Date(), "yyyy-MM-dd")}
            onChange={(e) => setDate(e.target.value)}
            className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div className="flex gap-2 ml-auto">
          {selectedId !== ALL && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleDownloadOne}
              disabled={downloadingOne || loadingData || reports.length === 0}
              className="gap-1.5"
            >
              {downloadingOne ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <FileBarChart className="h-3.5 w-3.5" />
              )}
              Generate PDF
            </Button>
          )}

          <Button
            size="sm"
            onClick={handleDownloadAll}
            disabled={downloadingAll || loadingData}
            className="gap-1.5"
          >
            {downloadingAll ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <FileDown className="h-3.5 w-3.5" />
            )}
            Download All Reports
          </Button>
        </div>
      </div>

      {/* Preview table */}
      {loadingData ? (
        <div className="flex items-center gap-2 py-8 justify-center text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading data…
        </div>
      ) : reports.length === 0 ? (
        <p className="py-8 text-center text-sm text-slate-500">No data for selected date.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-500">Telemarketer</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-slate-500">Total Leads</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-slate-500">Calls on Date</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-slate-500">Wins on Date</th>
                <th className="px-4 py-3 text-center text-xs font-medium text-slate-500">RAG</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-slate-500">Win Rate</th>
                <th className="px-4 py-3 text-center text-xs font-medium text-slate-500">Rank</th>
              </tr>
            </thead>
            <tbody>
              {reports.map((r) => (
                <tr key={r.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-800">{r.name}</td>
                  <td className="px-4 py-3 text-right text-slate-700">{r.totalLeads}</td>
                  <td className="px-4 py-3 text-right text-slate-700">{r.callsOnDate}</td>
                  <td className="px-4 py-3 text-right text-slate-700">{r.winsOnDate}</td>
                  <td className="px-4 py-3 text-center">
                    <span className="inline-flex items-center gap-2 text-xs">
                      <span className="text-green-600"><RAGDot color="green" />{r.ragGreen}</span>
                      <span className="text-amber-600"><RAGDot color="amber" />{r.ragAmber}</span>
                      <span className="text-red-600"><RAGDot color="red" />{r.ragRed}</span>
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span
                      className={`font-medium ${
                        r.winRate >= 20
                          ? "text-green-600"
                          : r.winRate >= 10
                          ? "text-amber-600"
                          : "text-red-600"
                      }`}
                    >
                      {r.winRate}%
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={`text-xs font-bold ${r.rank === 1 ? "text-yellow-600" : r.rank === 2 ? "text-slate-500" : "text-amber-800"}`}>
                      {r.rank === 1 ? "🥇" : r.rank === 2 ? "🥈" : "🥉"} #{r.rank}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-slate-400">
        Win Rate = all-time wins ÷ total leads assigned × 100. Rank = by calls made on selected date.
      </p>
    </div>
  )
}
