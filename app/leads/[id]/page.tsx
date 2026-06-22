import { LeadDetailShell } from "@/components/leads/LeadDetailShell"

interface Props {
  params: { id: string }
}

export default function LeadDetailPage({ params }: Props) {
  return <LeadDetailShell leadId={params.id} />
}
