"use client"

import { useMemo } from "react"
import { createClient } from "@/lib/supabase/client"
import { useDepartmentStore } from "@/lib/stores/departmentStore"
import { useTelemarketerStore } from "@/lib/stores/telemarketerStore"
import type {
  AcademicTerm,
  Department,
  DepartmentConfig,
  DepartmentProduct,
  FunnelStageDef,
  KycFieldDef,
} from "@/types/crm"

/**
 * Department configuration: one fetch for the whole session.
 *
 * Reps are locked to their own department (decision D7); admins get a switcher
 * that defaults to "All departments".
 */

/**
 * Load every config table and populate the store. Called once by
 * DepartmentProvider.
 *
 * Failure is NOT fatal and must never be. If these queries fail — an older
 * database without migration 009, an RLS policy tightened in 011, a dropped
 * connection — the store simply stays empty, `funnelHelpers` falls back to its
 * original hardcoded telematics behaviour, and the app keeps working exactly as
 * it did before this sprint. That fallback is the whole reason the original
 * helpers were kept.
 */
export async function loadDepartmentConfig(): Promise<void> {
  const store = useDepartmentStore.getState()
  const supabase = createClient()

  try {
    const [depRes, stageRes, kycRes, prodRes, termRes] = await Promise.all([
      supabase.from("departments").select("*").order("sort_order"),
      supabase.from("funnel_stages").select("*").order("sort_order"),
      supabase.from("kyc_fields").select("*").order("sort_order"),
      supabase.from("department_products").select("*").order("sort_order"),
      supabase.from("academic_terms").select("*").order("start_date"),
    ])

    const firstError =
      depRes.error || stageRes.error || kycRes.error || prodRes.error || termRes.error
    if (firstError) {
      console.error("[departments] config load failed:", firstError.message)
      store.setError(firstError.message)
      return
    }

    const departments = (depRes.data ?? []) as unknown as Department[]
    const stages = (stageRes.data ?? []) as unknown as FunnelStageDef[]
    const kycFields = (kycRes.data ?? []) as unknown as KycFieldDef[]
    const products = (prodRes.data ?? []) as unknown as DepartmentProduct[]
    const terms = (termRes.data ?? []) as unknown as AcademicTerm[]

    const configs: Record<string, DepartmentConfig> = {}
    for (const department of departments) {
      configs[department.id] = {
        department,
        stages: stages.filter((s) => s.department_id === department.id),
        kycFields: kycFields.filter((k) => k.department_id === department.id),
        products: products.filter((p) => p.department_id === department.id),
      }
    }

    store.setConfig(departments, configs, terms)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error("[departments] config load threw:", message)
    store.setError(message)
  }
}

export interface UseDepartmentResult {
  /** The department in effect, or null for an admin viewing all. */
  department: Department | null
  /** All departments, for an admin switcher. */
  departments: Department[]
  stages: FunnelStageDef[]
  kycFields: KycFieldDef[]
  products: DepartmentProduct[]
  academicTerms: AcademicTerm[]
  /** True when the signed-in user may switch departments (admins only). */
  canSwitch: boolean
  /** True while the config has not settled yet. */
  loading: boolean
  error: string | null
  setActiveDepartment: (id: string | null) => void
}

/**
 * Resolve the department config for the signed-in user.
 *
 * A rep's department comes from the telemarketer row already in
 * `telemarketerStore` — AuthProvider fetches it with `select("*")`, so
 * `department_id` arrives for free now that migration 009 has added the column.
 * That is deliberate: AuthProvider carries a hard constraint about not awaiting
 * supabase calls inside the GoTrue lock, and the less this work touches it, the
 * better.
 */
export function useDepartment(): UseDepartmentResult {
  const activeTelemarketer = useTelemarketerStore((s) => s.activeTelemarketer)
  const departments = useDepartmentStore((s) => s.departments)
  const configs = useDepartmentStore((s) => s.configs)
  const academicTerms = useDepartmentStore((s) => s.academicTerms)
  const activeDepartmentId = useDepartmentStore((s) => s.activeDepartmentId)
  const loaded = useDepartmentStore((s) => s.loaded)
  const error = useDepartmentStore((s) => s.error)
  const setActiveDepartment = useDepartmentStore((s) => s.setActiveDepartment)

  // A linked telemarketer means a rep; no link means admin (AuthProvider sets
  // activeTelemarketer to null for admins).
  const repDepartmentId = activeTelemarketer?.department_id ?? null
  const isRep = Boolean(activeTelemarketer)

  // Reps are locked to their own department; their stored selection is ignored.
  const effectiveId = isRep ? repDepartmentId : activeDepartmentId

  return useMemo(() => {
    const config = effectiveId ? configs[effectiveId] ?? null : null
    return {
      department: config?.department ?? null,
      departments,
      stages: config?.stages ?? [],
      kycFields: (config?.kycFields ?? []).filter((f) => f.is_active),
      products: (config?.products ?? []).filter((p) => p.is_active),
      academicTerms,
      canSwitch: !isRep,
      loading: !loaded,
      error,
      setActiveDepartment,
    }
  }, [
    effectiveId,
    configs,
    departments,
    academicTerms,
    isRep,
    loaded,
    error,
    setActiveDepartment,
  ])
}

/**
 * Stages for an arbitrary department — for admin views listing leads across
 * departments, where each row needs its own department's labels and colours.
 */
export function useStagesFor(departmentId: string | null | undefined): FunnelStageDef[] {
  const configs = useDepartmentStore((s) => s.configs)
  return useMemo(
    () => (departmentId ? configs[departmentId]?.stages ?? [] : []),
    [configs, departmentId],
  )
}
