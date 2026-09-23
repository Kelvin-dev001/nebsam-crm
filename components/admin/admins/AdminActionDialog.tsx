"use client"

import { useState } from "react"
import { AlertTriangle, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog"
import { StepUpPasswordField } from "./StepUpPasswordField"

/**
 * The step-up confirmation shared by reset / deactivate / reactivate / retire.
 *
 * One component rather than four near-identical dialogs, because the shape is
 * always the same: explain the consequence, ask for the actor's own password,
 * confirm. Four copies would drift, and the one that drifted would be the one
 * that forgot to clear the password field on failure.
 */

export type AdminAction = "reset" | "deactivate" | "reactivate" | "retire"

const COPY: Record<AdminAction, { title: (n: string) => string; body: string; confirm: string; danger?: boolean }> = {
  reset: {
    title: (n) => `Reset ${n}'s password?`,
    body: "Their current password stops working immediately and they will be signed out everywhere. You will get a temporary password to share, shown once.",
    confirm: "Reset password",
  },
  deactivate: {
    title: (n) => `Remove ${n}'s administrator access?`,
    body: "They lose access to every department immediately, and their login is blocked. Nothing is deleted — their name stays on everything they did, and this can be reversed.",
    confirm: "Remove access",
    danger: true,
  },
  reactivate: {
    title: (n) => `Restore ${n}'s administrator access?`,
    body: "They get a NEW temporary password and must choose their own before they can do anything. The old one is not restored.",
    confirm: "Restore access",
  },
  retire: {
    title: () => "Retire the shared admin login?",
    body: "The password that several people know stops working immediately. From then on every administrative action names a real person. Nothing is deleted, and this can be reversed.",
    confirm: "Retire shared login",
    danger: true,
  },
}

export function AdminActionDialog({
  action,
  name,
  busy,
  error,
  extra,
  onCancel,
  onConfirm,
}: {
  action: AdminAction
  name: string
  busy: boolean
  error: string | null
  /** Anything action-specific to show above the password field. */
  extra?: React.ReactNode
  onCancel: () => void
  onConfirm: (actorPassword: string, reason: string | null) => void
}) {
  const [password, setPassword] = useState("")
  const [reason, setReason] = useState("")
  const copy = COPY[action]

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onCancel() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{copy.title(name)}</DialogTitle>
          <DialogDescription>{copy.body}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {extra}

          {action === "deactivate" && (
            <div className="space-y-1.5">
              <Label htmlFor="admin-reason">Reason (optional)</Label>
              <Input
                id="admin-reason" value={reason} onChange={(e) => setReason(e.target.value)}
                placeholder="No longer needs admin access"
              />
            </div>
          )}

          <StepUpPasswordField value={password} onChange={setPassword} disabled={busy} />

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
              className={`flex-1 gap-2 ${copy.danger ? "bg-red-600 hover:bg-red-700" : ""}`}
              disabled={busy || !password}
              onClick={() => { onConfirm(password, reason.trim() || null); setPassword("") }}
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              {busy ? "Working…" : copy.confirm}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
