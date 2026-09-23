"use client"

import { useState } from "react"
import { AlertTriangle, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet"
import { normalizePhone } from "@/lib/utils/phoneHelpers"
import { StepUpPasswordField } from "./StepUpPasswordField"
import type { LoginDetails } from "../users/LoginDetailsDialog"

/**
 * Add a named administrator (§8.8).
 *
 * The warning panel is not decoration. An administrator sees every lead in
 * every department and can add, reset and deactivate every user including other
 * administrators. Someone clicking through this form should be told exactly
 * what they are handing over before they hand it over.
 */

interface Form { full_name: string; email: string; phone: string }
const EMPTY: Form = { full_name: "", email: "", phone: "" }

export function AddAdminSheet({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (details: LoginDetails) => void
}) {
  const [form, setForm] = useState<Form>(EMPTY)
  const [actorPassword, setActorPassword] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }))

  function close() {
    setForm(EMPTY)
    setActorPassword("")
    setError(null)
    onOpenChange(false)
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (form.full_name.trim().length < 2) return setError("Full name is required.")
    if (!form.email.trim()) return setError("A login email is required.")
    if (!actorPassword) return setError("Enter your own password to continue.")

    setSaving(true)
    try {
      const res = await fetch("/api/admin/admins", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          full_name: form.full_name.trim(),
          email: form.email.trim().toLowerCase(),
          phone: form.phone.trim() || null,
          actorPassword,
        }),
      })
      const body = await res.json()

      if (!res.ok || !body.ok) {
        setError(body.error ?? "Could not create the administrator.")
        // Clear the password on any failure so a wrong one is never resubmitted
        // by a second click, and never sits in the DOM after an error.
        setActorPassword("")
        return
      }

      onCreated({
        full_name: body.full_name,
        email: body.email,
        tempPassword: body.tempPassword,
      })
      toast.success(`${body.full_name} is now an administrator`)
      close()
    } catch {
      setError("Could not reach the server.")
      setActorPassword("")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) close() }}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Add administrator</SheetTitle>
          <SheetDescription>
            They will get a temporary password to sign in with, shown once.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 flex gap-2 rounded-md border border-amber-300 bg-amber-50 p-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <p className="text-xs leading-relaxed text-amber-900">
            Administrators can see <strong>every lead in every department</strong>, and can add,
            reset and deactivate every user — <strong>including other administrators</strong>.
          </p>
        </div>

        <form onSubmit={submit} className="mt-5 space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="a-name">Full name *</Label>
            <Input
              id="a-name" value={form.full_name} autoComplete="off"
              onChange={(e) => set("full_name", e.target.value)}
              placeholder="Kelvin Oyugi"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="a-email">Login email *</Label>
            <Input
              id="a-email" type="email" value={form.email} autoComplete="off"
              onChange={(e) => set("email", e.target.value)}
              placeholder="kelvin@nebsamdigital.com"
            />
            <p className="text-xs text-slate-500">
              A personal address for this person, never one several people share. It cannot already
              belong to another login.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="a-phone">Phone</Label>
            <Input
              id="a-phone" value={form.phone} autoComplete="off"
              onChange={(e) => set("phone", e.target.value)}
              onBlur={(e) => e.target.value && set("phone", normalizePhone(e.target.value))}
              placeholder="0722000000" className="font-mono"
            />
          </div>

          <StepUpPasswordField value={actorPassword} onChange={setActorPassword} disabled={saving} />

          {error && (
            <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              {error}
            </p>
          )}

          <div className="flex gap-2 pt-1">
            <Button type="button" variant="outline" className="flex-1" onClick={close} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" className="flex-1 gap-2" disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {saving ? "Creating…" : "Add administrator"}
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  )
}
