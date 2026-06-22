"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { Search, X } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import { createClient } from "@/lib/supabase/client"
import { FunnelStageBadge } from "@/components/leads/FunnelStageBadge"
import { RAGBadge } from "@/components/leads/RAGBadge"
import { formatDate } from "@/lib/utils/dateHelpers"
import { FunnelStage, RAGStatus, FUNNEL_STAGE_LABELS } from "@/types/crm"

interface LeadRow {
  id: string
  phone_number: string
  full_name: string | null
  product_interested: string | null
  funnel_stage: FunnelStage
  rag_status: RAGStatus
  created_at: string
  telemarketer: { full_name: string } | null
}

interface TelemarketerOption { id: string; full_name: string }

export function AllLeadsOverview() {
  const [leads, setLeads] = useState<LeadRow[]>([])
  const [loading, setLoading] = useState(true)
  const [telemarketers, setTelemarketers] = useState<TelemarketerOption[]>([])
  const [search, setSearch] = useState("")
  const [tmFilter, setTmFilter] = useState("")
  const [stageFilter, setStageFilter] = useState("")

  useEffect(() => {
    const supabase = createClient()
    Promise.all([
      supabase
        .from("leads")
        .select("id, phone_number, full_name, product_interested, funnel_stage, rag_status, created_at, telemarketer:telemarketers(full_name)")
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
    const matchesSearch =
      !q ||
      (l.full_name ?? "").toLowerCase().includes(q) ||
      l.phone_number.toLowerCase().includes(q)
    const matchesTm = !tmFilter || l.telemarketer?.full_name === tmFilter
    const matchesStage = !stageFilter || l.funnel_stage === stageFilter
    return matchesSearch && matchesTm && matchesStage
  })

  const hasFilters = search || tmFilter || stageFilter

  return (
    <div className="space-y-3">
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
          <option value="">All Telemarketers</option>
          {telemarketers.map((t) => (
            <option key={t.id} value={t.full_name}>{t.full_name}</option>
          ))}
        </select>
        <select
          value={stageFilter}
          onChange={(e) => setStageFilter(e.target.value)}
          className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">All Stages</option>
          {Object.entries(FUNNEL_STAGE_LABELS).map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </select>
        {hasFilters && (
          <Button variant="ghost" size="sm" className="h-9 gap-1.5 text-slate-500"
            onClick={() => { setSearch(""); setTmFilter(""); setStageFilter("") }}>
            <X className="h-3.5 w-3.5" /> Clear
          </Button>
        )}
        <span className="ml-auto text-xs text-slate-400">
          {loading ? "Loading…" : `${filtered.length} of ${leads.length} leads`}
        </span>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-slate-200 overflow-hidden bg-white">
        <Table>
          <TableHeader>
            <TableRow className="bg-slate-50 hover:bg-slate-50">
              {["Phone", "Name", "Assigned To", "Product", "Stage", "RAG", "Created", ""].map((h) => (
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
                  {Array.from({ length: 8 }).map((_, j) => (
                    <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                  ))}
                </TableRow>
              ))
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="h-32 text-center text-slate-400 text-sm">
                  No leads found
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((lead) => (
                <TableRow key={lead.id} className="hover:bg-slate-50">
                  <TableCell className="font-mono text-xs text-blue-600">
                    <Link href={`/leads/${lead.id}`} className="hover:underline">
                      {lead.phone_number}
                    </Link>
                  </TableCell>
                  <TableCell className="text-sm text-slate-800">
                    {lead.full_name ?? <span className="text-slate-400 italic text-xs">Unknown</span>}
                  </TableCell>
                  <TableCell className="text-sm text-slate-600">
                    {lead.telemarketer?.full_name ?? <span className="text-amber-600 text-xs font-medium">Unassigned</span>}
                  </TableCell>
                  <TableCell className="text-xs text-slate-500">
                    {lead.product_interested ?? "—"}
                  </TableCell>
                  <TableCell><FunnelStageBadge stage={lead.funnel_stage} /></TableCell>
                  <TableCell><RAGBadge status={lead.rag_status} /></TableCell>
                  <TableCell className="text-xs text-slate-400 whitespace-nowrap">
                    {formatDate(lead.created_at)}
                  </TableCell>
                  <TableCell>
                    <Link
                      href={`/leads/${lead.id}`}
                      className="text-xs text-blue-600 hover:underline whitespace-nowrap"
                    >
                      View →
                    </Link>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
