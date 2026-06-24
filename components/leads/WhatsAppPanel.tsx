"use client"

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet"
import { Badge } from "@/components/ui/badge"
import { X } from "lucide-react"
import { WhatsAppChat, type ChatLead } from "@/components/chat/WhatsAppChat"
import { formatDate } from "@/lib/utils/dateHelpers"
import type { LeadDetail } from "./LeadDetailShell"

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  open: boolean
  onClose: () => void
  lead: LeadDetail
}

// ── Component ─────────────────────────────────────────────────────────────────

export function WhatsAppPanel({ open, onClose, lead }: Props) {
  // Map LeadDetail → ChatLead so WhatsAppChat stays decoupled
  const chatLead: ChatLead = {
    id:                 lead.id,
    phone_number:       lead.phone_number,
    full_name:          lead.full_name,
    product_interested: lead.product_interested,
    funnel_stage:       lead.funnel_stage,
    rag_status:         lead.rag_status,
    created_at:         lead.created_at,
    whatsapp_message:   lead.whatsapp_message,
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
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#25D366] text-white text-sm font-bold shrink-0">
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
              <X className="h-5 w-5" />
            </button>
          </div>
        </SheetHeader>

        {/* ── Chat ── */}
        <div className="flex-1 min-h-0 flex flex-col">
          <WhatsAppChat lead={chatLead} mode="panel" />
        </div>
      </SheetContent>
    </Sheet>
  )
}
