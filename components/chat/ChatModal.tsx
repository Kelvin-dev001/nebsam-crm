"use client"

import Link from "next/link"
import { X } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { Badge } from "@/components/ui/badge"
import { FunnelStageBadge } from "@/components/leads/FunnelStageBadge"
import { RAGBadge } from "@/components/leads/RAGBadge"
import { WhatsAppChat, type ChatLead } from "./WhatsAppChat"
import { formatDate } from "@/lib/utils/dateHelpers"

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  lead: ChatLead | null
  onClose: () => void
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ChatModal({ lead, onClose }: Props) {
  return (
    <Dialog open={!!lead} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-2xl w-full p-0 flex flex-col overflow-hidden max-h-[85vh] gap-0">
        {/* Visually hidden title for accessibility */}
        <DialogHeader className="sr-only">
          <DialogTitle>WhatsApp Chat — {lead?.full_name ?? lead?.phone_number}</DialogTitle>
          <DialogDescription>Chat history and message composer</DialogDescription>
        </DialogHeader>

        {/* ── KYC Summary (top ~30%) ── */}
        {lead && (
          <div className="shrink-0 border-b border-slate-200 bg-white">
            {/* Header bar */}
            <div className="flex items-center justify-between px-4 py-3 bg-[#0F1729]">
              <div className="flex items-center gap-3 min-w-0">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#25D366] text-white text-sm font-bold shrink-0">
                  {(lead.full_name ?? lead.phone_number)[0].toUpperCase()}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-white truncate">
                    {lead.full_name ?? <span className="italic opacity-70">Unknown Lead</span>}
                  </p>
                  <p className="text-xs font-mono text-slate-300">{lead.phone_number}</p>
                </div>
              </div>
              <button
                onClick={onClose}
                className="text-slate-400 hover:text-white transition-colors shrink-0"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* KYC details */}
            <div className="px-4 py-3 space-y-2.5">
              <div className="flex flex-wrap items-center gap-2">
                {lead.product_interested && (
                  <Badge className="bg-blue-100 text-blue-700 border-0 text-xs">
                    {lead.product_interested}
                  </Badge>
                )}
                <FunnelStageBadge stage={lead.funnel_stage} />
                <RAGBadge status={lead.rag_status} />
                <span className="text-xs text-slate-400 ml-auto">
                  First contact: {formatDate(lead.created_at)}
                </span>
              </div>

              {lead.whatsapp_message && (
                <blockquote className="border-l-2 border-[#25D366] pl-3 text-xs text-slate-600 italic bg-slate-50 rounded-r py-1.5 line-clamp-2">
                  {lead.whatsapp_message}
                </blockquote>
              )}

              <Link
                href={`/leads/${lead.id}`}
                className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline font-medium"
              >
                View Full Profile →
              </Link>
            </div>
          </div>
        )}

        {/* ── Chat (bottom ~70%) ── */}
        {lead && (
          <div className="flex-1 min-h-0 flex flex-col">
            <WhatsAppChat lead={lead} mode="modal" />
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
