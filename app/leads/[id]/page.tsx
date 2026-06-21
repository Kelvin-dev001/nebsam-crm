interface Props {
  params: { id: string }
}

export default function LeadDetailPage({ params }: Props) {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold text-slate-900">Lead Detail</h1>
      <p className="text-slate-500 mt-1">Lead ID: {params.id} — Coming in Sprint 6</p>
    </div>
  )
}
