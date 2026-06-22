import type { Metadata } from "next"
import localFont from "next/font/local"
import "./globals.css"
import { Sidebar } from "@/components/layout/Sidebar"
import { Header } from "@/components/layout/Header"
import { MobileNav } from "@/components/layout/MobileNav"
import { Toaster } from "@/components/ui/sonner"

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
  weight: "100 900",
})

const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
  weight: "100 900",
})

export const metadata: Metadata = {
  title: {
    default: "Nebsam CRM",
    template: "%s · Nebsam CRM",
  },
  description: "Lead management for Nebsam Digital Solutions",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        {/* Desktop sidebar */}
        <Sidebar />
        {/* Top header — full width on mobile, offset by sidebar on desktop */}
        <Header />
        {/* Main content — no left offset on mobile, sidebar offset on desktop */}
        <main className="pt-16 pb-20 lg:pb-0 lg:pl-60 min-h-screen bg-white">
          {children}
        </main>
        {/* Bottom tab bar — mobile only */}
        <MobileNav />
        <Toaster richColors />
      </body>
    </html>
  )
}
