"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { PackageCheck, Plus, Loader2, Truck, Ban, Users } from "lucide-react"
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
import { useTelemarketerStore } from "@/lib/stores/telemarketerStore"
import { formatDate, daysUntil, getRenewalColorClass } from "@/lib/utils/dateHelpers"
import { cn } from "@/lib/utils"
import { format, addDays } from "date-fns"
import type { DeliveryStatus } from "@/types/crm"

/**
 * Reorders — the post-sale page for `consumption` departments (Container
 * E-Seal).
 *
 * E-seal revenue is per-use: a customer buys a batch of seals and comes back
 * when they run out, so there is no annual renewal to chase. What matters is
 * the reorder date, which is also what drives the RAG `reorder_overdue` rule.
 *
 * Money is formatted KES 12,500 and phones stay +254…, per the project rules.
 */

interface OrderRow {
  id: string
  lead_id: string
  order_date: string
  product: string
  quantity: number
  unit_price: number | null
  total_amount: number | null
  currency: string
  delivery_date: string | null
  delivery_status: DeliveryStatus
  reorder_due_date: string | null
  notes: string | null
  lead: { company_name: string | null; full_name: string | null; phone_number: string } | null
}

interface WonLead {
  id: string
  company_name: string | null
  full_name: string | null
  phone_number: string
}

function formatKes(amount: number | null, currency = "KES"): string {
  if (amount == null) return "—"
  return `${currency} ${Math.round(amount).toLocaleString("en-KE")}`
}

const STATUS_CLASSES: Record<DeliveryStatus, string> = {
  pending: "bg-amber-100 text-amber-700 border-amber-200",
  delivered: "bg-green-100 text-green-700 border-green-200",
  cancelled: "bg-slate-100 text-slate-500 border-slate-200",
}

export function ReordersShell() {
  const { activeTelemarketer } = useTelemarketerStore()
  const { department, products, stages } = useDepartment()

  const [orders, setOrders] = useState<OrderRow[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState<string>("")
  const [dueFilter, setDueFilter] = useState<string>("")
  const [recordOpen, setRecordOpen] = useState(false)

  const load = useCallback(async () => {
    if (!department?.id) {
      setLoading(false)
      return
    }
    const supabase = createClient()
    setLoading(true)
    try {
      let query = supabase
        .from("service_orders")
        .select("*, lead:leads(company_name, full_name, phone_number)")
        .eq("department_id", department.id)
      // A rep sees their own orders; an admin viewing a department sees all.
      if (activeTelemarketer) query = query.eq("telemarketer_id", activeTelemarketer.id)

      const { data, error } = await query.order("reorder_due_date", {
        ascending: true,
        nullsFirst: false,
      })
      if (error) throw error
      setOrders((data ?? []) as unknown as OrderRow[])
    } catch (err) {
      console.error("ReordersShell fetch failed:", err)
      toast.error("Could not load reorders")
    } finally {
      setLoading(false)
    }
  }, [department?.id, activeTelemarketer])

  useEffect(() => {
    void load()
  }, [load])

  const filtered = useMemo(() => {
    return orders.filter((o) => {
      if (statusFilter && o.delivery_status !== statusFilter) return false
      if (dueFilter) {
        const d = o.reorder_due_date ? daysUntil(o.reorder_due_date) : null
        if (d === null) return false
        if (dueFilter === "overdue" && d >= 0) return false
        if (dueFilter === "30" && (d < 0 || d > 30)) return false
        if (dueFilter === "60" && (d < 0 || d > 60)) return false
      }
      return true
    })
  }, [orders, statusFilter, dueFilter])

  async function setStatus(order: OrderRow, status: DeliveryStatus) {
    const supabase = createClient()
    const previous = orders
    // Optimistic — the list is small and the write is a single column.
    setOrders((prev) =>
      prev.map((o) =>
        o.id === order.id
          ? {
              ...o,
              delivery_status: status,
              delivery_date:
                status === "delivered" ? format(new Date(), "yyyy-MM-dd") : o.delivery_date,
            }
          : o,
      ),
    )
    const { error } = await supabase
      .from("service_orders")
      .update({
        delivery_status: status,
        ...(status === "delivered" ? { delivery_date: format(new Date(), "yyyy-MM-dd") } : {}),
      })
      .eq("id", order.id)

    if (error) {
      console.error(error)
      setOrders(previous)
      toast.error("Could not update the order")
    } else {
      toast.success(status === "delivered" ? "Marked delivered" : "Order cancelled")
    }
  }

  if (!department) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3 text-center p-6">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-slate-100">
          <Users className="h-7 w-7 text-slate-400" />
        </div>
        <h2 className="text-lg font-semibold text-slate-800">No department selected</h2>
        <p className="text-sm text-slate-500 max-w-xs">
          Reorders are shown per department. Pick one from the header switcher.
        </p>
      </div>
    )
  }

  return (
    <div className="p-4 lg:p-6 space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Reorders</h1>
          <p className="text-slate-500 text-sm mt-0.5">
            {loading ? "Loading…" : `${filtered.length} of ${orders.length} orders`} ·{" "}
            {department.name}
          </p>
        </div>
        <Button className="gap-1.5" onClick={() => setRecordOpen(true)}>
          <Plus className="h-4 w-4" />
          Record Order
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm text-slate-700"
        >
          <option value="">All statuses</option>
          <option value="pending">Pending</option>
          <option value="delivered">Delivered</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <select
          value={dueFilter}
          onChange={(e) => setDueFilter(e.target.value)}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm text-slate-700"
        >
          <option value="">Any reorder date</option>
          <option value="overdue">Overdue</option>
          <option value="30">Due within 30 days</option>
          <option value="60">Due within 60 days</option>
        </select>
      </div>

      {/* Table */}
      <div className="rounded-lg border border-slate-200 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="text-left font-medium px-3 py-2">Customer</th>
              <th className="text-left font-medium px-3 py-2">Product</th>
              <th className="text-right font-medium px-3 py-2">Qty</th>
              <th className="text-right font-medium px-3 py-2">Value</th>
              <th className="text-left font-medium px-3 py-2">Ordered</th>
              <th className="text-left font-medium px-3 py-2">Reorder Due</th>
              <th className="text-left font-medium px-3 py-2">Status</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <tr key={i} className="border-t border-slate-100">
                  <td className="px-3 py-3" colSpan={8}>
                    <Skeleton className="h-4 w-full" />
                  </td>
                </tr>
              ))
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-12 text-center">
                  <PackageCheck className="h-8 w-8 text-slate-300 mx-auto mb-2" />
                  <p className="text-sm text-slate-500">
                    {orders.length === 0
                      ? "No orders recorded yet. Record one when a customer buys a batch."
                      : "No orders match these filters."}
                  </p>
                </td>
              </tr>
            ) : (
              filtered.map((o) => {
                const days = o.reorder_due_date ? daysUntil(o.reorder_due_date) : null
                return (
                  <tr key={o.id} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="px-3 py-2">
                      <Link
                        href={`/leads/${o.lead_id}`}
                        className="font-medium text-slate-800 hover:text-blue-600 hover:underline"
                      >
                        {o.lead?.company_name ?? o.lead?.full_name ?? o.lead?.phone_number ?? "—"}
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-slate-600">{o.product}</td>
                    <td className="px-3 py-2 text-right text-slate-600">{o.quantity}</td>
                    <td className="px-3 py-2 text-right text-slate-700 whitespace-nowrap">
                      {formatKes(o.total_amount, o.currency)}
                    </td>
                    <td className="px-3 py-2 text-slate-500 whitespace-nowrap">
                      {formatDate(o.order_date)}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {o.reorder_due_date ? (
                        <span className={cn("font-medium", days !== null ? getRenewalColorClass(days) : "")}>
                          {formatDate(o.reorder_due_date)}
                          {days !== null && (
                            <span className="text-xs ml-1">
                              ({days < 0 ? `${Math.abs(days)}d overdue` : `${days}d`})
                            </span>
                          )}
                        </span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={cn(
                          "inline-flex rounded-full border px-2 py-0.5 text-xs font-medium capitalize",
                          STATUS_CLASSES[o.delivery_status],
                        )}
                      >
                        {o.delivery_status}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex gap-1 justify-end">
                        {o.delivery_status === "pending" && (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 px-2 text-xs gap-1"
                              onClick={() => void setStatus(o, "delivered")}
                            >
                              <Truck className="h-3 w-3" />
                              Delivered
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2 text-xs text-slate-500"
                              onClick={() => void setStatus(o, "cancelled")}
                            >
                              <Ban className="h-3 w-3" />
                            </Button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      <RecordOrderDialog
        open={recordOpen}
        onClose={() => setRecordOpen(false)}
        departmentId={department.id}
        productNames={products.map((p) => p.name)}
        wonStageKeys={stages.filter((s) => s.is_won || !s.is_terminal).map((s) => s.key)}
        telemarketerId={activeTelemarketer?.id ?? null}
        onSaved={() => void load()}
      />
    </div>
  )
}

/**
 * Record a batch a customer has bought.
 *
 * `reorder_due_date` is the point of the whole page: it puts the customer back
 * on the list when they are due to buy again, and it is what turns the lead RED
 * once it passes.
 */
function RecordOrderDialog({
  open,
  onClose,
  departmentId,
  productNames,
  wonStageKeys,
  telemarketerId,
  onSaved,
}: {
  open: boolean
  onClose: () => void
  departmentId: string
  productNames: string[]
  wonStageKeys: string[]
  telemarketerId: string | null
  onSaved: () => void
}) {
  const [leads, setLeads] = useState<WonLead[]>([])
  const [leadId, setLeadId] = useState("")
  const [product, setProduct] = useState("")
  const [quantity, setQuantity] = useState("")
  const [unitPrice, setUnitPrice] = useState("")
  const [reorderDue, setReorderDue] = useState(format(addDays(new Date(), 30), "yyyy-MM-dd"))
  const [notes, setNotes] = useState("")
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setLeadId("")
    setProduct(productNames[0] ?? "")
    setQuantity("")
    setUnitPrice("")
    setReorderDue(format(addDays(new Date(), 30), "yyyy-MM-dd"))
    setNotes("")

    const supabase = createClient()
    ;(async () => {
      let q = supabase
        .from("leads")
        .select("id, company_name, full_name, phone_number")
        .eq("department_id", departmentId)
      if (wonStageKeys.length > 0) q = q.in("funnel_stage", wonStageKeys)
      const { data, error } = await q.order("company_name").limit(200)
      if (error) console.error(error)
      setLeads((data ?? []) as unknown as WonLead[])
    })()
  }, [open, departmentId, productNames, wonStageKeys])

  const total =
    quantity && unitPrice ? Number(quantity) * Number(unitPrice) : null

  async function save() {
    if (!leadId || !product || !quantity) {
      toast.error("Customer, product and quantity are required")
      return
    }
    setSaving(true)
    try {
      const supabase = createClient()
      const { error } = await supabase.from("service_orders").insert({
        lead_id: leadId,
        department_id: departmentId,
        telemarketer_id: telemarketerId!,
        product,
        quantity: Number(quantity),
        unit_price: unitPrice ? Number(unitPrice) : null,
        total_amount: total,
        reorder_due_date: reorderDue || null,
        notes: notes || null,
      })
      if (error) throw error
      toast.success("Order recorded")
      onSaved()
      onClose()
    } catch (err) {
      console.error(err)
      toast.error("Could not record the order")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o: boolean) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Record Order</DialogTitle>
          <DialogDescription>
            The reorder date puts this customer back on the list when they are due to buy again.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs text-slate-600">Customer</Label>
            <select
              value={leadId}
              onChange={(e) => setLeadId(e.target.value)}
              className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">Select a customer…</option>
              {leads.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.company_name ?? l.full_name ?? l.phone_number}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <Label className="text-xs text-slate-600">Product</Label>
            <select
              value={product}
              onChange={(e) => setProduct(e.target.value)}
              className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
            >
              {productNames.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs text-slate-600">Quantity</Label>
              <Input
                type="number"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                className="h-9 text-sm"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-slate-600">Unit price (KES)</Label>
              <Input
                type="number"
                value={unitPrice}
                onChange={(e) => setUnitPrice(e.target.value)}
                className="h-9 text-sm"
              />
            </div>
          </div>

          {total != null && (
            <p className="text-xs text-slate-500">
              Total: <span className="font-medium text-slate-700">{formatKes(total)}</span>
            </p>
          )}

          <div className="space-y-1">
            <Label className="text-xs text-slate-600">Reorder due</Label>
            <Input
              type="date"
              value={reorderDue}
              onChange={(e) => setReorderDue(e.target.value)}
              className="h-9 text-sm"
            />
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
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <PackageCheck className="h-4 w-4" />}
            Record Order
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
