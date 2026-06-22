import type { Metadata } from "next"
import { AdminShell } from "@/components/admin/AdminShell"

export const metadata: Metadata = { title: "Admin" }

export default function AdminPage() {
  return <AdminShell />
}
