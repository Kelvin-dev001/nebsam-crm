"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { RefreshCcw, PackageCheck, FileClock, CalendarClock } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { createClient } from "@/lib/supabase/client"
import { useDepartment } from "@/lib/departments/useDepartment"
import type { PostSaleModel, Telemarketer } from "@/types/crm"
import { format, addDays } from "date-fns"
import { daysUntil, getRenewalColorClass } from "@/lib/utils/dateHelpers"

/**
 * What this client owes us next, whatever "next" means for the department.
 *
 * Replaces the telematics-only Upcoming Renewals widget. Each department earns
 * differently after the sale, so each has a different thing coming due:
 *
 *   annual_renewal  telematics   sales.renewal_due_date
 *   subscription    fuel         sales.contract_end
 *   consumption     e-seal       service_orders.reorder_due_date
 *   term_contract   school bus   term_billings.due_date
 *
 * The switch is EXHAUSTIVE with a `never` default, so adding a fifth post-sale
 * model fails the build rather than silently rendering an empty card.
 */

interface Props {
  telemarketer: Telemarketer
}

interface CommitmentItem {
  id: string
  title: string
  subtitle: string
  dueDate: string | null
  leadId: string | null
}

interface Presentation {
  heading: string
  icon: typeof RefreshCcw
  iconClass: string
  emptyText: string
  href: string | null
}

function presentationFor(model: PostSaleModel): Presentation | null {
  switch (model) {
    case "annual_renewal":
      return {
        heading: "Upcoming Renewals",
        icon: RefreshCcw,
        iconClass: "text-purple-500",
        emptyText: "No renewals in the next 60 days",
        href: "/renewals",
      }
    case "subscription":
      return {
        heading: "Contracts Expiring",
        icon: FileClock,
        iconClass: "text-amber-500",
        emptyText: "No contracts expiring in the next 60 days",
        href: "/renewals",
      }
    case "consumption":
      return {
        heading: "Reorders Due",
        icon: PackageCheck,
        iconClass: "text-teal-600",
        emptyText: "No reorders due in the next 60 days",
        href: "/reorders",
      }
    case "term_contract":
      return {
        heading: "Term Billing Due",
        icon: CalendarClock,
        iconClass: "text-indigo-500",
        emptyText: "No term billing due in the next 60 days",
        href: "/term-billing",
      }
    case "none":
      return null
    default: {
      // Exhaustiveness guard: a new post-sale model must be handled here.
      const _never: never = model
      return _never
    }
  }
}

export function UpcomingCommitments({ telemarketer }: Props) {
  const { department } = useDepartment()
  const [items, setItems] = useState<CommitmentItem[]>([])
  const [loading, setLoading] = useState(true)

  const model = (department?.post_sale_model ?? "annual_renewal") as PostSaleModel
  const presentation = presentationFor(model)

  useEffect(() => {
    if (!presentation) {
      setLoading(false)
      return
    }

    const supabase = createClient()
    const today = format(new Date(), "yyyy-MM-dd")
    const in60 = format(addDays(new Date(), 60), "yyyy-MM-dd")
    let cancelled = false

    ;(async () => {
      setLoading(true)
      try {
        let next: CommitmentItem[] = []

        if (model === "annual_renewal" || model === "subscription") {
          const dateCol = model === "annual_renewal" ? "renewal_due_date" : "contract_end"
          const { data, error } = await supabase
            .from("sales")
            .select(`id, product, ${dateCol}, sale_amount, lead_id, lead:leads(full_name, phone_number)`)
            .eq("telemarketer_id", telemarketer.id)
            .gte(dateCol, today)
            .lte(dateCol, in60)
            .order(dateCol, { ascending: true })
            .limit(8)
          if (error) throw error
          next = ((data ?? []) as unknown as Array<Record<string, unknown>>).map((r) => {
            const lead = r.lead as { full_name: string | null; phone_number: string } | null
            return {
              id: String(r.id),
              title: lead?.full_name ?? lead?.phone_number ?? "Unknown",
              subtitle: String(r.product ?? ""),
              dueDate: (r[dateCol] as string) ?? null,
              leadId: (r.lead_id as string) ?? null,
            }
          })
        } else if (model === "consumption") {
          const { data, error } = await supabase
            .from("service_orders")
            .select("id, product, quantity, reorder_due_date, lead_id, lead:leads(full_name, company_name, phone_number)")
            .eq("telemarketer_id", telemarketer.id)
            .gte("reorder_due_date", today)
            .lte("reorder_due_date", in60)
            .order("reorder_due_date", { ascending: true })
            .limit(8)
          if (error) throw error
          next = ((data ?? []) as unknown as Array<Record<string, unknown>>).map((r) => {
            const lead = r.lead as
              | { full_name: string | null; company_name: string | null; phone_number: string }
              | null
            return {
              id: String(r.id),
              title: lead?.company_name ?? lead?.full_name ?? lead?.phone_number ?? "Unknown",
              subtitle: `${r.quantity ?? ""} × ${r.product ?? ""}`.trim(),
              dueDate: (r.reorder_due_date as string) ?? null,
              leadId: (r.lead_id as string) ?? null,
            }
          })
        } else if (model === "term_contract") {
          const { data, error } = await supabase
            .from("term_billings")
            .select("id, bus_count, total_amount, due_date, invoice_status, lead_id, lead:leads(company_name, full_name, phone_number), academic_term:academic_terms(name)")
            .gte("due_date", today)
            .lte("due_date", in60)
            .in("invoice_status", ["pending", "invoiced", "partial", "overdue"])
            .order("due_date", { ascending: true })
            .limit(8)
          if (error) throw error
          next = ((data ?? []) as unknown as Array<Record<string, unknown>>).map((r) => {
            const lead = r.lead as
              | { company_name: string | null; full_name: string | null; phone_number: string }
              | null
            const term = r.academic_term as { name: string } | null
            return {
              id: String(r.id),
              title: lead?.company_name ?? lead?.full_name ?? lead?.phone_number ?? "Unknown",
              subtitle: `${term?.name ?? "Term"} · ${r.bus_count ?? 0} buses`,
              dueDate: (r.due_date as string) ?? null,
              leadId: (r.lead_id as string) ?? null,
            }
          })
        }

        if (!cancelled) setItems(next)
      } catch (err) {
        console.error("UpcomingCommitments fetch failed:", err)
        if (!cancelled) setItems([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [telemarketer.id, model, presentation])

  // post_sale_model 'none' — there is nothing to chase, so show nothing.
  if (!presentation) return null

  const Icon = presentation.icon

  return (
    <Card className="border border-slate-200 shadow-none">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold text-slate-700 flex items-center gap-2">
          <Icon className={`h-4 w-4 ${presentation.iconClass}`} />
          {presentation.heading}
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
            <Icon className="h-8 w-8 text-slate-300 mb-2" />
            <p className="text-sm text-slate-500">{presentation.emptyText}</p>
          </div>
        ) : (
          <div className="space-y-2">
            {items.map((item) => {
              const days = item.dueDate ? daysUntil(item.dueDate) : null
              const colorClass = days !== null ? getRenewalColorClass(days) : "text-slate-500"
              const row = (
                <div className="flex items-center gap-3 py-2 border-b border-slate-100 last:border-0">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-800 truncate">{item.title}</p>
                    <p className="text-xs text-slate-500 truncate">{item.subtitle}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-xs text-slate-500">
                      {item.dueDate ? format(new Date(item.dueDate), "dd MMM") : "—"}
                    </p>
                    {days !== null && (
                      <p className={`text-xs font-semibold ${colorClass}`}>
                        {days === 0 ? "Today" : `${days}d`}
                      </p>
                    )}
                  </div>
                </div>
              )
              return item.leadId ? (
                <Link key={item.id} href={`/leads/${item.leadId}`} className="block hover:bg-slate-50 -mx-2 px-2 rounded">
                  {row}
                </Link>
              ) : (
                <div key={item.id}>{row}</div>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
