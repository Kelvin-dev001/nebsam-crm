"use client"

import { useState } from "react"
import { Check, Copy, AlertTriangle, MessageSquare } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog"
import { LOGIN_URL, loginDetailsMessage } from "@/lib/auth/loginUrl"

/**
 * Shows a new user's login details ONCE.
 *
 * The temporary password reached the browser in a single HTTP response and
 * lives only in this component's props. It is never written to the database,
 * never logged, never put in a toast or a URL (§5.1). Closing this dialog is
 * the last time anyone sees it — if it is lost, the admin issues a new one with
 * Reset password. That is deliberate, not an oversight.
 *
 * There is no "show again": a dialog that could be reopened would mean the
 * value was being stored somewhere.
 */

export interface LoginDetails {
  full_name: string
  email: string
  tempPassword: string
  /** Shown only for Telematics, which has an automatic lead round-robin. */
  departmentSlug?: string | null
  departmentName?: string | null
}

export function LoginDetailsDialog({
  details,
  onClose,
}: {
  details: LoginDetails | null
  onClose: () => void
}) {
  const [copied, setCopied] = useState<string | null>(null)

  if (!details) return null

  async function copy(label: string, value: string) {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(label)
      setTimeout(() => setCopied(null), 1800)
    } catch {
      // Clipboard is blocked in some browsers without a user gesture or over
      // http. Say so rather than silently doing nothing.
      toast.error("Could not copy. Select the text and copy it manually.")
    }
  }

  const message = loginDetailsMessage({
    fullName: details.full_name,
    email: details.email,
    tempPassword: details.tempPassword,
  })

  const Row = ({ label, value }: { label: string; value: string }) => (
    <div className="flex items-center justify-between gap-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
      <div className="min-w-0">
        <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</p>
        <p className="truncate font-mono text-sm text-slate-800">{value}</p>
      </div>
      <Button
        type="button" variant="ghost" size="sm" className="shrink-0"
        onClick={() => copy(label, value)}
      >
        {copied === label ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
      </Button>
    </div>
  )

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{details.full_name} can now sign in</DialogTitle>
          <DialogDescription>
            Share these privately. They will set their own password on first sign-in.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Row label="Link" value={LOGIN_URL} />
          <Row label="Email" value={details.email} />
          <Row label="Temporary password" value={details.tempPassword} />
        </div>

        <Button
          type="button" variant="outline" className="w-full gap-2"
          onClick={() => copy("Message", message)}
        >
          {copied === "Message"
            ? <><Check className="h-4 w-4 text-emerald-600" /> Copied</>
            : <><MessageSquare className="h-4 w-4" /> Copy as message</>}
        </Button>

        <div className="flex gap-2 rounded-md border border-red-200 bg-red-50 p-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
          <p className="text-xs leading-relaxed text-red-800">
            <strong>This password will not be shown again.</strong> It is not stored anywhere.
            If it is lost, use <strong>Reset password</strong> to issue a new one.
          </p>
        </div>

        {details.departmentSlug === "telematics" && (
          <p className="rounded-md border border-blue-200 bg-blue-50 p-3 text-xs leading-relaxed text-blue-900">
            New Telematics reps join the WhatsApp round-robin immediately, so this person will
            start receiving new enquiries straight away.
          </p>
        )}

        <Button type="button" className="w-full" onClick={onClose}>
          Done
        </Button>
      </DialogContent>
    </Dialog>
  )
}
