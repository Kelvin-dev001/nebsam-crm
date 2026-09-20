"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { AlertTriangle, CalendarClock, Loader2, UserPlus } from "lucide-react"
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
import { KycFields } from "./KycFields"
import { createClient } from "@/lib/supabase/client"
import { useDepartment } from "@/lib/departments/useDepartment"
import { useDepartmentStore } from "@/lib/stores/departmentStore"
import { useTelemarketerStore } from "@/lib/stores/telemarketerStore"
import { normalizePhone, isValidKenyanPhone } from "@/lib/utils/phoneHelpers"
import {
  emptyKycValues,
  splitKycForSave,
  type KycValues,
} from "@/lib/utils/kycHelpers"
import { holidayFollowUpWarning } from "@/lib/utils/termHelpers"
import { cn } from "@/lib/utils"
import { format } from "date-fns"
import type { CallOutcome, LeadSource } from "@/types/crm"

/**
 * Manual prospect entry — the core of the multi-department work.
 *
 * The three new departments get no leads from the WhatsApp chatbot. A rep is
 * handed a number on a call or sources one offline, and needs to key it in,
 * complete a KYC, record how the first call went and set a follow-up.
 *
 * Every toggle here is plain React state, never an RHF `setValue`-only field.
 * That is the rule the CallLogModal comment records: setValue-only fields
 * collapse to their defaults at submit and silently drop follow-ups and KYC
 * answers. This form avoids react-hook-form entirely — the field set is built
 * at runtime from config, so there is nothing static to register.
 */

interface CrossDeptMatch {
  department_id: string
  department_slug: string
  department_name: string
  funnel_stage: string
  assigned_rep: string | null
  created_at: string
}

export interface NewProspectResult {
  id: string
  phone_number: string
  full_name: string | null
  company_name: string | null
  product_interested: string | null
  funnel_stage: string
  rag_status: string
  department_id: string
  created_at: string
  updated_at: string
}

interface Props {
  open: boolean
  onClose: () => void
  onCreated?: (lead: NewProspectResult) => void
}

const LEAD_SOURCES: { value: LeadSource | string; label: string }[] = [
  { value: "manual", label: "Manual entry" },
  { value: "referral", label: "Referral" },
  { value: "walk_in", label: "Walk-in" },
  { value: "cold_call", label: "Cold call" },
  { value: "existing_client", label: "Existing client" },
]

const CALL_OUTCOMES: { value: CallOutcome; label: string }[] = [
  { value: "answered", label: "Answered" },
  { value: "no_answer", label: "No answer" },
  { value: "busy", label: "Busy" },
  { value: "callback_requested", label: "Callback requested" },
  { value: "wrong_number", label: "Wrong number" },
]

const selectClasses =
  "w-full h-9 rounded-md border border-input bg-background px-3 text-sm text-slate-700 " +
  "focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"

export function NewProspectSheet({ open, onClose, onCreated }: Props) {
  const { activeTelemarketer } = useTelemarketerStore()
  const { department, departments, canSwitch, academicTerms } = useDepartment()
  const configs = useDepartmentStore((s) => s.configs)

  // Admin may pick; a rep is locked to their own department.
  const [chosenDeptId, setChosenDeptId] = useState<string | null>(null)
  const effectiveDeptId = canSwitch ? chosenDeptId : department?.id ?? null
  const config = effectiveDeptId ? configs[effectiveDeptId] ?? null : null
  const kycFields = useMemo(
    () => (config?.kycFields ?? []).filter((f) => f.is_active),
    [config],
  )
  const products = useMemo(
    () => (config?.products ?? []).filter((p) => p.is_active),
    [config],
  )

  const [phone, setPhone] = useState("")
  const [source, setSource] = useState<string>("manual")
  const [kyc, setKyc] = useState<KycValues>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)

  // Duplicate state
  const [checking, setChecking] = useState(false)
  const [matches, setMatches] = useState<CrossDeptMatch[]>([])
  const lastChecked = useRef<string>("")

  // Optional first call — plain state, deliberately not RHF
  const [logCall, setLogCall] = useState(false)
  const [callOutcome, setCallOutcome] = useState<CallOutcome>("answered")
  const [callNotes, setCallNotes] = useState("")

  // Optional follow-up — plain state
  const [setFollowup, setSetFollowup] = useState(false)
  const [followupDate, setFollowupDate] = useState("")
  const [followupTime, setFollowupTime] = useState("09:00")
  const [followupNotes, setFollowupNotes] = useState("")

  // Reset whenever the sheet opens, and seed the KYC shape from config.
  useEffect(() => {
    if (!open) return
    setPhone("")
    setSource("manual")
    setErrors({})
    setMatches([])
    lastChecked.current = ""
    setLogCall(false)
    setCallOutcome("answered")
    setCallNotes("")
    setSetFollowup(false)
    setFollowupDate("")
    setFollowupTime("09:00")
    setFollowupNotes("")
    setChosenDeptId(canSwitch ? null : department?.id ?? null)
  }, [open, canSwitch, department?.id])

  useEffect(() => {
    setKyc(emptyKycValues(kycFields))
  }, [kycFields])

  const sameDeptMatch = matches.find((m) => m.department_id === effectiveDeptId) ?? null
  const otherDeptMatches = matches.filter((m) => m.department_id !== effectiveDeptId)

  /** On blur: normalise, then ask the database where else this number lives. */
  async function checkDuplicates(raw: string) {
    const normalised = normalizePhone(raw)
    setPhone(normalised)
    if (!normalised || normalised === lastChecked.current) return
    if (!isValidKenyanPhone(normalised)) {
      setMatches([])
      return
    }

    lastChecked.current = normalised
    setChecking(true)
    try {
      const supabase = createClient()
      const { data, error } = await supabase.rpc("check_phone_across_departments", {
        p_phone: normalised,
      })
      if (error) {
        // Not fatal: the database still enforces uniqueness on save. Warn only.
        console.error("[new prospect] duplicate check failed:", error.message)
        setMatches([])
        return
      }
      setMatches((data ?? []) as unknown as CrossDeptMatch[])
    } finally {
      setChecking(false)
    }
  }

  function validate(): boolean {
    const next: Record<string, string> = {}
    if (!phone) next._phone = "Phone number is required"
    else if (!isValidKenyanPhone(phone)) next._phone = "Enter a valid Kenyan number"
    if (!effectiveDeptId) next._department = "Choose a department"

    for (const f of kycFields) {
      if (!f.is_required) continue
      const v = kyc[f.key]
      const empty =
        v == null || v === "" || (Array.isArray(v) && v.length === 0)
      if (empty) next[f.key] = `${f.label} is required`
    }

    if (setFollowup && !followupDate) next._followup = "Pick a follow-up date"

    setErrors(next)
    return Object.keys(next).length === 0
  }

  async function handleSave() {
    if (sameDeptMatch) return
    if (!validate()) return
    if (!effectiveDeptId) return

    const dept = departments.find((d) => d.id === effectiveDeptId)
    if (!dept) return

    setSaving(true)
    const supabase = createClient()
    const { kyc: kycBlob, columns } = splitKycForSave(kyc, kycFields)

    try {
      // 1. One RPC creates the lead, applying the department's assignment mode.
      const { data, error } = await supabase.rpc("create_manual_lead", {
        p_department_slug: dept.slug,
        p_phone: phone,
        p_company: (columns.company_name as string) ?? null,
        p_contact_name: (columns.full_name as string) ?? null,
        p_kyc: kycBlob as never,
        p_product: (columns.product_interested as string) ?? null,
        p_source: source,
        p_created_by: activeTelemarketer?.id ?? null,
        p_location: (columns.location as string) ?? null,
      })

      if (error) {
        // The RPC raises a typed unique_violation for a same-department
        // duplicate so this reads as a sentence rather than a SQL error.
        const duplicate =
          error.message.includes("already exists in department") ||
          error.code === "23505"
        toast.error(
          duplicate
            ? "That number is already a prospect in your department."
            : `Could not create the prospect: ${error.message}`,
        )
        return
      }

      const lead = data as unknown as NewProspectResult
      if (!lead?.id) {
        toast.error("The prospect was not created — please try again.")
        return
      }

      // 2. Optional first call log.
      if (logCall && activeTelemarketer) {
        const { error: callErr } = await supabase.from("call_logs").insert({
          lead_id: lead.id,
          telemarketer_id: activeTelemarketer.id,
          call_outcome: callOutcome,
          call_notes: callNotes || null,
          rag_status_after_call: lead.rag_status,
          funnel_stage_after_call: lead.funnel_stage,
          department_id: effectiveDeptId,
        })
        if (callErr) {
          console.error(callErr)
          toast.warning("Prospect saved, but the call log failed to record.")
        }
      }

      // 3. Optional follow-up. Built as +03:00 so it lands at the intended
      //    local time regardless of where the browser thinks it is.
      if (setFollowup && followupDate && activeTelemarketer) {
        const scheduled = `${followupDate}T${followupTime}:00+03:00`
        const { error: fuErr } = await supabase.from("followup_schedule").insert({
          lead_id: lead.id,
          telemarketer_id: activeTelemarketer.id,
          followup_type: "pre_sale",
          scheduled_date: scheduled,
          notes: followupNotes || null,
          status: "pending",
          department_id: effectiveDeptId,
        })
        if (fuErr) {
          console.error(fuErr)
          toast.warning("Prospect saved, but the follow-up failed to schedule.")
        }
      }

      toast.success(
        `${lead.company_name || lead.full_name || lead.phone_number} added to ${dept.name}`,
      )
      onCreated?.(lead)
      onClose()
    } catch (err) {
      console.error(err)
      toast.error("Could not create the prospect — please try again.")
    } finally {
      setSaving(false)
    }
  }

  // Holiday-aware follow-up picker, school bus only. Never blocks the date.
  const holidayWarning = useMemo(() => {
    if (!followupDate) return null
    if (config?.department.slug !== "school_bus") return null
    const d = new Date(`${followupDate}T12:00:00`)
    return holidayFollowUpWarning(academicTerms, d)
  }, [followupDate, config?.department.slug, academicTerms])

  return (
    <Sheet open={open} onOpenChange={(o: boolean) => { if (!o) onClose() }}>
      <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader className="px-0">
          <SheetTitle className="flex items-center gap-2">
            <UserPlus className="h-4 w-4" />
            New Prospect
          </SheetTitle>
          <SheetDescription>
            {department
              ? `Added to ${department.name} and assigned to you.`
              : "Key in a number you sourced offline."}
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-4 py-2">
          {/* ── Phone ───────────────────────────────────────────────── */}
          <div className="space-y-1">
            <Label htmlFor="np-phone" className="text-xs font-medium text-slate-600">
              Phone Number <span className="text-red-500">*</span>
            </Label>
            <Input
              id="np-phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              onBlur={(e) => void checkDuplicates(e.target.value)}
              placeholder="07XX XXX XXX"
              inputMode="tel"
              className="h-9 text-sm font-mono"
            />
            {checking && (
              <span className="text-[11px] text-slate-400 flex items-center gap-1">
                <Loader2 className="h-3 w-3 animate-spin" /> Checking for duplicates…
              </span>
            )}
            {errors._phone && <span className="text-[11px] text-red-600">{errors._phone}</span>}
          </div>

          {/* Same-department duplicate: blocking. */}
          {sameDeptMatch && (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm">
              <p className="font-medium text-red-800">Already in your queue</p>
              <p className="text-red-700 text-xs mt-0.5">
                This number is already a prospect in {sameDeptMatch.department_name}
                {sameDeptMatch.assigned_rep ? `, with ${sameDeptMatch.assigned_rep}` : ""}.
              </p>
              <Link
                href="/leads"
                onClick={onClose}
                className="text-xs font-medium text-red-800 underline mt-1 inline-block"
              >
                Open it in the leads queue
              </Link>
            </div>
          )}

          {/* Cross-department duplicate: a warning, never a block (decision D2). */}
          {otherDeptMatches.length > 0 && !sameDeptMatch && (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm">
              <p className="font-medium text-amber-900 flex items-center gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5" />
                Also a prospect elsewhere
              </p>
              <ul className="text-amber-800 text-xs mt-1 space-y-0.5">
                {otherDeptMatches.map((m) => (
                  <li key={m.department_id}>
                    {m.department_name} — stage {m.funnel_stage}
                    {m.assigned_rep ? `, rep ${m.assigned_rep}` : ""}
                  </li>
                ))}
              </ul>
              <p className="text-[11px] text-amber-700 mt-1">
                That is allowed — different departments sell different things. Continue if this
                is a separate opportunity.
              </p>
            </div>
          )}

          {/* ── Department ──────────────────────────────────────────── */}
          <div className="space-y-1">
            <Label className="text-xs font-medium text-slate-600">Department</Label>
            {canSwitch ? (
              <select
                value={chosenDeptId ?? ""}
                onChange={(e) => setChosenDeptId(e.target.value || null)}
                className={selectClasses}
              >
                <option value="">Select a department…</option>
                {departments
                  .filter((d) => d.is_active)
                  .map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
              </select>
            ) : (
              <div className="h-9 flex items-center px-3 rounded-md border border-slate-200 bg-slate-50 text-sm text-slate-600">
                {department?.name ?? "—"}
              </div>
            )}
            {errors._department && (
              <span className="text-[11px] text-red-600">{errors._department}</span>
            )}
          </div>

          {/* ── Lead source ─────────────────────────────────────────── */}
          <div className="space-y-1">
            <Label className="text-xs font-medium text-slate-600">Lead Source</Label>
            <select
              value={source}
              onChange={(e) => setSource(e.target.value)}
              className={selectClasses}
            >
              {LEAD_SOURCES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>

          {/* ── KYC, rendered from this department's config ─────────── */}
          {effectiveDeptId && kycFields.length > 0 && (
            <div className="space-y-2 border-t border-slate-100 pt-3">
              <p className="text-xs font-semibold text-slate-700 uppercase tracking-wide">
                KYC
              </p>
              <KycFields
                fields={kycFields}
                values={kyc}
                onChange={(k, v) => setKyc((prev) => ({ ...prev, [k]: v }))}
                products={products}
                errors={errors}
              />
            </div>
          )}

          {effectiveDeptId && kycFields.length === 0 && (
            <p className="text-xs text-slate-400">
              No KYC questions are configured for this department yet.
            </p>
          )}

          {/* ── Optional first call ─────────────────────────────────── */}
          <div className="border-t border-slate-100 pt-3 space-y-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={logCall}
                onChange={(e) => setLogCall(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm font-medium text-slate-700">
                Log the first call now?
              </span>
            </label>

            {logCall && (
              <div className="space-y-2 pl-6">
                <select
                  value={callOutcome}
                  onChange={(e) => setCallOutcome(e.target.value as CallOutcome)}
                  className={selectClasses}
                >
                  {CALL_OUTCOMES.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <Textarea
                  value={callNotes}
                  onChange={(e) => setCallNotes(e.target.value)}
                  placeholder="What was said?"
                  className="text-sm min-h-16"
                />
              </div>
            )}
          </div>

          {/* ── Optional follow-up ──────────────────────────────────── */}
          <div className="border-t border-slate-100 pt-3 space-y-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={setFollowup}
                onChange={(e) => setSetFollowup(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm font-medium text-slate-700">
                Schedule a follow-up?
              </span>
            </label>

            {setFollowup && (
              <div className="space-y-2 pl-6">
                <div className="flex gap-2">
                  <Input
                    type="date"
                    value={followupDate}
                    onChange={(e) => setFollowupDate(e.target.value)}
                    className="h-9 text-sm"
                  />
                  <Input
                    type="time"
                    value={followupTime}
                    onChange={(e) => setFollowupTime(e.target.value)}
                    className="h-9 text-sm w-32"
                  />
                </div>
                {errors._followup && (
                  <span className="text-[11px] text-red-600">{errors._followup}</span>
                )}

                {/* School-bus holiday warning — informational, never blocking. */}
                {holidayWarning && (
                  <div className="rounded-md border border-amber-200 bg-amber-50 p-2.5 text-xs">
                    <p className="text-amber-900 flex items-start gap-1.5">
                      <CalendarClock className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                      <span>{holidayWarning.message}</span>
                    </p>
                    <button
                      type="button"
                      onClick={() =>
                        setFollowupDate(format(holidayWarning.suggestion, "yyyy-MM-dd"))
                      }
                      className="mt-1.5 text-[11px] font-medium text-amber-900 underline"
                    >
                      {holidayWarning.suggestionLabel}
                    </button>
                  </div>
                )}

                <Textarea
                  value={followupNotes}
                  onChange={(e) => setFollowupNotes(e.target.value)}
                  placeholder="What is this follow-up for?"
                  className="text-sm min-h-14"
                />
              </div>
            )}
          </div>

          {/* ── Actions ─────────────────────────────────────────────── */}
          <div className="flex gap-2 pt-2 border-t border-slate-100">
            <Button
              onClick={handleSave}
              disabled={saving || !!sameDeptMatch || !effectiveDeptId}
              className={cn("flex-1 gap-1.5")}
            >
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Saving…
                </>
              ) : (
                <>
                  <UserPlus className="h-4 w-4" /> Add Prospect
                </>
              )}
            </Button>
            <Button variant="ghost" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
