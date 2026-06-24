"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { ArrowLeft, Loader2, MessageCircle } from "lucide-react"
import { toast } from "sonner"
import { Button, buttonVariants } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { createClient } from "@/lib/supabase/client"
import { FunnelStage, RAGStatus, FUNNEL_STAGES, FUNNEL_STAGE_LABELS } from "@/types/crm"
import { FunnelStageBadge } from "./FunnelStageBadge"
import { RAGBadge } from "./RAGBadge"
import { LeadDetailTabs } from "./LeadDetailTabs"
import { WhatsAppPanel } from "./WhatsAppPanel"
import { cn } from "@/lib/utils"
import { formatDate } from "@/lib/utils/dateHelpers"

// ── Types ─────────────────────────────────────────────────────────────────────

export interface LeadCallLog {
  id: string
  called_at: string
  duration_seconds: number | null
  call_outcome: string
  call_notes: string | null
  rag_status_after_call: string | null
  funnel_stage_after_call: string | null
  next_followup_date: string | null
  next_followup_notes: string | null
  telemarketer: { full_name: string } | null
}

export interface LeadSale {
  id: string
  product: string
  sale_amount: number | null
  currency: string
  sale_date: string
  installation_date: string | null
  installation_location: string | null
  vehicle_registration: string | null
  serial_number: string | null
  subscription_type: string
  renewal_due_date: string | null
  renewal_reminder_sent: boolean
  notes: string | null
}

export interface LeadFollowUp {
  id: string
  followup_type: string
  scheduled_date: string
  notes: string | null
  status: string
  completed_at: string | null
}

export interface LeadDetail {
  id: string
  phone_number: string
  full_name: string | null
  location: string | null
  vehicle_type: string | null
  product_interested: string | null
  lead_source: string
  funnel_stage: FunnelStage
  rag_status: RAGStatus
  campaign_name: string | null
  whatsapp_message: string | null
  assigned_to: string | null
  created_at: string
  updated_at: string
  telemarketer: { id: string; full_name: string; email: string } | null
  call_logs: LeadCallLog[]
  sales: LeadSale[]
  followup_schedule: LeadFollowUp[]
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  leadId: string
}

const POST_SALE_STAGES: FunnelStage[] = ["won", "installed", "post_sale", "renewal_due", "renewed"]

export function LeadDetailShell({ leadId }: Props) {
  const [lead, setLead] = useState<LeadDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [pendingStage, setPendingStage] = useState<FunnelStage | null>(null)
  const [stageSaving, setStageSaving] = useState(false)
  const [showRagPicker, setShowRagPicker] = useState(false)
  const [ragSaving, setRagSaving] = useState(false)
  const [showWhatsApp, setShowWhatsApp] = useState(false)

  useEffect(() => {
    const supabase = createClient()
    supabase
      .from("leads")
      .select(`
        *,
        telemarketer:telemarketers(id, full_name, email),
        call_logs(
          id, called_at, duration_seconds, call_outcome, call_notes,
          rag_status_after_call, funnel_stage_after_call,
          next_followup_date, next_followup_notes,
          telemarketer:telemarketers(full_name)
        ),
        sales(
          id, product, sale_amount, currency, sale_date, installation_date,
          installation_location, vehicle_registration, serial_number,
          subscription_type, renewal_due_date, renewal_reminder_sent, notes
        ),
        followup_schedule(
          id, followup_type, scheduled_date, notes, status, completed_at
        )
      `)
      .eq("id", leadId)
      .single()
      .then(({ data, error }) => {
        if (!error && data) {
          const d = data as unknown as LeadDetail
          setLead({
            ...d,
            call_logs: [...(d.call_logs ?? [])].sort(
              (a: LeadCallLog, b: LeadCallLog) => new Date(b.called_at).getTime() - new Date(a.called_at).getTime()
            ),
            followup_schedule: [...(d.followup_schedule ?? [])].sort(
              (a: LeadFollowUp, b: LeadFollowUp) => new Date(a.scheduled_date).getTime() - new Date(b.scheduled_date).getTime()
            ),
          })
        }
        setLoading(false)
      })
  }, [leadId])

  async function confirmStageChange() {
    if (!pendingStage || !lead) return
    setStageSaving(true)
    const supabase = createClient()
    const { error } = await supabase.from("leads")
      .update({ funnel_stage: pendingStage })
      .eq("id", lead.id)
    if (error) {
      toast.error("Failed to update stage")
    } else {
      setLead((prev) => prev && { ...prev, funnel_stage: pendingStage })
      toast.success(`Stage updated to ${FUNNEL_STAGE_LABELS[pendingStage]}`)
    }
    setStageSaving(false)
    setPendingStage(null)
  }

  async function handleRagOverride(status: RAGStatus) {
    if (!lead) return
    setRagSaving(true)
    const supabase = createClient()
    const { error } = await supabase.from("leads")
      .update({ rag_status: status })
      .eq("id", lead.id)
    if (error) {
      toast.error("Failed to update RAG status")
    } else {
      setLead((prev) => prev && { ...prev, rag_status: status })
      toast.success("RAG status updated")
    }
    setRagSaving(false)
    setShowRagPicker(false)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
      </div>
    )
  }

  if (!lead) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3 text-center p-6">
        <p className="text-slate-500">Lead not found.</p>
        <Link href="/leads" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
          Back to Leads
        </Link>
      </div>
    )
  }

  const isPostSale = POST_SALE_STAGES.includes(lead.funnel_stage)

  return (
    <div className="flex flex-col min-h-screen">
      {/* Page header */}
      <div className="border-b border-slate-200 bg-white sticky top-16 z-30">
        <div className="px-4 lg:px-6 py-3 space-y-3">
          {/* Back + meta row */}
          <div className="flex items-center gap-3">
            <Link
              href="/leads"
              className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-700 transition-colors"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              My Leads
            </Link>
            <span className="text-slate-300 text-xs">/</span>
            <span className="text-xs text-slate-500 font-mono">{lead.phone_number}</span>
          </div>

          {/* Lead identity + controls */}
          <div className="flex flex-wrap items-start gap-3 justify-between">
            <div>
              <h1 className="text-xl font-bold text-slate-900">
                {lead.full_name ?? <span className="text-slate-400 italic font-normal">Unknown Lead</span>}
              </h1>
              <p className="text-sm text-slate-500 font-mono mt-0.5">{lead.phone_number}</p>
              <p className="text-xs text-slate-400 mt-0.5">
                Added {formatDate(lead.created_at)}
                {lead.telemarketer && ` · Assigned to ${lead.telemarketer.full_name}`}
              </p>
            </div>

            {/* Funnel stage + RAG controls */}
            <div className="flex items-center gap-2 flex-wrap">
              {/* Funnel stage dropdown */}
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-500 hidden sm:block">Stage:</span>
                <select
                  value={lead.funnel_stage}
                  onChange={(e) => setPendingStage(e.target.value as FunnelStage)}
                  className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
                >
                  {FUNNEL_STAGES.map((s) => (
                    <option key={s} value={s}>{FUNNEL_STAGE_LABELS[s]}</option>
                  ))}
                </select>
              </div>

              {/* RAG badge — clickable */}
              <div className="relative">
                <button
                  onClick={() => setShowRagPicker((v) => !v)}
                  disabled={ragSaving}
                  className="flex items-center gap-1.5 h-8 px-3 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 transition-colors"
                >
                  {ragSaving ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" />
                  ) : (
                    <RAGBadge status={lead.rag_status} />
                  )}
                </button>
                {showRagPicker && (
                  <div className="absolute right-0 top-9 z-50 flex gap-1.5 p-2 bg-white rounded-lg border border-slate-200 shadow-md">
                    {(["green", "amber", "red"] as const).map((s) => (
                      <button
                        key={s}
                        onClick={() => handleRagOverride(s)}
                        className={cn(
                          "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
                          s === "green" && "bg-green-50 text-green-700 hover:bg-green-100",
                          s === "amber" && "bg-amber-50 text-amber-700 hover:bg-amber-100",
                          s === "red"   && "bg-red-50 text-red-700 hover:bg-red-100",
                        )}
                      >
                        <RAGBadge status={s} showLabel={false} />
                        <span className="capitalize">{s}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <FunnelStageBadge stage={lead.funnel_stage} />

              <Button
                size="sm"
                variant="outline"
                onClick={() => setShowWhatsApp(true)}
                className="gap-1.5 border-green-200 text-green-700 hover:bg-green-50 hover:border-green-300"
              >
                <MessageCircle className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">WhatsApp Chat</span>
                <span className="sm:hidden">Chat</span>
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Tab content */}
      <div className="flex-1 px-4 lg:px-6 py-4">
        <LeadDetailTabs
          lead={lead}
          isPostSale={isPostSale}
          onLeadUpdated={(updates) => setLead((prev) => prev && { ...prev, ...updates })}
        />
      </div>

      {/* WhatsApp Chat side panel */}
      <WhatsAppPanel
        open={showWhatsApp}
        onClose={() => setShowWhatsApp(false)}
        lead={lead}
      />

      {/* Funnel stage confirmation dialog */}
      <Dialog open={!!pendingStage} onOpenChange={(open: boolean) => { if (!open) setPendingStage(null) }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Change Funnel Stage?</DialogTitle>
            <DialogDescription>
              Move{" "}
              <strong>{lead.full_name ?? lead.phone_number}</strong> from{" "}
              <strong>{FUNNEL_STAGE_LABELS[lead.funnel_stage]}</strong> to{" "}
              <strong>{pendingStage ? FUNNEL_STAGE_LABELS[pendingStage] : ""}</strong>?
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-3 mt-2">
            <Button variant="outline" className="flex-1" onClick={() => setPendingStage(null)} disabled={stageSaving}>
              Cancel
            </Button>
            <Button className="flex-1" onClick={confirmStageChange} disabled={stageSaving}>
              {stageSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Confirm"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
