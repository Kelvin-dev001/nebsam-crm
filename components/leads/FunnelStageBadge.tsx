import { FunnelStage, FUNNEL_STAGE_LABELS } from "@/types/crm"
import { cn } from "@/lib/utils"

const STAGE_CLASSES: Record<FunnelStage, string> = {
  new:          "bg-slate-100 text-slate-600 border-slate-200",
  contacted:    "bg-blue-100 text-blue-700 border-blue-200",
  interested:   "bg-cyan-100 text-cyan-700 border-cyan-200",
  quote_sent:   "bg-violet-100 text-violet-700 border-violet-200",
  negotiating:  "bg-amber-100 text-amber-700 border-amber-200",
  won:          "bg-green-100 text-green-700 border-green-200",
  installed:    "bg-green-200 text-green-800 border-green-300",
  post_sale:    "bg-teal-100 text-teal-700 border-teal-200",
  sorted:       "bg-purple-100 text-purple-700 border-purple-200",
  renewal_due:  "bg-orange-100 text-orange-700 border-orange-200",
  renewed:      "bg-emerald-100 text-emerald-700 border-emerald-200",
  lost:         "bg-red-100 text-red-700 border-red-200",
  unqualified:  "bg-slate-100 text-slate-400 border-slate-200",
}

interface Props {
  stage: FunnelStage
  className?: string
}

export function FunnelStageBadge({ stage, className }: Props) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        STAGE_CLASSES[stage] ?? "bg-slate-100 text-slate-600 border-slate-200",
        className
      )}
    >
      {FUNNEL_STAGE_LABELS[stage] ?? stage}
    </span>
  )
}
