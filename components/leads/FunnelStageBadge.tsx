"use client"

import { cn } from "@/lib/utils"
import type { StageKey } from "@/types/crm"
import { useStagesFor } from "@/lib/departments/useDepartment"
import { stageBadgeClasses, stageLabel } from "@/lib/utils/funnelHelpers"

/**
 * Funnel stage badge, per department.
 *
 * Label and colour come from the `funnel_stages` config for the lead's
 * department, falling back to the original telematics map when no department is
 * given or the config has not loaded — so an existing telematics call site that
 * passes only `stage` renders exactly as it always has.
 *
 * An unknown key renders title-cased ("Board Review") rather than as raw
 * snake_case or an empty badge.
 */

interface Props {
  stage: StageKey
  /** The lead's department. Omit for the legacy telematics-only behaviour. */
  departmentId?: string | null
  className?: string
}

export function FunnelStageBadge({ stage, departmentId, className }: Props) {
  const stages = useStagesFor(departmentId)

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        stageBadgeClasses(stage, stages),
        className,
      )}
    >
      {stageLabel(stage, stages)}
    </span>
  )
}
