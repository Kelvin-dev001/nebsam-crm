"use client"

import { useEffect, useState } from "react"
import { Users, Search, X, CheckSquare } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import { createClient } from "@/lib/supabase/client"
import { FunnelStageBadge } from "@/components/leads/FunnelStageBadge"
import { RAGBadge } from "@/components/leads/RAGBadge"
import { FunnelStage, RAGStatus } from "@/types/crm"

interface LeadRow {
  id: string
  phone_number: string
  full_name: string | null
  product_interested: string | null
  funnel_stage: FunnelStage
  rag_status: RAGStatus
  telemarketer: { id: string; full_name: string } | null
}

interface TelemarketerOption { id: string; full_name: string }

export function LeadAssignment() {
  const [leads, setLeads] = useState<LeadRow[]>([])
  const [loading, setLoading] = useState(true)
  const [telemarketers, setTelemarketers] = useState<TelemarketerOption[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [assignTo, setAssignTo] = useState("")
  const [assigning, setAssigning] = useState(false)
  const [search, setSearch] = useState("")
  const [tmFilter, setTmFilter] = useState("")

  useEffect(() => {
    const supabase = createClient()
    Promise.all([
      supabase
        .from("leads")
        .select("id, phone_number, full_name, product_interested, funnel_stage, rag_status, telemarketer:telemarketers(id, full_name)")
        .order("created_at", { ascending: false })
        .limit(500),
      supabase.from("telemarketers").select("id, full_name").eq("is_active", true).order("full_name"),
    ]).then(([leadsResult, tmResult]) => {
      setLeads((leadsResult.data as unknown as LeadRow[]) ?? [])
      setTelemarketers((tmResult.data as TelemarketerOption[]) ?? [])
      setLoading(false)
    })
  }, [])

  const filtered = leads.filter((l) => {
    const q = search.toLowerCase()
    const matchesSearch = !q || (l.full_name ?? "").toLowerCase().includes(q) || l.phone_number.toLowerCase().includes(q)
    const matchesTm = !tmFilter
      ? true
      : tmFilter === "__unassigned__"
        ? !l.telemarketer
        : l.telemarketer?.id === tmFilter
    return matchesSearch && matchesTm
  })

  function toggleAll(checked: boolean) {
    if (checked) setSelected(new Set(filtered.map((l) => l.id)))
    else setSelected(new Set())
  }

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function assignSelected() {
    if (!assignTo || selected.size === 0) return
    setAssigning(true)
    const supabase = createClient()
    const ids = Array.from(selected)

    const { error } = await supabase.from("leads")
      .update({ assigned_to: assignTo })
      .in("id", ids)

    if (error) {
      toast.error("Assignment failed")
    } else {
      const tm = telemarketers.find((t) => t.id === assignTo)
      setLeads((prev) =>
        prev.map((l) =>
          selected.has(l.id)
            ? { ...l, telemarketer: tm ? { id: tm.id, full_name: tm.full_name } : l.telemarketer }
            : l
        )
      )
      toast.success(`${ids.length} lead${ids.length !== 1 ? "s" : ""} assigned to ${tm?.full_name}`)
      setSelected(new Set())
      setAssignTo("")
    }
    setAssigning(false)
  }

  const allFilteredSelected = filtered.length > 0 && filtered.every((l) => selected.has(l.id))

  return (
    <div className="space-y-3">
      {/* Action bar */}
      <div className="flex flex-wrap gap-2 items-center p-3 bg-slate-50 rounded-xl border border-slate-200">
        <CheckSquare className="h-4 w-4 text-slate-400 shrink-0" />
        <span className="text-sm text-slate-600">
          {selected.size > 0 ? `${selected.size} lead${selected.size !== 1 ? "s" : ""} selected` : "Select leads to assign"}
        </span>
        {selected.size > 0 && (
          <>
            <select
              value={assignTo}
              onChange={(e) => setAssignTo(e.target.value)}
              className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Assign to…</option>
              {telemarketers.map((t) => (
                <option key={t.id} value={t.id}>{t.full_name}</option>
              ))}
            </select>
            <Button
              size="sm"
              className="h-9 gap-1.5"
              disabled={!assignTo || assigning}
              onClick={assignSelected}
            >
              <Users className="h-3.5 w-3.5" />
              {assigning ? "Assigning…" : "Assign"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-9 text-slate-500"
              onClick={() => setSelected(new Set())}
            >
              Clear selection
            </Button>
          </>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
          <Input
            placeholder="Search name or phone…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 h-9 text-sm w-52"
          />
        </div>
        <select
          value={tmFilter}
          onChange={(e) => setTmFilter(e.target.value)}
          className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">All</option>
          <option value="__unassigned__">Unassigned</option>
          {telemarketers.map((t) => (
            <option key={t.id} value={t.id}>{t.full_name}</option>
          ))}
        </select>
        {(search || tmFilter) && (
          <Button variant="ghost" size="sm" className="h-9 gap-1.5 text-slate-500"
            onClick={() => { setSearch(""); setTmFilter("") }}>
            <X className="h-3.5 w-3.5" /> Clear
          </Button>
        )}
        <span className="ml-auto text-xs text-slate-400">
          {loading ? "Loading…" : `${filtered.length} leads`}
        </span>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-slate-200 overflow-hidden bg-white">
        <Table>
          <TableHeader>
            <TableRow className="bg-slate-50 hover:bg-slate-50">
              <TableHead className="w-10 py-3">
                <input
                  type="checkbox"
                  className="rounded border-slate-300 cursor-pointer"
                  checked={allFilteredSelected}
                  onChange={(e) => toggleAll(e.target.checked)}
                />
              </TableHead>
              {["Phone", "Name", "Currently Assigned", "Product", "Stage", "RAG"].map((h) => (
                <TableHead key={h} className="text-xs font-semibold text-slate-500 uppercase tracking-wide py-3">
                  {h}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              Array.from({ length: 8 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 7 }).map((_, j) => (
                    <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                  ))}
                </TableRow>
              ))
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="h-32 text-center text-slate-400 text-sm">
                  No leads found
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((lead) => (
                <TableRow
                  key={lead.id}
                  className={`hover:bg-slate-50 cursor-pointer ${selected.has(lead.id) ? "bg-blue-50" : ""}`}
                  onClick={() => toggleOne(lead.id)}
                >
                  <TableCell>
                    <input
                      type="checkbox"
                      className="rounded border-slate-300 cursor-pointer"
                      checked={selected.has(lead.id)}
                      onChange={() => toggleOne(lead.id)}
                      onClick={(e) => e.stopPropagation()}
                    />
                  </TableCell>
                  <TableCell className="font-mono text-xs text-slate-700">{lead.phone_number}</TableCell>
                  <TableCell className="text-sm text-slate-800">
                    {lead.full_name ?? <span className="text-slate-400 italic text-xs">Unknown</span>}
                  </TableCell>
                  <TableCell className="text-sm text-slate-600">
                    {lead.telemarketer?.full_name ?? (
                      <span className="text-amber-600 text-xs font-medium">Unassigned</span>
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-slate-500">{lead.product_interested ?? "—"}</TableCell>
                  <TableCell><FunnelStageBadge stage={lead.funnel_stage} /></TableCell>
                  <TableCell><RAGBadge status={lead.rag_status} /></TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
