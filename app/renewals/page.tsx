import type { Metadata } from "next"
import { RenewalsShell } from "@/components/renewals/RenewalsShell"

export const metadata: Metadata = { title: "Renewals" }

export default function RenewalsPage() {
  return <RenewalsShell />
}
