import type { Metadata } from "next"
import { LeadsShell } from "@/components/leads/LeadsShell"

export const metadata: Metadata = { title: "My Leads" }

export default function LeadsPage() {
  return <LeadsShell />
}
