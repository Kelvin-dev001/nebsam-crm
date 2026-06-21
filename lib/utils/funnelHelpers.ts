import { FunnelStage, FUNNEL_STAGES, FUNNEL_STAGE_LABELS } from "@/types/crm"

export function getFunnelStageLabel(stage: FunnelStage): string {
  return FUNNEL_STAGE_LABELS[stage]
}

export function getFunnelStageIndex(stage: FunnelStage): number {
  return FUNNEL_STAGES.indexOf(stage)
}

export function isActiveLead(stage: FunnelStage): boolean {
  return !["lost", "unqualified", "renewed"].includes(stage)
}

export function isPostSale(stage: FunnelStage): boolean {
  return ["won", "installed", "post_sale", "renewal_due", "renewed"].includes(stage)
}

export const FUNNEL_STAGE_COLORS: Record<FunnelStage, string> = {
  new: "bg-slate-500",
  contacted: "bg-blue-500",
  interested: "bg-cyan-500",
  quote_sent: "bg-violet-500",
  negotiating: "bg-amber-500",
  won: "bg-green-600",
  installed: "bg-green-700",
  post_sale: "bg-teal-600",
  renewal_due: "bg-orange-500",
  renewed: "bg-emerald-600",
  lost: "bg-red-600",
  unqualified: "bg-slate-400",
}
