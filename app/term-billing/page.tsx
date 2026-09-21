import type { Metadata } from "next"
import { TermBillingShell } from "@/components/billing/TermBillingShell"

export const metadata: Metadata = { title: "Term Billing" }

export default function TermBillingPage() {
  return <TermBillingShell />
}
