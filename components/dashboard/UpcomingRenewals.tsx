"use client"

import { useEffect, useState } from "react"
import { RefreshCcw } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { createClient } from "@/lib/supabase/client"
import { Telemarketer } from "@/types/crm"
import { format, addDays } from "date-fns"
import { daysUntil, getRenewalColorClass } from "@/lib/utils/dateHelpers"

interface Props {
  telemarketer: Telemarketer
}

interface RenewalItem {
  id: string
  product: string
  renewal_due_date: string | null
  sale_amount: number | null
  lead: { full_name: string | null; phone_number: string } | null
}

export function UpcomingRenewals({ telemarketer }: Props) {
  const [items, setItems] = useState<RenewalItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const supabase = createClient()
    const today = format(new Date(), "yyyy-MM-dd")
    const in60Days = format(addDays(new Date(), 60), "yyyy-MM-dd")

    ;(async () => {
      try {
        const { data, error } = await supabase
          .from("sales")
          .select("id, product, renewal_due_date, sale_amount, lead:leads(full_name, phone_number)")
          .eq("telemarketer_id", telemarketer.id)
          .gte("renewal_due_date", today)
          .lte("renewal_due_date", in60Days)
          .order("renewal_due_date", { ascending: true })
          .limit(8)
        if (error) console.error("UpcomingRenewals fetch error:", error)
        setItems((data as unknown as RenewalItem[]) ?? [])
      } catch (err) {
        console.error("UpcomingRenewals fetch failed:", err)
      } finally {
        setLoading(false)
      }
    })()
  }, [telemarketer.id])

  return (
    <Card className="border border-slate-200 shadow-none">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold text-slate-700 flex items-center gap-2">
          <RefreshCcw className="h-4 w-4 text-purple-500" />
          Upcoming Renewals
          <span className="ml-auto text-xs font-normal text-slate-400">Next 60 days</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-4 w-32 flex-1" />
                <Skeleton className="h-5 w-14" />
              </div>
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <RefreshCcw className="h-8 w-8 text-slate-300 mb-2" />
            <p className="text-sm text-slate-500">No renewals in the next 60 days</p>
          </div>
        ) : (
          <div className="space-y-2">
            {items.map((item) => {
              const days = item.renewal_due_date ? daysUntil(item.renewal_due_date) : null
              const colorClass = days !== null ? getRenewalColorClass(days) : "text-slate-500"
              return (
                <div key={item.id} className="flex items-center gap-3 py-2 border-b border-slate-100 last:border-0">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-800 truncate">
                      {item.lead?.full_name ?? item.lead?.phone_number}
                    </p>
                    <p className="text-xs text-slate-500 truncate">{item.product}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-xs text-slate-500">
                      {item.renewal_due_date ? format(new Date(item.renewal_due_date), "dd MMM") : "—"}
                    </p>
                    {days !== null && (
                      <p className={`text-xs font-semibold ${colorClass}`}>
                        {days === 0 ? "Today" : `${days}d`}
                      </p>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
