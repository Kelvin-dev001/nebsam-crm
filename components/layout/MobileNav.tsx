"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Settings } from "lucide-react"
import { cn } from "@/lib/utils"
import { useDepartment } from "@/lib/departments/useDepartment"
import { navItemsFor } from "@/lib/departments/navItems"

export function MobileNav() {
  const pathname = usePathname()
  const { department } = useDepartment()
  const navItems = [
    ...navItemsFor(department?.post_sale_model),
    { href: "/admin", label: "Admin", icon: Settings },
  ]

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
