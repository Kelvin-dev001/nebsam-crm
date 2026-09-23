"use client"

import { useState } from "react"
import { Eye, EyeOff, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { createClient } from "@/lib/supabase/client"
import { PASSWORD_MIN_LENGTH } from "@/lib/auth/passwordPolicy"

/**
 * Setting your own password.
 *
 * Kept as a standalone component on purpose (U-D2). When Nebsam has a mail
 * sender, an email-based "forgot password" flow can reuse this on an
 * /auth/reset route without rework. Do not inline it back into the page.
 *
 * Plain React state, not React Hook Form — CLAUDE.md's RHF rule exists because
 * setValue-only fields silently collapse to their defaults at submit, and a
 * password field that silently submits an empty string is exactly the kind of
 * failure that is hard to see and easy to ship.
 */

export function SetPasswordForm({
  first = false,
  onDone,
}: {
  /** First sign-in variant: no cancel, different wording. */
  first?: boolean
  onDone: () => void
}) {
  const [current, setCurrent] = useState("")
  const [next, setNext] = useState("")
  const [confirm, setConfirm] = useState("")
  const [show, setShow] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    // Client-side checks are for a fast, readable message. The server enforces
    // the same policy and is the authority.
    if (next.length < PASSWORD_MIN_LENGTH) {
      return setError(`Your new password must be at least ${PASSWORD_MIN_LENGTH} characters.`)
    }
    if (!/[a-zA-Z]/.test(next) || !/[0-9]/.test(next)) {
      return setError("Your new password must contain both letters and numbers.")
    }
    if (next !== confirm) return setError("The two new passwords do not match.")
    if (next === current) return setError("Your new password must be different from your current one.")

    setSaving(true)
    try {
      const res = await fetch("/api/account/password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ current_password: current, new_password: next }),
      })
      const body = await res.json()

      if (!res.ok || !body.ok) {
        setError(body.error ?? "Could not update your password.")
        return
      }

      // Refresh the JWT so it no longer carries must_change_password, or the
      // middleware gate would bounce them straight back to this page.
      //
      // This is in the SUBMIT handler, never inside onAuthStateChange — a
      // supabase call inside that callback deadlocks the GoTrue lock and hangs
      // every request in the app (CLAUDE.md).
      await createClient().auth.refreshSession()

      toast.success("Password updated")
      setCurrent(""); setNext(""); setConfirm("")
      onDone()
    } catch {
      setError("Could not reach the server. Check your connection and try again.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="pw-current">
          {first ? "Temporary password" : "Current password"}
        </Label>
        <Input
          id="pw-current" type={show ? "text" : "password"} value={current}
          autoComplete="current-password"
          onChange={(e) => setCurrent(e.target.value)}
        />
        {first && (
          <p className="text-xs text-slate-500">The one your administrator gave you.</p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="pw-new">New password</Label>
        <div className="relative">
          <Input
            id="pw-new" type={show ? "text" : "password"} value={next}
            autoComplete="new-password" className="pr-10"
            onChange={(e) => setNext(e.target.value)}
          />
          <button
            type="button"
            onClick={() => setShow((s) => !s)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
            aria-label={show ? "Hide passwords" : "Show passwords"}
          >
            {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
        <p className="text-xs text-slate-500">
          At least {PASSWORD_MIN_LENGTH} characters, with letters and numbers.
        </p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="pw-confirm">Confirm new password</Label>
        <Input
          id="pw-confirm" type={show ? "text" : "password"} value={confirm}
          autoComplete="new-password"
          onChange={(e) => setConfirm(e.target.value)}
        />
      </div>

      {error && (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      )}

      <Button type="submit" className="w-full gap-2" disabled={saving}>
        {saving && <Loader2 className="h-4 w-4 animate-spin" />}
        {saving ? "Updating…" : first ? "Set password and continue" : "Update password"}
      </Button>
    </form>
  )
}
