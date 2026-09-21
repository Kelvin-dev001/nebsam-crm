"use client"

import { useEffect } from "react"
import { usePathname } from "next/navigation"
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
  const pathname = usePathname()
  const loaded = useDepartmentStore((s) => s.loaded)
  const error = useDepartmentStore((s) => s.error)

  useEffect(() => {
    // Migration 011 restricts the config tables to `authenticated`, so there is
    // nothing to load for a signed-out visitor. Skipping /login matters for a
    // subtler reason than tidiness: loadDepartmentConfig marks the store
    // `loaded` on failure as well as success, so one refused attempt on the
    // login page would have left the app permanently unconfigured for that
    // session — falling back to hardcoded telematics behaviour with no retry.
    if (pathname === "/login") return

    // Retry if a previous attempt failed, e.g. it ran before the session was
    // established.
    if (loaded && !error) return

    void loadDepartmentConfig()
  }, [pathname, loaded, error])

  return null
}
