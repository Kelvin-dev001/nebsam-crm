import type { Metadata } from "next"
import { Suspense } from "react"

export const metadata: Metadata = { title: "Sign In · Nebsam CRM" }

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense>
      {children}
    </Suspense>
  )
}
