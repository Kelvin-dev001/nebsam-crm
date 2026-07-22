"use client"

import { useEffect, useState } from "react"
import { Plus, Pencil, ToggleLeft, ToggleRight, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog"
import { createClient } from "@/lib/supabase/client"
import { Telemarketer } from "@/types/crm"
type EditableTelemarketer = Pick<Telemarketer, "full_name" | "email" | "phone">

const EMPTY_FORM: EditableTelemarketer = { full_name: "", email: "", phone: "" }

export function TelemarketerManager() {
  const [telemarketers, setTelemarketers] = useState<Telemarketer[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<Telemarketer | null>(null)
  const [form, setForm] = useState<EditableTelemarketer>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [leadCounts, setLeadCounts] = useState<Record<string, number>>({})

  useEffect(() => {
    fetchAll()
  }, [])

  async function fetchAll() {
    const supabase = createClient()
    const [tmResult, leadsResult] = await Promise.all([
      supabase.from("telemarketers").select("*").order("full_name"),
      supabase.from("leads").select("assigned_to"),
    ])
    if (tmResult.data) setTelemarketers(tmResult.data as Telemarketer[])
    if (leadsResult.data) {
      const counts: Record<string, number> = {}
      for (const l of leadsResult.data as { assigned_to: string | null }[]) {
        if (l.assigned_to) counts[l.assigned_to] = (counts[l.assigned_to] ?? 0) + 1
      }
      setLeadCounts(counts)
    }
    setLoading(false)
  }

  function openAdd() {
    setEditing(null)
    setForm(EMPTY_FORM)
    setDialogOpen(true)
  }

  function openEdit(tm: Telemarketer) {
    setEditing(tm)
    setForm({ full_name: tm.full_name, email: tm.email, phone: tm.phone ?? "" })
    setDialogOpen(true)
  }

  async function save() {
    if (!form.full_name.trim() || !form.email.trim()) {
      toast.error("Name and email are required")
      return
    }
    setSaving(true)
    const supabase = createClient()
    const payload = {
      full_name: form.full_name.trim(),
      email: form.email.trim(),
      phone: form.phone?.trim() || null,
    }

    if (editing) {
      const { error } = await supabase.from("telemarketers")
        .update(payload)
        .eq("id", editing.id)
      if (error) {
        toast.error("Failed to update telemarketer")
      } else {
        setTelemarketers((prev) =>
          prev.map((t) => t.id === editing.id ? { ...t, ...payload } : t)
        )
        toast.success("Telemarketer updated")
        setDialogOpen(false)
      }
    } else {
      const { data, error } = await supabase.from("telemarketers")
        .insert({ ...payload, is_active: true })
        .select()
        .single()
      if (error) {
        toast.error("Failed to add telemarketer")
      } else {
        setTelemarketers((prev) => [...prev, data as Telemarketer].sort((a, b) => a.full_name.localeCompare(b.full_name)))
        toast.success(`${payload.full_name} added`)
        setDialogOpen(false)
      }
    }
    setSaving(false)
  }

  async function toggleActive(tm: Telemarketer) {
    setTogglingId(tm.id)
    const supabase = createClient()
    const { error } = await supabase.from("telemarketers")
      .update({ is_active: !tm.is_active })
      .eq("id", tm.id)
    if (error) {
      toast.error("Failed to update status")
    } else {
      setTelemarketers((prev) =>
        prev.map((t) => t.id === tm.id ? { ...t, is_active: !t.is_active } : t)
      )
      toast.success(`${tm.full_name} ${tm.is_active ? "deactivated" : "activated"}`)
    }
    setTogglingId(null)
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">
          {loading ? "Loading…" : `${telemarketers.length} telemarketer${telemarketers.length !== 1 ? "s" : ""}`}
        </p>
        <Button size="sm" className="gap-1.5" onClick={openAdd}>
          <Plus className="h-3.5 w-3.5" />
          Add Telemarketer
        </Button>
      </div>

      <div className="rounded-xl border border-slate-200 overflow-hidden bg-white">
        <Table>
          <TableHeader>
            <TableRow className="bg-slate-50 hover:bg-slate-50">
              {["Name", "Email", "Phone", "Leads", "Status", "Actions"].map((h) => (
                <TableHead key={h} className="text-xs font-semibold text-slate-500 uppercase tracking-wide py-3">
                  {h}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 6 }).map((_, j) => (
                    <TableCell key={j}><Skeleton className="h-4 w-24" /></TableCell>
                  ))}
                </TableRow>
              ))
            ) : telemarketers.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center text-slate-400 text-sm">
                  No telemarketers yet
                </TableCell>
              </TableRow>
            ) : (
              telemarketers.map((tm) => (
                <TableRow key={tm.id} className="hover:bg-slate-50">
                  <TableCell className="font-medium text-slate-800">{tm.full_name}</TableCell>
                  <TableCell className="text-sm text-slate-600">{tm.email}</TableCell>
                  <TableCell className="text-sm text-slate-500 font-mono">{tm.phone ?? "—"}</TableCell>
                  <TableCell className="text-sm text-slate-700 tabular-nums">
                    {leadCounts[tm.id] ?? 0}
                  </TableCell>
                  <TableCell>
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                      tm.is_active ? "bg-green-50 text-green-700" : "bg-slate-100 text-slate-500"
                    }`}>
                      {tm.is_active ? "Active" : "Inactive"}
                    </span>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-xs gap-1 text-slate-600"
                        onClick={() => openEdit(tm)}
                      >
                        <Pencil className="h-3 w-3" />
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className={`h-7 px-2 text-xs gap-1 ${tm.is_active ? "text-red-600 hover:bg-red-50" : "text-green-600 hover:bg-green-50"}`}
                        disabled={togglingId === tm.id}
                        onClick={() => toggleActive(tm)}
                      >
                        {togglingId === tm.id ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : tm.is_active ? (
                          <ToggleLeft className="h-3 w-3" />
                        ) : (
                          <ToggleRight className="h-3 w-3" />
                        )}
                        {tm.is_active ? "Deactivate" : "Activate"}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Add / Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={(open: boolean) => { if (!open) setDialogOpen(false) }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Telemarketer" : "Add Telemarketer"}</DialogTitle>
            <DialogDescription>
              {editing ? `Update details for ${editing.full_name}.` : "Add a new telemarketer to the team."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 mt-1">
            <div className="space-y-1.5">
              <Label htmlFor="tm-name">Full Name *</Label>
              <Input
                id="tm-name"
                placeholder="e.g. Edith Wanjiku"
                value={form.full_name}
                onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tm-email">Email *</Label>
              <Input
                id="tm-email"
                type="email"
                placeholder="e.g. edith@nebsam.co.ke"
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tm-phone">Phone</Label>
              <Input
                id="tm-phone"
                placeholder="+254700000000"
                value={form.phone ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
              />
            </div>
            <div className="flex gap-3 pt-1">
              <Button variant="outline" className="flex-1" onClick={() => setDialogOpen(false)} disabled={saving}>
                Cancel
              </Button>
              <Button className="flex-1" onClick={save} disabled={saving}>
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : editing ? "Save Changes" : "Add"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
