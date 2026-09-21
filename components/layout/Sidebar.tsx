"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Settings } from "lucide-react"
import { cn } from "@/lib/utils"
import { SignOutButton } from "./SignOutButton"
import { useDepartment } from "@/lib/departments/useDepartment"
import { navItemsFor } from "@/lib/departments/navItems"

const adminItem = { href: "/admin", label: "Admin", icon: Settings }

export function Sidebar() {
  const pathname = usePathname()
  const { department } = useDepartment()
  // Nav follows the department's post-sale model, so an e-seal rep gets
  // Reorders where telematics gets Renewals.
  const navItems = navItemsFor(department?.post_sale_model)

  return (
    <aside className="hidden lg:flex fixed inset-y-0 left-0 z-50 w-60 flex-col" style={{ backgroundColor: "#0F1729" }}>
      {/* Logo */}
      <div className="flex h-16 items-center px-6 border-b border-white/10">
        <div className="flex flex-col">
          <span className="text-white font-bold text-lg tracking-tight leading-tight">Nebsam CRM</span>
          {department && (
            <span
              className="text-[11px] font-medium leading-tight"
              style={{ color: department.accent_color }}
            >
              {department.name}
            </span>
          )}
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-1">
        {navItems.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
              pathname === href || pathname.startsWith(href + "/")
                ? "bg-white/15 text-white"
                : "text-white/60 hover:bg-white/10 hover:text-white"
            )}
          >
            <Icon className="h-4 w-4 shrink-0" />
            {label}
          </Link>
        ))}
      </nav>

      {/* Admin link + Sign Out at bottom */}
      <div className="px-3 py-4 border-t border-white/10 space-y-1">
        <Link
          href={adminItem.href}
          className={cn(
            "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
            pathname === adminItem.href
              ? "bg-white/15 text-white"
              : "text-white/60 hover:bg-white/10 hover:text-white"
          )}
        >
          <adminItem.icon className="h-4 w-4 shrink-0" />
          {adminItem.label}
        </Link>
        <SignOutButton />
      </div>
    </aside>
  )
}
