"use client"

import { ChevronDown, User } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useTelemarketerStore } from "@/lib/stores/telemarketerStore"

const TELEMARKETERS = [
  { id: "sonnie", full_name: "Sonnie", email: "sonnie@nebsam.co.ke", phone: null, created_at: "" },
  { id: "janet", full_name: "Janet", email: "janet@nebsam.co.ke", phone: null, created_at: "" },
  { id: "suzzie", full_name: "Suzzie", email: "suzzie@nebsam.co.ke", phone: null, created_at: "" },
]

export function TelemarketerSwitcher() {
  const { activeTelemarketer, setActiveTelemarketer } = useTelemarketerStore()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium hover:bg-slate-100 transition-colors outline-none">
        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-600 text-white text-xs font-bold">
          {activeTelemarketer ? activeTelemarketer.full_name[0] : <User className="h-3.5 w-3.5" />}
        </div>
        <span className="text-slate-700">
          {activeTelemarketer ? activeTelemarketer.full_name : "Select Telemarketer"}
        </span>
        <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuLabel>Switch Telemarketer</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {TELEMARKETERS.map((t) => (
          <DropdownMenuItem
            key={t.id}
            onClick={() => setActiveTelemarketer(t)}
            className="cursor-pointer"
          >
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-100 text-blue-700 text-xs font-bold mr-2">
              {t.full_name[0]}
            </div>
            {t.full_name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
