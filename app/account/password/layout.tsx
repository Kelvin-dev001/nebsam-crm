import type { Metadata } from "next"
import { Suspense } from "react"

export const metadata: Metadata = { title: "Change Password" }

// Suspense because the page reads ?first=1 with useSearchParams. Scoped to this
// route rather than added to AppShell: AppShell wraps every page from the root
// layout, so a useSearchParams there would drag the whole app into dynamic
// rendering to answer one query string.
export default function AccountPasswordLayout({ children }: { children: React.ReactNode }) {
  return <Suspense>{children}</Suspense>
}
