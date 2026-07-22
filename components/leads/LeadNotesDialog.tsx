"use client"

import { Phone, StickyNote } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { formatDateTime, formatRelative } from "@/lib/utils/dateHelpers"
import type { ProcessedLead } from "./LeadsShell"

const OUTCOME_CONFIG: Record<string, { label: string; color: string }> = {
  answered:           { label: "Answered",     color: "bg-green-100 text-green-700 border-green-200" },
  no_answer:          { label: "No Answer",     color: "bg-slate-100 text-slate-600 border-slate-200" },
  busy:               { label: "Busy",          color: "bg-amber-100 text-amber-700 border-amber-200" },
  callback_requested: { label: "Callback",      color: "bg-blue-100 text-blue-700 border-blue-200" },
  wrong_number:       { label: "Wrong Number",  color: "bg-red-100 text-red-700 border-red-200" },
}

interface Props {
  lead: ProcessedLead | null
  onClose: () => void
}

export function LeadNotesDialog({ lead, onClose }: Props) {
  return (
    <Dialog open={!!lead} onOpenChange={(open: boolean) => { if (!open) onClose() }}>
      <DialogContent className="sm:max-w-lg max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <StickyNote className="h-4 w-4 text-slate-500" />
            Call Notes
          </DialogTitle>
          <DialogDescription>
            {lead?.full_name ?? lead?.phone_number}
            {lead && ` · ${lead.call_count} call${lead.call_count !== 1 ? "s" : ""} logged`}
          </DialogDescription>
        </DialogHeader>

        {lead && lead.call_history.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-center gap-2">
            <Phone className="h-8 w-8 text-slate-300" />
            <p className="text-sm text-slate-500">No calls logged for this lead yet.</p>
          </div>
        ) : (
          <div className="space-y-3 pt-1">
            {lead?.call_history.map((call, i) => {
              const outcome = OUTCOME_CONFIG[call.call_outcome] ?? {
                label: call.call_outcome,
                color: "bg-slate-100 text-slate-600 border-slate-200",
              }
              return (
                <div key={`${call.called_at}-${i}`} className="rounded-lg border border-slate-200 p-3">
                  <div className="flex items-center gap-2 flex-wrap mb-1.5">
                    <Badge variant="outline" className={cn("text-xs", outcome.color)}>
                      {outcome.label}
                    </Badge>
                    <span className="text-xs text-slate-400">{formatDateTime(call.called_at)}</span>
                    <span className="text-slate-300 text-xs">·</span>
                    <span className="text-xs text-slate-400">{formatRelative(call.called_at)}</span>
                  </div>
                  {call.call_notes ? (
                    <p className="text-sm text-slate-700 whitespace-pre-wrap">{call.call_notes}</p>
                  ) : (
                    <p className="text-xs text-slate-400 italic">No notes recorded for this call.</p>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
