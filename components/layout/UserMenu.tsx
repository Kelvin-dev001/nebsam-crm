"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { ChevronDown, LogOut, Loader2 } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { createClient } from "@/lib/supabase/client"
import { useTelemarketerStore } from "@/lib/stores/telemarketerStore"

interface AuthUser {
  email: string
  role: string
  displayName: string
}

export function UserMenu() {
  const router = useRouter()
  const { activeTelemarketer } = useTelemarketerStore()
  const [user,        setUser]        = useState<AuthUser | null>(null)
  const [signingOut,  setSigningOut]  = useState(false)

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) return
      const role        = (session.user.user_metadata?.role as string | undefined) ?? "telemarketer"
      const displayName =
        activeTelemarketer?.full_name ??
        (role === "admin" ? "Admin" : session.user.email?.split("@")[0] ?? "User")
      setUser({ email: session.user.email ?? "", role, displayName })
    })
  }, [activeTelemarketer])

  async function handleSignOut() {
    setSigningOut(true)
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push("/login")
    router.refresh()
  }

  if (!user) {
    return (
      <div className="flex h-9 w-9 items-center justify-center rounded-lg">
        <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
      </div>
    )
  }

  const initials = user.displayName
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2)

  const avatarColor = user.role === "admin" ? "bg-purple-600" : "bg-blue-600"

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium hover:bg-slate-100 transition-colors outline-none">
        <div className={`flex h-7 w-7 items-center justify-center rounded-full ${avatarColor} text-white text-xs font-bold shrink-0`}>
          {initials}
        </div>
        <span className="text-slate-700 hidden sm:block max-w-[120px] truncate">
          {user.displayName}
        </span>
        <ChevronDown className="h-3.5 w-3.5 text-slate-400 hidden sm:block" />
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="font-normal">
            <div className="flex flex-col space-y-0.5">
              <span className="text-sm font-semibold text-slate-800">{user.displayName}</span>
              <span className="text-xs text-slate-500 truncate">{user.email}</span>
              <span className="text-[10px] text-slate-400 capitalize">{user.role}</span>
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={handleSignOut}
            disabled={signingOut}
            className="cursor-pointer text-red-600 focus:text-red-600 focus:bg-red-50 gap-2"
          >
            {signingOut
              ? <Loader2 className="h-4 w-4 animate-spin" />
              : <LogOut className="h-4 w-4" />}
            Sign Out
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
