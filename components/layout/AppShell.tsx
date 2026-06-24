"use client"

import { usePathname } from "next/navigation"
import { Sidebar } from "./Sidebar"
import { Header } from "./Header"
import { MobileNav } from "./MobileNav"

// Renders the app chrome (sidebar, header, bottom nav) for all
// routes EXCEPT the /login page, which is full-screen on its own.

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const isAuthPage = pathname === "/login"

  if (isAuthPage) {
    return <>{children}</>
  }

  return (
    <>
      <Sidebar />
      <Header />
      <main className="pt-16 pb-20 lg:pb-0 lg:pl-60 min-h-screen bg-white">
        {children}
      </main>
      <MobileNav />
    </>
  )
}
