"use client"

import { useEffect } from "react"
import { loadDepartmentConfig } from "@/lib/departments/useDepartment"
import { useDepartmentStore } from "@/lib/stores/departmentStore"

/**
 * Loads the department configuration once per session.
 *
 * Stage labels and colours, KYC questions and product lists are database rows
 * (decision D3), and the leads table needs them for every row. Fetching per row
 * would be thousands of requests, so it is loaded once here and read from
 * `departmentStore` everywhere else. Never fetch these tables from a component.
 *
 * Renders nothing, and deliberately does not block: if the config fails to
 * load, the app carries on with the original hardcoded telematics behaviour
 * rather than showing a spinner or an error page. This component must never be
 * the reason a rep cannot see their leads.
 *
 * Note it does NOT hook into onAuthStateChange. AuthProvider owns that
 * callback and carries a hard constraint about not awaiting supabase calls
 * inside the GoTrue auth lock; adding another await in there risks the deadlock
 * that hangs every request in the app. The config is per-database, not
 * per-user, so loading it once on mount is sufficient.
 */
export function DepartmentProvider() {
  const loaded = useDepartmentStore((s) => s.loaded)

  useEffect(() => {
    if (loaded) return
    void loadDepartmentConfig()
  }, [loaded])

  return null
}
