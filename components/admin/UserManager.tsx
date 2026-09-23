"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import {
  AlertTriangle, ArrowLeftRight, KeyRound, Loader2, Plus, RotateCcw, Search, Shield, UserCheck,
  UserMinus, Users,
} from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import { formatPhone } from "@/lib/utils/phoneHelpers"
import { createClient } from "@/lib/supabase/client"
import { AddUserSheet } from "./users/AddUserSheet"
import { LoginDetailsDialog, type LoginDetails } from "./users/LoginDetailsDialog"
import { ReassignDialog, type Candidate } from "./users/ReassignDialog"
import { AddAdminSheet } from "./admins/AddAdminSheet"
import { AdminActionDialog, type AdminAction } from "./admins/AdminActionDialog"
import { useDepartment } from "@/lib/departments/useDepartment"

/**
 * Admin → Users (§8.2). Replaces TelemarketerManager, which is left in place
 * and unused pending Kelvin's decision to delete it.
 *
 * Two things this fixes beyond adding logins:
 *
 *  · Lead counts are computed by rep_workload() in SQL. The old tab did
 *    `select("assigned_to")` and counted rows in the browser, which PostgREST
 *    silently truncates at 1,000 rows against 3,478 leads — the numbers were
 *    simply wrong, with no error.
 *  · "No login" is now visible. The old Add button created a rep row with no
 *    auth user, so the person could never sign in and nothing said so.
 */

interface UserRow {
  rep_id: string
  user_id: string | null
  full_name: string
  login_email: string | null
  phone: string | null
  job_title: string | null
  department_id: string | null
  department_name: string | null
  is_active: boolean
  must_change_password: boolean
  open_leads: number
  pending_followups: number
  last_sign_in_at: string | null
  status: "active" | "must_change_password" | "deactivated" | "no_login"
}

interface AdminRow {
  user_id: string
  full_name: string
  login_email: string | null
  phone: string | null
  is_active: boolean
  is_shared_account: boolean
  must_change_password: boolean
  last_sign_in_at: string | null
  status: string
}

interface Unrecognised {
  user_id: string
  email: string | null
  created_at: string | null
  role: string | null
}

const STATUS_STYLES: Record<string, { label: string; cls: string }> = {
  active:                { label: "Active",               cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  must_change_password:  { label: "Must change password", cls: "bg-amber-50 text-amber-700 border-amber-200" },
  deactivated:           { label: "Deactivated",          cls: "bg-slate-100 text-slate-600 border-slate-300" },
  no_login:              { label: "No login",             cls: "bg-red-50 text-red-700 border-red-200" },
}

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_STYLES[status] ?? STATUS_STYLES.active
  return (
    <span className={`inline-flex whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium ${s.cls}`}>
      {s.label}
    </span>
  )
}

/** "2 hours ago" / "never". Kept local — it is only used here. */
function relative(iso: string | null): string {
  if (!iso) return "never"
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 30) return `${days}d ago`
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
}

export function UserManager() {
  const [users, setUsers] = useState<UserRow[]>([])
  const [admins, setAdmins] = useState<AdminRow[]>([])
  const [unrecognised, setUnrecognised] = useState<Unrecognised[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [search, setSearch] = useState("")
  const [dept, setDept] = useState("")
  const [status, setStatus] = useState("")

  const [addOpen, setAddOpen] = useState(false)
  const [details, setDetails] = useState<LoginDetails | null>(null)
  const [creatingLoginFor, setCreatingLoginFor] = useState<string | null>(null)
  const [busyFor, setBusyFor] = useState<string | null>(null)
  const [confirmReset, setConfirmReset] = useState<UserRow | null>(null)
  const [reassign, setReassign] = useState<{ rep: UserRow; mode: "deactivate" | "move" } | null>(null)
  const [reassignBusy, setReassignBusy] = useState(false)
  const [reassignError, setReassignError] = useState<string | null>(null)
  const { departments: allDepartments } = useDepartment()
  const [addAdminOpen, setAddAdminOpen] = useState(false)
  const [adminAction, setAdminAction] = useState<{ admin: AdminRow; action: AdminAction } | null>(null)
  const [adminBusy, setAdminBusy] = useState(false)
  const [adminError, setAdminError] = useState<string | null>(null)
  const [me, setMe] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const res = await fetch("/api/admin/users")
      const body = await res.json()
      if (!res.ok || !body.ok) {
        // Surface it. The old All-Leads view showed an empty state instead of
        // the error and hid a broken query for weeks.
        setError(body.error ?? `Could not load users (${res.status}).`)
        return
      }
      setUsers(body.users ?? [])
      setAdmins(body.admins ?? [])
      setUnrecognised(body.unrecognised ?? [])
    } catch {
      setError("Could not reach the server.")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  // The signed-in admin's own id. Reset and Remove-access are refused for your
  // own row by the server; hiding them here stops an admin clicking a button
  // that can only fail.
  useEffect(() => {
    void (async () => {
      const { data } = await createClient().auth.getUser()
      setMe(data.user?.id ?? null)
    })()
  }, [])

  async function createLogin(rep: UserRow) {
    setCreatingLoginFor(rep.rep_id)
    try {
      const res = await fetch(`/api/admin/users/${rep.rep_id}/login`, { method: "POST" })
      const body = await res.json()
      if (!res.ok || !body.ok) {
        toast.error(body.error ?? "Could not create the login.")
        return
      }
      setDetails({
        full_name: body.full_name,
        email: body.email,
        tempPassword: body.tempPassword,
        departmentName: body.department?.name ?? null,
      })
      await load()
    } catch {
      toast.error("Could not reach the server.")
    } finally {
      setCreatingLoginFor(null)
    }
  }

  async function resetPassword(rep: UserRow) {
    setConfirmReset(null)
    setBusyFor(rep.rep_id)
    try {
      const res = await fetch(`/api/admin/users/${rep.rep_id}/reset-password`, { method: "POST" })
      const body = await res.json()
      if (!res.ok || !body.ok) {
        toast.error(body.error ?? "Could not reset the password.")
        return
      }
      // Straight into the one-time dialog. This is the only time the password
      // is visible, so it must not be behind a toast that can be dismissed.
      setDetails({
        full_name: body.full_name,
        email: body.email,
        tempPassword: body.tempPassword,
        departmentSlug: body.department?.slug ?? null,
        departmentName: body.department?.name ?? null,
      })
      await load()
    } catch {
      toast.error("Could not reach the server.")
    } finally {
      setBusyFor(null)
    }
  }

  async function requireChange(rep: UserRow) {
    setBusyFor(rep.rep_id)
    try {
      const res = await fetch(
        `/api/admin/users/${rep.rep_id}/require-password-change`, { method: "POST" },
      )
      const body = await res.json()
      if (!res.ok || !body.ok) {
        toast.error(body.error ?? "Could not set the flag.")
        return
      }
      toast.success(`${body.full_name} will be asked to set a new password at their next sign-in`)
      await load()
    } catch {
      toast.error("Could not reach the server.")
    } finally {
      setBusyFor(null)
    }
  }

  // Who could inherit: active reps in the SAME department, never the person
  // being acted on. reassign_rep_open_work refuses anything else, because RLS
  // would hide the leads from an inheritor in another department.
  function candidatesFor(rep: UserRow): Candidate[] {
    return users
      .filter(
        (u) =>
          u.rep_id !== rep.rep_id &&
          u.department_id === rep.department_id &&
          u.is_active &&
          u.status !== "deactivated",
      )
      .map((u) => ({ rep_id: u.rep_id, full_name: u.full_name, open_leads: u.open_leads }))
  }

  async function runReassign(opts: {
    inheritorId: string | null
    reason: string | null
    departmentId: string | null
  }) {
    if (!reassign) return
    const { rep, mode } = reassign
    setReassignBusy(true)
    setReassignError(null)
    try {
      const url =
        mode === "deactivate"
          ? `/api/admin/users/${rep.rep_id}/deactivate`
          : `/api/admin/users/${rep.rep_id}/department`
      const body =
        mode === "deactivate"
          ? { inheritor_id: opts.inheritorId, reason: opts.reason }
          : { department_id: opts.departmentId, inheritor_id: opts.inheritorId }

      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      })
      const b = await res.json()

      if (!res.ok || !b.ok) {
        // Keep the dialog open so the button becomes Retry. A partial failure
        // is resumable by design, and closing would hide that.
        setReassignError(b.error ?? "That did not work.")
        return
      }

      const m = b.moved ?? {}
      const parts: string[] = []
      if (m.leads_moved) parts.push(`${m.leads_moved} lead${m.leads_moved === 1 ? "" : "s"}`)
      if (m.followups_moved)
        parts.push(`${m.followups_moved} follow-up${m.followups_moved === 1 ? "" : "s"}`)
      if (m.followups_cancelled)
        parts.push(
          `${m.followups_cancelled} follow-up${m.followups_cancelled === 1 ? "" : "s"} cancelled`,
        )
      const where = b.inheritor ? ` to ${b.inheritor}` : m.to_backlog ? " to the backlog" : ""
      const movedText = parts.length ? ` - ${parts.join(", ")}${where}` : ""

      toast.success(
        mode === "deactivate"
          ? `${b.full_name} deactivated${movedText}`
          : `${b.full_name} moved to ${b.to}${movedText}`,
      )
      if (b.warnings?.length) {
        toast.warning(`Partly done: ${b.warnings.join("; ")}. Try again to finish.`)
      }
      setReassign(null)
      await load()
    } catch {
      setReassignError("Could not reach the server.")
    } finally {
      setReassignBusy(false)
    }
  }

  async function reactivate(rep: UserRow) {
    setBusyFor(rep.rep_id)
    try {
      const res = await fetch(`/api/admin/users/${rep.rep_id}/reactivate`, { method: "POST" })
      const b = await res.json()
      if (!res.ok || !b.ok) {
        toast.error(b.error ?? "Could not reactivate.")
        return
      }
      if (b.no_login) {
        toast.success(`${b.full_name} reactivated. They still need a login.`)
      } else {
        setDetails({
          full_name: b.full_name,
          email: b.email,
          tempPassword: b.tempPassword,
          departmentSlug: b.department?.slug ?? null,
          departmentName: b.department?.name ?? null,
        })
      }
      await load()
    } catch {
      toast.error("Could not reach the server.")
    } finally {
      setBusyFor(null)
    }
  }

  // A named admin who has signed in AND chosen their own password. Until one
  // exists, retiring the shared login could leave nobody able to administer
  // anything — the server refuses it too, this just stops offering the button.
  const provenNamedAdmin = admins.find(
    (a) => !a.is_shared_account && a.is_active && a.last_sign_in_at && !a.must_change_password,
  )

  async function runAdminAction(actorPassword: string, reason: string | null) {
    if (!adminAction) return
    const { admin: target, action } = adminAction
    setAdminBusy(true)
    setAdminError(null)
    try {
      const url =
        action === "retire"
          ? "/api/admin/admins/retire-shared"
          : action === "reset"
            ? `/api/admin/admins/${target.user_id}/reset-password`
            : `/api/admin/admins/${target.user_id}/${action}`

      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ actorPassword, ...(reason ? { reason } : {}) }),
      })
      const b = await res.json()

      if (!res.ok || !b.ok) {
        setAdminError(b.error ?? "That did not work.")
        return
      }

      if (b.tempPassword) {
        setDetails({ full_name: b.full_name, email: b.email, tempPassword: b.tempPassword })
      } else if (action === "retire") {
        toast.success(
          "The shared admin login is retired. Anyone who used it now needs their own account.",
        )
      } else {
        toast.success(`${b.full_name ?? "Administrator"} updated`)
      }
      if (b.warnings?.length) {
        toast.warning(`Partly done: ${b.warnings.join("; ")}. Try again to finish.`)
      }
      setAdminAction(null)
      await load()
    } catch {
      setAdminError("Could not reach the server.")
    } finally {
      setAdminBusy(false)
    }
  }

  async function requireAdminChange(target: AdminRow) {
    setBusyFor(target.user_id)
    try {
      const res = await fetch(
        `/api/admin/admins/${target.user_id}/require-password-change`, { method: "POST" },
      )
      const b = await res.json()
      if (!res.ok || !b.ok) { toast.error(b.error ?? "Could not set the flag."); return }
      toast.success(`${b.full_name} will be asked to set a new password at their next sign-in`)
      await load()
    } catch {
      toast.error("Could not reach the server.")
    } finally {
      setBusyFor(null)
    }
  }

  const departments = useMemo(
    () => Array.from(
      new Set(users.map((u) => u.department_name).filter((d): d is string => Boolean(d))),
    ).sort(),
    [users],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return users.filter((u) => {
      if (dept && u.department_name !== dept) return false
      if (status && u.status !== status) return false
      if (!q) return true
      return (
        u.full_name.toLowerCase().includes(q) ||
        (u.login_email ?? "").toLowerCase().includes(q) ||
        (u.phone ?? "").includes(q)
      )
    })
  }, [users, search, dept, status])

  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-10 w-full" />
        {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}
      </div>
    )
  }

  return (
    <div className="space-y-8">
      {error && (
        <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
          <div className="text-sm text-red-800">
            <p>{error}</p>
            <button onClick={() => void load()} className="mt-1 font-medium underline">Try again</button>
          </div>
        </div>
      )}

      {/* ── Unrecognised logins ────────────────────────────────────────────── */}
      {unrecognised.length > 0 && (
        <section className="rounded-lg border border-red-300 bg-red-50 p-4">
          <h3 className="flex items-center gap-2 font-semibold text-red-900">
            <AlertTriangle className="h-4 w-4" />
            Unrecognised logins ({unrecognised.length})
          </h3>
          <p className="mt-1 text-sm text-red-800">
            These logins are not linked to any rep or administrator. If you don&apos;t recognise one,
            contact your developer before doing anything else.
          </p>
          <div className="mt-3 space-y-1">
            {unrecognised.map((u) => (
              <div key={u.user_id} className="rounded border border-red-200 bg-white px-3 py-2 text-sm">
                <span className="font-mono">{u.email ?? "(no email)"}</span>
                <span className="ml-2 text-slate-500">
                  created {u.created_at?.slice(0, 10) ?? "?"} · role {u.role ?? "none"}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Administrators ─────────────────────────────────────────────────── */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="flex items-center gap-2 font-semibold text-slate-800">
            <Shield className="h-4 w-4 text-slate-500" />
            Administrators
          </h3>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setAddAdminOpen(true)}>
            <Plus className="h-4 w-4" /> Add administrator
          </Button>
        </div>
        <div className="rounded-lg border border-slate-200">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Login email</TableHead>
                <TableHead>Last sign-in</TableHead>
                <TableHead>Status</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {admins.map((a) => (
                <TableRow key={a.user_id}>
                  <TableCell className="font-medium">
                    {a.full_name}
                    {a.is_shared_account && (
                      <span className="ml-2 rounded-full border border-slate-300 bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                        Shared
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="font-mono text-sm">{a.login_email ?? "—"}</TableCell>
                  <TableCell className="text-sm text-slate-600">{relative(a.last_sign_in_at)}</TableCell>
                  <TableCell><StatusBadge status={a.status} /></TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1.5">
                      {a.user_id === me && (
                        <span className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-xs text-blue-700">
                          You
                        </span>
                      )}
                      {a.status === "deactivated" ? (
                        <Button
                          size="sm" variant="outline" className="gap-1.5"
                          onClick={() => { setAdminError(null); setAdminAction({ admin: a, action: "reactivate" }) }}
                        >
                          <UserCheck className="h-3.5 w-3.5" />
                          {a.is_shared_account ? "Un-retire" : "Restore"}
                        </Button>
                      ) : a.user_id === me ? null : (
                        <>
                          <Button
                            size="sm" variant="outline" className="gap-1.5"
                            onClick={() => { setAdminError(null); setAdminAction({ admin: a, action: "reset" }) }}
                          >
                            <KeyRound className="h-3.5 w-3.5" /> Reset password
                          </Button>
                          {!a.must_change_password && (
                            <Button
                              size="sm" variant="ghost" className="gap-1.5"
                              disabled={busyFor === a.user_id}
                              onClick={() => void requireAdminChange(a)}
                            >
                              <RotateCcw className="h-3.5 w-3.5" /> Require change
                            </Button>
                          )}
                          {a.is_shared_account ? (
                            <Button
                              size="sm" variant="ghost"
                              className="gap-1.5 text-red-600 hover:bg-red-50 hover:text-red-700"
                              disabled={!provenNamedAdmin}
                              title={
                                provenNamedAdmin
                                  ? `${provenNamedAdmin.full_name} has signed in and set their own password, so this is safe.`
                                  : "A named administrator must sign in and set their own password first, or nobody could administer the CRM."
                              }
                              onClick={() => { setAdminError(null); setAdminAction({ admin: a, action: "retire" }) }}
                            >
                              <UserMinus className="h-3.5 w-3.5" /> Retire shared login
                            </Button>
                          ) : (
                            <Button
                              size="sm" variant="ghost"
                              className="gap-1.5 text-red-600 hover:bg-red-50 hover:text-red-700"
                              onClick={() => { setAdminError(null); setAdminAction({ admin: a, action: "deactivate" }) }}
                            >
                              <UserMinus className="h-3.5 w-3.5" /> Remove access
                            </Button>
                          )}
                        </>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>

      {/* ── Sales reps ─────────────────────────────────────────────────────── */}
      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 font-semibold text-slate-800">
            <Users className="h-4 w-4 text-slate-500" />
            Sales reps
            <span className="text-sm font-normal text-slate-500">
              ({filtered.length}{filtered.length !== users.length && ` of ${users.length}`})
            </span>
          </h3>
          <Button size="sm" className="gap-1.5" onClick={() => setAddOpen(true)}>
            <Plus className="h-4 w-4" /> Add user
          </Button>
        </div>

        <div className="mb-3 flex flex-wrap gap-2">
          <div className="relative min-w-[200px] flex-1">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, email or phone" className="pl-8"
            />
          </div>
          <select
            value={dept} onChange={(e) => setDept(e.target.value)}
            className="h-10 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">All departments</option>
            {departments.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
          <select
            value={status} onChange={(e) => setStatus(e.target.value)}
            className="h-10 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">All statuses</option>
            <option value="active">Active</option>
            <option value="must_change_password">Must change password</option>
            <option value="deactivated">Deactivated</option>
            <option value="no_login">No login</option>
          </select>
        </div>

        <div className="rounded-lg border border-slate-200">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Login email</TableHead>
                <TableHead>Department</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead className="text-right">Open leads</TableHead>
                <TableHead className="text-right">Follow-ups</TableHead>
                <TableHead>Last sign-in</TableHead>
                <TableHead>Status</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={9} className="py-10 text-center text-sm text-slate-500">
                    {users.length === 0 ? "No users yet." : "No users match these filters."}
                  </TableCell>
                </TableRow>
              )}
              {filtered.map((u) => (
                <TableRow key={u.rep_id}>
                  <TableCell className="font-medium">
                    {u.full_name}
                    {u.job_title && <p className="text-xs font-normal text-slate-500">{u.job_title}</p>}
                  </TableCell>
                  <TableCell className="font-mono text-sm">{u.login_email ?? "—"}</TableCell>
                  <TableCell className="text-sm">{u.department_name ?? "—"}</TableCell>
                  <TableCell className="font-mono text-sm">{u.phone ? formatPhone(u.phone) : "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{u.open_leads.toLocaleString()}</TableCell>
                  <TableCell className="text-right tabular-nums">{u.pending_followups.toLocaleString()}</TableCell>
                  <TableCell className="text-sm text-slate-600">{relative(u.last_sign_in_at)}</TableCell>
                  <TableCell><StatusBadge status={u.status} /></TableCell>
                  <TableCell className="text-right">
                    {u.status === "no_login" ? (
                      <Button
                        size="sm" variant="outline" className="gap-1.5"
                        disabled={creatingLoginFor === u.rep_id}
                        onClick={() => void createLogin(u)}
                      >
                        {creatingLoginFor === u.rep_id
                          ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          : <KeyRound className="h-3.5 w-3.5" />}
                        Create login
                      </Button>
                    ) : (
                      <div className="flex justify-end gap-1.5">
                        <Button
                          size="sm" variant="outline" className="gap-1.5"
                          disabled={busyFor === u.rep_id}
                          onClick={() => setConfirmReset(u)}
                          title="Issue a new temporary password and end their other sessions"
                        >
                          {busyFor === u.rep_id
                            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            : <KeyRound className="h-3.5 w-3.5" />}
                          Reset password
                        </Button>
                        {!u.must_change_password && u.status !== "deactivated" && (
                          <Button
                            size="sm" variant="ghost" className="gap-1.5"
                            disabled={busyFor === u.rep_id}
                            onClick={() => void requireChange(u)}
                            title="Ask them to choose a new password at their next sign-in. Their current password keeps working until they do."
                          >
                            <RotateCcw className="h-3.5 w-3.5" />
                            Require change
                          </Button>
                        )}
                        {u.status === "deactivated" ? (
                          <Button
                            size="sm" variant="outline" className="gap-1.5"
                            disabled={busyFor === u.rep_id}
                            onClick={() => void reactivate(u)}
                            title="Unblock their login and issue a new temporary password. Their old leads are NOT returned."
                          >
                            {busyFor === u.rep_id
                              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              : <UserCheck className="h-3.5 w-3.5" />}
                            Reactivate
                          </Button>
                        ) : (
                          <>
                            <Button
                              size="sm" variant="ghost" className="gap-1.5"
                              onClick={() => { setReassignError(null); setReassign({ rep: u, mode: "move" }) }}
                              title="Move them to another department. Their open work stays behind."
                            >
                              <ArrowLeftRight className="h-3.5 w-3.5" />
                              Move
                            </Button>
                            <Button
                              size="sm" variant="ghost"
                              className="gap-1.5 text-red-600 hover:bg-red-50 hover:text-red-700"
                              onClick={() => { setReassignError(null); setReassign({ rep: u, mode: "deactivate" }) }}
                              title="Hand over their open work and block their login."
                            >
                              <UserMinus className="h-3.5 w-3.5" />
                              Deactivate
                            </Button>
                          </>
                        )}
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>


      </section>

      {confirmReset && (
        <Dialog open onOpenChange={(o) => { if (!o) setConfirmReset(null) }}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Reset {confirmReset.full_name}&apos;s password?</DialogTitle>
              <DialogDescription>
                Their current password stops working immediately, and they will be signed out
                everywhere.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-2 text-sm text-slate-600">
              <p>
                You will get a temporary password to share with them. It is shown{" "}
                <strong>once</strong> and is not stored anywhere.
              </p>
              <p className="text-slate-500">
                If you only want them to choose a new password without cutting off the one they
                have, use <strong>Require change</strong> instead.
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setConfirmReset(null)}>
                Cancel
              </Button>
              <Button className="flex-1" onClick={() => void resetPassword(confirmReset)}>
                Reset password
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}

      <AddAdminSheet
        open={addAdminOpen}
        onOpenChange={setAddAdminOpen}
        onCreated={(d) => { setDetails(d); void load() }}
      />

      {adminAction && (
        <AdminActionDialog
          action={adminAction.action}
          name={adminAction.admin.full_name}
          busy={adminBusy}
          error={adminError}
          extra={
            adminAction.action === "retire" && provenNamedAdmin ? (
              <p className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
                <strong>{provenNamedAdmin.full_name}</strong> has signed in and set their own
                password, so administrative access will not be lost.
              </p>
            ) : undefined
          }
          onCancel={() => { setAdminAction(null); setAdminError(null) }}
          onConfirm={(pw, reason) => void runAdminAction(pw, reason)}
        />
      )}

      {reassign && (
        <ReassignDialog
          mode={reassign.mode}
          repName={reassign.rep.full_name}
          departmentName={reassign.rep.department_name}
          openLeads={reassign.rep.open_leads}
          pendingFollowups={reassign.rep.pending_followups}
          candidates={candidatesFor(reassign.rep)}
          departments={allDepartments
            .filter((d) => d.is_active && d.id !== reassign.rep.department_id)
            .map((d) => ({ id: d.id, name: d.name }))}
          busy={reassignBusy}
          error={reassignError}
          onCancel={() => { setReassign(null); setReassignError(null) }}
          onConfirm={(opts) => void runReassign(opts)}
        />
      )}

      <AddUserSheet
        open={addOpen}
        onOpenChange={setAddOpen}
        onCreated={(d) => { setDetails(d); void load() }}
      />
      <LoginDetailsDialog details={details} onClose={() => setDetails(null)} />
    </div>
  )
}
