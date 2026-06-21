"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { createClient } from "@/lib/supabase/client"
import { Telemarketer } from "@/types/crm"

interface Props {
  telemarketer: Telemarketer
}

interface RAGCounts {
  green: number
  amber: number
  red: number
}

const RAG_CONFIG = [
  {
    key: "green" as const,
    label: "Green",
    sublabel: "High intent",
    dot: "bg-green-500",
    bg: "bg-green-50",
    border: "border-green-200",
    text: "text-green-700",
    count: "text-green-900",
  },
  {
    key: "amber" as const,
    label: "Amber",
    sublabel: "Moderate",
    dot: "bg-amber-500",
    bg: "bg-amber-50",
    border: "border-amber-200",
    text: "text-amber-700",
    count: "text-amber-900",
  },
  {
    key: "red" as const,
    label: "Red",
    sublabel: "Cold",
    dot: "bg-red-500",
    bg: "bg-red-50",
    border: "border-red-200",
    text: "text-red-700",
    count: "text-red-900",
  },
]

export function RAGSummary({ telemarketer }: Props) {
  const [counts, setCounts] = useState<RAGCounts | null>(null)

  useEffect(() => {
    const supabase = createClient()

    Promise.all([
      supabase.from("leads").select("*", { count: "exact", head: true }).eq("assigned_to", telemarketer.id).eq("rag_status", "green"),
      supabase.from("leads").select("*", { count: "exact", head: true }).eq("assigned_to", telemarketer.id).eq("rag_status", "amber"),
      supabase.from("leads").select("*", { count: "exact", head: true }).eq("assigned_to", telemarketer.id).eq("rag_status", "red"),
    ]).then(([g, a, r]) => {
      setCounts({ green: g.count ?? 0, amber: a.count ?? 0, red: r.count ?? 0 })
    })
  }, [telemarketer.id])

  const total = counts ? counts.green + counts.amber + counts.red : 0

  return (
    <Card className="border border-slate-200 shadow-none h-full">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold text-slate-700">RAG Status Summary</CardTitle>
        {counts && (
          <p className="text-xs text-slate-400">{total} leads total</p>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {RAG_CONFIG.map(({ key, label, sublabel, dot, bg, border, text, count: countClass }) => (
          <div key={key} className={`flex items-center justify-between rounded-lg border p-3 ${bg} ${border}`}>
            <div className="flex items-center gap-2.5">
              <div className={`h-2.5 w-2.5 rounded-full shrink-0 ${dot}`} />
              <div>
                <p className={`text-sm font-medium ${text}`}>{label}</p>
                <p className={`text-xs ${text} opacity-70`}>{sublabel}</p>
              </div>
            </div>
            {counts === null ? (
              <Skeleton className="h-7 w-10" />
            ) : (
              <span className={`text-2xl font-bold ${countClass}`}>
                {counts[key]}
              </span>
            )}
          </div>
        ))}

        {/* Mini progress bar */}
        {counts && total > 0 && (
          <div className="flex h-2 rounded-full overflow-hidden gap-0.5 mt-2">
            {counts.green > 0 && (
              <div className="bg-green-500 rounded-full" style={{ width: `${(counts.green / total) * 100}%` }} />
            )}
            {counts.amber > 0 && (
              <div className="bg-amber-500 rounded-full" style={{ width: `${(counts.amber / total) * 100}%` }} />
            )}
            {counts.red > 0 && (
              <div className="bg-red-500 rounded-full" style={{ width: `${(counts.red / total) * 100}%` }} />
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
