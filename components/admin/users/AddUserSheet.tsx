"use client"

import { useState } from "react"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet"
import { useDepartment } from "@/lib/departments/useDepartment"
import { normalizePhone } from "@/lib/utils/phoneHelpers"
import type { LoginDetails } from "./LoginDetailsDialog"

/**
 * Add a rep, with a login, in one step (§8.3).
 *
 * The old "Add Telemarketer" button inserted a row from the browser and created
 * no auth user, so the person could never sign in and nothing said so. This
 * always creates both, and the server rolls the login back if the rep row fails
 * — there is never a login with nothing behind it.
 *
 * Plain React state rather than React Hook Form. CLAUDE.md's RHF toggle rule
 * exists because setValue-only fields silently collapse to their defaults at
 * submit; this form is small enough that controlled state removes the risk
 * entirely rather than working around it.
 */

interface Form {
  full_name: string
  email: string
  phone: string
  department_id: string
  job_title: string
}

const EMPTY: Form = { full_name: "", email: "", phone: "", department_id: "", job_title: "" }

export function AddUserSheet({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (details: LoginDetails) => void
}) {
  const { departments } = useDepartment()
  const [form, setForm] = useState<Form>(EMPTY)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const active = departments.filter((d) => d.is_active)
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }))

  function close() {
    setForm(EMPTY)
    setError(null)
    onOpenChange(false)
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    // Client-side checks are for a fast, readable message only. The server
    // validates the same things with Zod and is the actual authority.
    if (form.full_name.trim().length < 2) return setError("Full name is required.")
    if (!form.email.trim()) return setError("A login email is required.")
    if (!form.department_id) return setError("Choose a department.")

    setSaving(true)
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          full_name: form.full_name.trim(),
          email: form.email.trim().toLowerCase(),
          phone: form.phone.trim() || null,
          department_id: form.department_id,
          job_title: form.job_title.trim() || null,
        }),
      })
      const body = await res.json()

      if (!res.ok || !body.ok) {
        setError(body.error ?? "Could not create the user.")
        return
      }

      onCreated({
        full_name: body.full_name,
        email: body.email,
        tempPassword: body.tempPassword,
        departmentSlug: body.department?.slug ?? null,
        departmentName: body.department?.name ?? null,
      })
      toast.success(`${body.full_name} added`)
      close()
    } catch {
      setError("Could not reach the server. Check your connection and try again.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) close() }}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Add user</SheetTitle>
          <SheetDescription>
            Creates the sales rep and their login together. You will get a temporary password to
            share with them, shown once.
          </SheetDescription>
        </SheetHeader>

        <form onSubmit={submit} className="mt-5 space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="u-name">Full name *</Label>
            <Input
              id="u-name" value={form.full_name} autoComplete="off"
              onChange={(e) => set("full_name", e.target.value)}
              placeholder="Mary Wanjiku"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="u-email">Login email *</Label>
            <Input
              id="u-email" type="email" value={form.email} autoComplete="off"
              onChange={(e) => set("email", e.target.value)}
              placeholder="mary@nebsamdigital.com"
            />
            <p className="text-xs text-slate-500">This is the address they sign in with.</p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="u-dept">Department *</Label>
            <select
              id="u-dept" value={form.department_id}
              onChange={(e) => set("department_id", e.target.value)}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="">Select a department…</option>
              {active.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
            <p className="text-xs text-slate-500">
              A rep only ever sees leads in their own department.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="u-phone">Phone</Label>
            <Input
              id="u-phone" value={form.phone} autoComplete="off"
              onChange={(e) => set("phone", e.target.value)}
              onBlur={(e) => e.target.value && set("phone", normalizePhone(e.target.value))}
              placeholder="0722000000"
              className="font-mono"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="u-title">Job title</Label>
            <Input
              id="u-title" value={form.job_title} autoComplete="off"
              onChange={(e) => set("job_title", e.target.value)}
              placeholder="Sales Representative"
            />
          </div>

          {error && (
            <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              {error}
            </p>
          )}

          <div className="flex gap-2 pt-2">
            <Button type="button" variant="outline" className="flex-1" onClick={close} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" className="flex-1 gap-2" disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {saving ? "Creating…" : "Create user"}
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  )
}
