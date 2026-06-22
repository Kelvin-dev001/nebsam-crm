import type { Metadata } from "next"
import { LeadDetailShell } from "@/components/leads/LeadDetailShell"

export const metadata: Metadata = { title: "Lead Detail" }

interface Props {
  params: { id: string }
}

export default function LeadDetailPage({ params }: Props) {
  return <LeadDetailShell leadId={params.id} />
}
