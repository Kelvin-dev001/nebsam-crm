"use client"

import { useEffect, useState } from "react"
import { useForm, type Resolver } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { Loader2, Phone } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet"
import { RAGBadge } from "./RAGBadge"
import { createClient } from "@/lib/supabase/client"
import type { Database } from "@/lib/supabase/types"
type LeadUpdate = Database["public"]["Tables"]["leads"]["Update"]
import { useTelemarketerStore } from "@/lib/stores/telemarketerStore"
import { FunnelStage, RAGStatus, FUNNEL_STAGES, FUNNEL_STAGE_LABELS, PRODUCTS } from "@/types/crm"
import { cn } from "@/lib/utils"

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CallingLead {
  id: string
  phone_number: string
  full_name: string | null
  product_interested: string | null
  funnel_stage: FunnelStage
  rag_status: RAGStatus
  location?: string | null
  vehicle_type?: string | null
}

export interface CallSavedPayload {
  leadId: string
  ragStatus: RAGStatus
  funnelStage: FunnelStage
  callOutcome: string
  callNote: string | null
  calledAt: string
  /** TIMESTAMPTZ of the newly scheduled follow-up, or null if none set. */
  nextFollowup: string | null
}

// ── Schema ────────────────────────────────────────────────────────────────────

// 30-minute slots 8:00 AM – 7:00 PM
const TIME_OPTIONS = Array.from({ length: 23 }, (_, i) => {
  const totalMins = 8 * 60 + i * 30
  const h = Math.floor(totalMins / 60)
  const m = totalMins % 60
  const value = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`
  const period = h < 12 ? "AM" : "PM"
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h
  const label = `${h12}:${String(m).padStart(2, "0")} ${period}`
  return { value, label }
})

const schema = z.object({
  call_outcome: z.enum([
    "answered",
    "no_answer",
    "busy",
    "callback_requested",
    "wrong_number",
  ]),
  duration_minutes: z.number().min(0).max(999).optional(),
  duration_secs:    z.number().min(0).max(59).optional(),
  call_notes:       z.string().optional(),
  rag_status:       z.enum(["green", "amber", "red"]),
  funnel_stage:     z.string().optional(),
  kyc_full_name:    z.string().optional(),
  kyc_location:     z.string().optional(),
  kyc_vehicle_type: z.string().optional(),
  kyc_product:      z.string().optional(),
  followup_date:    z.string().optional().nullable(),
  followup_time:    z.string().optional().nullable(),
  followup_notes:   z.string().optional(),
})

type FormValues = z.infer<typeof schema>

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  lead: CallingLead | null
  onClose: () => void
  onSaved: (payload: CallSavedPayload) => void
  /** Attribute the call/follow-up to this telemarketer instead of the active one.
   *  Used by the admin all-reps backlog so calls land on the lead's owner. */
  actingTelemarketerId?: string | null
}

const OUTCOME_OPTIONS = [
  { value: "answered",           label: "Answered" },
  { value: "no_answer",          label: "No Answer" },
  { value: "busy",               label: "Busy" },
  { value: "callback_requested", label: "Callback Requested" },
  { value: "wrong_number",       label: "Wrong Number" },
]

export function CallLogModal({ lead, onClose, onSaved, actingTelemarketerId }: Props) {
  const { activeTelemarketer } = useTelemarketerStore()
  // Attribute writes to the passed-in rep (admin all-reps backlog) or the active one.
  const actingId = actingTelemarketerId ?? activeTelemarketer?.id ?? null
  // Toggles are plain React state — NOT react-hook-form fields. setValue-only RHF
  // fields silently collapse to their default at submit, which previously dropped
  // every follow-up and KYC update.
  const [updateKyc, setUpdateKyc] = useState(false)
  const [hasFollowup, setHasFollowup] = useState(false)

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema) as Resolver<FormValues>,
    defaultValues: {
      call_outcome: undefined,
      duration_minutes: 0,
      duration_secs: 0,
      call_notes: "",
      rag_status: undefined,
      funnel_stage: undefined,
    },
  })

  const watchRag = watch("rag_status")

  // Reset form with lead defaults whenever the modal opens
  useEffect(() => {
    if (lead) {
      setUpdateKyc(false)
      setHasFollowup(false)
      reset({
        call_outcome: undefined,
        duration_minutes: 0,
        duration_secs: 0,
        call_notes: "",
        rag_status: lead.rag_status,
        funnel_stage: lead.funnel_stage,
        kyc_full_name: lead.full_name ?? "",
        kyc_location: lead.location ?? "",
        kyc_vehicle_type: lead.vehicle_type ?? "",
        kyc_product: lead.product_interested ?? "",
        followup_date: "",
        followup_time: "",
        followup_notes: "",
      })
    }
  }, [lead, reset])

  async function onSubmit(values: FormValues) {
    if (!lead || !actingId) return

    const newFunnelStage = (values.funnel_stage as FunnelStage | undefined) ?? lead.funnel_stage
    const newRagStatus = values.rag_status

    // Combine follow-up date + time into a TIMESTAMPTZ string (EAT = UTC+3)
    const followupTime = values.followup_time || "09:00"
    const scheduledDateTime =
      hasFollowup && values.followup_date
        ? `${values.followup_date}T${followupTime}:00+03:00`
        : null

    // Optimistic: update the parent immediately and close
    onSaved({
      leadId: lead.id,
      ragStatus: newRagStatus,
      funnelStage: newFunnelStage,
      callOutcome: values.call_outcome,
      callNote: values.call_notes || null,
      calledAt: new Date().toISOString(),
      nextFollowup: scheduledDateTime,
    })
    onClose()

    // Background writes
    const supabase = createClient()
    const durationSeconds =
      (values.duration_minutes ?? 0) * 60 + (values.duration_secs ?? 0)

    try {
      // 1. Create call log
      const { error: logErr } = await supabase.from("call_logs").insert({
        lead_id: lead.id,
        telemarketer_id: actingId,
        call_outcome: values.call_outcome,
        duration_seconds: durationSeconds || null,
        call_notes: values.call_notes || null,
        rag_status_after_call: newRagStatus,
        funnel_stage_after_call: newFunnelStage,
        next_followup_date: hasFollowup ? values.followup_date : null,
        next_followup_notes: hasFollowup ? values.followup_notes : null,
      })
      if (logErr) throw logErr

      // 2. Update lead fields
      const leadUpdate: LeadUpdate = {
        rag_status: newRagStatus,
        funnel_stage: newFunnelStage,
      }
      if (updateKyc) {
        if (values.kyc_full_name)    leadUpdate.full_name          = values.kyc_full_name
        if (values.kyc_location)     leadUpdate.location           = values.kyc_location
        if (values.kyc_vehicle_type) leadUpdate.vehicle_type       = values.kyc_vehicle_type
        if (values.kyc_product)      leadUpdate.product_interested = values.kyc_product
      }
      const { error: leadErr } = await supabase.from("leads").update(leadUpdate).eq("id", lead.id)
      if (leadErr) throw leadErr

      // 3. Create follow-up schedule if set
      if (scheduledDateTime) {
        const { error: fuErr } = await supabase.from("followup_schedule").insert({
          lead_id: lead.id,
          telemarketer_id: actingId,
          followup_type: "pre_sale",
          scheduled_date: scheduledDateTime,
          notes: values.followup_notes || null,
          status: "pending",
        })
        if (fuErr) throw fuErr
      }

      toast.success("Call logged successfully")

      // Auto-send WhatsApp installation confirmation (fire and forget)
      if (newFunnelStage === "installed") {
        fetch("/api/whatsapp/installed-message", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ leadId: lead.id }),
        })
          .then(async (res) => {
            if (res.ok) {
              toast.success("✅ WhatsApp confirmation sent to client")
            } else {
              const d = await res.json().catch(() => ({})) as { error?: string }
              toast.warning(`⚠️ Stage updated but WhatsApp failed: ${d.error ?? "please send manually"}`)
            }
          })
          .catch(() =>
            toast.warning("⚠️ Stage updated but WhatsApp message failed — please send manually"),
          )
      }
    } catch (err) {
      console.error(err)
      toast.error("Failed to save call log — please try again")
    }
  }

  return (
    <Sheet open={!!lead} onOpenChange={(open: boolean) => { if (!open) onClose() }}>
      <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto p-0" showCloseButton={false}>
        {/* Header */}
        <SheetHeader className="sticky top-0 z-10 bg-white border-b border-slate-200 px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-600 text-white text-sm font-bold shrink-0">
                {(lead?.full_name ?? lead?.phone_number ?? "?")[0].toUpperCase()}
              </div>
              <div className="min-w-0">
                <SheetTitle className="text-base font-semibold text-slate-900 truncate">
                  {lead?.full_name ?? "Unknown Lead"}
                </SheetTitle>
                <SheetDescription className="text-xs text-slate-500 font-mono mt-0.5">
                  {lead?.phone_number}
                </SheetDescription>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Phone className="h-4 w-4 text-blue-600" />
              <span className="text-xs text-slate-500">{lead?.product_interested ?? "No product"}</span>
            </div>
          </div>
        </SheetHeader>

        {/* Form */}
        <form onSubmit={handleSubmit(onSubmit)} className="px-5 py-5 space-y-5">

          {/* Call Outcome */}
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-slate-700 uppercase tracking-wide">
              Call Outcome <span className="text-red-500">*</span>
            </Label>
            <select
              {...register("call_outcome")}
              className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="">Select outcome…</option>
              {OUTCOME_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            {errors.call_outcome && (
              <p className="text-xs text-red-500">{errors.call_outcome.message}</p>
            )}
          </div>

          {/* Duration */}
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-slate-700 uppercase tracking-wide">
              Duration
            </Label>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1.5">
                <Input
                  type="number"
                  min={0}
                  max={999}
                  placeholder="0"
                  {...register("duration_minutes", { valueAsNumber: true })}
                  className="w-16 h-9 text-center text-sm"
                />
                <span className="text-xs text-slate-500">min</span>
              </div>
              <span className="text-slate-400">:</span>
              <div className="flex items-center gap-1.5">
                <Input
                  type="number"
                  min={0}
                  max={59}
                  placeholder="0"
                  {...register("duration_secs", { valueAsNumber: true })}
                  className="w-16 h-9 text-center text-sm"
                />
                <span className="text-xs text-slate-500">sec</span>
              </div>
            </div>
          </div>

          {/* Notes */}
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-slate-700 uppercase tracking-wide">
              Call Notes
            </Label>
            <Textarea
              rows={4}
              placeholder="Enter call notes, client feedback, objections, next steps..."
              {...register("call_notes")}
              className="text-sm"
            />
          </div>

          {/* RAG Status */}
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-slate-700 uppercase tracking-wide">
              RAG Status <span className="text-red-500">*</span>
            </Label>
            <div className="grid grid-cols-3 gap-2">
              {(["green", "amber", "red"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setValue("rag_status", s, { shouldValidate: true })}
                  className={cn(
                    "flex items-center justify-center gap-2 h-9 rounded-lg border text-sm font-medium transition-all",
                    watchRag === s
                      ? s === "green"
                        ? "bg-green-600 text-white border-green-600"
                        : s === "amber"
                        ? "bg-amber-500 text-white border-amber-500"
                        : "bg-red-600 text-white border-red-600"
                      : "bg-white text-slate-600 border-slate-200 hover:border-slate-300"
                  )}
                >
                  <RAGBadge status={s} showLabel={false} />
                  <span className="capitalize">{s}</span>
                </button>
              ))}
            </div>
            {errors.rag_status && (
              <p className="text-xs text-red-500">{errors.rag_status.message as string}</p>
            )}
          </div>

          {/* Funnel Stage */}
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-slate-700 uppercase tracking-wide">
              Update Funnel Stage
            </Label>
            <select
              {...register("funnel_stage")}
              className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-ring"
            >
              {FUNNEL_STAGES.map((s) => (
                <option key={s} value={s}>{FUNNEL_STAGE_LABELS[s]}</option>
              ))}
            </select>
          </div>

          {/* KYC Toggle */}
          <div className="rounded-lg border border-slate-200 overflow-hidden">
            <button
              type="button"
              onClick={() => setUpdateKyc((v) => !v)}
              className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-50 transition-colors"
            >
              <span className="text-sm font-medium text-slate-700">Update KYC during call?</span>
              <div className={cn(
                "relative h-5 w-9 rounded-full transition-colors",
                updateKyc ? "bg-blue-600" : "bg-slate-200"
              )}>
                <div className={cn(
                  "absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform",
                  updateKyc ? "translate-x-4" : "translate-x-0.5"
                )} />
              </div>
            </button>
            {updateKyc && (
              <div className="border-t border-slate-100 px-4 py-3 space-y-3 bg-slate-50">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs text-slate-600">Full Name</Label>
                    <Input {...register("kyc_full_name")} className="h-8 text-sm" placeholder="Full name" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-slate-600">Location</Label>
                    <Input {...register("kyc_location")} className="h-8 text-sm" placeholder="City / Estate" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-slate-600">Vehicle Type</Label>
                    <Input {...register("kyc_vehicle_type")} className="h-8 text-sm" placeholder="e.g. Toyota Prado" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-slate-600">Product</Label>
                    <select
                      {...register("kyc_product")}
                      className="w-full h-8 rounded-md border border-input bg-background px-2 text-xs text-slate-700 focus:outline-none"
                    >
                      <option value="">— same —</option>
                      {PRODUCTS.map((p) => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Follow-up Toggle */}
          <div className="rounded-lg border border-slate-200 overflow-hidden">
            <button
              type="button"
              onClick={() => setHasFollowup((v) => !v)}
              className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-50 transition-colors"
            >
              <span className="text-sm font-medium text-slate-700">Schedule next follow-up?</span>
              <div className={cn(
                "relative h-5 w-9 rounded-full transition-colors",
                hasFollowup ? "bg-blue-600" : "bg-slate-200"
              )}>
                <div className={cn(
                  "absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform",
                  hasFollowup ? "translate-x-4" : "translate-x-0.5"
                )} />
              </div>
            </button>
            {hasFollowup && (
              <div className="border-t border-slate-100 px-4 py-3 space-y-3 bg-slate-50">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs text-slate-600">Date</Label>
                    <Input
                      type="date"
                      {...register("followup_date")}
                      min={new Date().toISOString().split("T")[0]}
                      className="h-8 text-sm"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-slate-600">Time</Label>
                    <select
                      {...register("followup_time")}
                      className="w-full h-8 rounded-md border border-input bg-background px-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-ring"
                    >
                      <option value="">— any time —</option>
                      {TIME_OPTIONS.map((t) => (
                        <option key={t.value} value={t.value}>{t.label}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-slate-600">Notes</Label>
                  <Textarea
                    rows={2}
                    {...register("followup_notes")}
                    placeholder="What to discuss next time?"
                    className="text-sm resize-none"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex gap-3 pt-2 pb-6">
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              onClick={onClose}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button type="submit" className="flex-1" disabled={isSubmitting}>
              {isSubmitting ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Saving…
                </>
              ) : (
                "Save & Close"
              )}
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  )
}
