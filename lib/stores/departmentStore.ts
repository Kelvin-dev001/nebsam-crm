"use client"

import { create } from "zustand"
import { persist } from "zustand/middleware"
import type {
  Department,
  DepartmentConfig,
  DepartmentProduct,
  FunnelStageDef,
  KycFieldDef,
  AcademicTerm,
} from "@/types/crm"

/**
 * Department configuration, loaded ONCE per session and cached here.
 *
 * Stage labels, colours, KYC questions and product lists live in the database
 * (decision D3), which means every leads row, every badge and every dropdown
 * needs them. Fetching per row would be thousands of requests; this store is
 * what makes the config-driven design affordable. DepartmentProvider fills it
 * at app start and nothing else should fetch these tables.
 *
 * Only `activeDepartmentId` is persisted. The config itself is deliberately NOT
 * persisted: it changes when an admin edits a stage or adds a KYC question, and
 * a stale copy in localStorage would show a rep the wrong funnel until they
 * cleared their browser. It costs one query at startup to always be correct.
 */
interface DepartmentStore {
  departments: Department[]
  configs: Record<string, DepartmentConfig>
  academicTerms: AcademicTerm[]
  /** null = "All departments" (admin only). */
  activeDepartmentId: string | null
  /** True once the initial load has settled, successfully or not. */
  loaded: boolean
  /** Set when the config could not be loaded, so the UI can say so. */
  error: string | null

  setActiveDepartment: (id: string | null) => void
  setConfig: (
    departments: Department[],
    configs: Record<string, DepartmentConfig>,
    academicTerms: AcademicTerm[],
  ) => void
  setError: (message: string | null) => void
  reset: () => void
}

export const useDepartmentStore = create<DepartmentStore>()(
  persist(
    (set) => ({
      departments: [],
      configs: {},
      academicTerms: [],
      activeDepartmentId: null,
      loaded: false,
      error: null,

      setActiveDepartment: (id) => set({ activeDepartmentId: id }),

      setConfig: (departments, configs, academicTerms) =>
        set({ departments, configs, academicTerms, loaded: true, error: null }),

      setError: (message) => set({ error: message, loaded: true }),

      reset: () =>
        set({
          departments: [],
          configs: {},
          academicTerms: [],
          activeDepartmentId: null,
          loaded: false,
          error: null,
        }),
    }),
    {
      name: "nebsam-active-department",
      // Persist the selection only. See the note above.
      partialize: (state) => ({ activeDepartmentId: state.activeDepartmentId }),
    },
  ),
)

// ── Selectors ───────────────────────────────────────────────────────────────
// Plain functions rather than hooks so they can be used in callbacks and in
// non-React code (report builders, CSV import) without violating hook rules.

export function getDepartmentById(id: string | null | undefined): Department | null {
  if (!id) return null
  return useDepartmentStore.getState().departments.find((d) => d.id === id) ?? null
}

export function getDepartmentBySlug(slug: string): Department | null {
  return useDepartmentStore.getState().departments.find((d) => d.slug === slug) ?? null
}

export function getConfig(departmentId: string | null | undefined): DepartmentConfig | null {
  if (!departmentId) return null
  return useDepartmentStore.getState().configs[departmentId] ?? null
}

export function getStages(departmentId: string | null | undefined): FunnelStageDef[] {
  return getConfig(departmentId)?.stages ?? []
}

export function getKycFields(departmentId: string | null | undefined): KycFieldDef[] {
  return (getConfig(departmentId)?.kycFields ?? []).filter((f) => f.is_active)
}

export function getProducts(departmentId: string | null | undefined): DepartmentProduct[] {
  return (getConfig(departmentId)?.products ?? []).filter((p) => p.is_active)
}
