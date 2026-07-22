"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { LayoutDashboard, Users, RefreshCcw, Settings, Inbox } from "lucide-react"
import { cn } from "@/lib/utils"

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/leads",     label: "My Leads",  icon: Users },
  { href: "/backlog",   label: "Backlog",   icon: Inbox },
  { href: "/renewals",  label: "Renewals",  icon: RefreshCcw },
  { href: "/admin",     label: "Admin",     icon: Settings },
]

export function MobileNav() {
  const pathname = usePathname()

  return (
    <nav className="fixed bottom-0 inset-x-0 z-50 flex lg:hidden border-t border-slate-200 bg-white">
      {navItems.map(({ href, label, icon: Icon }) => {
        const active = pathname === href || pathname.startsWith(href + "/")
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex flex-1 flex-col items-center gap-1 py-3 text-[10px] font-medium transition-colors",
              active ? "text-blue-600" : "text-slate-400"
            )}
          >
            <Icon className={cn("h-5 w-5", active && "text-blue-600")} />
            {label}
          </Link>
        )
      })}
    </nav>
  )
}
