"use client"

import { create } from "zustand"
import { persist } from "zustand/middleware"
import { Telemarketer } from "@/types/crm"

interface TelemarketerStore {
  activeTelemarketer: Telemarketer | null
  setActiveTelemarketer: (telemarketer: Telemarketer | null) => void
}

export const useTelemarketerStore = create<TelemarketerStore>()(
  persist(
    (set) => ({
      activeTelemarketer: null,
      setActiveTelemarketer: (telemarketer) =>
        set({ activeTelemarketer: telemarketer }),
    }),
    {
      name: "nebsam-active-telemarketer",
    }
  )
)
