import type { Metadata } from "next"
import { ReordersShell } from "@/components/reorders/ReordersShell"

export const metadata: Metadata = { title: "Reorders" }

export default function ReordersPage() {
  return <ReordersShell />
}
