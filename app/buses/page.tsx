import type { Metadata } from "next"
import { BusRegisterShell } from "@/components/buses/BusRegisterShell"

export const metadata: Metadata = { title: "Bus Register" }

export default function BusesPage() {
  return <BusRegisterShell />
}
