import { createClient } from "@/lib/supabase/client"
import { format } from "date-fns"

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AlarmFollowUp {
  id: string
  lead_id: string
  lead_name: string | null
  product: string | null
  scheduled_date: string   // ISO TIMESTAMPTZ
  notes: string | null
}

// ── Supabase query ────────────────────────────────────────────────────────────

export async function checkUpcomingFollowups(
  telemarketerId: string,
): Promise<AlarmFollowUp[]> {
  const supabase = createClient()
  const now = new Date()
  const in25h = new Date(now.getTime() + 25 * 60 * 60 * 1000)

  const { data, error } = await supabase
    .from("followup_schedule")
    .select(
      "id, lead_id, scheduled_date, notes, lead:leads(full_name, product_interested)",
    )
    .eq("telemarketer_id", telemarketerId)
    .eq("status", "pending")
    .gte("scheduled_date", now.toISOString())
    .lte("scheduled_date", in25h.toISOString())

  if (error || !data) return []

  return data.map((row) => {
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
}

// ── Sound — Web Audio API 3-beep chime ───────────────────────────────────────

export function playChime(): void {
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    const ctx = new AudioCtx()

    const freqs = [880, 1100, 880]
    freqs.forEach((freq, i) => {
      const osc  = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.connect(gain)
      gain.connect(ctx.destination)

      osc.type      = "sine"
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0, ctx.currentTime + i * 0.35)
      gain.gain.linearRampToValueAtTime(0.45, ctx.currentTime + i * 0.35 + 0.02)
      gain.gain.linearRampToValueAtTime(0, ctx.currentTime + i * 0.35 + 0.22)

      osc.start(ctx.currentTime + i * 0.35)
      osc.stop(ctx.currentTime + i * 0.35 + 0.25)
    })
  } catch {
    // AudioContext unavailable or blocked — silent fail
  }
}

// ── Push notification ─────────────────────────────────────────────────────────

export function sendPushNotification(
  type: "24h" | "1h",
  followUp: AlarmFollowUp,
): void {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return

  const timeStr  = formatFollowUpTime(followUp.scheduled_date)
  const leadName = followUp.lead_name ?? "a lead"
  const product  = followUp.product ?? "follow-up"

  const title = type === "24h" ? "⏰ Follow-up Tomorrow" : "🔔 Follow-up in 1 Hour!"
  const body  = `Call ${leadName} at ${timeStr} regarding ${product}`

  try {
    const n = new Notification(title, { body, icon: "/favicon.ico" })
    n.onclick = () => {
      window.focus()
      window.open(`/leads/${followUp.lead_id}`, "_self")
      n.close()
    }
  } catch {
    // Notification blocked or unavailable
  }
}

function formatFollowUpTime(iso: string): string {
  try { return format(new Date(iso), "h:mm a") } catch { return iso }
}

// ── localStorage dedup ────────────────────────────────────────────────────────

const STORAGE_KEY = "nebsam-alerted"
const DEDUP_TTL_MS = 23 * 60 * 60 * 1000 // 23 hours

function alertKey(id: string, window: "24h" | "1h"): string {
  return `${id}-${window}`
}

function getAlerted(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as Record<string, number>
  } catch {
    return {}
  }
}

export function wasAlertedRecently(id: string, window: "24h" | "1h"): boolean {
  const alerted = getAlerted()
  const ts = alerted[alertKey(id, window)]
  if (!ts) return false
  return Date.now() - ts < DEDUP_TTL_MS
}

export function markAlerted(id: string, window: "24h" | "1h"): void {
  try {
    const alerted = getAlerted()
    alerted[alertKey(id, window)] = Date.now()
    // Prune entries older than DEDUP_TTL_MS to prevent unbounded growth
    const now = Date.now()
    for (const k in alerted) {
      if (now - alerted[k] > DEDUP_TTL_MS) delete alerted[k]
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(alerted))
  } catch {}
}

// ── Window check helpers ──────────────────────────────────────────────────────

const TOLERANCE_MS = 5 * 60 * 1000 // ±5 minutes

export function isInAlarmWindow(
  scheduledISO: string,
  type: "24h" | "1h",
): boolean {
  const scheduledMs = new Date(scheduledISO).getTime()
  const offsetMs    = type === "24h" ? 24 * 60 * 60 * 1000 : 60 * 60 * 1000
  const alarmAt     = scheduledMs - offsetMs
  const now         = Date.now()
  return Math.abs(now - alarmAt) <= TOLERANCE_MS
}
