"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import { Bell } from "lucide-react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { useTelemarketerStore } from "@/lib/stores/telemarketerStore"
import { format, isToday } from "date-fns"
import { cn } from "@/lib/utils"

const SEEN_KEY = "nebsam-bell-seen"

interface BellFollowUp {
  id: string
  lead_id: string
  lead_name: string | null
  product: string | null
  scheduled_date: string
  notes: string | null
}

function getSeenIds(): Set<string> {
  try {
    const raw = localStorage.getItem(SEEN_KEY)
    return new Set(raw ? (JSON.parse(raw) as string[]) : [])
  } catch {
    return new Set()
  }
}

function saveSeenIds(ids: Set<string>): void {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(Array.from(ids)))
  } catch {}
}

function formatBellTime(iso: string): string {
  try {
    const d = new Date(iso)
    return isToday(d) ? format(d, "h:mm a") : format(d, "EEE h:mm a")
  } catch {
    return ""
  }
}

export function NotificationBell() {
  const router = useRouter()
  const { activeTelemarketer } = useTelemarketerStore()
  const [followUps, setFollowUps] = useState<BellFollowUp[]>([])
  const [seenIds,   setSeenIds]   = useState<Set<string>>(new Set())
  const [open,      setOpen]      = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const loadFollowUps = useCallback(async () => {
    if (!activeTelemarketer) { setFollowUps([]); return }
    const supabase = createClient()
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0)
    const tomorrowStart = new Date(todayStart); tomorrowStart.setDate(tomorrowStart.getDate() + 1)

    const { data } = await supabase
      .from("followup_schedule")
      .select("id, lead_id, scheduled_date, notes, lead:leads(full_name, product_interested)")
      .eq("telemarketer_id", activeTelemarketer.id)
      .eq("status", "pending")
      .gte("scheduled_date", todayStart.toISOString())
      .lt("scheduled_date", tomorrowStart.toISOString())
      .order("scheduled_date", { ascending: true })

    const mapped: BellFollowUp[] = (data ?? []).map((row) => {
      const lead = row.lead as { full_name: string | null; product_interested: string | null } | null
      return {
        id:             row.id,
        lead_id:        row.lead_id,
        lead_name:      lead?.full_name ?? null,
        product:        lead?.product_interested ?? null,
        scheduled_date: row.scheduled_date,
        notes:          row.notes,
      }
    })
    setFollowUps(mapped)
  }, [activeTelemarketer?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Load on mount and when telemarketer changes
  useEffect(() => {
    setSeenIds(getSeenIds())
    loadFollowUps()
  }, [loadFollowUps])

  // Close dropdown on outside click
  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener("mousedown", handleClick)
    return () => document.removeEventListener("mousedown", handleClick)
  }, [open])

  const unreadCount = followUps.filter((f) => !seenIds.has(f.id)).length

  function handleOpen() {
    setOpen((v) => !v)
    // Mark all as seen when opening the dropdown
    if (!open && followUps.length > 0) {
      const next = new Set(Array.from(seenIds).concat(followUps.map((f) => f.id)))
      setSeenIds(next)
      saveSeenIds(next)
    }
  }

  function markAllRead() {
    const next = new Set(Array.from(seenIds).concat(followUps.map((f) => f.id)))
    setSeenIds(next)
    saveSeenIds(next)
    setOpen(false)
  }

  function navigateToLead(leadId: string) {
    setOpen(false)
    router.push(`/leads/${leadId}`)
  }

  if (!activeTelemarketer) return null

  return (
    <div ref={dropdownRef} className="relative">
      {/* Bell button */}
      <button
        onClick={handleOpen}
        aria-label="Follow-up notifications"
        className={cn(
          "relative flex h-9 w-9 items-center justify-center rounded-lg transition-colors",
          open ? "bg-slate-100 text-slate-700" : "text-slate-500 hover:bg-slate-100 hover:text-slate-700",
        )}
      >
        <Bell className="h-4.5 w-4.5 h-[18px] w-[18px]" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[9px] font-bold text-white leading-none">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute right-0 top-11 z-50 w-80 rounded-xl border border-slate-200 bg-white shadow-xl overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 bg-slate-50">
            <p className="text-sm font-semibold text-slate-800">
              Today&apos;s Follow-ups
            </p>
            <span className="text-xs text-slate-400">
              {followUps.length} pending
            </span>
          </div>

          {/* List */}
          <div className="max-h-72 overflow-y-auto">
            {followUps.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-center gap-1.5">
                <Bell className="h-7 w-7 text-slate-200" />
                <p className="text-sm text-slate-500">No follow-ups today</p>
                <p className="text-xs text-slate-400">You&apos;re all clear!</p>
              </div>
            ) : (
              followUps.map((fu) => (
                <button
                  key={fu.id}
                  onClick={() => navigateToLead(fu.lead_id)}
                  className="w-full flex items-start gap-3 px-4 py-3 hover:bg-slate-50 transition-colors border-b border-slate-50 last:border-0 text-left"
                >
                  {/* Time chip */}
                  <div className="shrink-0 mt-0.5">
                    <span className="inline-flex items-center rounded-md bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700 whitespace-nowrap">
                      {formatBellTime(fu.scheduled_date)}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-800 truncate">
                      {fu.lead_name ?? "Unknown Lead"}
                    </p>
                    <p className="text-xs text-slate-500 truncate">
                      {fu.product ?? "Follow-up"}{fu.notes ? ` · ${fu.notes}` : ""}
                    </p>
                  </div>
                </button>
              ))
            )}
          </div>

          {/* Footer */}
          {followUps.length > 0 && (
            <div className="border-t border-slate-100 px-4 py-2.5">
              <button
                onClick={markAllRead}
                className="text-xs text-slate-400 hover:text-slate-600 transition-colors"
              >
                Mark all read
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
