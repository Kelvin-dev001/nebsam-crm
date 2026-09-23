"use client"

import { useState } from "react"
import { Eye, EyeOff, ShieldAlert } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

/**
 * The "re-enter your own password" field on admin-targeted actions (U-D7c).
 *
 * Asked for because once named admins exist, one admin can create, reset,
 * deactivate or reactivate another — so a browser left unlocked on a desk is
 * otherwise enough to take over administrative access to the whole CRM, with
 * the owner's name on every audit line.
 *
 * It is not MFA and the wording does not pretend otherwise. It raises the cost
 * of walking past an unattended screen, which is the realistic risk in a shared
 * office.
 *
 * Never pre-filled, never remembered between actions, and `autoComplete` is
 * "current-password" so a password manager offers the right entry rather than
 * proposing to save a new one.
 */
export function StepUpPasswordField({
  value,
  onChange,
  disabled,
}: {
  value: string
  onChange: (v: string) => void
  disabled?: boolean
}) {
  const [show, setShow] = useState(false)

  return (
    <div className="space-y-1.5 rounded-lg border border-slate-300 bg-slate-50 p-3">
      <Label htmlFor="step-up" className="flex items-center gap-1.5">
        <ShieldAlert className="h-4 w-4 text-slate-500" />
        Your password *
      </Label>
      <div className="relative">
        <Input
          id="step-up"
          type={show ? "text" : "password"}
          value={value}
          disabled={disabled}
          autoComplete="current-password"
          className="bg-white pr-10"
          onChange={(e) => onChange(e.target.value)}
        />
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
          aria-label={show ? "Hide password" : "Show password"}
        >
          {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
      <p className="text-xs text-slate-500">
        Confirm it is you. Actions that change who can administer the CRM ask for this.
      </p>
    </div>
  )
}
