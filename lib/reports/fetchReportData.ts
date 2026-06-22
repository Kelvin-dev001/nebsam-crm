import { createClient } from "@/lib/supabase/client"
import { Telemarketer } from "@/types/crm"

export interface TelemarketerReport {
  id: string
  name: string
  totalLeads: number
  callsOnDate: number
  ragRed: number
  ragAmber: number
  ragGreen: number
  winsOnDate: number
  allTimeWins: number
  winRate: number   // (all-time wins / total leads) * 100, rounded to 1dp
  rank: number      // 1 / 2 / 3 — ranked by callsOnDate desc
}

export async function fetchReportData(
  telemarketers: Telemarketer[],
  date: string  // "yyyy-MM-dd"
): Promise<TelemarketerReport[]> {
  const supabase = createClient()

  const dateStart = new Date(date)
  dateStart.setHours(0, 0, 0, 0)
  const dateEnd = new Date(date)
  dateEnd.setHours(23, 59, 59, 999)

  const results = await Promise.all(
    telemarketers.map(async (t) => {
      const [leadsRes, callsRes, ragRes, winsRes, allWinsRes] = await Promise.all([
        // Total leads assigned (all time)
        supabase
          .from("leads")
          .select("*", { count: "exact", head: true })
          .eq("assigned_to", t.id),

        // Calls made on date
        supabase
          .from("call_logs")
          .select("*", { count: "exact", head: true })
          .eq("telemarketer_id", t.id)
          .gte("called_at", dateStart.toISOString())
          .lte("called_at", dateEnd.toISOString()),

        // RAG breakdown (full rows needed for grouping)
        supabase
          .from("leads")
          .select("rag_status")
          .eq("assigned_to", t.id),

        // Wins on date (by sale_date)
        supabase
          .from("sales")
          .select("*", { count: "exact", head: true })
          .eq("telemarketer_id", t.id)
          .eq("sale_date", date),

        // All-time wins (for win rate)
        supabase
          .from("sales")
          .select("*", { count: "exact", head: true })
          .eq("telemarketer_id", t.id),
      ])

      const totalLeads = leadsRes.count ?? 0
      const callsOnDate = callsRes.count ?? 0
      const winsOnDate = winsRes.count ?? 0
      const allTimeWins = allWinsRes.count ?? 0

      const ragRows = ragRes.data ?? []
      const ragRed = ragRows.filter((r) => r.rag_status === "red").length
      const ragAmber = ragRows.filter((r) => r.rag_status === "amber").length
      const ragGreen = ragRows.filter((r) => r.rag_status === "green").length

      const winRate =
        totalLeads > 0 ? Math.round((allTimeWins / totalLeads) * 1000) / 10 : 0

      return {
        id: t.id,
        name: t.full_name,
        totalLeads,
        callsOnDate,
        ragRed,
        ragAmber,
        ragGreen,
        winsOnDate,
        allTimeWins,
        winRate,
        rank: 0, // filled in below
      }
    })
  )

  // Rank by callsOnDate descending (ties share the same rank)
  const sorted = [...results].sort((a, b) => b.callsOnDate - a.callsOnDate)
  let currentRank = 1
  sorted.forEach((r, i) => {
    if (i > 0 && r.callsOnDate < sorted[i - 1].callsOnDate) currentRank = i + 1
    r.rank = currentRank
  })

  // Return in original telemarketer order
  return results.map((r) => {
    const ranked = sorted.find((s) => s.id === r.id)!
    return { ...r, rank: ranked.rank }
  })
}
