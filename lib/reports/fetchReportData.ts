import { createClient } from "@/lib/supabase/client"
import { Telemarketer } from "@/types/crm"

export interface TelemarketerReport {
  id: string
  name: string
  /** The rep's department, so a report can be grouped and headed by it. */
  departmentId: string | null
  departmentName: string | null
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
  date: string,  // "yyyy-MM-dd"
  /**
   * Restrict every figure to one department. Omit for a cross-department
   * report; an admin viewing "All departments" wants the whole picture, a rep
   * downloading their own wants only theirs.
   */
  departmentId?: string | null,
): Promise<TelemarketerReport[]> {
  const supabase = createClient()

  // Department names, so each row can say where it belongs.
  const { data: deptRows } = await supabase.from("departments").select("id, name")
  const deptNames = new Map<string, string>(
    ((deptRows ?? []) as Array<{ id: string; name: string }>).map((d) => [d.id, d.name]),
  )

  const dateStart = new Date(date)
  dateStart.setHours(0, 0, 0, 0)
  const dateEnd = new Date(date)
  dateEnd.setHours(23, 59, 59, 999)

  /**
   * Apply the department predicate when one was asked for.
   *
   * A rep belongs to one department, so for a single-rep report this changes
   * nothing. It matters for an admin report that must not mix departments'
   * numbers into one win rate.
   */
  const scope = <T extends { eq: (col: string, val: string) => T }>(q: T): T =>
    departmentId ? q.eq("department_id", departmentId) : q

  const results = await Promise.all(
    telemarketers.map(async (t) => {
      const [leadsRes, callsRes, ragRes, winsRes, allWinsRes] = await Promise.all([
        // Total leads assigned (all time)
        scope(
          supabase
            .from("leads")
            .select("*", { count: "exact", head: true })
            .eq("assigned_to", t.id),
        ),

        // Calls made on date
        scope(
          supabase
            .from("call_logs")
            .select("*", { count: "exact", head: true })
            .eq("telemarketer_id", t.id)
            .gte("called_at", dateStart.toISOString())
            .lte("called_at", dateEnd.toISOString()),
        ),

        // RAG breakdown (full rows needed for grouping)
        scope(
          supabase
            .from("leads")
            .select("rag_status")
            .eq("assigned_to", t.id),
        ),

        // Wins on date (by sale_date)
        scope(
          supabase
            .from("sales")
            .select("*", { count: "exact", head: true })
            .eq("telemarketer_id", t.id)
            .eq("sale_date", date),
        ),

        // All-time wins (for win rate)
        scope(
          supabase
            .from("sales")
            .select("*", { count: "exact", head: true })
            .eq("telemarketer_id", t.id),
        ),
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
        departmentId: t.department_id ?? null,
        departmentName: t.department_id ? deptNames.get(t.department_id) ?? null : null,
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
