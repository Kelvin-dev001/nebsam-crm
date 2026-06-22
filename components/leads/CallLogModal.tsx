"use client"

import { useEffect } from "react"
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
}

// ── Schema ────────────────────────────────────────────────────────────────────

const schema = z
  .object({
    call_outcome: z.enum([
      "answered",
      "no_answer",
      "busy",
      "callback_requested",
      "wrong_number",
    ]),
    duration_minutes: z.number().min(0).max(999).optional(),
    duration_secs: z.number().min(0).max(59).optional(),
    call_notes: z.string().min(1, "Notes are required"),
    rag_status: z.enum(["green", "amber", "red"]),
    funnel_stage: z.string().optional(),
    update_kyc: z.boolean().default(false),
    kyc_full_name: z.string().optional(),
    kyc_location: z.string().optional(),
    kyc_vehicle_type: z.string().optional(),
    kyc_product: z.string().optional(),
    has_followup: z.boolean().default(false),
    followup_date: z.string().optional(),
    followup_notes: z.string().optional(),
  })
  .refine(
    (d) => !d.has_followup || !!d.followup_date,
    { message: "Follow-up date is required", path: ["followup_date"] }
  )

type FormValues = z.infer<typeof schema>

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  lead: CallingLead | null
  onClose: () => void
  onSaved: (payload: CallSavedPayload) => void
}

const OUTCOME_OPTIONS = [
  { value: "answered",           label: "Answered" },
  { value: "no_answer",          label: "No Answer" },
  { value: "busy",               label: "Busy" },
  { value: "callback_requested", label: "Callback Requested" },
  { value: "wrong_number",       label: "Wrong Number" },
]

export function CallLogModal({ lead, onClose, onSaved }: Props) {
  const { activeTelemarketer } = useTelemarketerStore()

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
      update_kyc: false,
      has_followup: false,
    },
  })

  const watchRag = watch("rag_status")
  const watchKyc = watch("update_kyc")
  const watchFollowup = watch("has_followup")

  // Reset form with lead defaults whenever the modal opens
  useEffect(() => {
    if (lead) {
      reset({
        call_outcome: undefined,
        duration_minutes: 0,
        duration_secs: 0,
        call_notes: "",
        rag_status: lead.rag_status,
        funnel_stage: lead.funnel_stage,
        update_kyc: false,
        kyc_full_name: lead.full_name ?? "",
        kyc_location: lead.location ?? "",
        kyc_vehicle_type: lead.vehicle_type ?? "",
        kyc_product: lead.product_interested ?? "",
        has_followup: false,
        followup_date: "",
        followup_notes: "",
      })
    }
  }, [lead, reset])

  async function onSubmit(values: FormValues) {
    if (!lead || !activeTelemarketer) return

    const newFunnelStage = (values.funnel_stage as FunnelStage | undefined) ?? lead.funnel_stage
    const newRagStatus = values.rag_status

    // Optimistic: update the parent immediately and close
    onSaved({ leadId: lead.id, ragStatus: newRagStatus, funnelStage: newFunnelStage })
    onClose()

    // Background writes
    const supabase = createClient()
    const durationSeconds =
      (values.duration_minutes ?? 0) * 60 + (values.duration_secs ?? 0)

    try {
      // 1. Create call log
      const { error: logErr } = await supabase.from("call_logs").insert({
        lead_id: lead.id,
        telemarketer_id: activeTelemarketer.id,
        call_outcome: values.call_outcome,
        duration_seconds: durationSeconds || null,
        call_notes: values.call_notes,
        rag_status_after_call: newRagStatus,
        funnel_stage_after_call: newFunnelStage,
        next_followup_date: values.has_followup ? values.followup_date : null,
        next_followup_notes: values.has_followup ? values.followup_notes : null,
      } as any)
      if (logErr) throw logErr

      // 2. Update lead fields
      const leadUpdate: Record<string, unknown> = {
        rag_status: newRagStatus,
        funnel_stage: newFunnelStage,
      }
      if (values.update_kyc) {
        if (values.kyc_full_name)    leadUpdate.full_name          = values.kyc_full_name
        if (values.kyc_location)     leadUpdate.location           = values.kyc_location
        if (values.kyc_vehicle_type) leadUpdate.vehicle_type       = values.kyc_vehicle_type
        if (values.kyc_product)      leadUpdate.product_interested = values.kyc_product
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: leadErr } = await (supabase.from("leads") as any).update(leadUpdate).eq("id", lead.id)
      if (leadErr) throw leadErr

      // 3. Create follow-up schedule if set
      if (values.has_followup && values.followup_date) {
        const { error: fuErr } = await supabase.from("followup_schedule").insert({
          lead_id: lead.id,
          telemarketer_id: activeTelemarketer.id,
          followup_type: "pre_sale",
          scheduled_date: values.followup_date,
          notes: values.followup_notes || null,
          status: "pending",
        } as any)
        if (fuErr) throw fuErr
      }

      toast.success("Call logged successfully")
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
              Call Notes <span className="text-red-500">*</span>
            </Label>
            <Textarea
              rows={3}
              placeholder="What did the client say? What was discussed?"
              {...register("call_notes")}
              className="text-sm resize-none"
            />
            {errors.call_notes && (
              <p className="text-xs text-red-500">{errors.call_notes.message}</p>
            )}
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
              onClick={() => setValue("update_kyc", !watchKyc)}
              className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-50 transition-colors"
            >
              <span className="text-sm font-medium text-slate-700">Update KYC during call?</span>
              <div className={cn(
                "relative h-5 w-9 rounded-full transition-colors",
                watchKyc ? "bg-blue-600" : "bg-slate-200"
              )}>
                <div className={cn(
                  "absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform",
                  watchKyc ? "translate-x-4" : "translate-x-0.5"
                )} />
              </div>
            </button>
            {watchKyc && (
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
              onClick={() => setValue("has_followup", !watchFollowup)}
              className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-50 transition-colors"
            >
              <span className="text-sm font-medium text-slate-700">Schedule next follow-up?</span>
              <div className={cn(
                "relative h-5 w-9 rounded-full transition-colors",
                watchFollowup ? "bg-blue-600" : "bg-slate-200"
              )}>
                <div className={cn(
                  "absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform",
                  watchFollowup ? "translate-x-4" : "translate-x-0.5"
                )} />
              </div>
            </button>
            {watchFollowup && (
              <div className="border-t border-slate-100 px-4 py-3 space-y-3 bg-slate-50">
                <div className="space-y-1">
                  <Label className="text-xs text-slate-600">Follow-up Date <span className="text-red-500">*</span></Label>
                  <Input
                    type="date"
                    {...register("followup_date")}
                    min={new Date().toISOString().split("T")[0]}
                    className="h-8 text-sm"
                  />
                  {errors.followup_date && (
                    <p className="text-xs text-red-500">{errors.followup_date.message}</p>
                  )}
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
