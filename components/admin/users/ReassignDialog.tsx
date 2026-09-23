"use client"

import { useMemo, useState } from "react"
import { AlertTriangle, Inbox, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog"

/**
 * The inheritor step, shared by Deactivate and Move department.
 *
 * Both actions strand work for the same reason, so they ask the same question
 * once, in one place. `leads_dept_scoped` requires
 * `department_id = current_rep_department() AND assigned_to = current_rep()`,
 * so open leads left on someone who has been deactivated — or who has moved
 * department — match nobody. They are still in the database and still show to
 * an admin, but they vanish from every rep's queue, which from the floor is
 * indistinguishable from losing them.
 *
 * Each candidate shows their current open-lead count so the load can be spread
 * deliberately rather than always landing on whoever is first alphabetically.
 */

export interface Candidate {
  rep_id: string
  full_name: string
  open_leads: number
}

export function ReassignDialog({
  mode,
  repName,
  departmentName,
  openLeads,
  pendingFollowups,
  candidates,
  departments,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  mode: "deactivate" | "move"
  repName: string
  /** The department the work is currently in — the one an inheritor must be in. */
  departmentName: string | null
  openLeads: number
  pendingFollowups: number
  candidates: Candidate[]
  /** Move mode only: the departments they could move to (their own excluded). */
  departments?: Array<{ id: string; name: string }>
  busy: boolean
  error: string | null
  onCancel: () => void
  onConfirm: (opts: {
    inheritorId: string | null
    reason: string | null
    departmentId: string | null
  }) => void
}) {
  const [inheritor, setInheritor] = useState<string>("")
  const [reason, setReason] = useState("")
  const [targetDept, setTargetDept] = useState<string>("")

  const hasWork = openLeads > 0 || pendingFollowups > 0
  const noCandidates = candidates.length === 0
  const sorted = useMemo(
    () => [...candidates].sort((a, b) => a.open_leads - b.open_leads),
    [candidates],
  )

  // An inheritor is required only when there IS work and someone to take it.
  const needsChoice = hasWork && !noCandidates
  const needsDept = mode === "move"
  const canConfirm =
    !busy && (!needsChoice || inheritor !== "") && (!needsDept || targetDept !== "")

  const verb = mode === "deactivate" ? "Deactivate" : "Move"

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onCancel() }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {mode === "deactivate" ? `Deactivate ${repName}?` : `Move ${repName} to another department`}
          </DialogTitle>
          <DialogDescription>
            {mode === "deactivate"
              ? "They will be signed out and blocked from signing in again."
              : `Their open work stays in ${departmentName ?? "their current department"}.`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {mode === "move" && (
            <div className="space-y-1.5">
              <Label htmlFor="target-dept">Move to *</Label>
              <select
                id="target-dept" value={targetDept}
                onChange={(e) => setTargetDept(e.target.value)}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="">Select a department…</option>
                {(departments ?? []).map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
              <p className="text-xs text-slate-500">
                They will only see leads in the new department from then on.
              </p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg border border-slate-200 p-3">
              <p className="text-xs uppercase tracking-wide text-slate-500">Open leads</p>
              <p className="text-2xl font-semibold tabular-nums text-slate-900">
                {openLeads.toLocaleString()}
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 p-3">
              <p className="text-xs uppercase tracking-wide text-slate-500">Pending follow-ups</p>
              <p className="text-2xl font-semibold tabular-nums text-slate-900">
                {pendingFollowups.toLocaleString()}
              </p>
            </div>
          </div>

          {!hasWork && (
            <p className="text-sm text-slate-600">
              They have no open work, so nothing needs to change hands. Leads at a closed stage
              stay with them — they are history, and moving them would rewrite who did the work.
            </p>
          )}

          {hasWork && noCandidates && (
            <div className="flex gap-2 rounded-md border border-amber-200 bg-amber-50 p-3">
              <Inbox className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              <div className="text-sm text-amber-900">
                <p className="font-medium">
                  No other active rep in {departmentName ?? "this department"}.
                </p>
                <p className="mt-1">
                  The {openLeads.toLocaleString()} open leads will go to the department{" "}
                  <strong>backlog</strong>, where an admin can reassign them from Admin → Assignment.
                  {pendingFollowups > 0 && (
                    <>
                      {" "}Their {pendingFollowups.toLocaleString()} pending follow-up
                      {pendingFollowups === 1 ? "" : "s"} will be <strong>cancelled</strong> — a
                      follow-up cannot sit in a backlog, and leaving it on someone who is gone means
                      nobody ever makes the call.
                    </>
                  )}
                </p>
              </div>
            </div>
          )}

          {needsChoice && (
            <div className="space-y-1.5">
              <Label htmlFor="inheritor">Who takes over their open work? *</Label>
              <select
                id="inheritor" value={inheritor}
                onChange={(e) => setInheritor(e.target.value)}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="">Select a rep…</option>
                {sorted.map((c) => (
                  <option key={c.rep_id} value={c.rep_id}>
                    {c.full_name} — {c.open_leads.toLocaleString()} open
                  </option>
                ))}
              </select>
              <p className="text-xs text-slate-500">
                Active reps in {departmentName ?? "this department"}, least loaded first. Past call
                logs and sales stay attributed to {repName}.
              </p>
            </div>
          )}

          {mode === "deactivate" && (
            <div className="space-y-1.5">
              <Label htmlFor="reason">Reason (optional)</Label>
              <Input
                id="reason" value={reason} onChange={(e) => setReason(e.target.value)}
                placeholder="Left the company"
              />
            </div>
          )}

          {mode === "deactivate" && (
            <p className="text-xs text-slate-500">
              Nothing is deleted. Their call logs, sales and service orders keep their name, and
              they can be reactivated later.
            </p>
          )}

          {error && (
            <div className="flex gap-2 rounded-md border border-red-200 bg-red-50 p-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
              <p className="text-sm text-red-800">{error}</p>
            </div>
          )}

          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={onCancel} disabled={busy}>
              Cancel
            </Button>
            <Button
              className="flex-1 gap-2"
              disabled={!canConfirm}
              onClick={() =>
                onConfirm({
                  inheritorId: inheritor || null,
                  reason: reason.trim() || null,
                  departmentId: targetDept || null,
                })
              }
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              {busy ? "Working…" : error ? "Retry" : verb}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
