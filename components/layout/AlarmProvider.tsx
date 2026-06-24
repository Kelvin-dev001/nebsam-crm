"use client"

import { useEffect, useState } from "react"
import { Bell, X } from "lucide-react"
import { useTelemarketerStore } from "@/lib/stores/telemarketerStore"
import {
  checkUpcomingFollowups,
  isInAlarmWindow,
  wasAlertedRecently,
  markAlerted,
  playChime,
  sendPushNotification,
} from "@/lib/notifications/followupAlarm"

const BANNER_DISMISSED_KEY = "nebsam-notif-dismissed"
const INTERVAL_MS = 60_000 // 60 seconds

export function AlarmProvider() {
  const { activeTelemarketer } = useTelemarketerStore()
  const [showBanner, setShowBanner] = useState(false)

  // ── Notification permission banner ──────────────────────────────────────────
  useEffect(() => {
    if (typeof Notification === "undefined") return
    if (Notification.permission === "granted") return
    if (Notification.permission === "denied") return
    const dismissed = localStorage.getItem(BANNER_DISMISSED_KEY)
    if (!dismissed) setShowBanner(true)
  }, [])

  async function handleEnableNotifications() {
    setShowBanner(false)
    localStorage.setItem(BANNER_DISMISSED_KEY, "1")
    try {
      await Notification.requestPermission()
    } catch {}
  }

  function handleDismissBanner() {
    setShowBanner(false)
    localStorage.setItem(BANNER_DISMISSED_KEY, "1")
  }

  // ── Alarm interval ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!activeTelemarketer) return

    async function runCheck() {
      if (!activeTelemarketer) return
      const followUps = await checkUpcomingFollowups(activeTelemarketer.id)

      for (const fu of followUps) {
        for (const window of ["24h", "1h"] as const) {
          if (isInAlarmWindow(fu.scheduled_date, window) && !wasAlertedRecently(fu.id, window)) {
            playChime()
            sendPushNotification(window, fu)
            markAlerted(fu.id, window)
          }
        }
      }
    }

    // Run immediately, then every 60s
    runCheck()
    const timer = setInterval(runCheck, INTERVAL_MS)
    return () => clearInterval(timer)
  }, [activeTelemarketer?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!showBanner) return null

  return (
    <div className="fixed bottom-24 lg:bottom-6 right-4 z-50 flex items-start gap-3 rounded-xl border border-blue-200 bg-white shadow-lg px-4 py-3 max-w-sm animate-in slide-in-from-bottom-4 fade-in duration-300">
      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-100 shrink-0 mt-0.5">
        <Bell className="h-4 w-4 text-blue-600" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-slate-800">Stay on top of follow-ups</p>
        <p className="text-xs text-slate-500 mt-0.5">
          Enable notifications to get reminders 1 hour and 24 hours before each follow-up.
        </p>
        <div className="flex gap-2 mt-2.5">
          <button
            onClick={handleEnableNotifications}
            className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 transition-colors"
          >
            Enable Notifications
          </button>
          <button
            onClick={handleDismissBanner}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 transition-colors"
          >
            Maybe Later
          </button>
        </div>
      </div>
      <button
        onClick={handleDismissBanner}
        className="text-slate-400 hover:text-slate-600 shrink-0"
        aria-label="Dismiss"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}
