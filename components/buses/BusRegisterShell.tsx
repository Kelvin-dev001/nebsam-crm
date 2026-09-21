"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { Bus, Plus, Loader2, Users } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { createClient } from "@/lib/supabase/client"
import { useDepartment } from "@/lib/departments/useDepartment"
import { formatDate } from "@/lib/utils/dateHelpers"
import { cn } from "@/lib/utils"
import type { SchoolBusStatus } from "@/types/crm"

/**
 * The bus register — the operations view across every school this rep handles.
 *
 * A school is ONE lead with N buses, and billing is per bus per term, so the
 * register is the thing that decides what a school actually owes. It is the
 * VERIFIED record: `kyc.bus_count` is what the school claimed at inquiry, this
 * is what was actually installed. Quote from the claim, bill from the register.
 *
 * Only buses with status installed or active count towards a term billing —
 * `generate_term_billings` filters on exactly that.
 *
 * The per-school view lives on the lead's own page; this is the fleet-wide one.
 */

interface BusRow {
  id: string
  lead_id: string
  registration_number: string
  route_name: string | null
  capacity: number | null
  device_serial: string | null
  device_product: string | null
  install_date: string | null
  status: SchoolBusStatus
  rate_per_term: number | null
  currency: string
  notes: string | null
  lead: { company_name: string | null; full_name: string | null; phone_number: string } | null
}

interface SchoolOption {
  id: string
  company_name: string | null
  full_name: string | null
  phone_number: string
}

const STATUS_CLASSES: Record<SchoolBusStatus, string> = {
  prospective: "bg-slate-100 text-slate-600 border-slate-200",
  scheduled: "bg-sky-100 text-sky-700 border-sky-200",
  installed: "bg-teal-100 text-teal-700 border-teal-200",
  active: "bg-green-100 text-green-700 border-green-200",
  suspended: "bg-amber-100 text-amber-700 border-amber-200",
  removed: "bg-red-100 text-red-700 border-red-200",
}

const ALL_STATUSES: SchoolBusStatus[] = [
  "prospective", "scheduled", "installed", "active", "suspended", "removed",
]

/** The statuses that actually get billed. */
const BILLABLE: SchoolBusStatus[] = ["installed", "active"]

function schoolName(l: BusRow["lead"] | SchoolOption | null): string {
  if (!l) return "—"
  return l.company_name ?? l.full_name ?? l.phone_number
}

export function BusRegisterShell() {
  // The register is department-wide: buses belong to schools, not to reps.
  const { department, products } = useDepartment()

  const [buses, setBuses] = useState<BusRow[]>([])
  const [schools, setSchools] = useState<SchoolOption[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState("")
  const [schoolFilter, setSchoolFilter] = useState("")
  const [editing, setEditing] = useState<BusRow | null>(null)
  const [adding, setAdding] = useState(false)

  const load = useCallback(async () => {
    if (!department?.id) {
      setLoading(false)
      return
    }
    const supabase = createClient()
    setLoading(true)
    try {
      const [busRes, schoolRes] = await Promise.all([
        supabase
          .from("school_buses")
          .select("*, lead:leads(company_name, full_name, phone_number)")
          .eq("department_id", department.id)
          .order("registration_number"),
        supabase
          .from("leads")
          .select("id, company_name, full_name, phone_number")
          .eq("department_id", department.id)
          .order("company_name"),
      ])
      if (busRes.error) throw busRes.error
      setBuses((busRes.data ?? []) as unknown as BusRow[])
      setSchools((schoolRes.data ?? []) as unknown as SchoolOption[])
    } catch (err) {
      console.error("BusRegisterShell fetch failed:", err)
      toast.error("Could not load the bus register")
    } finally {
      setLoading(false)
    }
  }, [department?.id])

  useEffect(() => {
    void load()
  }, [load])

  const filtered = useMemo(
    () =>
      buses.filter((b) => {
        if (statusFilter && b.status !== statusFilter) return false
        if (schoolFilter && b.lead_id !== schoolFilter) return false
        return true
      }),
    [buses, statusFilter, schoolFilter],
  )

  const billableCount = useMemo(
    () => buses.filter((b) => BILLABLE.includes(b.status)).length,
    [buses],
  )

  if (!department) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3 text-center p-6">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-slate-100">
          <Users className="h-7 w-7 text-slate-400" />
        </div>
        <h2 className="text-lg font-semibold text-slate-800">No department selected</h2>
        <p className="text-sm text-slate-500 max-w-xs">
          The bus register belongs to the School Bus department.
        </p>
      </div>
    )
  }

  return (
    <div className="p-4 lg:p-6 space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Bus Register</h1>
          <p className="text-slate-500 text-sm mt-0.5">
            {loading
              ? "Loading…"
              : `${filtered.length} of ${buses.length} buses · ${billableCount} billable`}
          </p>
        </div>
        <Button className="gap-1.5" onClick={() => setAdding(true)}>
          <Plus className="h-4 w-4" />
          Add Bus
        </Button>
      </div>

      <div className="flex flex-wrap gap-2">
        <select
          value={schoolFilter}
          onChange={(e) => setSchoolFilter(e.target.value)}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm text-slate-700"
        >
          <option value="">All schools</option>
          {schools.map((s) => (
            <option key={s.id} value={s.id}>{schoolName(s)}</option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm text-slate-700"
        >
          <option value="">All statuses</option>
          {ALL_STATUSES.map((s) => (
            <option key={s} value={s} className="capitalize">{s}</option>
          ))}
        </select>
      </div>

      <div className="rounded-lg border border-slate-200 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="text-left font-medium px-3 py-2">Reg Number</th>
              <th className="text-left font-medium px-3 py-2">School</th>
              <th className="text-left font-medium px-3 py-2">Route</th>
              <th className="text-right font-medium px-3 py-2">Seats</th>
              <th className="text-left font-medium px-3 py-2">Device</th>
              <th className="text-left font-medium px-3 py-2">Installed</th>
              <th className="text-left font-medium px-3 py-2">Status</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <tr key={i} className="border-t border-slate-100">
                  <td className="px-3 py-3" colSpan={8}><Skeleton className="h-4 w-full" /></td>
                </tr>
              ))
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-12 text-center">
                  <Bus className="h-8 w-8 text-slate-300 mx-auto mb-2" />
                  <p className="text-sm text-slate-500">
                    {buses.length === 0
                      ? "No buses registered yet. Add them as each school's fleet is confirmed."
                      : "No buses match these filters."}
                  </p>
                </td>
              </tr>
            ) : (
              filtered.map((b) => (
                <tr key={b.id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-3 py-2 font-mono text-slate-800">{b.registration_number}</td>
                  <td className="px-3 py-2">
                    <Link
                      href={`/leads/${b.lead_id}`}
                      className="text-slate-700 hover:text-blue-600 hover:underline"
                    >
                      {schoolName(b.lead)}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-slate-600">{b.route_name ?? "—"}</td>
                  <td className="px-3 py-2 text-right text-slate-600">{b.capacity ?? "—"}</td>
                  <td className="px-3 py-2 text-slate-600">
                    {b.device_serial ? (
                      <span className="font-mono text-xs">{b.device_serial}</span>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-slate-500 whitespace-nowrap">
                    {b.install_date ? formatDate(b.install_date) : "—"}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={cn(
                        "inline-flex rounded-full border px-2 py-0.5 text-xs font-medium capitalize",
                        STATUS_CLASSES[b.status],
                      )}
                    >
                      {b.status}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-xs"
                      onClick={() => setEditing(b)}
                    >
                      Edit
                    </Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <BusDialog
        open={adding || !!editing}
        bus={editing}
        schools={schools}
        deviceProducts={products.map((p) => p.name)}
        departmentId={department.id}
        onClose={() => {
          setAdding(false)
          setEditing(null)
        }}
        onSaved={() => void load()}
      />
    </div>
  )
}

function BusDialog({
  open,
  bus,
  schools,
  deviceProducts,
  departmentId,
  onClose,
  onSaved,
}: {
  open: boolean
  bus: BusRow | null
  schools: SchoolOption[]
  deviceProducts: string[]
  departmentId: string
  onClose: () => void
  onSaved: () => void
}) {
  const [leadId, setLeadId] = useState("")
  const [reg, setReg] = useState("")
  const [route, setRoute] = useState("")
  const [capacity, setCapacity] = useState("")
  const [serial, setSerial] = useState("")
  const [deviceProduct, setDeviceProduct] = useState("")
  const [installDate, setInstallDate] = useState("")
  const [status, setStatus] = useState<SchoolBusStatus>("prospective")
  const [rate, setRate] = useState("")
  const [notes, setNotes] = useState("")
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setLeadId(bus?.lead_id ?? "")
    setReg(bus?.registration_number ?? "")
    setRoute(bus?.route_name ?? "")
    setCapacity(bus?.capacity != null ? String(bus.capacity) : "")
    setSerial(bus?.device_serial ?? "")
    setDeviceProduct(bus?.device_product ?? deviceProducts[0] ?? "")
    setInstallDate(bus?.install_date ?? "")
    setStatus(bus?.status ?? "prospective")
    setRate(bus?.rate_per_term != null ? String(bus.rate_per_term) : "")
    setNotes(bus?.notes ?? "")
  }, [open, bus, deviceProducts])

  async function save() {
    if (!leadId || !reg.trim()) {
      toast.error("School and registration number are required")
      return
    }
    setSaving(true)
    try {
      const supabase = createClient()
      const payload = {
        lead_id: leadId,
        department_id: departmentId,
        registration_number: reg.trim().toUpperCase(),
        route_name: route || null,
        capacity: capacity ? Number(capacity) : null,
        device_serial: serial || null,
        device_product: deviceProduct || null,
        install_date: installDate || null,
        status,
        rate_per_term: rate ? Number(rate) : null,
        notes: notes || null,
      }

      const { error } = bus
        ? await supabase.from("school_buses").update(payload).eq("id", bus.id)
        : await supabase.from("school_buses").insert(payload)

      if (error) {
        // UNIQUE(department_id, registration_number) — a duplicate plate must
        // read as a sentence, not as a raw constraint name.
        if (error.code === "23505" || error.message.includes("school_buses_department_id_registration_number_key")) {
          toast.error(`Bus ${payload.registration_number} is already on the register.`)
        } else {
          toast.error(`Could not save the bus: ${error.message}`)
        }
        return
      }

      toast.success(bus ? "Bus updated" : "Bus added to the register")
      onSaved()
      onClose()
    } catch (err) {
      console.error(err)
      toast.error("Could not save the bus")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o: boolean) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{bus ? "Edit Bus" : "Add Bus"}</DialogTitle>
          <DialogDescription>
            Only buses marked installed or active are billed each term.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs text-slate-600">School</Label>
            <select
              value={leadId}
              onChange={(e) => setLeadId(e.target.value)}
              disabled={!!bus}
              className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm disabled:opacity-60"
            >
              <option value="">Select a school…</option>
              {schools.map((s) => (
                <option key={s.id} value={s.id}>{schoolName(s)}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs text-slate-600">Reg Number</Label>
              <Input
                value={reg}
                onChange={(e) => setReg(e.target.value)}
                placeholder="KDA 123X"
                className="h-9 text-sm font-mono uppercase"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-slate-600">Route</Label>
              <Input
                value={route}
                onChange={(e) => setRoute(e.target.value)}
                placeholder="Westlands"
                className="h-9 text-sm"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs text-slate-600">Capacity</Label>
              <Input
                type="number"
                value={capacity}
                onChange={(e) => setCapacity(e.target.value)}
                className="h-9 text-sm"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-slate-600">Rate per term (KES)</Label>
              <Input
                type="number"
                value={rate}
                onChange={(e) => setRate(e.target.value)}
                className="h-9 text-sm"
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-xs text-slate-600">Device</Label>
            <select
              value={deviceProduct}
              onChange={(e) => setDeviceProduct(e.target.value)}
              className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">—</option>
              {deviceProducts.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs text-slate-600">Device serial</Label>
              <Input
                value={serial}
                onChange={(e) => setSerial(e.target.value)}
                className="h-9 text-sm font-mono"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-slate-600">Install date</Label>
              <Input
                type="date"
                value={installDate}
                onChange={(e) => setInstallDate(e.target.value)}
                className="h-9 text-sm"
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-xs text-slate-600">Status</Label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as SchoolBusStatus)}
              className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm capitalize"
            >
              {ALL_STATUSES.map((s) => (
                <option key={s} value={s} className="capitalize">{s}</option>
              ))}
            </select>
            {!BILLABLE.includes(status) && (
              <span className="text-[11px] text-slate-400">
                Not billed while {status}.
              </span>
            )}
          </div>

          <div className="space-y-1">
            <Label className="text-xs text-slate-600">Notes</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="text-sm min-h-14"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={() => void save()} disabled={saving} className="gap-1.5">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bus className="h-4 w-4" />}
            {bus ? "Save" : "Add Bus"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
