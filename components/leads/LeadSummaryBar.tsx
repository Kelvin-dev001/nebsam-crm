"use client"

import { Package, MapPin, Car, Megaphone, Radio, CalendarClock, StickyNote } from "lucide-react"
import { cn } from "@/lib/utils"
import { formatFollowUpDate, formatRelative } from "@/lib/utils/dateHelpers"
import { isPast } from "date-fns"
import type { LeadDetail } from "./LeadDetailShell"

const LEAD_SOURCE_LABELS: Record<string, string> = {
  whatsapp_bot: "WhatsApp Bot",
  meta_ads: "Meta Ads",
  tiktok_ads: "TikTok Ads",
  referral: "Referral",
  manual: "Manual",
}

// Always-visible snapshot of the lead's KYC + latest activity, so the key
// context stays on screen no matter which tab or funnel stage the lead is in.
export function LeadSummaryBar({ lead }: { lead: LeadDetail }) {
  // Earliest still-pending follow-up.
  const nextFollowUp = lead.followup_schedule.find((f) => f.status === "pending") ?? null

  // Most recent call that actually carries a note.
  const lastNote = lead.call_logs.find((c) => c.call_notes && c.call_notes.trim() !== "") ?? null

  const fields: { icon: React.FC<{ className?: string }>; label: string; value: string | null }[] = [
    { icon: Package, label: "Product", value: lead.product_interested },
    { icon: MapPin, label: "Location", value: lead.location },
    { icon: Car, label: "Vehicle", value: lead.vehicle_type },
    { icon: Radio, label: "Source", value: LEAD_SOURCE_LABELS[lead.lead_source] ?? lead.lead_source },
    { icon: Megaphone, label: "Campaign", value: lead.campaign_name },
  ]

  const overdue = nextFollowUp ? isPast(new Date(nextFollowUp.scheduled_date)) : false

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4 mb-5">
      {/* KYC snapshot */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-x-4 gap-y-3">
        {fields.map(({ icon: Icon, label, value }) => (
          <div key={label} className="min-w-0">
            <p className="flex items-center gap-1 text-[10px] font-semibold text-slate-400 uppercase tracking-wide">
              <Icon className="h-3 w-3" />
              {label}
            </p>
            <p className={cn("text-sm mt-0.5 truncate", value ? "text-slate-800 font-medium" : "text-slate-400 italic")}>
              {value ?? "—"}
            </p>
          </div>
        ))}
      </div>

      {/* Next follow-up + last note */}
      {(nextFollowUp || lastNote) && (
        <div className="mt-4 pt-3 border-t border-slate-200 grid grid-cols-1 md:grid-cols-2 gap-3">
          {/* Next follow-up */}
          <div className="flex items-start gap-2">
            <CalendarClock className={cn("h-4 w-4 shrink-0 mt-0.5", overdue ? "text-red-500" : "text-blue-500")} />
            <div className="min-w-0">
              <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Next follow-up</p>
              {nextFollowUp ? (
                <p className={cn("text-sm font-medium", overdue ? "text-red-600" : "text-slate-800")}>
                  {formatFollowUpDate(nextFollowUp.scheduled_date)}
                  {overdue && <span className="ml-1.5 text-xs font-semibold text-red-500">overdue</span>}
                  {nextFollowUp.notes && (
                    <span className="block text-xs font-normal text-slate-500 truncate">{nextFollowUp.notes}</span>
                  )}
                </p>
              ) : (
                <p className="text-sm text-slate-400 italic">None scheduled</p>
              )}
            </div>
          </div>

          {/* Last note */}
          {lastNote && (
            <div className="flex items-start gap-2">
              <StickyNote className="h-4 w-4 shrink-0 mt-0.5 text-slate-400" />
              <div className="min-w-0">
                <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">
                  Last note · {formatRelative(lastNote.called_at)}
                </p>
                <p className="text-sm text-slate-700 line-clamp-2">{lastNote.call_notes}</p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
