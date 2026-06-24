import type { Metadata } from "next"
import localFont from "next/font/local"
import "./globals.css"
import { AppShell } from "@/components/layout/AppShell"
import { AlarmProvider } from "@/components/layout/AlarmProvider"
import { AuthProvider } from "@/components/layout/AuthProvider"
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
        <AppShell>
          {children}
        </AppShell>
        <Toaster richColors />
        <AuthProvider />
        <AlarmProvider />
      </body>
    </html>
  )
}
