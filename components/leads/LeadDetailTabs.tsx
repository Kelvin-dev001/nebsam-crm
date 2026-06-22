"use client"

import { useState } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { Loader2, Phone, Plus, Lock, CalendarCheck, CheckCircle2, Clock, XCircle } from "lucide-react"
import { toast } from "sonner"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { createClient } from "@/lib/supabase/client"
import { useTelemarketerStore } from "@/lib/stores/telemarketerStore"
import { PRODUCTS, FUNNEL_STAGE_LABELS } from "@/types/crm"
import { RAGBadge } from "./RAGBadge"
import { FunnelStageBadge } from "./FunnelStageBadge"
import { type LeadDetail, type LeadSale } from "./LeadDetailShell"
import { formatDate, formatDateTime, formatRelative } from "@/lib/utils/dateHelpers"
import { cn } from "@/lib/utils"
import type { Resolver } from "react-hook-form"

// ─── KYC Tab ──────────────────────────────────────────────────────────────────

const kycSchema = z.object({
  full_name: z.string().optional(),
  location: z.string().optional(),
  vehicle_type: z.string().optional(),
  product_interested: z.string().optional(),
  campaign_name: z.string().optional(),
  lead_source: z.string().optional(),
})
type KYCValues = z.infer<typeof kycSchema>

const LEAD_SOURCES = [
  { value: "whatsapp_bot", label: "WhatsApp Bot" },
  { value: "meta_ads",     label: "Meta Ads" },
  { value: "tiktok_ads",   label: "TikTok Ads" },
  { value: "referral",     label: "Referral" },
  { value: "manual",       label: "Manual" },
]

function KYCTab({ lead, onLeadUpdated }: { lead: LeadDetail; onLeadUpdated: (u: Partial<LeadDetail>) => void }) {
  const { register, handleSubmit, formState: { isSubmitting, isDirty } } = useForm<KYCValues>({
    resolver: zodResolver(kycSchema) as Resolver<KYCValues>,
    defaultValues: {
      full_name: lead.full_name ?? "",
      location: lead.location ?? "",
      vehicle_type: lead.vehicle_type ?? "",
      product_interested: lead.product_interested ?? "",
      campaign_name: lead.campaign_name ?? "",
      lead_source: lead.lead_source,
    },
  })

  async function onSubmit(values: KYCValues) {
    const supabase = createClient()
    const { error } = await (supabase.from("leads") as any).update(values).eq("id", lead.id)
    if (error) { toast.error("Failed to save"); return }
    onLeadUpdated(values as Partial<LeadDetail>)
    toast.success("Profile saved")
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
      {/* First WhatsApp message */}
      {lead.whatsapp_message && (
        <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
          <p className="text-xs font-semibold text-slate-500 mb-2 uppercase tracking-wide">First WhatsApp Message</p>
          <blockquote className="text-sm text-slate-700 italic border-l-2 border-blue-400 pl-3">
            {lead.whatsapp_message}
          </blockquote>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Full Name</Label>
          <Input {...register("full_name")} placeholder="Full name" className="h-9" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Phone Number</Label>
          <Input value={lead.phone_number} readOnly className="h-9 font-mono bg-slate-50 text-slate-500" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Location</Label>
          <Input {...register("location")} placeholder="City / Estate" className="h-9" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Vehicle Type</Label>
          <Input {...register("vehicle_type")} placeholder="e.g. Toyota Prado" className="h-9" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Product Interested</Label>
          <select
            {...register("product_interested")}
            className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="">— select —</option>
            {PRODUCTS.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Lead Source</Label>
          <select
            {...register("lead_source")}
            className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            {LEAD_SOURCES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Campaign Name</Label>
          <Input {...register("campaign_name")} placeholder="e.g. June 2026 Fuel Push" className="h-9" />
        </div>
      </div>

      {lead.telemarketer && (
        <div className="text-xs text-slate-400 border-t border-slate-100 pt-3">
          Assigned to <strong className="text-slate-600">{lead.telemarketer.full_name}</strong>
          {" "}· Added {formatDate(lead.created_at)}
          {" "}· Last updated {formatDate(lead.updated_at)}
        </div>
      )}

      <Button type="submit" disabled={isSubmitting || !isDirty} className="w-full sm:w-auto">
        {isSubmitting ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…</> : "Save Changes"}
      </Button>
    </form>
  )
}

// ─── Call History Tab ─────────────────────────────────────────────────────────

const OUTCOME_CONFIG: Record<string, { label: string; color: string }> = {
  answered:           { label: "Answered",        color: "bg-green-100 text-green-700 border-green-200" },
  no_answer:          { label: "No Answer",        color: "bg-slate-100 text-slate-600 border-slate-200" },
  busy:               { label: "Busy",             color: "bg-amber-100 text-amber-700 border-amber-200" },
  callback_requested: { label: "Callback",         color: "bg-blue-100 text-blue-700 border-blue-200" },
  wrong_number:       { label: "Wrong Number",     color: "bg-red-100 text-red-700 border-red-200" },
}

function CallHistoryTab({ lead }: { lead: LeadDetail }) {
  if (lead.call_logs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center gap-2">
        <Phone className="h-10 w-10 text-slate-300" />
        <p className="text-sm font-medium text-slate-500">No calls logged yet</p>
        <p className="text-xs text-slate-400">Use the Call Now button to log the first call.</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {lead.call_logs.map((log, i) => {
        const outcome = OUTCOME_CONFIG[log.call_outcome] ?? { label: log.call_outcome, color: "bg-slate-100 text-slate-600 border-slate-200" }
        const mins = log.duration_seconds ? Math.floor(log.duration_seconds / 60) : null
        const secs = log.duration_seconds ? log.duration_seconds % 60 : null

        return (
          <div key={log.id} className="flex gap-4">
            {/* Timeline dot */}
            <div className="flex flex-col items-center">
              <div className={cn(
                "h-8 w-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0",
                i === 0 ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-500"
              )}>
                {lead.call_logs.length - i}
              </div>
              {i < lead.call_logs.length - 1 && <div className="w-px flex-1 bg-slate-200 my-1" />}
            </div>

            {/* Log content */}
            <div className="flex-1 pb-4 min-w-0">
              <div className="flex flex-wrap items-center gap-2 mb-1.5">
                <Badge variant="outline" className={cn("text-xs", outcome.color)}>{outcome.label}</Badge>
                {log.duration_seconds != null && (
                  <span className="text-xs text-slate-400">{mins}m {secs}s</span>
                )}
                {log.rag_status_after_call && (
                  <RAGBadge status={log.rag_status_after_call as any} />
                )}
                {log.funnel_stage_after_call && (
                  <FunnelStageBadge stage={log.funnel_stage_after_call as any} />
                )}
              </div>
              {log.call_notes && (
                <p className="text-sm text-slate-700 mb-1.5">{log.call_notes}</p>
              )}
              {log.next_followup_date && (
                <p className="text-xs text-blue-600">
                  Follow-up: {formatDate(log.next_followup_date)}
                  {log.next_followup_notes && ` — ${log.next_followup_notes}`}
                </p>
              )}
              <div className="flex items-center gap-2 mt-1.5">
                <p className="text-xs text-slate-400">{formatDateTime(log.called_at)}</p>
                <span className="text-slate-300 text-xs">·</span>
                <p className="text-xs text-slate-400">{formatRelative(log.called_at)}</p>
                {log.telemarketer && (
                  <>
                    <span className="text-slate-300 text-xs">·</span>
                    <p className="text-xs text-slate-400">{log.telemarketer.full_name}</p>
                  </>
                )}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─── Sale Details Tab ─────────────────────────────────────────────────────────

const saleSchema = z.object({
  product: z.string().min(1, "Product is required"),
  sale_amount: z.number().min(0).optional(),
  sale_date: z.string().min(1, "Sale date is required"),
  installation_date: z.string().optional(),
  installation_location: z.string().optional(),
  vehicle_registration: z.string().optional(),
  serial_number: z.string().optional(),
  subscription_type: z.enum(["annual", "once_off"]),
  notes: z.string().optional(),
})
type SaleValues = z.infer<typeof saleSchema>

function SaleDetailsTab({
  lead,
  isPostSale,
  onSaleUpdated,
}: {
  lead: LeadDetail
  isPostSale: boolean
  onSaleUpdated: (sale: LeadSale) => void
}) {
  const { activeTelemarketer } = useTelemarketerStore()
  const existingSale = lead.sales[0] ?? null
  const [editing, setEditing] = useState(!existingSale)

  const { register, handleSubmit, formState: { isSubmitting, errors } } = useForm<SaleValues>({
    resolver: zodResolver(saleSchema) as Resolver<SaleValues>,
    defaultValues: {
      product: existingSale?.product ?? lead.product_interested ?? "",
      sale_amount: existingSale?.sale_amount ?? undefined,
      sale_date: existingSale?.sale_date ?? new Date().toISOString().split("T")[0],
      installation_date: existingSale?.installation_date ?? "",
      installation_location: existingSale?.installation_location ?? "",
      vehicle_registration: existingSale?.vehicle_registration ?? "",
      serial_number: existingSale?.serial_number ?? "",
      subscription_type: (existingSale?.subscription_type as "annual" | "once_off") ?? "annual",
      notes: existingSale?.notes ?? "",
    },
  })

  if (!isPostSale) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center gap-2">
        <Lock className="h-10 w-10 text-slate-300" />
        <p className="text-sm font-medium text-slate-500">Sale details not yet available</p>
        <p className="text-xs text-slate-400">Change the funnel stage to <strong>Won</strong> or beyond to unlock this tab.</p>
      </div>
    )
  }

  async function onSubmit(values: SaleValues) {
    if (!activeTelemarketer) { toast.error("No telemarketer selected"); return }
    const supabase = createClient()

    const payload = {
      lead_id: lead.id,
      telemarketer_id: activeTelemarketer.id,
      ...values,
      sale_amount: values.sale_amount ?? null,
      installation_date: values.installation_date || null,
      installation_location: values.installation_location || null,
      vehicle_registration: values.vehicle_registration || null,
      serial_number: values.serial_number || null,
      notes: values.notes || null,
    }

    let savedSale: LeadSale | null = null

    if (existingSale) {
      const { data, error } = await (supabase.from("sales") as any).update(payload).eq("id", existingSale.id).select().single()
      if (error) { toast.error("Failed to update sale"); return }
      savedSale = data
    } else {
      const { data, error } = await (supabase.from("sales") as any).insert(payload).select().single()
      if (error) { toast.error("Failed to create sale"); return }
      savedSale = data
    }

    if (savedSale) {
      onSaleUpdated(savedSale)
      toast.success(existingSale ? "Sale updated" : "Sale created")
      setEditing(false)
    }
  }

  if (!editing && existingSale) {
    return (
      <div className="space-y-4">
        <div className="flex justify-between items-center">
          <h3 className="text-sm font-semibold text-slate-700">Sale Record</h3>
          <Button variant="outline" size="sm" onClick={() => setEditing(true)}>Edit</Button>
        </div>
        <div className="grid grid-cols-2 gap-4">
          {[
            { label: "Product",          value: existingSale.product },
            { label: "Amount",           value: existingSale.sale_amount ? `KES ${existingSale.sale_amount.toLocaleString()}` : "—" },
            { label: "Sale Date",        value: existingSale.sale_date ? formatDate(existingSale.sale_date) : "—" },
            { label: "Subscription",     value: existingSale.subscription_type === "annual" ? "Annual" : "Once-off" },
            { label: "Installation",     value: existingSale.installation_date ? formatDate(existingSale.installation_date) : "—" },
            { label: "Install Location", value: existingSale.installation_location ?? "—" },
            { label: "Vehicle Reg",      value: existingSale.vehicle_registration ?? "—" },
            { label: "Serial Number",    value: existingSale.serial_number ?? "—" },
            { label: "Renewal Due",      value: existingSale.renewal_due_date ? formatDate(existingSale.renewal_due_date) : "—" },
          ].map(({ label, value }) => (
            <div key={label}>
              <p className="text-xs text-slate-400 uppercase tracking-wide font-medium">{label}</p>
              <p className="text-sm text-slate-800 mt-0.5">{value}</p>
            </div>
          ))}
          {existingSale.notes && (
            <div className="col-span-2">
              <p className="text-xs text-slate-400 uppercase tracking-wide font-medium">Notes</p>
              <p className="text-sm text-slate-800 mt-0.5">{existingSale.notes}</p>
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="text-sm font-semibold text-slate-700">{existingSale ? "Edit Sale" : "Create Sale Record"}</h3>
        {existingSale && <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(false)}>Cancel</Button>}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5 sm:col-span-2">
          <Label className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Product <span className="text-red-500">*</span></Label>
          <select
            {...register("product")}
            className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="">— select product —</option>
            {PRODUCTS.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          {errors.product && <p className="text-xs text-red-500">{errors.product.message}</p>}
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Amount (KES)</Label>
          <Input
            type="number"
            min={0}
            placeholder="0"
            {...register("sale_amount", { valueAsNumber: true })}
            className="h-9"
          />
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Sale Date <span className="text-red-500">*</span></Label>
          <Input type="date" {...register("sale_date")} className="h-9" />
          {errors.sale_date && <p className="text-xs text-red-500">{errors.sale_date.message}</p>}
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Installation Date</Label>
          <Input type="date" {...register("installation_date")} className="h-9" />
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Installation Location</Label>
          <Input {...register("installation_location")} placeholder="e.g. Industrial Area" className="h-9" />
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Vehicle Registration</Label>
          <Input {...register("vehicle_registration")} placeholder="e.g. KBZ 123A" className="h-9 uppercase" />
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Serial Number</Label>
          <Input {...register("serial_number")} placeholder="Device serial" className="h-9" />
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Subscription</Label>
          <select
            {...register("subscription_type")}
            className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="annual">Annual</option>
            <option value="once_off">Once-off</option>
          </select>
        </div>

        <div className="space-y-1.5 sm:col-span-2">
          <Label className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Notes</Label>
          <Textarea rows={2} {...register("notes")} className="text-sm resize-none" />
        </div>
      </div>

      <p className="text-xs text-slate-400">Renewal date is auto-calculated as installation date + 365 days.</p>

      <div className="flex gap-3">
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…</> : existingSale ? "Update Sale" : "Create Sale"}
        </Button>
      </div>
    </form>
  )
}

// ─── Follow-up Schedule Tab ────────────────────────────────────────────────────

const followUpSchema = z.object({
  scheduled_date: z.string().min(1, "Date is required"),
  followup_type: z.enum(["pre_sale", "post_sale_renewal", "check_in"]),
  notes: z.string().optional(),
})
type FollowUpValues = z.infer<typeof followUpSchema>

const STATUS_ICON: Record<string, { icon: React.FC<{ className?: string }>; color: string; label: string }> = {
  pending:     { icon: Clock,         color: "text-amber-500", label: "Pending"     },
  completed:   { icon: CheckCircle2,  color: "text-green-500", label: "Completed"   },
  missed:      { icon: XCircle,       color: "text-red-500",   label: "Missed"      },
  rescheduled: { icon: CalendarCheck, color: "text-blue-500",  label: "Rescheduled" },
}

function FollowUpTab({ lead, onFollowUpAdded }: { lead: LeadDetail; onFollowUpAdded: (f: any) => void }) {
  const { activeTelemarketer } = useTelemarketerStore()
  const [showForm, setShowForm] = useState(false)

  const { register, handleSubmit, reset, formState: { isSubmitting, errors } } = useForm<FollowUpValues>({
    resolver: zodResolver(followUpSchema) as Resolver<FollowUpValues>,
    defaultValues: { scheduled_date: "", followup_type: "pre_sale", notes: "" },
  })

  async function onSubmit(values: FollowUpValues) {
    if (!activeTelemarketer) { toast.error("No telemarketer selected"); return }
    const supabase = createClient()
    const { data, error } = await (supabase.from("followup_schedule") as any).insert({
      lead_id: lead.id,
      telemarketer_id: activeTelemarketer.id,
      ...values,
      notes: values.notes || null,
      status: "pending",
    }).select().single()
    if (error) { toast.error("Failed to add follow-up"); return }
    onFollowUpAdded(data)
    toast.success("Follow-up scheduled")
    reset()
    setShowForm(false)
  }

  return (
    <div className="space-y-4">
      {/* Add button */}
      <div className="flex justify-between items-center">
        <h3 className="text-sm font-semibold text-slate-700">
          {lead.followup_schedule.length} follow-up{lead.followup_schedule.length !== 1 ? "s" : ""}
        </h3>
        <Button size="sm" variant="outline" onClick={() => setShowForm((v) => !v)} className="gap-1.5">
          <Plus className="h-3.5 w-3.5" />
          Add Follow-up
        </Button>
      </div>

      {/* Add form */}
      {showForm && (
        <Card className="border-blue-200 bg-blue-50/50 shadow-none">
          <CardContent className="pt-4">
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs text-slate-600">Date <span className="text-red-500">*</span></Label>
                  <Input type="date" {...register("scheduled_date")} className="h-8 text-sm" min={new Date().toISOString().split("T")[0]} />
                  {errors.scheduled_date && <p className="text-xs text-red-500">{errors.scheduled_date.message}</p>}
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-slate-600">Type</Label>
                  <select
                    {...register("followup_type")}
                    className="w-full h-8 rounded-md border border-input bg-background px-2 text-sm focus:outline-none"
                  >
                    <option value="pre_sale">Pre-Sale</option>
                    <option value="post_sale_renewal">Renewal</option>
                    <option value="check_in">Check-in</option>
                  </select>
                </div>
                <div className="space-y-1 sm:col-span-2">
                  <Label className="text-xs text-slate-600">Notes</Label>
                  <Input {...register("notes")} placeholder="What to discuss?" className="h-8 text-sm" />
                </div>
              </div>
              <div className="flex gap-2">
                <Button type="submit" size="sm" disabled={isSubmitting}>
                  {isSubmitting ? <Loader2 className="h-3 w-3 animate-spin" /> : "Schedule"}
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => { reset(); setShowForm(false) }}>Cancel</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Follow-up list */}
      {lead.followup_schedule.length === 0 && !showForm ? (
        <div className="flex flex-col items-center justify-center py-12 text-center gap-2">
          <CalendarCheck className="h-10 w-10 text-slate-300" />
          <p className="text-sm text-slate-500">No follow-ups scheduled yet</p>
        </div>
      ) : (
        <div className="space-y-2">
          {lead.followup_schedule.map((fu) => {
            const cfg = STATUS_ICON[fu.status] ?? STATUS_ICON.pending
            const Icon = cfg.icon
            const typeLabel = fu.followup_type === "pre_sale" ? "Pre-Sale" : fu.followup_type === "post_sale_renewal" ? "Renewal" : "Check-in"
            return (
              <div key={fu.id} className="flex items-start gap-3 p-3 rounded-lg border border-slate-100 hover:bg-slate-50">
                <Icon className={cn("h-4 w-4 shrink-0 mt-0.5", cfg.color)} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-medium text-slate-800">{formatDate(fu.scheduled_date)}</p>
                    <Badge variant="secondary" className="text-xs px-1.5 py-0">{typeLabel}</Badge>
                    <span className={cn("text-xs font-medium", cfg.color)}>{cfg.label}</span>
                  </div>
                  {fu.notes && <p className="text-xs text-slate-500 mt-0.5">{fu.notes}</p>}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── Main Tabs Component ───────────────────────────────────────────────────────

interface Props {
  lead: LeadDetail
  isPostSale: boolean
  onLeadUpdated: (updates: Partial<LeadDetail>) => void
}

export function LeadDetailTabs({ lead, isPostSale, onLeadUpdated }: Props) {
  return (
    <Tabs defaultValue="kyc">
      <TabsList variant="line" className="w-full sm:w-auto mb-4">
        <TabsTrigger value="kyc">KYC &amp; Profile</TabsTrigger>
        <TabsTrigger value="calls">
          Call History
          {lead.call_logs.length > 0 && (
            <Badge variant="secondary" className="ml-1.5 text-xs px-1.5 py-0">{lead.call_logs.length}</Badge>
          )}
        </TabsTrigger>
        <TabsTrigger value="sale">Sale Details</TabsTrigger>
        <TabsTrigger value="followups">
          Follow-ups
          {lead.followup_schedule.length > 0 && (
            <Badge variant="secondary" className="ml-1.5 text-xs px-1.5 py-0">{lead.followup_schedule.length}</Badge>
          )}
        </TabsTrigger>
      </TabsList>

      <Separator className="mb-5" />

      <TabsContent value="kyc">
        <KYCTab lead={lead} onLeadUpdated={onLeadUpdated} />
      </TabsContent>

      <TabsContent value="calls">
        <CallHistoryTab lead={lead} />
      </TabsContent>

      <TabsContent value="sale">
        <SaleDetailsTab
          lead={lead}
          isPostSale={isPostSale}
          onSaleUpdated={(sale) => onLeadUpdated({ sales: [sale, ...lead.sales.slice(1)] })}
        />
      </TabsContent>

      <TabsContent value="followups">
        <FollowUpTab
          lead={lead}
          onFollowUpAdded={(fu) =>
            onLeadUpdated({
              followup_schedule: [...lead.followup_schedule, fu].sort(
                (a, b) => new Date(a.scheduled_date).getTime() - new Date(b.scheduled_date).getTime()
              ),
            })
          }
        />
      </TabsContent>
    </Tabs>
  )
}
