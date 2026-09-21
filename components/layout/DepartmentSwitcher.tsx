"use client"

import { Building2 } from "lucide-react"
import { useDepartment } from "@/lib/departments/useDepartment"

/**
 * Department switcher — admin only.
 *
 * A rep is locked to their own department (decision D7), so for them this
 * renders a read-only badge. An admin has no department of their own, which
 * means without this control `activeDepartmentId` stays null forever and the
 * department-scoped pages (/reorders, /buses, /term-billing) have nothing to
 * scope to — they would sit permanently on their "no department selected"
 * state, pointing at a switcher that did not exist.
 *
 * "All departments" is the admin default and is right for the cross-department
 * views (Admin → Overview, Performance). The post-sale pages need a specific
 * one, because a reorder list spanning four departments with four different
 * post-sale models would be meaningless.
 */
export function DepartmentSwitcher() {
  const { department, departments, canSwitch, setActiveDepartment, loading } = useDepartment()

  if (loading || departments.length === 0) return null

  // Rep: show where they are, but do not offer a change.
  if (!canSwitch) {
    if (!department) return null
    return (
      <span
        className="hidden sm:inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium"
        style={{ borderColor: department.accent_color, color: department.accent_color }}
        title="Your department"
      >
        <span
          className="inline-block h-2 w-2 rounded-full"
          style={{ backgroundColor: department.accent_color }}
        />
        {department.name}
      </span>
    )
  }

  return (
    <label className="flex items-center gap-1.5" title="Admin: switch department">
      <Building2 className="h-4 w-4 text-slate-400" />
      <select
        value={department?.id ?? ""}
        onChange={(e) => setActiveDepartment(e.target.value || null)}
        className="h-8 rounded-md border border-input bg-background px-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-ring"
      >
        <option value="">All departments</option>
        {departments
          .filter((d) => d.is_active)
          .map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
      </select>
    </label>
  )
}
