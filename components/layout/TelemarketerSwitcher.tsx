"use client"

import { useEffect, useState } from "react"
import { ChevronDown, Loader2, User } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useTelemarketerStore } from "@/lib/stores/telemarketerStore"
import { createClient } from "@/lib/supabase/client"
import { Telemarketer } from "@/types/crm"

export function TelemarketerSwitcher() {
  const { activeTelemarketer, setActiveTelemarketer } = useTelemarketerStore()
  const [telemarketers, setTelemarketers] = useState<Telemarketer[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const supabase = createClient()
    supabase
      .from("telemarketers")
      .select("*")
      .eq("is_active", true)
      .order("full_name")
      .then(({ data }) => {
        if (data) setTelemarketers(data as Telemarketer[])
        setLoading(false)
      })
  }, [])

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium hover:bg-slate-100 transition-colors outline-none">
        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-600 text-white text-xs font-bold shrink-0">
          {activeTelemarketer ? (
            activeTelemarketer.full_name[0].toUpperCase()
          ) : (
            <User className="h-3.5 w-3.5" />
          )}
        </div>
        <span className="text-slate-700 hidden sm:block">
          {activeTelemarketer ? activeTelemarketer.full_name : "Select Telemarketer"}
        </span>
        <ChevronDown className="h-3.5 w-3.5 text-slate-400 hidden sm:block" />
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="text-xs text-slate-500 font-normal">
            Switch Telemarketer
          </DropdownMenuLabel>
          <DropdownMenuSeparator />

          {loading ? (
            <div className="flex items-center gap-2 px-2 py-2 text-sm text-slate-500">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Loading…
            </div>
          ) : (
            telemarketers.map((t) => (
              <DropdownMenuItem
                key={t.id}
                onClick={() => setActiveTelemarketer(t)}
                className="cursor-pointer gap-2"
              >
                <div className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-100 text-blue-700 text-xs font-bold shrink-0">
                  {t.full_name[0].toUpperCase()}
                </div>
                <span>{t.full_name}</span>
                {activeTelemarketer?.id === t.id && (
                  <span className="ml-auto text-blue-600 text-xs">✓</span>
                )}
              </DropdownMenuItem>
            ))
          )}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
