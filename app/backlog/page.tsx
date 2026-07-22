import type { Metadata } from "next"
import { BacklogShell } from "@/components/backlog/BacklogShell"

export const metadata: Metadata = { title: "Backlog" }

export default function BacklogPage() {
  return <BacklogShell />
}
