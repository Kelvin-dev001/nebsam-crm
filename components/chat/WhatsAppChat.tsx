"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import { SendHorizontal, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { createClient } from "@/lib/supabase/client"
import { toast } from "sonner"
import { format, isToday, isYesterday } from "date-fns"
import { cn } from "@/lib/utils"
import type { FunnelStage, RAGStatus } from "@/types/crm"
import type { Json } from "@/lib/supabase/types"

// ── Exported lead type (minimal — both ProcessedLead and LeadDetail satisfy this) ──

export interface ChatLead {
  id: string
  phone_number: string
  full_name: string | null
  product_interested: string | null
  funnel_stage: FunnelStage
  rag_status: RAGStatus
  created_at: string
  whatsapp_message?: string | null
}

// ── Internal types ────────────────────────────────────────────────────────────

interface ChatMessage {
  id: string
  direction: "incoming" | "outgoing"
  body: string
  sent_at: string
  optimistic?: boolean
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export function extractBody(rawPayload: Json): string {
  if (!rawPayload || typeof rawPayload !== "object" || Array.isArray(rawPayload)) return ""
  const p = rawPayload as Record<string, unknown>
  const entry = (p.entry as unknown[])?.[0] as Record<string, unknown> | undefined
  const value = (entry?.changes as unknown[])?.[0] as Record<string, unknown> | undefined
  const msg   = (value?.value as Record<string, unknown>)
  const metaMsg = (msg?.messages as unknown[])?.[0] as Record<string, unknown> | undefined
  if (metaMsg?.body) return String(metaMsg.body)
  return String(p.text ?? p.message ?? p.body ?? "")
}

function formatMsgTime(iso: string): string {
  try {
    const d = new Date(iso)
    if (isToday(d))     return `Today ${format(d, "h:mm a")}`
    if (isYesterday(d)) return `Yesterday ${format(d, "h:mm a")}`
    return format(d, "EEE d MMM · h:mm a")
  } catch {
    return ""
  }
}

// Single soft chime — tiny base64 WAV (220 Hz, 120ms)
const CHIME_SRC =
  "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA="

function playChime() {
  try {
    const audio = new Audio(CHIME_SRC)
    audio.volume = 0.3
    audio.play().catch(() => {})
  } catch {}
}

// ── WhatsApp icon SVG ────────────────────────────────────────────────────────

function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  )
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  lead: ChatLead
  mode: "modal" | "panel"
}

// ── Component ─────────────────────────────────────────────────────────────────

export function WhatsAppChat({ lead, mode }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [loading,  setLoading]  = useState(false)
  const [sending,  setSending]  = useState(false)
  const [text,     setText]     = useState("")
  const scrollRef  = useRef<HTMLDivElement>(null)
  const inputRef   = useRef<HTMLInputElement>(null)

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      if (scrollRef.current) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight
      }
    })
  }, [])

  // Load history on mount
  useEffect(() => {
    let active = true
    setLoading(true)
    setText("")

    const supabase = createClient()
    supabase
      .from("webhook_events")
      .select("id, direction, message_text, sent_at, raw_payload")
      .eq("phone_number", lead.phone_number)
      .order("sent_at", { ascending: true })
      .then(({ data }) => {
        if (!active) return
        const mapped: ChatMessage[] = (data ?? [])
          .map((r) => ({
            id:        r.id,
            direction: r.direction === "outgoing" ? "outgoing" as const : "incoming" as const,
            body:      r.message_text || extractBody(r.raw_payload),
            sent_at:   r.sent_at,
          }))
          .filter((m) => m.body.trim() !== "")
        setMessages(mapped)
        setLoading(false)
        scrollToBottom()
        setTimeout(() => inputRef.current?.focus(), 50)
      })

    // Realtime subscription
    const channel = supabase
      .channel(`wa-chat-${lead.phone_number}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "webhook_events",
          filter: `phone_number=eq.${lead.phone_number}`,
        },
        (payload) => {
          const r = payload.new as {
            id: string
            direction: string | null
            message_text: string | null
            sent_at: string
            raw_payload: Json
          }
          const body = r.message_text || extractBody(r.raw_payload)
          if (!body.trim()) return

          const isOutgoing = r.direction === "outgoing"

          setMessages((prev) => {
            if (prev.some((m) => m.id === r.id)) return prev
            return [...prev, { id: r.id, direction: isOutgoing ? "outgoing" : "incoming", body, sent_at: r.sent_at }]
          })

          if (!isOutgoing) playChime()
          scrollToBottom()
        },
      )
      .subscribe()

    return () => {
      active = false
      supabase.removeChannel(channel)
    }
  }, [lead.phone_number, scrollToBottom])

  async function send() {
    const trimmed = text.trim()
    if (!trimmed || sending) return

    const optimisticId = `opt-${Date.now()}`
    setMessages((prev) => [
      ...prev,
      { id: optimisticId, direction: "outgoing", body: trimmed, sent_at: new Date().toISOString(), optimistic: true },
    ])
    setText("")
    setSending(true)
    scrollToBottom()

    const res = await fetch("/api/whatsapp/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to: lead.phone_number, message: trimmed }),
    }).catch(() => null)

    setSending(false)

    if (!res?.ok) {
      setMessages((prev) => prev.filter((m) => m.id !== optimisticId))
      toast.error("Failed to send — check BSP configuration")
      setText(trimmed)
      return
    }

    const { event_id } = await res.json().catch(() => ({}))
    if (event_id) {
      setMessages((prev) =>
        prev.map((m) => m.id === optimisticId ? { ...m, id: event_id, optimistic: false } : m)
      )
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send() }
  }

  const isPanel = mode === "panel"

  return (
    <div className={cn("flex flex-col", isPanel ? "h-full" : "flex-1 min-h-0")}>
      {/* ── Messages ── */}
      <div
        ref={scrollRef}
        className={cn(
          "flex-1 overflow-y-auto px-4 py-3 space-y-2",
          isPanel ? "bg-slate-50" : "bg-[#ECE5DD]",
        )}
      >
        {loading ? (
          <div className="space-y-3 pt-2">
            {[48, 64, 36, 56].map((w, i) => (
              <div key={i} className={cn("flex", i % 2 ? "justify-end" : "justify-start")}>
                <Skeleton className={cn("h-9 rounded-2xl")} style={{ width: `${w * 2}px` }} />
              </div>
            ))}
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-center py-8">
            <WhatsAppIcon className="h-14 w-14 text-[#25D366] opacity-60" />
            <p className="text-sm text-slate-500 font-medium">No WhatsApp messages yet</p>
            <p className="text-xs text-slate-400">Send the first message below.</p>
          </div>
        ) : (
          messages.map((msg) => (
            <div
              key={msg.id}
              className={cn("flex", msg.direction === "outgoing" ? "justify-end" : "justify-start")}
            >
              <div
                className={cn(
                  "max-w-[78%] px-3.5 py-2 shadow-sm",
                  msg.direction === "outgoing"
                    ? "bg-[#25D366] text-white rounded-[18px_18px_4px_18px]"
                    : "bg-white text-slate-800 rounded-[18px_18px_18px_4px] border border-slate-100",
                  msg.optimistic && "opacity-60",
                )}
              >
                <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">{msg.body}</p>
                <p
                  className={cn(
                    "text-[10px] mt-0.5 text-right",
                    msg.direction === "outgoing" ? "text-green-100" : "text-slate-400",
                  )}
                >
                  {formatMsgTime(msg.sent_at)}
                  {msg.optimistic && <Loader2 className="inline-block h-2.5 w-2.5 animate-spin ml-1 opacity-70" />}
                </p>
              </div>
            </div>
          ))
        )}
      </div>

      {/* ── Composer ── */}
      <div className="border-t border-slate-200 px-3 py-2.5 flex items-center gap-2 bg-white shrink-0">
        <Input
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a WhatsApp message..."
          className="flex-1 h-9 text-sm"
          disabled={sending}
        />
        <Button
          size="icon"
          className="h-9 w-9 shrink-0 bg-[#25D366] hover:bg-[#22c55e]"
          onClick={send}
          disabled={sending || !text.trim()}
        >
          {sending
            ? <Loader2 className="h-4 w-4 animate-spin" />
            : <SendHorizontal className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  )
}
