"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import { SendHorizontal, MessageCircleOff, Loader2 } from "lucide-react"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { createClient } from "@/lib/supabase/client"
import { toast } from "sonner"
import { format } from "date-fns"
import { formatDate } from "@/lib/utils/dateHelpers"
import { cn } from "@/lib/utils"
import type { LeadDetail } from "./LeadDetailShell"
import type { Json } from "@/lib/supabase/types"

// ── Types ─────────────────────────────────────────────────────────────────────

interface ChatMessage {
  id: string
  direction: "incoming" | "outgoing"
  body: string
  sent_at: string
  optimistic?: boolean
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractBody(rawPayload: Json): string {
  if (!rawPayload || typeof rawPayload !== "object" || Array.isArray(rawPayload)) return ""
  const p = rawPayload as Record<string, unknown>
  // Meta Cloud API
  const entry = (p.entry as unknown[])?.[0] as Record<string, unknown> | undefined
  const value = (entry?.changes as unknown[])?.[0] as Record<string, unknown> | undefined
  const msg = (value?.value as Record<string, unknown>)
  const metaBody = (msg?.messages as unknown[])?.[0] as Record<string, unknown> | undefined
  if (metaBody?.body) return String(metaBody.body)
  // Simple / WATI formats
  return String(p.text ?? p.message ?? p.body ?? "")
}

function formatTime(iso: string) {
  try { return format(new Date(iso), "h:mm a") } catch { return "" }
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  open: boolean
  onClose: () => void
  lead: LeadDetail
}

export function WhatsAppPanel({ open, onClose, lead }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [loading, setLoading]   = useState(false)
  const [sending, setSending]   = useState(false)
  const [text, setText]         = useState("")
  const scrollRef               = useRef<HTMLDivElement>(null)
  const inputRef                = useRef<HTMLInputElement>(null)

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      if (scrollRef.current) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight
      }
    })
  }, [])

  // Load history whenever the panel opens
  useEffect(() => {
    if (!open) return
    let active = true
    setLoading(true)

    const supabase = createClient()
    supabase
      .from("webhook_events")
      .select("id, direction, message_text, sent_at, raw_payload")
      .eq("phone_number", lead.phone_number)
      .order("sent_at", { ascending: true })
      .then(({ data }) => {
        if (!active) return
        const mapped: ChatMessage[] = (data ?? [])
          .filter((r) => {
            const body = r.message_text || extractBody(r.raw_payload)
            return body.trim() !== ""
          })
          .map((r) => ({
            id:        r.id,
            direction: (r.direction === "outgoing" ? "outgoing" : "incoming") as ChatMessage["direction"],
            body:      r.message_text || extractBody(r.raw_payload),
            sent_at:   r.sent_at,
          }))
        setMessages(mapped)
        setLoading(false)
        scrollToBottom()
        inputRef.current?.focus()
      })

    // Realtime: new messages for this phone number
    const channel = supabase
      .channel(`whatsapp-${lead.phone_number}`)
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

          setMessages((prev) => {
            // De-duplicate: don't add if we already have an optimistic copy
            if (prev.some((m) => m.id === r.id)) return prev
            return [
              ...prev,
              {
                id:        r.id,
                direction: r.direction === "outgoing" ? "outgoing" : "incoming",
                body,
                sent_at:   r.sent_at,
              },
            ]
          })
          scrollToBottom()
        },
      )
      .subscribe()

    return () => {
      active = false
      supabase.removeChannel(channel)
    }
  }, [open, lead.phone_number, scrollToBottom])

  async function send() {
    const trimmed = text.trim()
    if (!trimmed || sending) return

    const optimisticId = `opt-${Date.now()}`
    const optimistic: ChatMessage = {
      id:        optimisticId,
      direction: "outgoing",
      body:      trimmed,
      sent_at:   new Date().toISOString(),
      optimistic: true,
    }

    // Optimistic update
    setMessages((prev) => [...prev, optimistic])
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
      // Rollback optimistic message
      setMessages((prev) => prev.filter((m) => m.id !== optimisticId))
      toast.error("Failed to send message — check BSP configuration")
      setText(trimmed)
      return
    }

    // Replace optimistic with real event_id from response
    const { event_id } = await res.json().catch(() => ({}))
    if (event_id) {
      setMessages((prev) =>
        prev.map((m) => m.id === optimisticId ? { ...m, id: event_id, optimistic: false } : m)
      )
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <SheetContent
        side="right"
        showCloseButton={false}
        className="w-full sm:w-[400px] sm:max-w-[400px] p-0 flex flex-col gap-0"
      >
        {/* ── Header ── */}
        <SheetHeader className="px-4 py-3 border-b border-slate-200 shrink-0 bg-[#0F1729]">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-green-500 text-white text-sm font-bold shrink-0">
                {(lead.full_name ?? lead.phone_number)[0].toUpperCase()}
              </div>
              <div className="min-w-0">
                <SheetTitle className="text-base font-semibold text-white truncate">
                  {lead.full_name ?? "Unknown Lead"}
                </SheetTitle>
                <SheetDescription className="text-xs text-slate-300 font-mono mt-0">
                  {lead.phone_number}
                </SheetDescription>
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  {lead.product_interested && (
                    <Badge className="bg-blue-600 text-white text-[10px] px-1.5 py-0 border-0">
                      {lead.product_interested}
                    </Badge>
                  )}
                  <span className="text-[10px] text-slate-400">
                    First contact: {formatDate(lead.created_at)}
                  </span>
                </div>
              </div>
            </div>
            <button
              onClick={onClose}
              className="text-slate-400 hover:text-white transition-colors shrink-0 mt-0.5"
              aria-label="Close"
            >
              <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
              </svg>
            </button>
          </div>
        </SheetHeader>

        {/* ── Chat area ── */}
        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto px-4 py-4 space-y-3 bg-slate-50"
        >
          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className={cn("flex", i % 2 === 0 ? "justify-start" : "justify-end")}>
                  <Skeleton className={cn("h-10 rounded-2xl", i % 2 === 0 ? "w-48" : "w-36")} />
                </div>
              ))}
            </div>
          ) : messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-center py-12">
              <MessageCircleOff className="h-10 w-10 text-slate-300" />
              <p className="text-sm text-slate-500">No messages yet</p>
              <p className="text-xs text-slate-400">
                Messages from {lead.phone_number} will appear here
              </p>
            </div>
          ) : (
            messages.map((msg) => (
              <div
                key={msg.id}
                className={cn(
                  "flex",
                  msg.direction === "outgoing" ? "justify-end" : "justify-start"
                )}
              >
                <div
                  className={cn(
                    "max-w-[80%] px-3.5 py-2 shadow-sm",
                    msg.direction === "outgoing"
                      ? "bg-[#2563EB] text-white rounded-[18px_18px_4px_18px]"
                      : "bg-white text-slate-800 rounded-[18px_18px_18px_4px] border border-slate-100",
                    msg.optimistic && "opacity-70"
                  )}
                >
                  <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">
                    {msg.body}
                  </p>
                  <p
                    className={cn(
                      "text-[10px] mt-0.5 text-right",
                      msg.direction === "outgoing" ? "text-blue-100" : "text-slate-400"
                    )}
                  >
                    {formatTime(msg.sent_at)}
                    {msg.optimistic && (
                      <Loader2 className="inline-block h-2.5 w-2.5 animate-spin ml-1 opacity-70" />
                    )}
                  </p>
                </div>
              </div>
            ))
          )}
        </div>

        {/* ── Composer ── */}
        <div className="border-t border-slate-200 px-3 py-3 flex items-center gap-2 bg-white shrink-0">
          <Input
            ref={inputRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message..."
            className="flex-1 h-9 text-sm"
            disabled={sending}
          />
          <Button
            size="icon"
            className="h-9 w-9 bg-[#2563EB] hover:bg-blue-700 shrink-0"
            onClick={send}
            disabled={sending || !text.trim()}
          >
            {sending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <SendHorizontal className="h-4 w-4" />
            )}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}
